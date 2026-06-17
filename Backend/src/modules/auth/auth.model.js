const { z } = require('zod')

// Login accepts only the fields needed for username/password authentication.
const loginSchema = z.object({
  body: z.object({
    username: z.string().trim().min(1, 'Username is required.'),
    password: z.string().min(1, 'Password is required.'),
  }),
})

module.exports = {
  loginSchema,
}
