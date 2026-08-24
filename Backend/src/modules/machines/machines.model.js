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
    overrideReason: z.string().trim().min(1, 'A recovery override reason is required.').max(500, 'The recovery override reason is too long.').optional(),
  }).superRefine((body, context) => {
    if (body.status === 'Active' && !body.overrideReason) {
      context.addIssue({
        code: 'custom',
        path: ['overrideReason'],
        message: 'A recovery override reason is required when manually activating a sensor.',
      })
    }
  }),
})

module.exports = {
  machineIdSchema,
  machineStatusSchema,
  sensorStatusSchema,
}
