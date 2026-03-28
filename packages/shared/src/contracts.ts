import type { z } from 'zod';

import type {
  batchTimeBlockItemSchema,
  bookSlotSchema,
  bookingTokenParamsSchema,
  createProjectSchema,
  createTimeBlockSchema,
  createTimeBlocksBatchSchema,
  loginSchema,
  numericIdParamsSchema,
  registerSchema,
  rescheduleBookingSchema,
  shareTokenParamsSchema,
  updateProjectSchema
} from './schemas.js';

export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;

export type CreateProjectRequest = z.infer<typeof createProjectSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectSchema>;

export type NumericIdParams = z.infer<typeof numericIdParamsSchema>;

export type CreateTimeBlockRequest = z.infer<typeof createTimeBlockSchema>;
export type BatchTimeBlockItem = z.infer<typeof batchTimeBlockItemSchema>;
export type CreateTimeBlocksBatchRequest = z.infer<typeof createTimeBlocksBatchSchema>;

export type ShareTokenParams = z.infer<typeof shareTokenParamsSchema>;
export type BookingTokenParams = z.infer<typeof bookingTokenParamsSchema>;

export type BookSlotRequest = z.infer<typeof bookSlotSchema>;
export type RescheduleBookingRequest = z.infer<typeof rescheduleBookingSchema>;
