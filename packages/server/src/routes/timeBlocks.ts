import { Router } from 'express';

import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/', authMiddleware, (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/batch', authMiddleware, (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.delete('/:id', authMiddleware, (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export default router;
