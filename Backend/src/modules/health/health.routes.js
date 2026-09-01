const express = require('express')
const logger = require('../../utils/logger')
const healthService = require('./health.service')

const router = express.Router()
const service = 'iot-monitoring-backend'

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store')
  next()
}

function live(req, res) {
  res.json({ status: 'ok', service })
}

router.use(noStore)
router.get('/', live)
router.get('/live', live)
router.get('/ready', async (req, res) => {
  try {
    await healthService.checkReadiness()
    return res.json({ status: 'ready', service })
  } catch (error) {
    logger.warn('Backend readiness check failed.', {
      code: error?.code || error?.name || 'READINESS_CHECK_FAILED',
    })
    return res.status(503).json({ status: 'not_ready', service })
  }
})

module.exports = router
