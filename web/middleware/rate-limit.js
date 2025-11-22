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

export function rateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    const identifier = req.user?.userId || req.ip
    const result = limiter.check(identifier, maxRequests, windowMs)

    res.setHeader('X-RateLimit-Limit', maxRequests)
    res.setHeader('X-RateLimit-Remaining', result.remaining)

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000)
      res.setHeader('Retry-After', retryAfter)
      logger.warn(`Rate limit exceeded for ${identifier}`)
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter
      })
    }

    next()
  }
}

export function strictRateLimit(req, res, next) {
  return rateLimitMiddleware(20, 60000)(req, res, next)
}

export function authRateLimit(req, res, next) {
  return rateLimitMiddleware(5, 300000)(req, res, next)
}