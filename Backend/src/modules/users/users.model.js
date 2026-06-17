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
    name: z.string().trim().min(1, 'Full name is required.'),
    username: usernameSchema,
    email: z.string().trim().email('Enter a valid email address.'),
    role: z.string().trim().min(1, 'Role is required.'),
    password: z.string().min(8, 'Temporary password must be at least 8 characters.'),
  }),
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
  archiveUserSchema,
  createUserSchema,
  updateUserStatusSchema,
}
