const express = require('express')

const routeConfig = [
    { path: '/auth', module: 'auth' },
    { path: '/alerts', module: 'alerts' },
    { path: '/users', module: 'users' },
    { path: '/machines/:machineId/settings', module: 'settings' },
    { path: '/machines', module: 'machines' },
    { path: '/operations', module: 'operations' },
    { path: '/iot', module: 'iot' },
    { path: '/dashboard', module: 'dashboard' },
    { path: '/downtime', module: 'downtime' },
    { path: '/reports', module: 'reports' },
    { path: '/audit', module: 'audit' },
]

const router = express.Router()

routeConfig.forEach(({ path, module }) => {
    const moduleRoutes = require(`../modules/${module}/${module}.routes`)
    router.use(path, moduleRoutes)
})

routeConfig.forEach(({ path, module: mod }) => {
    let moduleRoutes
    try {
        moduleRoutes = require(`../modules/${mod}/${mod}.routes`)
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            throw new Error(`Route module "${mod}" not found: ${err.message}`)
        }
        throw err
    }
    router.use(path, moduleRoutes)
})
