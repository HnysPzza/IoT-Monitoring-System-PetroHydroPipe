const { z } = require('zod')

const watchdogDiagnosticsSchema = z.object({
  query: z.strictObject({}),
})

module.exports = {
  watchdogDiagnosticsSchema,
}
