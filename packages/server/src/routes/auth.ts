import bcrypt from 'bcrypt';
import { Router } from 'express';

import { loginSchema, registerSchema, type User } from '@session-scheduler/shared';

import { authMiddleware, signToken } from '../middleware/auth.js';
import { pool } from '../db/pool.js';

const router = Router();

type UserRow = User & { password_hash: string };

router.post('/register', async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const { email, password, first_name, last_name, phone, role } = parse.data;
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await pool.query<UserRow>(
      `
      INSERT INTO users (email, first_name, last_name, phone, role, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, first_name, last_name, phone, role, created_at, password_hash
      `,
      [email.toLowerCase(), first_name, last_name, phone ?? null, role, passwordHash]
    );

    const user = result.rows[0];
    if (!user) {
      res.status(500).json({ error: 'Unable to register user' });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    res.status(201).json({ token, user: omitPasswordHash(user) });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'Email already exists' });
      return;
    }

    res.status(500).json({ error: 'Unable to register user', details: error });
  }
});

router.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const { email, password } = parse.data;

  const result = await pool.query<UserRow>(
    `
    SELECT id, email, first_name, last_name, phone, role, created_at, password_hash
    FROM users
    WHERE email = $1
    `,
    [email.toLowerCase()]
  );

  const user = result.rows[0];
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  res.json({ token, user: omitPasswordHash(user) });
});

router.get('/me', authMiddleware, async (req, res) => {
  const result = await pool.query<User>(
    `
    SELECT id, email, first_name, last_name, phone, role, created_at
    FROM users
    WHERE id = $1
    `,
    [req.user?.userId]
  );

  const user = result.rows[0];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ user });
});

router.get('/engineers', authMiddleware, async (_req, res) => {
  const result = await pool.query<User>(
    `
    SELECT id, email, first_name, last_name, phone, role, created_at
    FROM users
    WHERE role = 'engineer'
    ORDER BY first_name ASC, last_name ASC
    `
  );

  res.json({ engineers: result.rows });
});

function omitPasswordHash(user: UserRow): User {
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    phone: user.phone,
    role: user.role,
    created_at: user.created_at
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export default router;
