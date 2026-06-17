function formatMessage(level, message) {
  return `[${new Date().toISOString()}] [${level}] ${message}`
}

const logger = {
  info(message, ...args) {
    console.log(formatMessage('INFO', message), ...args)
  },
  warn(message, ...args) {
    console.warn(formatMessage('WARN', message), ...args)
  },
  error(message, ...args) {
    console.error(formatMessage('ERROR', message), ...args)
  },
}

module.exports = logger
