// Dashboard handler - FIXED to handle 515 restart flow
class DashboardHandler {
  constructor() {
    this.apiBase = ''
    this.refreshInterval = null
    this.pairingCode = null
    this.connectionPollInterval = null
    this.init()
  }

  async init() {
    await this.checkAuth()
    await this.loadProfile()
    await this.loadSessionStatus()
    this.setupEventListeners()
    this.startAutoRefresh()
  }

  async checkAuth() {
    try {
      const response = await fetch('/auth/verify')
      if (!response.ok) {
        window.location.href = '/login'
        return
      }

      const data = await response.json()
      if (!data.success) {
        window.location.href = '/login'
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      window.location.href = '/login'
    }
  }

  async loadProfile() {
    try {
      const response = await fetch('/api/profile')
      const data = await response.json()

      if (data.success && data.profile) {
        this.updateProfileUI(data.profile)
      }
    } catch (error) {
      console.error('Load profile error:', error)
    }
  }

  updateProfileUI(profile) {
    const userNameEl = document.getElementById('user-name')
    const userPhoneEl = document.getElementById('user-phone')

    if (userNameEl) {
      userNameEl.textContent = profile.firstName || 'User'
    }

    if (userPhoneEl) {
      userPhoneEl.textContent = profile.phoneNumber || 'N/A'
    }
  }

  async loadSessionStatus() {
    try {
      const response = await fetch('/api/sessions/status')
      const data = await response.json()

      if (data.success && data.status) {
        this.updateSessionUI(data.status)
        
        // Handle different connection states
        if (data.status.connectionStatus === 'connecting') {
          this.pollPairingCode()
          this.startConnectionPolling() // Poll for connection completion
        } else if (data.status.connectionStatus === 'reconnecting') {
          // Keep polling when reconnecting after 515
          this.startConnectionPolling()
          this.showAlert('Finalizing connection...', 'info')
        } else {
          this.stopConnectionPolling()
        }
      }
    } catch (error) {
      console.error('Load session status error:', error)
    }
  }

  // Poll connection status more frequently during connection
  startConnectionPolling() {
    if (this.connectionPollInterval) return

    console.log('Starting connection polling...')
    this.connectionPollInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/sessions/status')
        const data = await response.json()

        if (data.success && data.status) {
          // Check if connected
          if (data.status.isConnected && data.status.connectionStatus === 'connected') {
            console.log('Connection established!')
            this.stopConnectionPolling()
            this.showAlert('WhatsApp connected successfully!', 'success')
            await this.loadSessionStatus() // Final status update
          } else if (data.status.connectionStatus === 'disconnected') {
            // Connection failed
            console.log('Connection failed')
            this.stopConnectionPolling()
            await this.loadSessionStatus()
          }
        }
      } catch (error) {
        console.error('Connection poll error:', error)
      }
    }, 2000) // Poll every 2 seconds
  }

  stopConnectionPolling() {
    if (this.connectionPollInterval) {
      clearInterval(this.connectionPollInterval)
      this.connectionPollInterval = null
      console.log('Stopped connection polling')
    }
  }

  updateSessionUI(status) {
    // Update status badge with reconnecting state
    const statusBadge = document.getElementById('status-badge')
    if (statusBadge) {
      let statusClass, statusText

      if (status.isConnected) {
        statusClass = 'status-badge-connected'
        statusText = 'Connected'
      } else if (status.connectionStatus === 'connecting') {
        statusClass = 'status-badge-connecting'
        statusText = 'Connecting'
      } else if (status.connectionStatus === 'reconnecting') {
        statusClass = 'status-badge-connecting'
        statusText = 'Finalizing Connection'
      } else {
        statusClass = 'status-badge-disconnected'
        statusText = 'Disconnected'
      }

      statusBadge.className = `status-badge ${statusClass}`
      statusBadge.innerHTML = `
        <span class="status-dot"></span>
        ${statusText}
      `
    }

    // Update phone number
    const phoneNumberEl = document.getElementById('session-phone')
    if (phoneNumberEl) {
      phoneNumberEl.textContent = status.phoneNumber || 'Not connected'
    }

    // Show/hide action buttons
    const connectCard = document.getElementById('connect-card')
    const disconnectBtn = document.getElementById('disconnect-btn')
    const reconnectBtn = document.getElementById('reconnect-btn')
    const pairingContainer = document.getElementById('pairing-container')

    if (status.isConnected) {
      if (connectCard) connectCard.classList.add('hidden')
      if (disconnectBtn) disconnectBtn.classList.remove('hidden')
      if (reconnectBtn) reconnectBtn.classList.add('hidden')
      if (pairingContainer) pairingContainer.classList.add('hidden')
    } else if (status.connectionStatus === 'connecting' || 
               status.connectionStatus === 'reconnecting') {
      // Keep UI in connecting/reconnecting state
      if (connectCard) connectCard.classList.add('hidden')
      if (disconnectBtn) disconnectBtn.classList.add('hidden')
      if (reconnectBtn) reconnectBtn.classList.add('hidden')
      
      // Show pairing code only during initial connecting (not reconnecting)
      if (status.connectionStatus === 'connecting' && pairingContainer) {
        pairingContainer.classList.remove('hidden')
      } else if (pairingContainer) {
        // Hide pairing code during reconnecting
        pairingContainer.classList.add('hidden')
      }
    } else {
      if (connectCard) connectCard.classList.remove('hidden')
      if (disconnectBtn) disconnectBtn.classList.add('hidden')
      if (pairingContainer) pairingContainer.classList.add('hidden')
      
      if (reconnectBtn && status.canReconnect) {
        reconnectBtn.classList.remove('hidden')
      }
    }

    // Load stats if connected
    if (status.isConnected) {
      this.loadSessionStats()
    }
  }

  async pollPairingCode() {
    try {
      const response = await fetch('/api/sessions/pairing-code')
      const data = await response.json()

      if (data.success && data.pairingCode) {
        this.displayPairingCode(data.pairingCode)
      } else {
        // Retry after 2 seconds
        setTimeout(() => this.pollPairingCode(), 2000)
      }
    } catch (error) {
      setTimeout(() => this.pollPairingCode(), 2000)
    }
  }

  displayPairingCode(code) {
    const codeEl = document.getElementById('pairing-code')
    if (codeEl) {
      codeEl.textContent = code
      this.pairingCode = code
    }

    const pairingContainer = document.getElementById('pairing-container')
    if (pairingContainer) {
      pairingContainer.classList.remove('hidden')
    }
  }

  setupEventListeners() {
    // Connect button
    const connectBtn = document.getElementById('connect-btn')
    if (connectBtn) {
      connectBtn.addEventListener('click', () => this.handleConnect())
    }

    // Disconnect button
    const disconnectBtn = document.getElementById('disconnect-btn')
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => this.handleDisconnect())
    }

    // Reconnect button
    const reconnectBtn = document.getElementById('reconnect-btn')
    if (reconnectBtn) {
      reconnectBtn.addEventListener('click', () => this.handleReconnect())
    }

    // Copy pairing code
    const copyBtn = document.getElementById('copy-code-btn')
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyPairingCode())
    }

    // Click pairing code to copy
    const codeEl = document.getElementById('pairing-code')
    if (codeEl) {
      codeEl.addEventListener('click', () => this.copyPairingCode())
    }

    // Logout button
    const logoutBtn = document.getElementById('logout-btn')
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout())
    }
  }

  async handleConnect() {
    const phoneInput = document.getElementById('connect-phone')
    if (!phoneInput) return

    const phoneNumber = phoneInput.value.trim()
    if (!phoneNumber) {
      this.showAlert('Please enter a phone number', 'error')
      return
    }

    this.setLoading(true, 'connect-btn', 'Connecting...')

    try {
      const response = await fetch('/api/sessions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber })
      })

      const data = await response.json()

      if (data.success) {
        this.showAlert('Session created! Waiting for pairing...', 'success')
        await this.loadSessionStatus()
      } else {
        this.showAlert(data.error || 'Failed to create session', 'error')
      }
    } catch (error) {
      this.showAlert('Network error. Please try again.', 'error')
    } finally {
      this.setLoading(false, 'connect-btn', 'Connect WhatsApp')
    }
  }

  async handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect?')) {
      return
    }

    this.setLoading(true, 'disconnect-btn', 'Disconnecting...')

    try {
      const response = await fetch('/api/sessions/disconnect', {
        method: 'POST'
      })

      const data = await response.json()

      if (data.success) {
        this.showAlert('Session disconnected', 'success')
        await this.loadSessionStatus()
      } else {
        this.showAlert(data.error || 'Failed to disconnect', 'error')
      }
    } catch (error) {
      this.showAlert('Network error. Please try again.', 'error')
    } finally {
      this.setLoading(false, 'disconnect-btn', 'Disconnect')
    }
  }

  async handleReconnect() {
    this.setLoading(true, 'reconnect-btn', 'Reconnecting...')

    try {
      const response = await fetch('/api/sessions/reconnect', {
        method: 'POST'
      })

      const data = await response.json()

      if (data.success) {
        this.showAlert('Reconnecting...', 'success')
        await this.loadSessionStatus()
      } else {
        this.showAlert(data.error || 'Failed to reconnect', 'error')
      }
    } catch (error) {
      this.showAlert('Network error. Please try again.', 'error')
    } finally {
      this.setLoading(false, 'reconnect-btn', 'Reconnect')
    }
  }

  async loadSessionStats() {
    try {
      const response = await fetch('/api/sessions/stats')
      const data = await response.json()

      if (data.success && data.stats) {
        this.updateStatsUI(data.stats)
      }
    } catch (error) {
      console.error('Load stats error:', error)
    }
  }

  updateStatsUI(stats) {
    // Update uptime
    const uptimeEl = document.getElementById('stat-uptime')
    if (uptimeEl && stats.uptime) {
      uptimeEl.textContent = this.formatUptime(stats.uptime)
    }

    // Update reconnect attempts
    const attemptsEl = document.getElementById('stat-attempts')
    if (attemptsEl) {
      attemptsEl.textContent = stats.reconnectAttempts || 0
    }

    // Update connection status
    const statusEl = document.getElementById('stat-status')
    if (statusEl) {
      statusEl.textContent = stats.connectionStatus || 'unknown'
    }
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  copyPairingCode() {
    if (!this.pairingCode) return

    navigator.clipboard.writeText(this.pairingCode).then(() => {
      const copyBtn = document.getElementById('copy-code-btn')
      if (copyBtn) {
        const originalText = copyBtn.innerHTML
        copyBtn.innerHTML = '✓ Copied!'
        copyBtn.classList.add('copied')

        setTimeout(() => {
          copyBtn.innerHTML = originalText
          copyBtn.classList.remove('copied')
        }, 2000)
      }

      this.showAlert('Pairing code copied to clipboard!', 'success')
    }).catch(() => {
      this.showAlert('Failed to copy code', 'error')
    })
  }

  async handleLogout() {
    this.stopAutoRefresh()
    this.stopConnectionPolling()
    
    try {
      await fetch('/auth/logout', { method: 'POST' })
      window.location.href = '/login'
    } catch (error) {
      window.location.href = '/login'
    }
  }

  startAutoRefresh() {
    // Refresh session status every 5 seconds
    this.refreshInterval = setInterval(() => {
      this.loadSessionStatus()
    }, 5000)
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }
  }

  showAlert(message, type) {
    const alertContainer = document.getElementById('alert-container')
    if (!alertContainer) return

    const alertClass = type === 'error' ? 'alert-error' : 
                      type === 'success' ? 'alert-success' : 
                      type === 'warning' ? 'alert-warning' : 'alert-info'

    const icon = type === 'error' ? '❌' : 
                type === 'success' ? '✅' : 
                type === 'warning' ? '⚠️' : 'ℹ️'

    alertContainer.innerHTML = `
      <div class="alert ${alertClass}">
        <span>${icon}</span>
        <span>${message}</span>
      </div>
    `

    setTimeout(() => {
      alertContainer.innerHTML = ''
    }, 5000)
  }

  setLoading(isLoading, btnId, text) {
    const btn = document.getElementById(btnId)
    if (!btn) return

    btn.disabled = isLoading
    btn.innerHTML = isLoading 
      ? `<span class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></span> ${text}`
      : text
  }
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  window.dashboardHandler = new DashboardHandler()
})

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (window.dashboardHandler) {
    window.dashboardHandler.stopAutoRefresh()
    window.dashboardHandler.stopConnectionPolling()
  }
})