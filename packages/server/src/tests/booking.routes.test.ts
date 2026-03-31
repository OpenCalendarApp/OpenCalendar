import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';

import type { NextFunction, Request, Response } from 'express';
import { bookingTokenParamsSchema, shareTokenParamsSchema } from '@session-scheduler/shared';

import { publicWriteRateLimiter } from '../middleware/rateLimit.js';
import {
  buildBookingPasswordAbuseKey,
  checkBookingPasswordLockout,
  clearBookingPasswordAbuseState,
  registerFailedBookingPasswordAttempt,
  resetBookingPasswordAbuseStateForTests
} from '../middleware/abuseProtection.js';

type MockResponse = Response & {
  statusCode: number;
  body?: unknown;
};

function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function createMockRequest(ip = '203.0.113.10'): Request {
  return {
    method: 'POST',
    originalUrl: '/api/schedule/book/demo',
    headers: {},
    ip,
    app: {
      get(key: string) {
        if (key === 'trust proxy') {
          return false;
        }

        return undefined;
      }
    }
  } as Request;
}

function createMockResponse(): MockResponse {
  const headers = new Map<string, string>();

  const response = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    }
  };

  return response as MockResponse;
}

async function invokeRateLimiter(ip = '203.0.113.10'): Promise<{ statusCode: number; nextCalled: boolean }> {
  const req = createMockRequest(ip);
  const res = createMockResponse();
  let nextCalled = false;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const resolveOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const next: NextFunction = (error?: unknown) => {
      if (error) {
        rejectOnce(error);
        return;
      }

      nextCalled = true;
      resolveOnce();
    };

    publicWriteRateLimiter(req, res, next);

    setImmediate(resolveOnce);
  });

  return {
    statusCode: res.statusCode,
    nextCalled
  };
}

void test('booking token schemas reject malformed token inputs', () => {
  assert.equal(shareTokenParamsSchema.safeParse({ shareToken: 'not-hex' }).success, false);
  assert.equal(bookingTokenParamsSchema.safeParse({ bookingToken: '1234' }).success, false);
});

void test('public write rate limiter throttles burst traffic', async () => {
  let throttledResponseCount = 0;

  for (let index = 0; index < 35; index += 1) {
    const result = await invokeRateLimiter();
    if (result.statusCode === 429 && !result.nextCalled) {
      throttledResponseCount += 1;
    }
  }

  assert.ok(throttledResponseCount > 0, 'Expected at least one throttled response');
});

void test('booking route keeps FOR UPDATE lock semantics for concurrency safety', async () => {
  const bookingRoutePath = new URL('../routes/booking.ts', import.meta.url);
  const source = await fs.readFile(bookingRoutePath, 'utf8');

  const forUpdateMatches = source.match(/FOR UPDATE/g) ?? [];
  assert.ok(forUpdateMatches.length >= 3, 'Expected at least 3 FOR UPDATE clauses in booking routes');

  assert.ok(source.includes("await client.query('BEGIN')"), 'Expected explicit transaction BEGIN');
  assert.ok(source.includes("await client.query('COMMIT')"), 'Expected explicit transaction COMMIT');
  assert.ok(source.includes('idempotency-key'), 'Expected idempotency key header support');
  assert.ok(source.includes('booking_idempotency_keys'), 'Expected booking idempotency table usage');
  assert.ok(source.includes('Idempotency-Replayed'), 'Expected idempotent replay response header');
  assert.ok(source.includes('Email domain is not allowed for this project'), 'Expected booking domain guard');
  assert.ok(source.includes('isEmailAllowedForProjectDomain'), 'Expected domain allowlist helper usage');
  assert.ok(source.includes('/waitlist/:shareToken'), 'Expected public waitlist route');
  assert.ok(source.includes('waitlist_entries'), 'Expected waitlist table usage in booking routes');
  assert.ok(source.includes('waitlist_opened'), 'Expected waitlist opening notification event');
  assert.ok(source.includes('enqueueMicrosoftCalendarSyncSafely'), 'Expected Microsoft calendar enqueue helper usage');
  assert.ok(source.includes('microsoft_calendar_sync_job_enqueue_failed'), 'Expected Microsoft calendar enqueue failure logging');
});

void test('booking password lockout progressively escalates after repeated failures', async () => {
  const previousEnv = {
    ABUSE_LOCKOUT_ENABLED: process.env.ABUSE_LOCKOUT_ENABLED,
    ABUSE_FAILURE_WINDOW_MS: process.env.ABUSE_FAILURE_WINDOW_MS,
    ABUSE_FAILURE_THRESHOLD: process.env.ABUSE_FAILURE_THRESHOLD,
    ABUSE_LOCKOUT_BASE_MS: process.env.ABUSE_LOCKOUT_BASE_MS,
    ABUSE_LOCKOUT_MAX_MS: process.env.ABUSE_LOCKOUT_MAX_MS,
    ABUSE_CAPTCHA_AFTER_LOCKOUTS: process.env.ABUSE_CAPTCHA_AFTER_LOCKOUTS
  };

  process.env.ABUSE_LOCKOUT_ENABLED = 'true';
  process.env.ABUSE_FAILURE_WINDOW_MS = '1000';
  process.env.ABUSE_FAILURE_THRESHOLD = '2';
  process.env.ABUSE_LOCKOUT_BASE_MS = '40';
  process.env.ABUSE_LOCKOUT_MAX_MS = '200';
  process.env.ABUSE_CAPTCHA_AFTER_LOCKOUTS = '2';
  resetBookingPasswordAbuseStateForTests();

  try {
    const key = buildBookingPasswordAbuseKey('demo-token', '198.51.100.42');

    const firstFailure = registerFailedBookingPasswordAttempt(key);
    assert.equal(firstFailure.locked, false);

    const firstLockout = registerFailedBookingPasswordAttempt(key);
    assert.equal(firstLockout.locked, true);
    assert.equal(firstLockout.lockoutLevel, 1);
    assert.equal(firstLockout.captchaRequired, false);

    await sleep(60);

    const afterFirstLockout = checkBookingPasswordLockout(key);
    assert.equal(afterFirstLockout.locked, false);

    registerFailedBookingPasswordAttempt(key);
    const secondLockout = registerFailedBookingPasswordAttempt(key);
    assert.equal(secondLockout.locked, true);
    assert.equal(secondLockout.lockoutLevel, 2);
    assert.equal(secondLockout.captchaRequired, true);

    clearBookingPasswordAbuseState(key);
    const clearedState = checkBookingPasswordLockout(key);
    assert.equal(clearedState.locked, false);
    assert.equal(clearedState.lockoutLevel, 0);
  } finally {
    restoreEnvVar('ABUSE_LOCKOUT_ENABLED', previousEnv.ABUSE_LOCKOUT_ENABLED);
    restoreEnvVar('ABUSE_FAILURE_WINDOW_MS', previousEnv.ABUSE_FAILURE_WINDOW_MS);
    restoreEnvVar('ABUSE_FAILURE_THRESHOLD', previousEnv.ABUSE_FAILURE_THRESHOLD);
    restoreEnvVar('ABUSE_LOCKOUT_BASE_MS', previousEnv.ABUSE_LOCKOUT_BASE_MS);
    restoreEnvVar('ABUSE_LOCKOUT_MAX_MS', previousEnv.ABUSE_LOCKOUT_MAX_MS);
    restoreEnvVar('ABUSE_CAPTCHA_AFTER_LOCKOUTS', previousEnv.ABUSE_CAPTCHA_AFTER_LOCKOUTS);
    resetBookingPasswordAbuseStateForTests();
  }
});
