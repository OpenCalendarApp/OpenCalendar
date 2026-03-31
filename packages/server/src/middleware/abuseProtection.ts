interface PasswordAttemptState {
  failures: number[];
  lockoutUntilMs: number;
  lockoutLevel: number;
  lastSeenMs: number;
}

type LockoutStatus = {
  locked: boolean;
  retryAfterSeconds: number;
  lockoutLevel: number;
  captchaRequired: boolean;
};

const bookingPasswordAttempts = new Map<string, PasswordAttemptState>();

function unlockedStatus(): LockoutStatus {
  return {
    locked: false,
    retryAfterSeconds: 0,
    lockoutLevel: 0,
    captchaRequired: false
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  return fallback;
}

function getConfig() {
  const failureWindowMs = parsePositiveInt(process.env.ABUSE_FAILURE_WINDOW_MS, 15 * 60_000);
  const failureThreshold = parsePositiveInt(process.env.ABUSE_FAILURE_THRESHOLD, 5);
  const lockoutBaseMs = parsePositiveInt(process.env.ABUSE_LOCKOUT_BASE_MS, 5 * 60_000);
  const lockoutMaxMs = parsePositiveInt(process.env.ABUSE_LOCKOUT_MAX_MS, 60 * 60_000);
  const captchaAfterLockouts = parsePositiveInt(process.env.ABUSE_CAPTCHA_AFTER_LOCKOUTS, 2);
  const enabled = parseBoolean(process.env.ABUSE_LOCKOUT_ENABLED, true);

  return {
    enabled,
    failureWindowMs,
    failureThreshold,
    lockoutBaseMs,
    lockoutMaxMs,
    captchaAfterLockouts
  };
}

function getOrCreateState(key: string, nowMs: number): PasswordAttemptState {
  const existing = bookingPasswordAttempts.get(key);
  if (existing) {
    existing.lastSeenMs = nowMs;
    return existing;
  }

  const state: PasswordAttemptState = {
    failures: [],
    lockoutUntilMs: 0,
    lockoutLevel: 0,
    lastSeenMs: nowMs
  };

  bookingPasswordAttempts.set(key, state);
  return state;
}

function pruneOldFailures(state: PasswordAttemptState, nowMs: number, failureWindowMs: number): void {
  state.failures = state.failures.filter((failureTimestamp) => nowMs - failureTimestamp <= failureWindowMs);
}

function cleanupStaleEntries(nowMs: number, staleAfterMs: number): void {
  for (const [key, state] of bookingPasswordAttempts.entries()) {
    const isLocked = state.lockoutUntilMs > nowMs;
    const hasRecentFailures = state.failures.length > 0;
    const isStale = nowMs - state.lastSeenMs > staleAfterMs;

    if (isStale && !isLocked && !hasRecentFailures) {
      bookingPasswordAttempts.delete(key);
    }
  }
}

function toLockoutStatus(state: PasswordAttemptState, nowMs: number, captchaAfterLockouts: number): LockoutStatus {
  const retryAfterMs = Math.max(state.lockoutUntilMs - nowMs, 0);
  return {
    locked: retryAfterMs > 0,
    retryAfterSeconds: Math.max(Math.ceil(retryAfterMs / 1000), 0),
    lockoutLevel: state.lockoutLevel,
    captchaRequired: state.lockoutLevel >= captchaAfterLockouts
  };
}

export function buildBookingPasswordAbuseKey(shareToken: string, ip: string | undefined): string {
  const normalizedIp = (ip ?? 'unknown').trim().toLowerCase();
  return `booking:${shareToken}:${normalizedIp}`;
}

export function checkBookingPasswordLockout(key: string, nowMs = Date.now()): LockoutStatus {
  const config = getConfig();
  if (!config.enabled) {
    return unlockedStatus();
  }

  const state = bookingPasswordAttempts.get(key);
  if (!state) {
    return unlockedStatus();
  }

  state.lastSeenMs = nowMs;
  pruneOldFailures(state, nowMs, config.failureWindowMs);

  if (state.lockoutUntilMs <= nowMs) {
    state.lockoutUntilMs = 0;
  }

  cleanupStaleEntries(nowMs, Math.max(config.failureWindowMs, config.lockoutMaxMs) * 2);
  return toLockoutStatus(state, nowMs, config.captchaAfterLockouts);
}

export function registerFailedBookingPasswordAttempt(key: string, nowMs = Date.now()): LockoutStatus {
  const config = getConfig();
  if (!config.enabled) {
    return unlockedStatus();
  }

  const state = getOrCreateState(key, nowMs);
  pruneOldFailures(state, nowMs, config.failureWindowMs);

  if (state.lockoutUntilMs > nowMs) {
    return toLockoutStatus(state, nowMs, config.captchaAfterLockouts);
  }

  state.failures.push(nowMs);

  if (state.failures.length >= config.failureThreshold) {
    state.lockoutLevel += 1;
    const scaledLockoutMs = config.lockoutBaseMs * (2 ** Math.max(state.lockoutLevel - 1, 0));
    const lockoutDurationMs = Math.min(scaledLockoutMs, config.lockoutMaxMs);
    state.lockoutUntilMs = nowMs + lockoutDurationMs;
    state.failures = [];
  }

  cleanupStaleEntries(nowMs, Math.max(config.failureWindowMs, config.lockoutMaxMs) * 2);
  return toLockoutStatus(state, nowMs, config.captchaAfterLockouts);
}

export function clearBookingPasswordAbuseState(key: string): void {
  bookingPasswordAttempts.delete(key);
}

export function resetBookingPasswordAbuseStateForTests(): void {
  bookingPasswordAttempts.clear();
}
