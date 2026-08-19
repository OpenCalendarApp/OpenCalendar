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
    Safe to re-run after a partial failure: every resource-creation step first
    checks whether the resource already exists and skips straight to reading
    its outputs if so. The ACR image build and the DB migration always run
    (cheap, and idempotent on their own), since a re-run after fixing a build
    or migration bug should pick up the new code. Postgres server creation and
    Front Door domain validation are not instant - read the output at each
    step before moving on.
#>

$ErrorActionPreference = 'Stop'

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $RootDir
try {

function Invoke-Checked {
    # Checks $LASTEXITCODE itself, so native-command stderr chatter (npm warn,
    # az CLI preview-extension notices, etc.) must not be allowed to get
    # promoted into a script-terminating exception ahead of that check.
    param([Parameter(Mandatory)][ScriptBlock]$Script)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Script
    } finally {
        $ErrorActionPreference = $prevEap
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Script"
    }
}

function Remove-OptionalSecret {
    # Container Apps rejects a secret whose value is blank ("value or
    # keyVaultUrl and identity should be provided"), so an unconfigured
    # optional integration (Resend, Microsoft OAuth, ...) must drop its
    # secret entry and its referencing env var's secretRef entirely rather
    # than substitute an empty value into the manifest.
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][string]$SecretName,
        [Parameter(Mandatory)][string]$EnvVarName,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Value
    )
    if (-not [string]::IsNullOrEmpty($Value)) { return $Text }
    $Text = $Text -replace "(?m)^ *- name: $SecretName\r?\n *value: .*\r?\n", ""
    $Text = $Text -replace "(?m)(^ *- name: $EnvVarName\r?\n) *secretRef: $SecretName\r?\n", "`${1}            value: `"`"`r`n"
    return $Text
}

function Invoke-Quiet {
    # Runs a command with $ErrorActionPreference relaxed so that benign stderr
    # chatter (e.g. az CLI "no stable version, using preview" notices) doesn't
    # get promoted into a script-terminating exception. Use for best-effort
    # setup calls where the exit code isn't checked.
    param([Parameter(Mandatory)][ScriptBlock]$Script)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Script
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Test-AzResource {
    param([Parameter(Mandatory)][ScriptBlock]$Show)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        & $Show 2>$null 1>$null
    } catch {
        # Resource doesn't exist (or lookup failed) - treated the same: fall through to create.
    } finally {
        $ErrorActionPreference = $prevEap
    }
    return $LASTEXITCODE -eq 0
}

function New-IfMissing {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][ScriptBlock]$Show,
        [Parameter(Mandatory)][ScriptBlock]$Create
    )
    if (Test-AzResource $Show) {
        Write-Host "  $Name already exists, skipping create" -ForegroundColor DarkGray
    } else {
        Invoke-Checked $Create
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
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }
    return -join ($buffer | ForEach-Object { $_.ToString("x2") })
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
New-IfMissing -Name "Resource group $ResourceGroup" `
    -Show { az group show -n $ResourceGroup -o none } `
    -Create { az group create -n $ResourceGroup -l $Location -o table }

Write-Host "== 2. Container registry ==" -ForegroundColor Cyan
New-IfMissing -Name "ACR $AcrName" `
    -Show { az acr show -g $ResourceGroup -n $AcrName -o none } `
    -Create { az acr create -g $ResourceGroup -n $AcrName --sku Basic -o table }
$AcrLoginServer = az acr show -n $AcrName --query loginServer -o tsv
if ($LASTEXITCODE -ne 0) { throw "Failed to read ACR login server" }

# Container apps authenticate to the registry with the admin user/password
# rather than a system-assigned managed identity: identity-based pull needs
# an AcrPull role assignment, which requires Owner/User Access Administrator
# on the subscription - this account only has Contributor.
Invoke-Checked { az acr update -n $AcrName --admin-enabled true -o none }
$AcrUsername = az acr credential show -n $AcrName --query username -o tsv
$AcrPassword = az acr credential show -n $AcrName --query "passwords[0].value" -o tsv

Write-Host "== 3. Build + push images via ACR build (no local docker needed) ==" -ForegroundColor Cyan
Invoke-Checked { az acr build -r $AcrName -t "opencalendar/server:latest" -f "packages/server/Dockerfile" . }
Invoke-Checked { az acr build -r $AcrName -t "opencalendar/client:latest" -f "packages/client/Dockerfile" . }

Write-Host "== 4. Log Analytics + Container Apps environment ==" -ForegroundColor Cyan
New-IfMissing -Name "Log Analytics workspace $LogAnalyticsName" `
    -Show { az monitor log-analytics workspace show -g $ResourceGroup -n $LogAnalyticsName -o none } `
    -Create { az monitor log-analytics workspace create -g $ResourceGroup -n $LogAnalyticsName -o table }
$LogId  = az monitor log-analytics workspace show -g $ResourceGroup -n $LogAnalyticsName --query customerId -o tsv
$LogKey = az monitor log-analytics workspace get-shared-keys -g $ResourceGroup -n $LogAnalyticsName --query primarySharedKey -o tsv

Invoke-Quiet { az extension add --name containerapp --upgrade -o none }
Invoke-Quiet { az provider register --namespace Microsoft.App -o none }
Invoke-Quiet { az provider register --namespace Microsoft.OperationalInsights -o none }

New-IfMissing -Name "Container Apps environment $EnvName" `
    -Show { az containerapp env show -g $ResourceGroup -n $EnvName -o none } `
    -Create {
        az containerapp env create -g $ResourceGroup -n $EnvName -l $Location `
            --logs-workspace-id $LogId --logs-workspace-key $LogKey -o table
    }
$ManagedEnvironmentId = az containerapp env show -g $ResourceGroup -n $EnvName --query id -o tsv

Write-Host "== 5. PostgreSQL Flexible Server ==" -ForegroundColor Cyan
# Public access + SSL required, restricted to Azure-internal callers. Revisit
# with VNET-injected Container Apps env + private endpoint once this baseline
# needs to move past a single-region single-replica setup (see
# docs/AZURE_DEPLOYMENT_PLAN.md decision matrix).
New-IfMissing -Name "Postgres server $PgServerName" `
    -Show { az postgres flexible-server show -g $ResourceGroup -n $PgServerName -o none } `
    -Create {
        # -o none, not -o table: this command's nested response (server +
        # default db + firewall rule) makes the table formatter itself fail
        # and exit 1 even when the server was created successfully.
        az postgres flexible-server create `
            -g $ResourceGroup -n $PgServerName -l $Location `
            --admin-user $PgAdminUser --admin-password $PgAdminPassword `
            --sku-name Standard_B1ms --tier Burstable --storage-size 32 `
            --version 16 --public-access "0.0.0.0-0.0.0.0" -o none
    }
New-IfMissing -Name "Postgres database $PgDbName" `
    -Show { az postgres flexible-server db show -g $ResourceGroup -s $PgServerName -d $PgDbName -o none } `
    -Create { az postgres flexible-server db create -g $ResourceGroup -s $PgServerName -d $PgDbName -o none }
Invoke-Checked {
    az postgres flexible-server parameter set `
        -g $ResourceGroup -s $PgServerName --name require_secure_transport --value on -o none
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
$ServerManifest = (Get-Content "infra/azure/container-apps/server.containerapp.yaml" -Raw).
    Replace("__LOCATION__", $Location).
    Replace("__MANAGED_ENVIRONMENT_ID__", $ManagedEnvironmentId).
    Replace("__ACR_LOGIN_SERVER__", $AcrLoginServer).
    Replace("__ACR_USERNAME__", $AcrUsername).
    Replace("__ACR_PASSWORD__", $AcrPassword).
    Replace("__SERVER_IMAGE__", "$AcrLoginServer/opencalendar/server:latest").
    Replace("__DATABASE_URL__", $DatabaseUrl).
    Replace("__JWT_SECRET__", $JwtSecret).
    Replace("__METRICS_TOKEN__", $MetricsToken).
    Replace("__RESEND_API_KEY__", $ResendApiKey).
    Replace("__MICROSOFT_CLIENT_ID__", $MicrosoftClientId).
    Replace("__MICROSOFT_CLIENT_SECRET__", $MicrosoftClientSecret).
    Replace("calendar.example.com", $AppDomain)
$ServerManifest = Remove-OptionalSecret -Text $ServerManifest -SecretName "resend-api-key" -EnvVarName "RESEND_API_KEY" -Value $ResendApiKey
$ServerManifest = Remove-OptionalSecret -Text $ServerManifest -SecretName "microsoft-client-id" -EnvVarName "MICROSOFT_CLIENT_ID" -Value $MicrosoftClientId
$ServerManifest = Remove-OptionalSecret -Text $ServerManifest -SecretName "microsoft-client-secret" -EnvVarName "MICROSOFT_CLIENT_SECRET" -Value $MicrosoftClientSecret
Set-Content -Path $ServerManifestPath -Value $ServerManifest -NoNewline

New-IfMissing -Name "Container app opencalendar-server" `
    -Show { az containerapp show -g $ResourceGroup -n opencalendar-server -o none } `
    -Create { az containerapp create -g $ResourceGroup -n opencalendar-server --yaml $ServerManifestPath -o table }
# Reconciles an existing app to the manifest too (not just fresh creates):
# heals anything left over from earlier failed attempts (e.g. the old
# managed-identity registry config) since this always supplies the full
# desired state, unlike a partial/flag-based update.
Invoke-Checked { az containerapp update -g $ResourceGroup -n opencalendar-server --yaml $ServerManifestPath -o table }
$ServerInternalOrigin = "https://" + (az containerapp show -g $ResourceGroup -n opencalendar-server --query properties.configuration.ingress.fqdn -o tsv)

Write-Host "== 8. Deploy client container app (external ingress) ==" -ForegroundColor Cyan
$ClientManifestPath = Join-Path ([System.IO.Path]::GetTempPath()) "opencalendar-client.containerapp.yaml"
(Get-Content "infra/azure/container-apps/client.containerapp.yaml" -Raw).
    Replace("__LOCATION__", $Location).
    Replace("__MANAGED_ENVIRONMENT_ID__", $ManagedEnvironmentId).
    Replace("__ACR_LOGIN_SERVER__", $AcrLoginServer).
    Replace("__ACR_USERNAME__", $AcrUsername).
    Replace("__ACR_PASSWORD__", $AcrPassword).
    Replace("__CLIENT_IMAGE__", "$AcrLoginServer/opencalendar/client:latest").
    Replace("__SERVER_INTERNAL_ORIGIN__", $ServerInternalOrigin) |
    Set-Content -Path $ClientManifestPath -NoNewline

New-IfMissing -Name "Container app opencalendar-client" `
    -Show { az containerapp show -g $ResourceGroup -n opencalendar-client -o none } `
    -Create { az containerapp create -g $ResourceGroup -n opencalendar-client --yaml $ClientManifestPath -o table }
Invoke-Checked { az containerapp update -g $ResourceGroup -n opencalendar-client --yaml $ClientManifestPath -o table }
$ClientFqdn = az containerapp show -g $ResourceGroup -n opencalendar-client --query properties.configuration.ingress.fqdn -o tsv

Write-Host "== 9. Front Door Premium in front of the client app ==" -ForegroundColor Cyan
New-IfMissing -Name "Front Door profile $AfdProfileName" `
    -Show { az afd profile show -g $ResourceGroup -n $AfdProfileName -o none } `
    -Create { az afd profile create -g $ResourceGroup -n $AfdProfileName --sku Premium_AzureFrontDoor -o table }

New-IfMissing -Name "Front Door endpoint $AfdEndpointName" `
    -Show { az afd endpoint show -g $ResourceGroup --profile-name $AfdProfileName -n $AfdEndpointName -o none } `
    -Create { az afd endpoint create -g $ResourceGroup --profile-name $AfdProfileName -n $AfdEndpointName -o table }

New-IfMissing -Name "Front Door origin group opencalendar-origin-group" `
    -Show { az afd origin-group show -g $ResourceGroup --profile-name $AfdProfileName -n opencalendar-origin-group -o none } `
    -Create {
        az afd origin-group create -g $ResourceGroup --profile-name $AfdProfileName `
            -n opencalendar-origin-group `
            --probe-request-type GET --probe-protocol Https --probe-path "/" --probe-interval-in-seconds 30 `
            --sample-size 4 --successful-samples-required 3 -o table
    }

New-IfMissing -Name "Front Door origin opencalendar-client-origin" `
    -Show { az afd origin show -g $ResourceGroup --profile-name $AfdProfileName --origin-group-name opencalendar-origin-group -n opencalendar-client-origin -o none } `
    -Create {
        az afd origin create -g $ResourceGroup --profile-name $AfdProfileName `
            --origin-group-name opencalendar-origin-group -n opencalendar-client-origin `
            --host-name $ClientFqdn --origin-host-header $ClientFqdn `
            --http-port 80 --https-port 443 --priority 1 --weight 1000 --enabled-state Enabled -o table
    }

New-IfMissing -Name "Front Door route opencalendar-route" `
    -Show { az afd route show -g $ResourceGroup --profile-name $AfdProfileName --endpoint-name $AfdEndpointName -n opencalendar-route -o none } `
    -Create {
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
