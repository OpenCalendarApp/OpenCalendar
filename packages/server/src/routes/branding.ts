import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';

import {
  tenantUidParamsSchema,
  updateBrandingSchema,
  type TenantBranding,
  type TenantBrandingResponse,
  type PublicTenantBrandingResponse
} from '@opencalendar/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

/* ─── Constants ─────────────────────────────────────────────────────────── */

const LOGO_MAX_SIZE = 500 * 1024; // 500 KB
const LOGO_MAX_WIDTH = 400;
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/svg+xml'
]);

const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads', 'logos')
);

/* ─── Ensure uploads directory ──────────────────────────────────────────── */

function ensureUploadsDir(): void {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

/* ─── Multer config (memory storage for processing) ─────────────────────── */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PNG, JPG, SVG'));
    }
  }
});

/* ─── Helper: build logo filename ───────────────────────────────────────── */

function logoFilename(tenantUid: string, ext: string): string {
  return `${tenantUid}${ext}`;
}

function extForMime(mime: string): string {
  if (mime === 'image/svg+xml') return '.svg';
  if (mime === 'image/png') return '.png';
  return '.jpg';
}

/* ─── Helper: delete existing logo file ─────────────────────────────────── */

function deleteLogoFile(tenantUid: string): void {
  for (const ext of ['.png', '.jpg', '.svg']) {
    const filePath = path.join(UPLOADS_DIR, logoFilename(tenantUid, ext));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC ROUTES — no auth required
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/branding/:tenantUid
 * Returns branding data (logo_url, accent_color) for public pages.
 */
router.get('/:tenantUid', asyncHandler(async (req, res) => {
  const paramsParse = tenantUidParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid tenant identifier', details: paramsParse.error.flatten() });
    return;
  }

  const { tenantUid } = paramsParse.data;

  const result = await pool.query<TenantBranding>(
    `SELECT logo_url, accent_color FROM tenants WHERE tenant_uid = $1`,
    [tenantUid]
  );

  const brandingRow = result.rows[0];
  if (!brandingRow) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  const response: PublicTenantBrandingResponse = { branding: brandingRow };
  res.json(response);
}));

/**
 * GET /api/branding/logo/:tenantUid
 * Serves the tenant logo image with cache headers.
 */
router.get('/logo/:tenantUid', asyncHandler(async (req, res) => {
  const paramsParse = tenantUidParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid tenant identifier' });
    return;
  }

  const { tenantUid } = paramsParse.data;

  // Check DB for logo_url
  const result = await pool.query<{ logo_url: string | null }>(
    `SELECT logo_url FROM tenants WHERE tenant_uid = $1`,
    [tenantUid]
  );

  const row = result.rows[0];
  if (!row || !row.logo_url) {
    res.status(404).json({ error: 'No logo found' });
    return;
  }

  // Find the file on disk
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  for (const ext of ['.png', '.jpg', '.svg']) {
    const filePath = path.join(UPLOADS_DIR, logoFilename(tenantUid, ext));
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
      res.sendFile(filePath);
      return;
    }
  }

  res.status(404).json({ error: 'Logo file not found' });
}));

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN ROUTES — require auth + admin role
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/branding/admin/current
 * Returns the current tenant's branding (admin-only).
 */
router.get('/admin/current', authMiddleware, requireRole(['admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const result = await pool.query<TenantBranding>(
    `SELECT logo_url, accent_color FROM tenants WHERE id = $1`,
    [req.user.tenantId]
  );

  const brandingRow = result.rows[0];
  if (!brandingRow) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  const response: TenantBrandingResponse = { branding: brandingRow };
  res.json(response);
}));

/**
 * PUT /api/branding/admin/accent-color
 * Update the tenant's accent color (admin-only).
 */
router.put('/admin/accent-color', authMiddleware, requireRole(['admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const bodyParse = updateBrandingSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Validation failed', details: bodyParse.error.flatten() });
    return;
  }

  const { accent_color } = bodyParse.data;

  const result = await pool.query<TenantBranding>(
    `UPDATE tenants SET accent_color = $1, updated_at = NOW() WHERE id = $2 RETURNING logo_url, accent_color`,
    [accent_color ?? null, req.user.tenantId]
  );

  const updated = result.rows[0];
  if (!updated) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  const response: TenantBrandingResponse = { branding: updated };
  res.json(response);
}));

/**
 * POST /api/branding/admin/logo
 * Upload a new logo (admin-only). Accepts PNG, JPG, SVG (max 500KB).
 * Raster images are resized to max 400px width.
 */
router.post('/admin/logo', authMiddleware, requireRole(['admin']), (req, res, next) => {
  upload.single('logo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Logo file exceeds 500KB limit' });
        return;
      }
      res.status(400).json({ error: 'Upload error', details: err.message });
      return;
    }
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No logo file provided' });
    return;
  }

  ensureUploadsDir();

  const tenantUid = req.user.tenantUid;
  const ext = extForMime(file.mimetype);

  // Delete any existing logo
  deleteLogoFile(tenantUid);

  const destPath = path.join(UPLOADS_DIR, logoFilename(tenantUid, ext));

  // Process: resize raster images, pass through SVGs
  if (file.mimetype === 'image/svg+xml') {
    fs.writeFileSync(destPath, file.buffer);
  } else {
    await sharp(file.buffer)
      .resize({ width: LOGO_MAX_WIDTH, withoutEnlargement: true })
      .toFile(destPath);
  }

  const logoUrl = `/api/branding/logo/${tenantUid}`;

  await pool.query(
    `UPDATE tenants SET logo_url = $1, updated_at = NOW() WHERE id = $2`,
    [logoUrl, req.user.tenantId]
  );

  const result = await pool.query<TenantBranding>(
    `SELECT logo_url, accent_color FROM tenants WHERE id = $1`,
    [req.user.tenantId]
  );

  const uploaded = result.rows[0];
  if (!uploaded) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  const response: TenantBrandingResponse = { branding: uploaded };
  res.json(response);
}));

/**
 * DELETE /api/branding/admin/logo
 * Remove the tenant's logo (admin-only).
 */
router.delete('/admin/logo', authMiddleware, requireRole(['admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  deleteLogoFile(req.user.tenantUid);

  await pool.query(
    `UPDATE tenants SET logo_url = NULL, updated_at = NOW() WHERE id = $1`,
    [req.user.tenantId]
  );

  const response: TenantBrandingResponse = {
    branding: { logo_url: null, accent_color: null }
  };

  // Refetch to include current accent_color
  const result = await pool.query<TenantBranding>(
    `SELECT logo_url, accent_color FROM tenants WHERE id = $1`,
    [req.user.tenantId]
  );
  const refetched = result.rows[0];
  if (refetched) {
    response.branding = refetched;
  }

  res.json(response);
}));

export default router;
