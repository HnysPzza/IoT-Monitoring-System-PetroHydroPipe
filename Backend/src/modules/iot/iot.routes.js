const express = require('express')

const router = express.Router()

router.use((req, res) => {
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'IoT event routes are reserved for a future phase.',
    },
  })
})

module.exports = router
