const express = require('express')

const router = express.Router()

router.use((req, res) => {
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'User routes are reserved for the next phase.',
    },
  })
})

module.exports = router
