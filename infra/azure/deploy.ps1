<#
.SYNOPSIS
    Provisions the Azure baseline described in docs/AZURE_DEPLOYMENT_PLAN.md and
    infra/azure/README.md: Front Door Premium -> Container Apps (client, server)
    -> PostgreSQL Flexible Server, backed by ACR.

.DESCRIPTION
    PowerShell equivalent of infra/azure/deploy.sh - same steps, same resource
    names, same manifests. Prereqs: az CLI logged in (`az login`), docker NOT
    required locally (uses `az acr build`), an Azure subscription with quota for
    Container Apps + Front Door Premium + Postgres Flexible Server.

.EXAMPLE
    Copy-Item infra/azure/deploy.env.ps1.example infra/azure/deploy.env.ps1
    # fill in deploy.env.ps1 with real values
    . .\infra\azure\deploy.env.ps1
    .\infra\azure\deploy.ps1

.NOTES
    Re-running is mostly safe (az ... create is idempotent for most resources)
    but Postgres server creation and Front Door domain validation are not
    instant - read the output at each step before moving on.
#>

$ErrorActionPreference = 'Stop'

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $RootDir
try {

function Invoke-Checked {
    param([Parameter(Mandatory)][ScriptBlock]$Script)
    & $Script
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Script"
    }
}

function Get-RequiredEnvVar {
    param([Parameter(Mandatory)][string]$Name)
    $value = [System.Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrEmpty($value)) {
        throw "Set `$env:$Name before running this script, e.g. via deploy.env.ps1"
    }
    return $value
}

function Get-OptionalEnvVar {
    param([Parameter(Mandatory)][string]$Name, [string]$Default = "")
    $value = [System.Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrEmpty($value)) { return $Default }
    return $value
}

function New-RandomHex {
    param([int]$Bytes = 32)
    $buffer = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)
    return [System.Convert]::ToHexString($buffer).ToLowerInvariant()
}

$ResourceGroup      = Get-RequiredEnvVar "RESOURCE_GROUP"
$Location           = Get-RequiredEnvVar "LOCATION"
$AcrName            = Get-RequiredEnvVar "ACR_NAME"
$EnvName            = Get-RequiredEnvVar "ENV_NAME"
$LogAnalyticsName   = Get-RequiredEnvVar "LOG_ANALYTICS_NAME"
$PgServerName       = Get-RequiredEnvVar "PG_SERVER_NAME"
$PgAdminUser        = Get-RequiredEnvVar "PG_ADMIN_USER"
$PgAdminPassword    = Get-RequiredEnvVar "PG_ADMIN_PASSWORD"
$PgDbName           = Get-OptionalEnvVar "PG_DB_NAME" "opencalendar"
$AppDomain          = Get-RequiredEnvVar "APP_DOMAIN"
$AfdProfileName     = Get-OptionalEnvVar "AFD_PROFILE_NAME" "opencalendar-fd"
$AfdEndpointName    = Get-OptionalEnvVar "AFD_ENDPOINT_NAME" "opencalendar"
$JwtSecret          = Get-OptionalEnvVar "JWT_SECRET" (New-RandomHex -Bytes 32)
$MetricsToken       = Get-OptionalEnvVar "METRICS_TOKEN" (New-RandomHex -Bytes 24)
$EmailFrom          = Get-OptionalEnvVar "EMAIL_FROM" "no-reply@$AppDomain"
$ResendApiKey       = Get-OptionalEnvVar "RESEND_API_KEY" ""
$MicrosoftClientId  = Get-OptionalEnvVar "MICROSOFT_CLIENT_ID" ""
$MicrosoftClientSecret = Get-OptionalEnvVar "MICROSOFT_CLIENT_SECRET" ""

Write-Host "== 1. Resource group ==" -ForegroundColor Cyan
Invoke-Checked { az group create -n $ResourceGroup -l $Location -o table }

Write-Host "== 2. Container registry ==" -ForegroundColor Cyan
Invoke-Checked { az acr create -g $ResourceGroup -n $AcrName --sku Basic -o table }
$AcrLoginServer = az acr show -n $AcrName --query loginServer -o tsv
if ($LASTEXITCODE -ne 0) { throw "Failed to read ACR login server" }

Write-Host "== 3. Build + push images via ACR build (no local docker needed) ==" -ForegroundColor Cyan
Invoke-Checked { az acr build -r $AcrName -t "opencalendar/server:latest" -f "packages/server/Dockerfile" . }
Invoke-Checked { az acr build -r $AcrName -t "opencalendar/client:latest" -f "packages/client/Dockerfile" . }

Write-Host "== 4. Log Analytics + Container Apps environment ==" -ForegroundColor Cyan
Invoke-Checked { az monitor log-analytics workspace create -g $ResourceGroup -n $LogAnalyticsName -o table }
$LogId  = az monitor log-analytics workspace show -g $ResourceGroup -n $LogAnalyticsName --query customerId -o tsv
$LogKey = az monitor log-analytics workspace get-shared-keys -g $ResourceGroup -n $LogAnalyticsName --query primarySharedKey -o tsv

az extension add --name containerapp --upgrade -o none 2>$null
az provider register --namespace Microsoft.App -o none
az provider register --namespace Microsoft.OperationalInsights -o none

Invoke-Checked {
    az containerapp env create -g $ResourceGroup -n $EnvName -l $Location `
        --logs-workspace-id $LogId --logs-workspace-key $LogKey -o table
}
$ManagedEnvironmentId = az containerapp env show -g $ResourceGroup -n $EnvName --query id -o tsv

Write-Host "== 5. PostgreSQL Flexible Server ==" -ForegroundColor Cyan
# Public access + SSL required, restricted to Azure-internal callers. Revisit
# with VNET-injected Container Apps env + private endpoint once this baseline
# needs to move past a single-region single-replica setup (see
# docs/AZURE_DEPLOYMENT_PLAN.md decision matrix).
Invoke-Checked {
    az postgres flexible-server create `
        -g $ResourceGroup -n $PgServerName -l $Location `
        --admin-user $PgAdminUser --admin-password $PgAdminPassword `
        --sku-name Standard_B1ms --tier Burstable --storage-size 32 `
        --version 16 --public-access "0.0.0.0-0.0.0.0" -o table
}
Invoke-Checked { az postgres flexible-server db create -g $ResourceGroup -s $PgServerName -d $PgDbName -o table }
Invoke-Checked {
    az postgres flexible-server parameter set `
        -g $ResourceGroup -s $PgServerName --name require_secure_transport --value on -o table
}

$PgHost = "$PgServerName.postgres.database.azure.com"
$DatabaseUrl = "postgresql://${PgAdminUser}:${PgAdminPassword}@${PgHost}:5432/${PgDbName}?sslmode=require"

Write-Host "== 6. Run schema migration from this machine ==" -ForegroundColor Cyan
$MyIp = (Invoke-RestMethod -Uri "https://api.ipify.org").Trim()
Invoke-Checked {
    az postgres flexible-server firewall-rule create `
        -g $ResourceGroup -n $PgServerName --rule-name allow-deploy-machine `
        --start-ip-address $MyIp --end-ip-address $MyIp -o table
}

$env:DATABASE_URL = $DatabaseUrl
try {
    Invoke-Checked { npm run db:migrate -w @opencalendar/server }
}
finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}

Invoke-Checked {
    az postgres flexible-server firewall-rule delete `
        -g $ResourceGroup -n $PgServerName --rule-name allow-deploy-machine --yes
}

Write-Host "== 7. Deploy server container app (internal ingress) ==" -ForegroundColor Cyan
$ServerManifestPath = Join-Path ([System.IO.Path]::GetTempPath()) "opencalendar-server.containerapp.yaml"
(Get-Content "infra/azure/container-apps/server.containerapp.yaml" -Raw).
    Replace("__MANAGED_ENVIRONMENT_ID__", $ManagedEnvironmentId).
    Replace("__ACR_LOGIN_SERVER__", $AcrLoginServer).
    Replace("__SERVER_IMAGE__", "$AcrLoginServer/opencalendar/server:latest").
    Replace("__DATABASE_URL__", $DatabaseUrl).
    Replace("__JWT_SECRET__", $JwtSecret).
    Replace("__METRICS_TOKEN__", $MetricsToken).
    Replace("__RESEND_API_KEY__", $ResendApiKey).
    Replace("__MICROSOFT_CLIENT_ID__", $MicrosoftClientId).
    Replace("__MICROSOFT_CLIENT_SECRET__", $MicrosoftClientSecret).
    Replace("calendar.example.com", $AppDomain) |
    Set-Content -Path $ServerManifestPath -NoNewline

Invoke-Checked { az containerapp create -g $ResourceGroup --yaml $ServerManifestPath -o table }
Invoke-Checked {
    az containerapp registry set -g $ResourceGroup -n opencalendar-server `
        --server $AcrLoginServer --identity system
}
$ServerInternalOrigin = "https://" + (az containerapp show -g $ResourceGroup -n opencalendar-server --query properties.configuration.ingress.fqdn -o tsv)

Write-Host "== 8. Deploy client container app (external ingress) ==" -ForegroundColor Cyan
$ClientManifestPath = Join-Path ([System.IO.Path]::GetTempPath()) "opencalendar-client.containerapp.yaml"
(Get-Content "infra/azure/container-apps/client.containerapp.yaml" -Raw).
    Replace("__MANAGED_ENVIRONMENT_ID__", $ManagedEnvironmentId).
    Replace("__ACR_LOGIN_SERVER__", $AcrLoginServer).
    Replace("__CLIENT_IMAGE__", "$AcrLoginServer/opencalendar/client:latest").
    Replace("__SERVER_INTERNAL_ORIGIN__", $ServerInternalOrigin) |
    Set-Content -Path $ClientManifestPath -NoNewline

Invoke-Checked { az containerapp create -g $ResourceGroup --yaml $ClientManifestPath -o table }
Invoke-Checked {
    az containerapp registry set -g $ResourceGroup -n opencalendar-client `
        --server $AcrLoginServer --identity system
}
$ClientFqdn = az containerapp show -g $ResourceGroup -n opencalendar-client --query properties.configuration.ingress.fqdn -o tsv

Write-Host "== 9. Front Door Premium in front of the client app ==" -ForegroundColor Cyan
Invoke-Checked { az afd profile create -g $ResourceGroup -n $AfdProfileName --sku Premium_AzureFrontDoor -o table }
Invoke-Checked { az afd endpoint create -g $ResourceGroup --profile-name $AfdProfileName -n $AfdEndpointName -o table }

Invoke-Checked {
    az afd origin-group create -g $ResourceGroup --profile-name $AfdProfileName `
        -n opencalendar-origin-group `
        --probe-request-type GET --probe-protocol Https --probe-path "/" --probe-interval-in-seconds 30 `
        --sample-size 4 --successful-samples-required 3 -o table
}

Invoke-Checked {
    az afd origin create -g $ResourceGroup --profile-name $AfdProfileName `
        --origin-group-name opencalendar-origin-group -n opencalendar-client-origin `
        --host-name $ClientFqdn --origin-host-header $ClientFqdn `
        --http-port 80 --https-port 443 --priority 1 --weight 1000 --enabled-state Enabled -o table
}

Invoke-Checked {
    az afd route create -g $ResourceGroup --profile-name $AfdProfileName `
        --endpoint-name $AfdEndpointName -n opencalendar-route `
        --origin-group opencalendar-origin-group --supported-protocols Https Http `
        --https-redirect Enabled --forwarding-protocol HttpsOnly --link-to-default-domain Enabled -o table
}

Write-Host ""
Write-Host "Default Front Door hostname (works immediately, use for a smoke test):" -ForegroundColor Green
az afd endpoint show -g $ResourceGroup --profile-name $AfdProfileName -n $AfdEndpointName --query hostName -o tsv

Write-Host @"

== Remaining manual steps ==
1. Custom domain: az afd custom-domain create ... for $AppDomain, then add the
   validation TXT record + CNAME it gives you at your DNS provider, then
   az afd route update ... --custom-domains to attach it to the route.
2. WAF: Front Door Premium supports a managed WAF policy - attach one via
   az afd security-policy create if this app will be internet-facing long-term.
3. Store JWT_SECRET / METRICS_TOKEN / PG_ADMIN_PASSWORD somewhere durable
   (Key Vault recommended) - they only exist in this session's env right now.
4. Confirm CORS_ORIGIN / BOOKING_PORTAL_BASE_URL / MICROSOFT_REDIRECT_URI on the
   server app match https://$AppDomain exactly (the replace above assumes the
   manifest's placeholder domain was calendar.example.com).
"@

}
finally {
    Pop-Location
}
