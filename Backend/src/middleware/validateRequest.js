function validateRequest(schema) {
  return (req, res, next) => {
    // Zod validates all request inputs before controllers run.
    const parsed = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    })

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          details: parsed.error.flatten(),
        },
      })
    }

    // Controllers use req.validated instead of raw request values.
    req.validated = parsed.data
    return next()
  }
}

module.exports = validateRequest
