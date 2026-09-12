const { z } = require('zod')

// Username format matches the frontend validation and database lookup style.
const usernameSchema = z
  .string()
  .trim()
  .min(1, 'Username is required.')
  .regex(/^[a-z0-9._-]+$/, 'Use lowercase letters, numbers, dots, dashes, or underscores only.')

const createUserSchema = z.object({
  // Admin-created accounts are validated before reaching the service layer.
  body: z.object({
    name: z.string().trim().min(1, 'Full name is required.').max(120),
    username: usernameSchema.max(80),
    email: z.string().trim().email('Enter a valid email address.').max(254),
    role: z.string().trim().min(1, 'Role is required.').max(80).refine((role) => role !== 'Admin', 'Admin cannot be assigned.'),
  }).strict(),
})

const listUsersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    search: z.string().trim().max(100).default(''),
    role: z.string().trim().max(80).default(''),
    status: z.enum(['', 'Active', 'Inactive']).default(''),
    onboarding: z.enum(['', 'Invited', 'Expired', 'Ready']).default(''),
    sort: z.enum(['created', 'name', 'role', 'status']).default('created'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  }).strict(),
})

const updateUserStatusSchema = z.object({
  // Status updates only allow activate/deactivate, never delete.
  params: z.object({
    id: z.string().uuid('Invalid user id.'),
  }),
  body: z.object({
    status: z.enum(['Active', 'Inactive']),
  }),
})

const archiveUserSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user id.'),
  }),
})

module.exports = {
  listUsersSchema,
  archiveUserSchema,
  createUserSchema,
  updateUserStatusSchema,
}
