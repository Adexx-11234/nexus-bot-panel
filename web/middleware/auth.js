import jwt from 'jsonwebtoken'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('AUTH_MIDDLEWARE')
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production'
const JWT_EXPIRES_IN = '7d'

export function authenticateToken(req, res, next) {
  try {
    const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  } catch (error) {
    logger.error('Token verification failed:', error.message)
    return res.status(403).json({ error: 'Invalid or expired token' })
  }
}

export function generateToken(userId, phoneNumber) {
  return jwt.sign(
    { userId, phoneNumber, type: 'web' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  )
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch (error) {
    return null
  }
}