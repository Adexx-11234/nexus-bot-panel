import { execSync } from 'child_process'
import fs from 'fs'

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  success: (...args) => console.log('[SUCCESS]', ...args)
}

// ============================================
// PART 1: Auto-Update with Force Pull
// ============================================

async function autoUpdate() {
  try {
    logger.info('='.repeat(70))
    logger.info('AUTO-UPDATE INITIALIZATION')
    logger.info('='.repeat(70))
    logger.info('')

    // Check if .git exists
    if (!fs.existsSync('.git')) {
      logger.warn('⚠️  No .git directory found, cloning repository...')
      
      execSync('git clone https://github.com/Adexx-11234/nexus-bot-panel /tmp/nexus-clone --depth 1', { 
        stdio: 'inherit',
        cwd: '/home/container'
      })
      
      logger.info('📦 Moving files to main directory...')
      execSync('shopt -s dotglob; mv /tmp/nexus-clone/* /home/container/ 2>/dev/null || true', { 
        stdio: 'inherit',
        shell: '/bin/bash'
      })
      execSync('rm -rf /tmp/nexus-clone', { stdio: 'inherit' })
      
      logger.success('✅ Repository cloned!')
    } else {
      logger.info('📥 Checking for updates from GitHub...')
      
      // Configure git to handle divergent branches
      try {
        execSync('git config pull.rebase false', { 
          stdio: 'pipe',
          cwd: '/home/container'
        })
        logger.info('✓ Git pull strategy configured')
      } catch (error) {
        logger.warn('⚠️  Could not configure git pull strategy')
      }
      
      // Stash any local changes
      try {
        execSync('git stash', { 
          stdio: 'pipe',
          cwd: '/home/container'
        })
        logger.info('📦 Local changes stashed')
      } catch (error) {
        logger.warn('⚠️  No changes to stash or stash already clean')
      }
      
      // Fetch and force pull from remote
      try {
        logger.info('🔄 Fetching latest changes from origin/main...')
        execSync('git fetch origin main', { 
          stdio: 'pipe',
          cwd: '/home/container'
        })
        
        const beforePull = execSync('git rev-parse HEAD', { 
          encoding: 'utf8',
          cwd: '/home/container'
        }).trim()
        
        logger.info('🔨 Force updating to origin/main...')
        execSync('git reset --hard origin/main', { 
          stdio: 'pipe',
          cwd: '/home/container'
        })
        
        const afterPull = execSync('git rev-parse HEAD', { 
          encoding: 'utf8',
          cwd: '/home/container'
        }).trim()
        
        if (beforePull !== afterPull) {
          logger.success('✅ Updates found and applied from GitHub!')
          logger.info(`   Commit: ${beforePull.substring(0, 7)} → ${afterPull.substring(0, 7)}`)
          
          // Check if package.json was updated
          try {
            const changedFiles = execSync('git diff --name-only HEAD@{1} HEAD', {
              encoding: 'utf8',
              cwd: '/home/container'
            }).trim()
            
            if (changedFiles.includes('package.json')) {
              logger.warn('⚠️  package.json was updated - full dependency reinstall required')
              
              // Remove node_modules to force clean install
              logger.info('🗑️  Removing old node_modules...')
              if (fs.existsSync('/home/container/node_modules')) {
                execSync('rm -rf /home/container/node_modules', { 
                  stdio: 'pipe',
                  cwd: '/home/container'
                })
                logger.success('✅ Old node_modules removed')
              }
              
              // Remove package-lock.json to ensure fresh resolution
              if (fs.existsSync('/home/container/package-lock.json')) {
                execSync('rm -f /home/container/package-lock.json', { 
                  stdio: 'pipe',
                  cwd: '/home/container'
                })
                logger.info('🗑️  Removed package-lock.json for fresh install')
              }
            }
          } catch (error) {
            logger.warn('⚠️  Could not check for package.json changes')
          }
        } else {
          logger.info('✓ Already on latest version')
        }
      } catch (error) {
        logger.warn('⚠️  Update check failed, continuing with current version')
        logger.warn(`   Error: ${error.message}`)
      }
    }

    // Install/update dependencies with legacy peer deps
    logger.info('')
    logger.info('📚 Installing/updating dependencies with legacy peer deps...')
    
    try {
      // Use --legacy-peer-deps and --force to handle dependency conflicts
      execSync('/usr/local/bin/npm install --legacy-peer-deps --force', { 
        stdio: 'inherit',
        cwd: '/home/container'
      })
      logger.success('✅ Dependencies installed successfully!')
    } catch (npmError) {
      logger.error('❌ npm install failed:', npmError.message)
      
      // Try alternative: clean install
      logger.warn('⚠️  Attempting clean install...')
      
      try {
        if (fs.existsSync('/home/container/node_modules')) {
          execSync('rm -rf /home/container/node_modules', { 
            stdio: 'pipe',
            cwd: '/home/container'
          })
        }
        
        if (fs.existsSync('/home/container/package-lock.json')) {
          execSync('rm -f /home/container/package-lock.json', { 
            stdio: 'pipe',
            cwd: '/home/container'
          })
        }
        
        execSync('/usr/local/bin/npm install --legacy-peer-deps', { 
          stdio: 'inherit',
          cwd: '/home/container'
        })
        logger.success('✅ Clean install successful!')
      } catch (retryError) {
        logger.error('❌ Clean install also failed')
        logger.warn('⚠️  Continuing with existing dependencies...')
      }
    }

    logger.info('')
    logger.info('='.repeat(70))
    logger.success('✅ INITIALIZATION COMPLETE')
    logger.info('='.repeat(70))
    logger.info('')

  } catch (error) {
    logger.error('❌ Initialization failed:', error.message)
    logger.warn('⚠️  Attempting to continue with existing setup...')
  }
}

// ============================================
// PART 2: Start the Bot
// ============================================

async function startBot() {
  try {
    logger.info('🚀 Starting Nexus Bot...')
    logger.info('')
    
    // Wait for files to settle
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Import and run the actual bot
    const botModule = await import('./index.js')
    logger.success('✅ Bot initialized and running!')
    
    // Keep the process alive - don't let it exit
    logger.info('⏳ Bot is running... (Press Ctrl+C to stop)')
    
    // Prevent process from exiting
    await new Promise(() => {
      // This promise never resolves, keeping the process alive forever
    })
    
  } catch (error) {
    logger.error('❌ Failed to start bot:', error.message)
    logger.error('Stack:', error.stack)
    process.exit(1)
  }
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  try {
    // Step 1: Initialize/Update
    await autoUpdate()
    
    // Step 2: Start Bot
    await startBot()
    
  } catch (error) {
    logger.error('❌ Critical error:', error.message)
    process.exit(1)
  }
}

// Run main
main().catch(error => {
  logger.error('Uncaught error:', error)
  process.exit(1)
})