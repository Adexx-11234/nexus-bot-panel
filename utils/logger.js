// WhatsApp Bot Logger Utility
const logger = {
  info: (message, ...args) => {
  // console.log(`[INFO] ${message}`, ...args)
  },
  error: (message, ...args) => {
    console.error(`[ERROR] ${message}`, ...args)
  },
  warn: (message, ...args) => {
    console.warn(`[WARN] ${message}`, ...args)
  },
    message: (message, ...args) => {
     console.log(`[MESSAGE] [${component}] ${message}`, ...args)
    },
  debug: (message, ...args) => {
 // console.debug(`[DEBUG] ${message}`, ...args)
  },
  child: (options) => {
    const component = options.component || 'UNKNOWN'
    return createComponentLogger(component)
  },
}

function createComponentLogger(component) {
  return {
    info: (message, ...args) => {
  // console.log(`[INFO] [${component}] ${message}`, ...args)
    },
    error: (message, ...args) => {
      console.error(`[ERROR] [${component}] ${message}`, ...args)
    },
    warn: (message, ...args) => {
     console.warn(`[WARN] [${component}] ${message}`, ...args)
    },
      message: (message, ...args) => {
     console.log(`[MESSAGE] [${component}] ${message}`, ...args)
    },
    debug: (message, ...args) => {
 // console.debug(`[DEBUG] [${component}] ${message}`, ...args)
    },
    child: (options) => {
      const childComponent = options.component || 'CHILD'
      return createComponentLogger(`${component}:${childComponent}`)
    },
  }
}

export { logger, createComponentLogger }
