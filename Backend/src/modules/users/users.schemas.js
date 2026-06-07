const { z } = require('zod')

const usernameSchema = z
  .string()
  .trim()
  .min(1, 'Username is required.')
  .regex(/^[a-z0-9._-]+$/, 'Use lowercase letters, numbers, dots, dashes, or underscores only.')

const createUserSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Full name is required.'),
    username: usernameSchema,
    email: z.string().trim().email('Enter a valid email address.'),
    role: z.string().trim().min(1, 'Role is required.'),
    password: z.string().min(8, 'Temporary password must be at least 8 characters.'),
  }),
})

const updateUserStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user id.'),
  }),
  body: z.object({
    status: z.enum(['Active', 'Inactive']),
  }),
})

module.exports = {
  createUserSchema,
  updateUserStatusSchema,
}
