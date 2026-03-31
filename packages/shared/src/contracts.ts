import type { z } from 'zod';

import type {
  batchTimeBlockItemSchema,
  bookSlotSchema,
  bookingTokenParamsSchema,
  createProjectSchema,
  createRecurringTimeBlocksSchema,
  createTimeBlockSchema,
  createTimeBlocksBatchSchema,
  loginSchema,
  oidcSsoStartQuerySchema,
  joinWaitlistSchema,
  logoutSchema,
  numericIdParamsSchema,
  refreshTokenSchema,
  registerSchema,
  rescheduleBookingSchema,
  shareTokenParamsSchema,
  setupInitializeSchema,
  updateAdminOidcSsoConfigSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
  updateProjectSchema
} from './schemas.js';

export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;
export type RefreshTokenRequest = z.infer<typeof refreshTokenSchema>;
export type LogoutRequest = z.infer<typeof logoutSchema>;
export type UpdateUserRoleRequest = z.infer<typeof updateUserRoleSchema>;
export type UpdateUserStatusRequest = z.infer<typeof updateUserStatusSchema>;
export type UpdateAdminOidcSsoConfigRequest = z.infer<typeof updateAdminOidcSsoConfigSchema>;

export type CreateProjectRequest = z.infer<typeof createProjectSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectSchema>;

export type NumericIdParams = z.infer<typeof numericIdParamsSchema>;

export type CreateTimeBlockRequest = z.infer<typeof createTimeBlockSchema>;
export type CreateRecurringTimeBlocksRequest = z.infer<typeof createRecurringTimeBlocksSchema>;
export type BatchTimeBlockItem = z.infer<typeof batchTimeBlockItemSchema>;
export type CreateTimeBlocksBatchRequest = z.infer<typeof createTimeBlocksBatchSchema>;

export type ShareTokenParams = z.infer<typeof shareTokenParamsSchema>;
export type BookingTokenParams = z.infer<typeof bookingTokenParamsSchema>;
export type OidcSsoStartQuery = z.infer<typeof oidcSsoStartQuerySchema>;
export type SetupInitializeRequest = z.infer<typeof setupInitializeSchema>;

export type BookSlotRequest = z.infer<typeof bookSlotSchema>;
export type JoinWaitlistRequest = z.infer<typeof joinWaitlistSchema>;
export type RescheduleBookingRequest = z.infer<typeof rescheduleBookingSchema>;
