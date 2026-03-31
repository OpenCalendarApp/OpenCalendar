import { z } from 'zod';

const hexTokenPattern = /^[a-f0-9]{64}$/i;
const rootDomainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const positiveInt = z.number().int().positive();
const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const isoDateTime = z.string().datetime({ offset: true });
const bookingEmailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(rootDomainPattern, 'booking_email_domain_allowlist must be a valid root domain');

export const userRoleSchema = z.enum(['admin', 'pm', 'engineer']);
export const registerUserRoleSchema = z.enum(['pm', 'engineer']);
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
  role: registerUserRoleSchema
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().trim().min(32).max(1024)
});

export const logoutSchema = z.object({
  refresh_token: z.string().trim().min(32).max(1024).optional()
});

export const updateUserRoleSchema = z.object({
  role: userRoleSchema
});

export const updateUserStatusSchema = z.object({
  is_active: z.boolean()
});

const optionalUrlOrEmptySchema = z.union([z.string().trim().url(), z.literal('')]);

export const createProjectSchema = z
  .object({
    name: nonEmptyText(255),
    description: z.string().max(5000).optional().default(''),
    signup_password: z.string().min(4),
    booking_email_domain_allowlist: z.union([bookingEmailDomainSchema, z.literal('')]).optional().default(''),
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
    booking_email_domain_allowlist: z.union([bookingEmailDomainSchema, z.literal(''), z.null()]).optional(),
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

export const createRecurringTimeBlocksSchema = z
  .object({
    project_id: positiveInt,
    ...blockWindowFields,
    max_signups: positiveInt.default(1),
    engineer_ids: engineerIdsSchema,
    slots_per_occurrence: positiveInt.max(24).default(1),
    recurrence: z.object({
      frequency: z.literal('weekly').default('weekly'),
      interval_weeks: positiveInt.max(26).default(1),
      occurrences: z.number().int().min(2).max(52)
    })
  })
  .superRefine(validateBlockWindow);

export const numericIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const shareTokenParamsSchema = z.object({
  shareToken: shareTokenSchema
});

export const bookingTokenParamsSchema = z.object({
  bookingToken: bookingTokenSchema
});

export const oidcSsoStartQuerySchema = z.object({
  tenant_uid: z.string().trim().uuid().optional()
});

export const setupInitializeSchema = z.object({
  tenant_name: nonEmptyText(255),
  email: z.string().trim().email(),
  password: z.string().min(8),
  first_name: nonEmptyText(100),
  last_name: nonEmptyText(100),
  phone: z.string().trim().min(3).max(30).optional()
});

export const updateAdminOidcSsoConfigSchema = z
  .object({
    enabled: z.boolean(),
    issuer_url: optionalUrlOrEmptySchema.default(''),
    authorization_endpoint: optionalUrlOrEmptySchema.default(''),
    token_endpoint: optionalUrlOrEmptySchema.default(''),
    userinfo_endpoint: optionalUrlOrEmptySchema.default(''),
    client_id: z.string().trim().max(255).default(''),
    client_secret: z.string().max(2048).optional().default(''),
    scopes: z.string().trim().min(1).max(500).default('openid profile email'),
    default_role: z.enum(['pm', 'engineer']).default('pm'),
    auto_provision: z.boolean().default(true),
    claim_email: z.string().trim().min(1).max(64).default('email'),
    claim_first_name: z.string().trim().min(1).max(64).default('given_name'),
    claim_last_name: z.string().trim().min(1).max(64).default('family_name'),
    success_redirect_url: optionalUrlOrEmptySchema.default(''),
    error_redirect_url: optionalUrlOrEmptySchema.default('')
  })
  .superRefine((data, context) => {
    if (!data.enabled) {
      return;
    }

    if (!data.authorization_endpoint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authorization_endpoint'],
        message: 'authorization_endpoint is required when SSO is enabled'
      });
    }
    if (!data.token_endpoint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['token_endpoint'],
        message: 'token_endpoint is required when SSO is enabled'
      });
    }
    if (!data.userinfo_endpoint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['userinfo_endpoint'],
        message: 'userinfo_endpoint is required when SSO is enabled'
      });
    }
    if (!data.client_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['client_id'],
        message: 'client_id is required when SSO is enabled'
      });
    }
  });

export const bookSlotSchema = z.object({
  password: z.string().min(1),
  time_block_id: positiveInt,
  first_name: nonEmptyText(100),
  last_name: nonEmptyText(100),
  email: z.string().trim().email(),
  phone: z.string().trim().min(3).max(30)
});

export const joinWaitlistSchema = bookSlotSchema;

export const rescheduleBookingSchema = z.object({
  new_time_block_id: positiveInt
});
