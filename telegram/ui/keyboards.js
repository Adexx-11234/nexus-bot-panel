/**
 * TelegramKeyboards - Inline keyboard layouts
 */
export class TelegramKeyboards {
  /**
   * Main menu keyboard
   */
  static mainMenu() {
    return {
      inline_keyboard: [
        [{ text: '📱 Connect WhatsApp', callback_data: 'connect' }],
        [
          { text: '📊 Status', callback_data: 'status' },
          { text: '❓ Help', callback_data: 'help' }
        ],
        [{ text: '🔌 Disconnect', callback_data: 'disconnect' }]
      ]
    }
  }

  /**
   * Connecting keyboard (with cancel)
   */
  static connecting() {
    return {
      inline_keyboard: [
        [{ text: '❌ Cancel', callback_data: 'main_menu' }]
      ]
    }
  }

  /**
   * Code options keyboard
   */
  static codeOptions(code) {
    return {
      inline_keyboard: [
        [{ text: '🔄 Get New Code', callback_data: 'connect' }],
        [{ text: '🔙 Main Menu', callback_data: 'main_menu' }]
      ]
    }
  }

  /**
   * Confirm disconnect keyboard
   */
  static confirmDisconnect() {
    return {
      inline_keyboard: [
        [
          { text: '✅ Yes, disconnect', callback_data: 'disconnect_confirm' },
          { text: '❌ Cancel', callback_data: 'main_menu' }
        ]
      ]
    }
  }

  /**
   * Back button keyboard
   */
  static backButton(target = 'main_menu') {
    return {
      inline_keyboard: [
        [{ text: '🔙 Back', callback_data: target }]
      ]
    }
  }

  /**
   * Simple OK button
   */
  static okButton() {
    return {
      inline_keyboard: [
        [{ text: '✅ OK', callback_data: 'main_menu' }]
      ]
    }
  }

  /**
   * Admin menu keyboard
   */
  static adminMenu() {
    return {
      inline_keyboard: [
        [{ text: '👥 Users', callback_data: 'admin_users' }],
        [{ text: '📊 Statistics', callback_data: 'admin_stats' }],
        [{ text: '⚙️ Settings', callback_data: 'admin_settings' }],
        [{ text: '📝 Logs', callback_data: 'admin_logs' }],
        [{ text: '🔙 Main Menu', callback_data: 'main_menu' }]
      ]
    }
  }
}