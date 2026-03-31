import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NextFunction, Request, Response } from 'express';

import { authMiddleware, requireRole, signToken } from '../middleware/auth.js';

process.env.JWT_SECRET ??= 'test-jwt-secret';

function createMockRequest(headers: Record<string, string> = {}): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    }
  } as Request;
}

function createMockResponse(): Response & { body?: unknown; statusCode: number } {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };

  return response as Response & { body?: unknown; statusCode: number };
}

void test('auth middleware returns 401 when token is missing', () => {
  const req = createMockRequest();
  const res = createMockResponse();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  authMiddleware(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Missing authentication token' });
});

void test('auth middleware sets req.user and calls next for valid token', () => {
  const token = signToken({
    userId: 1,
    tenantId: 1,
    tenantUid: '00000000-0000-0000-0000-000000000001',
    email: 'pm@example.com',
    role: 'pm'
  });

  const req = createMockRequest({
    authorization: `Bearer ${token}`
  });
  const res = createMockResponse();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  authMiddleware(req, res, next);

  assert.equal(nextCalled, true);
  assert.ok(req.user);
  assert.equal(req.user?.role, 'pm');
});

void test('role middleware blocks users outside allowed roles', () => {
  const req = createMockRequest();
  req.user = {
    userId: 2,
    tenantId: 1,
    tenantUid: '00000000-0000-0000-0000-000000000001',
    email: 'engineer@example.com',
    role: 'engineer'
  };

  const res = createMockResponse();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  requireRole(['pm'])(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Insufficient permissions' });
});
