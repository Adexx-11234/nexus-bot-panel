/**
 * Format timestamp to readable string
 */
export function formatTimestamp(timestamp, options = {}) {
  if (!timestamp) return 'Unknown'

  try {
    const date = new Date(typeof timestamp === 'number' ? timestamp * 1000 : timestamp)

    if (options.relative) {
      return getRelativeTime(timestamp)
    }

    if (options.time) {
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      })
    }

    if (options.date) {
      return date.toLocaleDateString('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
    }

    return date.toLocaleString('en-US')

  } catch (error) {
    return 'Invalid Date'
  }
}

/**
 * Get relative time (e.g., "2 minutes ago")
 */
export function getRelativeTime(timestamp) {
  if (!timestamp) return 'Unknown'

  try {
    const now = Math.floor(Date.now() / 1000)
    const ts = typeof timestamp === 'number' ? timestamp : Math.floor(new Date(timestamp).getTime() / 1000)
    const diff = now - ts

    if (diff < 60) return `${diff} seconds ago`
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
    if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`

    return `${Math.floor(diff / 31536000)} years ago`

  } catch (error) {
    return 'Unknown'
  }
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  if (!bytes || isNaN(bytes)) return 'Unknown'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * Format duration (seconds to readable format)
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0s'

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }
  return `${secs}s`
}

/**
 * Format phone number for display
 */
export function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return 'Unknown'

  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '')

  // Format based on length
  if (cleaned.length === 10) {
    // US format: (123) 456-7890
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }

  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    // US with country code: +1 (123) 456-7890
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`
  }

  // International format: +XX XXXX XXXX
  if (cleaned.length > 10) {
    const countryCode = cleaned.slice(0, cleaned.length - 10)
    const rest = cleaned.slice(-10)
    return `+${countryCode} ${rest.slice(0, 4)} ${rest.slice(4)}`
  }

  return `+${cleaned}`
}

/**
 * Format number with thousands separator
 */
export function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0'
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Format percentage
 */
export function formatPercentage(value, total) {
  if (!total || total === 0) return '0%'
  const percentage = (value / total) * 100
  return `${percentage.toFixed(1)}%`
}

/**
 * Truncate string with ellipsis
 */
export function truncateString(str, maxLength = 50) {
  if (!str || typeof str !== 'string') return ''
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength) + '...'
}

/**
 * Format list items
 */
export function formatList(items, numbered = false) {
  if (!Array.isArray(items) || items.length === 0) return ''

  return items
    .map((item, index) => {
      const prefix = numbered ? `${index + 1}. ` : '• '
      return `${prefix}${item}`
    })
    .join('\n')
}

/**
 * Format key-value pairs
 */
export function formatKeyValue(obj, separator = ': ') {
  if (!obj || typeof obj !== 'object') return ''

  return Object.entries(obj)
    .map(([key, value]) => `${key}${separator}${value}`)
    .join('\n')
}