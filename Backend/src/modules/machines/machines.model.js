const { z } = require('zod')

const machineStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid machine id.'),
  }),
  body: z.object({
    status: z.enum(['Running', 'Idle', 'Downtime']),
  }),
})

const machineIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid machine id.'),
  }),
})

const sensorStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid sensor id.'),
  }),
  body: z.object({
    status: z.enum(['Active', 'Inactive', 'Fault']),
  }),
})

module.exports = {
  machineIdSchema,
  machineStatusSchema,
  sensorStatusSchema,
}
