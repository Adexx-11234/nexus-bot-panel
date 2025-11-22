/**
 * TelegramFormatters - Text formatting utilities
 */
export class TelegramFormatters {
  /**
   * Format phone number for display
   */
  static formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return 'Unknown'
    
    // Remove + and format as +X XXX XXX XXXX
    const clean = phoneNumber.replace(/\D/g, '')
    
    if (clean.length === 11) {
      return `+${clean[0]} ${clean.slice(1, 4)} ${clean.slice(4, 7)} ${clean.slice(7)}`
    }
    
    return phoneNumber
  }

  /**
   * Format timestamp
   */
  static formatTimestamp(timestamp) {
    if (!timestamp) return 'Unknown'
    
    const date = new Date(timestamp)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  /**
   * Format duration (milliseconds to human readable)
   */
  static formatDuration(ms) {
    if (!ms || ms < 0) return '0s'
    
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`
    }
    
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    }
    
    return `${seconds}s`
  }

  /**
   * Escape markdown special characters
   */
  static escapeMarkdown(text) {
    if (!text) return ''
    
    return text
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/~/g, '\\~')
      .replace(/`/g, '\\`')
      .replace(/>/g, '\\>')
      .replace(/#/g, '\\#')
      .replace(/\+/g, '\\+')
      .replace(/-/g, '\\-')
      .replace(/=/g, '\\=')
      .replace(/\|/g, '\\|')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\./g, '\\.')
      .replace(/!/g, '\\!')
  }

  /**
   * Truncate text with ellipsis
   */
  static truncate(text, maxLength = 50) {
    if (!text) return ''
    if (text.length <= maxLength) return text
    
    return text.substring(0, maxLength - 3) + '...'
  }

  /**
   * Format boolean as emoji
   */
  static formatBoolean(value) {
    return value ? '✅' : '❌'
  }

  /**
   * Format status
   */
  static formatStatus(status) {
    const statusMap = {
      'connected': '🟢 Connected',
      'connecting': '🟡 Connecting',
      'disconnected': '🔴 Disconnected',
      'error': '❌ Error'
    }
    
    return statusMap[status] || status
  }
}