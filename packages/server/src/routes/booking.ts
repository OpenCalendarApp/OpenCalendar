import { Router } from 'express';

const router = Router();

router.get('/project/:shareToken', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/book/:shareToken', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.get('/booking/:bookingToken', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/reschedule/:bookingToken', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/cancel/:bookingToken', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.get('/calendar/:bookingToken', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

export default router;
