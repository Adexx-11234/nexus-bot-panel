/**
 * Admin Handler
 * Manages admin panel and administrative functions
 */

import { createComponentLogger } from '../../utils/logger.js'
import { TelegramKeyboards, TelegramMessages } from '../ui/index.js'
import { pool } from '../../config/database.js'

const logger = createComponentLogger('ADMIN_HANDLER')

export class AdminHandler {
  constructor(bot) {
    this.bot = bot
    this.adminMiddleware = null
    this.pendingInputs = new Map()
    this._initializeMiddleware()
  }

  /**
   * Initialize admin middleware
   * @private
   */
  async _initializeMiddleware() {
    const { AdminMiddleware } = await import('../middleware/index.js')
    this.adminMiddleware = new AdminMiddleware()
    await this.adminMiddleware.initializeDefaultAdmin()
  }

  /**
   * Handle admin panel access
   */
  async handlePanel(chatId, userId) {
    try {
      if (!this.adminMiddleware) {
        await this._initializeMiddleware()
      }

      const isAdmin = await this.adminMiddleware.isAdmin(userId)
      if (!isAdmin) {
        return this.bot.sendMessage(chatId, TelegramMessages.unauthorized())
      }

      if (this.adminMiddleware.isAdminSessionActive(userId)) {
        return this._showMainPanel(chatId)
      }

      if (this.adminMiddleware.isLockedOut(userId)) {
        return this.bot.sendMessage(chatId, TelegramMessages.adminLockout())
      }

      this.pendingInputs.set(userId, { type: 'password' })
      await this.bot.sendMessage(chatId, TelegramMessages.adminLogin(), {
        reply_markup: TelegramKeyboards.backButton('main_menu')
      })
    } catch (error) {
      logger.error('Error in handlePanel:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Failed to access admin panel'))
    }
  }

  /**
   * Process input from user
   */
  async processInput(msg) {
    const userId = msg.from.id
    const input = msg.text.trim()
    const pending = this.pendingInputs.get(userId)

    if (!pending) return false

    try {
      switch (pending.type) {
        case 'password':
          return await this._handlePassword(msg)
          
        case 'add_admin':
          await this._processAddAdmin(msg, input)
          break
          
        case 'remove_admin':
          await this._processRemoveAdmin(msg, input)
          break
          
        case 'admin_password':
          await this._processSetAdminPassword(msg, input)
          break
          
        case 'disconnect_user':
          await this._processDisconnectUser(msg, input)
          break
          
        default:
          return false
      }

      this.pendingInputs.delete(userId)
      return true
    } catch (error) {
      logger.error('Error processing input:', error)
      await this.bot.sendMessage(msg.chat.id, TelegramMessages.error('Failed to process input'))
      this.pendingInputs.delete(userId)
      return true
    }
  }

  /**
   * Handle password input
   * @private
   */
  async _handlePassword(msg) {
    const userId = msg.from.id
    const password = msg.text

    try {
      await this.bot.deleteMessage(msg.chat.id, msg.message_id)

      const pending = this.pendingInputs.get(userId)
      if (!pending || pending.type !== 'password') return false

      const isValid = await this.adminMiddleware.verifyAdminPassword(userId, password)

      if (isValid) {
        this.adminMiddleware.createAdminSession(userId)
        this.pendingInputs.delete(userId)
        await this.bot.sendMessage(msg.chat.id, TelegramMessages.adminLoginSuccess())
        await this._showMainPanel(msg.chat.id)
      } else {
        const attemptResult = this.adminMiddleware.recordFailedAttempt(userId)
        if (attemptResult.locked) {
          this.pendingInputs.delete(userId)
          await this.bot.sendMessage(msg.chat.id, TelegramMessages.adminLockout())
        } else {
          await this.bot.sendMessage(msg.chat.id, TelegramMessages.adminLoginFailed(attemptResult.attemptsLeft))
        }
      }
      return true
    } catch (error) {
      logger.error('Error in handlePassword:', error)
      return false
    }
  }

  /**
   * Show main admin panel
   * @private
   */
  async _showMainPanel(chatId) {
    await this.bot.sendMessage(chatId, TelegramMessages.adminPanel(), {
      parse_mode: 'Markdown',
      reply_markup: TelegramKeyboards.adminMenu()
    })
  }

  /**
   * Handle admin actions
   */
  async handleAction(query) {
    const chatId = query.message.chat.id
    const userId = query.from.id
    const action = query.data

    try {
      const authResult = await this.adminMiddleware.requireAdmin(userId)
      if (!authResult.authorized) {
        return this._handleUnauthorized(chatId, authResult.reason)
      }

      switch (action) {
        case 'admin_panel':
          await this._showMainPanel(chatId)
          break
        case 'admin_stats':
          await this._showStats(chatId)
          break
        case 'admin_users':
          await this._showUsersMenu(chatId)
          break
        case 'admin_users_list':
          await this._showUsers(chatId, 1)
          break
        case 'admin_manage':
          await this._showAdminManagement(chatId)
          break
        case 'admin_add':
          await this._handleAddAdmin(chatId, userId)
          break
        case 'admin_remove':
          await this._handleRemoveAdmin(chatId, userId)
          break
        case 'admin_list':
          await this._showAdminsList(chatId)
          break
        case 'admin_sessions':
          await this._showSessionsMenu(chatId)
          break
        case 'admin_system':
          await this._showSystemMenu(chatId)
          break
        case 'admin_health':
          await this._showHealthCheck(chatId)
          break
        case 'admin_maintenance':
          await this._showMaintenanceMenu(chatId)
          break
        case 'admin_disconnect_all':
          await this._confirmDisconnectAll(chatId)
          break
        case 'admin_disconnect_all_confirm':
          await this._executeDisconnectAll(chatId)
          break
        case 'admin_disconnect_user':
          await this._requestDisconnectUser(chatId, userId)
          break
        case 'admin_logout':
          await this._handleLogout(chatId, userId)
          break
        default:
          if (action.startsWith('admin_users_')) {
            const page = parseInt(action.split('_')[2])
            await this._showUsers(chatId, page)
          }
      }
    } catch (error) {
      logger.error('Error in handleAction:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Action failed'))
    }
  }

  /**
   * Show statistics
   * @private
   */
  async _showStats(chatId) {
    try {
      const stats = await this._getStats()
      await this.bot.sendMessage(chatId, TelegramMessages.adminStats(stats), {
        parse_mode: 'Markdown',
        reply_markup: TelegramKeyboards.backButton('admin_panel')
      })
    } catch (error) {
      logger.error('Error showing stats:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Failed to load statistics'))
    }
  }

  /**
   * Get system statistics
   * @private
   */
  async _getStats() {
    try {
      const [users, sessions, system] = await Promise.all([
        pool.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN updated_at > NOW() - INTERVAL '1 day' THEN 1 END) as active_today,
            COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as new_week
          FROM users
        `),
        pool.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN is_connected = true THEN 1 END) as connected,
            COUNT(CASE WHEN is_connected = true AND updated_at > NOW() - INTERVAL '1 hour' THEN 1 END) as active
          FROM users
        `),
        this._getSystemInfo()
      ])

      const totalUsers = parseInt(users.rows[0].total) || 0
      const connectedSessions = parseInt(sessions.rows[0].connected) || 0
      
      return {
        totalUsers,
        activeToday: parseInt(users.rows[0].active_today) || 0,
        newThisWeek: parseInt(users.rows[0].new_week) || 0,
        connectedSessions,
        activeSessions: parseInt(sessions.rows[0].active) || 0,
        connectionRate: totalUsers > 0 ? Math.round((connectedSessions / totalUsers) * 100) : 0,
        messagesToday: 0,
        messagesWeek: 0,
        avgMessages: 0,
        uptime: system.uptime,
        memoryUsage: system.memoryUsage
      }
    } catch (error) {
      logger.error('Error getting stats:', error)
      return {
        totalUsers: 0, activeToday: 0, newThisWeek: 0,
        connectedSessions: 0, activeSessions: 0, connectionRate: 0,
        messagesToday: 0, messagesWeek: 0, avgMessages: 0,
        uptime: 'Unknown', memoryUsage: 0
      }
    }
  }

  /**
   * Get system information
   * @private
   */
  _getSystemInfo() {
    const uptime = process.uptime()
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)
    
    return {
      uptime: `${hours}h ${minutes}m`,
      memoryUsage: Math.round(process.memoryUsage().rss / 1024 / 1024)
    }
  }

  /**
   * Show users menu
   * @private
   */
  async _showUsersMenu(chatId) {
    await this.bot.sendMessage(chatId, 'User Management\n\nSelect an option:', {
      reply_markup: TelegramKeyboards.adminUsersMenu()
    })
  }

  /**
   * Show user list
   * @private
   */
  async _showUsers(chatId, page = 1) {
    try {
      const limit = 8
      const offset = (page - 1) * limit

      const usersResult = await pool.query(`
        SELECT 
          telegram_id, username, first_name, is_admin,
          created_at, phone_number, is_connected
        FROM users
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset])

      const countResult = await pool.query('SELECT COUNT(*) FROM users')
      const totalUsers = parseInt(countResult.rows[0].count)
      const totalPages = Math.ceil(totalUsers / limit)

      if (usersResult.rows.length === 0) {
        return this.bot.sendMessage(chatId, 'No users found.', {
          reply_markup: TelegramKeyboards.backButton('admin_panel')
        })
      }

      await this.bot.sendMessage(chatId, TelegramMessages.adminUserList(usersResult.rows, page, totalPages), {
        parse_mode: 'Markdown',
        reply_markup: TelegramKeyboards.paginationKeyboard(page, totalPages, 'admin_users')
      })
    } catch (error) {
      logger.error('Error showing users:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Failed to load users'))
    }
  }

  /**
   * Show admin management
   * @private
   */
  async _showAdminManagement(chatId) {
    await this.bot.sendMessage(chatId, TelegramMessages.adminManageAdmins(), {
      parse_mode: 'Markdown',
      reply_markup: TelegramKeyboards.adminManagementKeyboard()
    })
  }

  /**
   * Handle add admin
   * @private
   */
  async _handleAddAdmin(chatId, userId) {
    if (!this.adminMiddleware.isDefaultAdmin(userId)) {
      return this.bot.sendMessage(chatId, TelegramMessages.error('Only the default admin can add other admins'))
    }

    this.pendingInputs.set(userId, { type: 'add_admin' })
    await this.bot.sendMessage(chatId, TelegramMessages.adminAddAdmin(), {
      parse_mode: 'Markdown',
      reply_markup: TelegramKeyboards.backButton('admin_manage')
    })
  }

  /**
   * Handle remove admin
   * @private
   */
  async _handleRemoveAdmin(chatId, userId) {
    if (!this.adminMiddleware.isDefaultAdmin(userId)) {
      return this.bot.sendMessage(chatId, TelegramMessages.error('Only the default admin can remove other admins'))
    }

    this.pendingInputs.set(userId, { type: 'remove_admin' })
    await this.bot.sendMessage(chatId, TelegramMessages.adminRemoveAdmin(), {
      parse_mode: 'Markdown',
      reply_markup: TelegramKeyboards.backButton('admin_manage')
    })
  }

  /**
   * Process add admin
   * @private
   */
  async _processAddAdmin(msg, input) {
    const chatId = msg.chat.id
    
    try {
      let targetTelegramId = input

      if (input.startsWith('@')) {
        const username = input.substring(1)
        const userResult = await pool.query('SELECT telegram_id FROM users WHERE username = $1', [username])

        if (userResult.rows.length === 0) {
          return this.bot.sendMessage(chatId, TelegramMessages.error('User not found. They must use the bot first.'))
        }

        targetTelegramId = userResult.rows[0].telegram_id
      }

      const userResult = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [targetTelegramId])
      if (userResult.rows.length === 0) {
        return this.bot.sendMessage(chatId, TelegramMessages.error('User not found. They must use the bot first.'))
      }

      const user = userResult.rows[0]
      if (user.is_admin) {
        return this.bot.sendMessage(chatId, TelegramMessages.error('User is already an admin.'))
      }

      this.pendingInputs.set(msg.from.id, { type: 'admin_password', targetTelegramId, user })
      await this.bot.sendMessage(chatId, TelegramMessages.setAdminPassword(user), {
        parse_mode: 'Markdown',
        reply_markup: TelegramKeyboards.backButton('admin_manage')
      })
    } catch (error) {
      logger.error('Error processing add admin:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Failed to add admin'))
    }
  }

  /**
   * Process set admin password
   * @private
   */
  async _processSetAdminPassword(msg, password) {
    const chatId = msg.chat.id
    const userId = msg.from.id
    const pending = this.pendingInputs.get(userId)

    if (!pending || !pending.targetTelegramId) {
      return this.bot.sendMessage(chatId, TelegramMessages.error('Invalid state'))
    }

    try {
      await this.bot.deleteMessage(chatId, msg.message_id)

      const result = await this.adminMiddleware.createAdmin(pending.targetTelegramId, userId, password)
      
      await this.bot.sendMessage(chatId, TelegramMessages.adminAdded(result.user), {
        parse_mode: 'Markdown',
        reply_markup: TelegramKeyboards.backButton('admin_manage')
      })
    } catch (error) {
      logger.error('Error setting admin password:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error(error.message || 'Failed to set admin password'))
    }
  }

  /**
   * Process remove admin
   * @private
   */
  async _processRemoveAdmin(msg, input) {
    const chatId = msg.chat.id
    
    try {
      const result = await this.adminMiddleware.removeAdmin(input)
      
      if (result.success) {
        await this.bot.sendMessage(chatId, TelegramMessages.operationSuccess(result.message), {
          reply_markup: TelegramKeyboards.backButton('admin_manage')
        })
      } else {
        await this.bot.sendMessage(chatId, TelegramMessages.error(result.message))
      }
    } catch (error) {
      logger.error('Error processing remove admin:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Failed to remove admin'))
    }
  }

  /**
   * Show admins list
   * @private
   */
  async _showAdminsList(chatId) {
    try {
      const admins = await this.adminMiddleware.getAllAdmins()
      await this.bot.sendMessage(chatId, TelegramMessages.adminListAdmins(admins), {
        parse_mode: 'Markdown',
        reply_markup: TelegramKeyboards.backButton('admin_manage')
      })
    } catch (error) {
      logger.error('Error showing admins list:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Failed to load admins list'))
    }
  }

  /**
   * Show sessions menu
   * @private
   */
  async _showSessionsMenu(chatId) {
    await this.bot.sendMessage(chatId, 'Session Management\n\nSelect an option:', {
      reply_markup: TelegramKeyboards.sessionsMenu()
    })
  }

  /**
   * Show system menu
   * @private
   */
  async _showSystemMenu(chatId) {
    await this.bot.sendMessage(chatId, 'System Management\n\nSelect an option:', {
      reply_markup: TelegramKeyboards.systemMenu()
    })
  }

  /**
   * Show health check
   * @private
   */
  async _showHealthCheck(chatId) {
    try {
      const health = await this.adminMiddleware.getSystemHealth()
      await this.bot.sendMessage(chatId, TelegramMessages.healthCheck(health), {
        parse_mode: 'Markdown',
        reply_markup: TelegramKeyboards.backButton('admin_system')
      })
    } catch (error) {
      logger.error('Error showing health check:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Failed to perform health check'))
    }
  }

  /**
   * Show maintenance menu
   * @private
   */
  async _showMaintenanceMenu(chatId) {
    await this.bot.sendMessage(chatId, TelegramMessages.maintenancePanel(), {
      parse_mode: 'Markdown',
      reply_markup: TelegramKeyboards.maintenanceMenu()
    })
  }

  /**
   * Confirm disconnect all
   * @private
   */
  async _confirmDisconnectAll(chatId) {
    await this.bot.sendMessage(chatId, TelegramMessages.disconnectAllConfirmation(), {
      parse_mode: 'Markdown',
      reply_markup: TelegramKeyboards.disconnectAllConfirmation()
    })
  }

  /**
   * Execute disconnect all
   * @private
   */
  async _executeDisconnectAll(chatId) {
    try {
      await this.bot.sendMessage(chatId, 'Disconnecting all users...')
      
      const result = await this.adminMiddleware.disconnectAllUsers(true)
      
      await this.bot.sendMessage(chatId, TelegramMessages.operationSuccess(`Disconnected ${result.count} users successfully`), {
        reply_markup: TelegramKeyboards.backButton('admin_maintenance')
      })
    } catch (error) {
      logger.error('Error disconnecting all users:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Failed to disconnect all users'))
    }
  }

  /**
   * Request disconnect user
   * @private
   */
  async _requestDisconnectUser(chatId, userId) {
    this.pendingInputs.set(userId, { type: 'disconnect_user' })
    await this.bot.sendMessage(chatId, TelegramMessages.disconnectSpecificUser(), {
      parse_mode: 'Markdown',
      reply_markup: TelegramKeyboards.backButton('admin_users')
    })
  }

  /**
   * Process disconnect user
   * @private
   */
  async _processDisconnectUser(msg, input) {
    const chatId = msg.chat.id
    
    try {
      const result = await this.adminMiddleware.disconnectSpecificUser(input)
      
      if (result.success) {
        await this.bot.sendMessage(chatId, TelegramMessages.operationSuccess(result.message), {
          reply_markup: TelegramKeyboards.backButton('admin_users')
        })
      } else {
        await this.bot.sendMessage(chatId, TelegramMessages.error(result.message))
      }
    } catch (error) {
      logger.error('Error processing disconnect user:', error)
      await this.bot.sendMessage(chatId, TelegramMessages.error('Failed to disconnect user'))
    }
  }

  /**
   * Handle logout
   * @private
   */
  async _handleLogout(chatId, userId) {
    this.adminMiddleware.destroyAdminSession(userId)
    this.pendingInputs.delete(userId)
    await this.bot.sendMessage(chatId, TelegramMessages.operationSuccess('Logged out successfully'), {
      reply_markup: TelegramKeyboards.backButton('main_menu')
    })
  }

  /**
   * Handle unauthorized access
   * @private
   */
  async _handleUnauthorized(chatId, reason) {
    const messages = {
      locked_out: TelegramMessages.adminLockout(),
      not_admin: TelegramMessages.unauthorized(),
      session_expired: TelegramMessages.adminLogin()
    }
    
    await this.bot.sendMessage(chatId, messages[reason] || messages.not_admin)
  }

  /**
   * Check if user has pending input
   */
  isPendingInput(userId) {
    return this.pendingInputs.has(userId)
  }

  /**
   * Clear pending input
   */
  clearPending(userId) {
    this.pendingInputs.delete(userId)
  }
}