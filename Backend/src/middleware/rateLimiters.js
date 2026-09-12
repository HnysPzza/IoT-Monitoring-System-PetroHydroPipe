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

const refreshRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  passOnStoreError: false,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json(rateLimitResponse('Too many session refresh requests. Please try again shortly.'))
  },
})

const analyticsRateLimiter = rateLimit({
  windowMs: env.ANALYTICS_RATE_LIMIT_WINDOW_MS,
  limit: env.ANALYTICS_RATE_LIMIT,
  passOnStoreError: false,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.authenticatedUser.id,
  handler: (req, res) => {
    res.status(429).json(rateLimitResponse('Too many Analytics requests. Please try again later.'))
  },
})

// Exports are heavier than reads (serialization + audit) so they get a tighter cap.
const exportRateLimiter = rateLimit({
  windowMs: env.EXPORT_RATE_LIMIT_WINDOW_MS,
  limit: env.EXPORT_RATE_LIMIT,
  passOnStoreError: false,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.authenticatedUser.id,
  handler: (req, res) => {
    res.status(429).json(rateLimitResponse('Too many export requests. Please try again later.'))
  },
})

// This first layer limits untrusted callers before device lookup and bcrypt work.
// This is for the sensors to avoid sensor attack and flood with false events.
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
// Esp base checking
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
  analyticsRateLimiter,
  exportRateLimiter,
  iotIngressRateLimiter,
  iotVerifiedDeviceRateLimiter,
  loginRateLimiter,
  refreshRateLimiter,
}
