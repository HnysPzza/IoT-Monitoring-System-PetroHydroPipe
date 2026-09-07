const { z } = require('zod')

// Login accepts only the fields needed for username/password authentication.
const loginSchema = z.object({
  body: z.object({
    username: z.string().trim().min(1, 'Username is required.'),
    password: z.string().min(1, 'Password is required.'),
  }),
})

const passwordSchema = z.string().min(12, 'Use at least 12 characters.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes.')
const setupPasswordSchema = z.object({ body: z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  password: passwordSchema,
}).strict() })
const setupTokenSchema = z.object({ body: setupPasswordSchema.shape.body.pick({ token: true }) })
const changePasswordSchema = z.object({ body: z.object({
  currentPassword: z.string().min(1).max(200),
  password: passwordSchema,
}).strict() })

module.exports = {
  setupTokenSchema,
  setupPasswordSchema,
  changePasswordSchema,
  loginSchema,
}
