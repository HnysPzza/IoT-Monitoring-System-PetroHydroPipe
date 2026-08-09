const { rateLimit, ipKeyGenerator } = require('express-rate-limit')
const env = require('../config/env')

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

// This first layer limits untrusted callers before device lookup and bcrypt work.
const iotIngressRateLimiter = rateLimit({
  windowMs: env.IOT_RATE_LIMIT_WINDOW_MS,
  limit: env.IOT_INGRESS_RATE_LIMIT,
  passOnStoreError: false,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json(rateLimitResponse('Too many ESP32 event requests from this source. Please try again later.'))
  },
})

// This second layer can trust the database-backed sensor id established by authentication.
const iotVerifiedDeviceRateLimiter = rateLimit({
  windowMs: env.IOT_RATE_LIMIT_WINDOW_MS,
  limit: env.IOT_DEVICE_RATE_LIMIT,
  passOnStoreError: false,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.iotDevice.id,
  handler: (req, res) => {
    res.status(429).json(rateLimitResponse('Too many ESP32 events. Please slow down this device.'))
  },
})

module.exports = {
  iotIngressRateLimiter,
  iotVerifiedDeviceRateLimiter,
  loginRateLimiter,
}
