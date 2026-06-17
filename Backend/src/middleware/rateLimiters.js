const { rateLimit, ipKeyGenerator } = require('express-rate-limit')

function rateLimitResponse(message) {
  return {
    error: {
      code: 'RATE_LIMITED',
      message,
    },
  }
}

// Login is IP-based to slow down password guessing.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json(rateLimitResponse('Too many login attempts. Please try again later.'))
  },
})

// ESP32 events are keyed by IP plus device id so one noisy device is isolated.
const iotEventRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.get('x-device-id') || 'unknown-device'}`,
  handler: (req, res) => {
    res.status(429).json(rateLimitResponse('Too many ESP32 events. Please slow down this device.'))
  },
})

module.exports = {
  iotEventRateLimiter,
  loginRateLimiter,
}
