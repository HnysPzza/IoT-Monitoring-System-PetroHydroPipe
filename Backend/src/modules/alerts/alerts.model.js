const { z } = require('zod')

const alertIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid alert id.'),
  }),
})

module.exports = {
  alertIdSchema,
}
