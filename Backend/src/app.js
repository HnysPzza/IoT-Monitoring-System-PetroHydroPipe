const cors = require('cors')
const express = require('express')
const helmet = require('helmet')
const morgan = require('morgan')
const env = require('./config/env')
const errorHandler = require('./middleware/errorHandler')
const auditRoutes = require('./modules/audit/audit.routes')
const authRoutes = require('./modules/auth/auth.routes')
const dashboardRoutes = require('./modules/dashboard/dashboard.routes')
const downtimeRoutes = require('./modules/downtime/downtime.routes')
const iotRoutes = require('./modules/iot/iot.routes')
const machinesRoutes = require('./modules/machines/machines.routes')
const usersRoutes = require('./modules/users/users.routes')

const app = express()

app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN }))
app.use(express.json())
app.use(morgan('dev'))

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'iot-monitoring-backend',
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/machines', machinesRoutes)
app.use('/api/iot', iotRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/downtime', downtimeRoutes)
app.use('/api/audit', auditRoutes)

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found.',
    },
  })
})

app.use(errorHandler)

module.exports = app
