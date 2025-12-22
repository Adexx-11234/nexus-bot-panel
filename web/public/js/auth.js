// Authentication handler
class AuthHandler {
  constructor() {
    this.apiBase = ''
    this.init()
  }

  init() {
    this.setupForms()
  }

  setupForms() {
    // Login form
    const loginForm = document.getElementById('login-form')
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e))
    }

    // Register form
    const registerForm = document.getElementById('register-form')
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => this.handleRegister(e))
    }
  }

  async handleLogin(e) {
    e.preventDefault()

    const phoneNumber = document.getElementById('phone-number').value.trim()
    const password = document.getElementById('password').value

    if (!phoneNumber || !password) {
      this.showAlert('Please fill in all fields', 'error')
      return
    }

    this.setLoading(true, 'login-btn', 'Logging in...')

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, password })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        this.showAlert('Login successful! Redirecting...', 'success')
        setTimeout(() => {
          window.location.href = '/dashboard'
        }, 1000)
      } else {
        this.showAlert(data.error || 'Login failed', 'error')
      }
    } catch (error) {
      this.showAlert('Network error. Please try again.', 'error')
    } finally {
      this.setLoading(false, 'login-btn', 'Login')
    }
  }

  async handleRegister(e) {
    e.preventDefault()

    const firstName = document.getElementById('first-name').value.trim()
    const phoneNumber = document.getElementById('phone-number').value.trim()
    const password = document.getElementById('password').value
    const confirmPassword = document.getElementById('confirm-password').value

    if (!phoneNumber || !password) {
      this.showAlert('Phone number and password are required', 'error')
      return
    }

    if (password !== confirmPassword) {
      this.showAlert('Passwords do not match', 'error')
      return
    }

    if (password.length < 8) {
      this.showAlert('Password must be at least 8 characters', 'error')
      return
    }

    this.setLoading(true, 'register-btn', 'Creating account...')

    try {
      const response = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, phoneNumber, password })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        this.showAlert('Account created successfully! Redirecting...', 'success')
        setTimeout(() => {
          window.location.href = '/dashboard'
        }, 1000)
      } else {
        this.showAlert(data.error || 'Registration failed', 'error')
      }
    } catch (error) {
      this.showAlert('Network error. Please try again.', 'error')
    } finally {
      this.setLoading(false, 'register-btn', 'Create Account')
    }
  }

  showAlert(message, type) {
    const alertContainer = document.getElementById('alert-container')
    if (!alertContainer) return

    const alertClass = type === 'error' ? 'alert-error' : 
                      type === 'success' ? 'alert-success' : 'alert-info'

    alertContainer.innerHTML = `
      <div class="alert ${alertClass}">
        <span>${type === 'error' ? '❌' : '✅'}</span>
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

  formatPhoneNumber(phone) {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '')
    
    // Add + if not present
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned
    }
    
    return cleaned
  }
}

// Initialize auth handler
document.addEventListener('DOMContentLoaded', () => {
  window.authHandler = new AuthHandler()
})