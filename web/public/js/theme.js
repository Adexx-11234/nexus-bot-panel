// Theme management
class ThemeManager {
  constructor() {
    this.theme = localStorage.getItem('theme') || 'light'
    this.init()
  }

  init() {
    this.applyTheme()
    this.setupToggle()
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme)
    this.updateToggleIcon()
  }

  toggleTheme() {
    this.theme = this.theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('theme', this.theme)
    this.applyTheme()
  }

  updateToggleIcon() {
    const toggleBtn = document.getElementById('theme-toggle')
    if (toggleBtn) {
      toggleBtn.innerHTML = this.theme === 'light' ? '🌙' : '☀️'
    }
  }

  setupToggle() {
    const toggleBtn = document.getElementById('theme-toggle')
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleTheme())
    }
  }
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', () => {
  window.themeManager = new ThemeManager()
})