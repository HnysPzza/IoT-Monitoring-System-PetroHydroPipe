function asyncHandler(handler) {
  return (req, res, next) => {
    // Sends async controller errors to the centralized error handler.
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

module.exports = asyncHandler
