const { z } = require('zod')

const machineIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid machine id.'),
  }),
})

module.exports = {
  machineIdSchema,
}
