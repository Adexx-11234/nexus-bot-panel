import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('RATE_LIMIT')

class RateLimiter {
  constructor() {
    this.requests = new Map()
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000)
  }

  cleanup() {
    const now = Date.now()
    for (const [key, data] of this.requests.entries()) {
      if (now - data.resetTime > 60000) {
        this.requests.delete(key)
      }
    }
  }

  check(identifier, maxRequests = 100, windowMs = 60000) {
    const now = Date.now()
    const record = this.requests.get(identifier)

    if (!record || now - record.resetTime > windowMs) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now
      })
      return { allowed: true, remaining: maxRequests - 1 }
    }

    if (record.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetTime: record.resetTime + windowMs }
    }

    record.count++
    return { allowed: true, remaining: maxRequests - record.count }
  }
}

const limiter = new RateLimiter()

export function rateLimitMiddleware(maxRequests = 100, windowMs = 60000, customMessage = null) {
  return (req, res, next) => {
    const identifier = req.user?.userId || req.ip
    const result = limiter.check(identifier, maxRequests, windowMs)

    res.setHeader('X-RateLimit-Limit', maxRequests)
    res.setHeader('X-RateLimit-Remaining', result.remaining)

    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil((result.resetTime - Date.now()) / 1000)
      const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60)
      
      res.setHeader('Retry-After', retryAfterSeconds)
      logger.warn(`Rate limit exceeded for ${identifier}`)
      
      // Format time message
      let timeMessage
      if (retryAfterSeconds < 60) {
        timeMessage = `${retryAfterSeconds} second${retryAfterSeconds !== 1 ? 's' : ''}`
      } else {
        timeMessage = `${retryAfterMinutes} minute${retryAfterMinutes !== 1 ? 's' : ''}`
      }
      
      // Use custom message or generate default
      const message = customMessage 
        ? `${customMessage} Please try again in ${timeMessage}.`
        : `You have exceeded the rate limit. Please try again in ${timeMessage}.`
      
      return res.status(429).json({
        error: 'Too many requests',
        message: message,
        retryAfter: retryAfterSeconds,
        retryAfterMinutes: retryAfterMinutes
      })
    }

    next()
  }
}

export function strictRateLimit(req, res, next) {
  return rateLimitMiddleware(50, 60000, 'You can only make 50 requests per minute.')(req, res, next)
}

export function authRateLimit(req, res, next) {
  return rateLimitMiddleware(10, 300000, 'You can only make 10 authentication requests per 5 minutes.')(req, res, next)
}