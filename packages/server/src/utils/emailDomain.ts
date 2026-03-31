const ROOT_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeProjectEmailDomainAllowlist(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  if (!ROOT_DOMAIN_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

export function isEmailAllowedForProjectDomain(
  email: string,
  allowlistedDomain: string | null | undefined
): boolean {
  if (allowlistedDomain === undefined || allowlistedDomain === null) {
    return true;
  }

  const normalizedAllowlist = allowlistedDomain.trim().toLowerCase();
  if (normalizedAllowlist.length === 0) {
    return true;
  }
  if (!ROOT_DOMAIN_PATTERN.test(normalizedAllowlist)) {
    return false;
  }

  const trimmedEmail = email.trim().toLowerCase();
  const atSymbolIndex = trimmedEmail.lastIndexOf('@');
  if (atSymbolIndex <= 0 || atSymbolIndex === trimmedEmail.length - 1) {
    return false;
  }

  const emailDomain = trimmedEmail.slice(atSymbolIndex + 1);
  return emailDomain === normalizedAllowlist || emailDomain.endsWith(`.${normalizedAllowlist}`);
}
