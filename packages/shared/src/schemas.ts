import { z } from 'zod';

const hexTokenPattern = /^[a-f0-9]{64}$/i;
const positiveInt = z.number().int().positive();
const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const isoDateTime = z.string().datetime({ offset: true });

export const userRoleSchema = z.enum(['pm', 'engineer']);
export const shareTokenSchema = z
  .string()
  .trim()
  .regex(hexTokenPattern, 'shareToken must be a 64-character hex token');
export const bookingTokenSchema = z
  .string()
  .trim()
  .regex(hexTokenPattern, 'bookingToken must be a 64-character hex token');

export const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  first_name: nonEmptyText(100),
  last_name: nonEmptyText(100),
  phone: z.string().trim().min(3).max(30).optional(),
  role: userRoleSchema
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

export const createProjectSchema = z
  .object({
    name: nonEmptyText(255),
    description: z.string().max(5000).optional().default(''),
    signup_password: z.string().min(4),
    is_group_signup: z.boolean(),
    max_group_size: positiveInt.optional().default(1),
    session_length_minutes: positiveInt
  })
  .superRefine((data, context) => {
    if (!data.is_group_signup && data.max_group_size !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_group_size'],
        message: 'max_group_size must be 1 when is_group_signup is false'
      });
    }
  });

export const updateProjectSchema = z
  .object({
    name: nonEmptyText(255).optional(),
    description: z.string().max(5000).optional(),
    signup_password: z.string().min(4).optional(),
    is_group_signup: z.boolean().optional(),
    max_group_size: positiveInt.optional(),
    session_length_minutes: positiveInt.optional(),
    is_active: z.boolean().optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one field is required'
  })
  .superRefine((data, context) => {
    if (data.is_group_signup === false && data.max_group_size && data.max_group_size !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_group_size'],
        message: 'max_group_size must be 1 when is_group_signup is false'
      });
    }
  });

const blockWindowFields = {
  start_time: isoDateTime,
  end_time: isoDateTime
} as const;

function validateBlockWindow(
  data: { start_time: string; end_time: string },
  context: z.RefinementCtx
): void {
  if (new Date(data.end_time).getTime() <= new Date(data.start_time).getTime()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_time'],
      message: 'end_time must be greater than start_time'
    });
  }
}

const engineerIdsSchema = z
  .array(positiveInt)
  .default([])
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'engineer_ids must contain unique values'
  });

export const createTimeBlockSchema = z
  .object({
    ...blockWindowFields,
    project_id: positiveInt,
    max_signups: positiveInt.default(1),
    engineer_ids: engineerIdsSchema
  })
  .superRefine(validateBlockWindow);

export const batchTimeBlockItemSchema = z
  .object({
    ...blockWindowFields,
    max_signups: positiveInt.default(1),
    engineer_ids: engineerIdsSchema
  })
  .superRefine(validateBlockWindow);

export const createTimeBlocksBatchSchema = z.object({
  project_id: positiveInt,
  blocks: z.array(batchTimeBlockItemSchema).min(1)
});

export const numericIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const shareTokenParamsSchema = z.object({
  shareToken: shareTokenSchema
});

export const bookingTokenParamsSchema = z.object({
  bookingToken: bookingTokenSchema
});

export const bookSlotSchema = z.object({
  password: z.string().min(1),
  time_block_id: positiveInt,
  first_name: nonEmptyText(100),
  last_name: nonEmptyText(100),
  email: z.string().trim().email(),
  phone: z.string().trim().min(3).max(30)
});

export const rescheduleBookingSchema = z.object({
  new_time_block_id: positiveInt
});
