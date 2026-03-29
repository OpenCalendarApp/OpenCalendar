import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

import type { NextFunction, Request, Response } from 'express';
import { bookingTokenParamsSchema, shareTokenParamsSchema } from '@session-scheduler/shared';

import { publicWriteRateLimiter } from '../middleware/rateLimit.js';

type MockResponse = Response & {
  statusCode: number;
  body?: unknown;
};

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
});
