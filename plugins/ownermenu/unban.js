import { createComponentLogger } from "../../utils/logger.js"
import nodemailer from "nodemailer"

const logger = createComponentLogger("UNBAN-WA")

// Gmail accounts for rotation
const gmailAccounts = [
  { email: "managerhimself032@gmail.com", password: "inagtgypnpyweleu" },
  { email: "arsheeqarsheeqq@gmail.com", password: "pkkqfactxwkpvzgc" },
  { email: "unknownhimself6@gmail.com", password: "uupfjdufriwrdgop" },
  { email: "cryptolord25ss@gmail.com", password: "lczszqjxovvbuxco" },
  { email: "himselfdev759@gmail.com", password: "fpwncioanqohseix" },
]

// WhatsApp support emails
const supportEmails = [
  "support@support.whatsapp.com",
  "appeals@support.whatsapp.com",
  "android_web@support.whatsapp.com",
  "ios_web@support.whatsapp.com",
  "webclient_web@support.whatsapp.com",
  "1483635209301664@support.whatsapp.com",
  "support@whatsapp.com",
  "businesscomplaints@support.whatsapp.com",
  "help@whatsapp.com",
  "abuse@support.whatsapp.com",
  "security@support.whatsapp.com"
]

let currentAccountIndex = 0

export default {
  name: "WhatsApp Unban",
  description: "Submit unban request to WhatsApp for banned numbers",
  commands: ["unbanwa", "waunban"],
  category: "ownermenu",
  ownerOnly: true,
  usage: "• `.unbanwa temp <number>` - Temporary unban request\n• `.unbanwa perm <number>` - Permanent unban request\n\nExample:\n• `.unbanwa temp +2348123456789`\n• `.unbanwa perm +2348123456789`",

  async execute(sock, sessionId, args, m) {
    try {
      const unbanType = args[0]?.toLowerCase()
      const phoneNumber = args[1]?.trim()

      // Validate input
      if (!unbanType || !["temp", "perm"].includes(unbanType)) {
        await this.showHelp(sock, m)
        return
      }

      if (!phoneNumber || !this.isValidPhoneNumber(phoneNumber)) {
        await sock.sendMessage(m.chat, {
          text: "❌ Invalid phone number format!\n\n" +
                "Number must:\n" +
                "• Start with + and country code\n" +
                "• Be 10-15 digits\n" +
                "• Example: +2348123456789\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Send processing message
      const processingMsg = await sock.sendMessage(m.chat, {
        text: `⏳ Processing ${unbanType === 'temp' ? 'Temporary' : 'Permanent'} unban request for ${phoneNumber}...\n\n` +
              `Please wait while we send emails to WhatsApp support.\n\n` +
              `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      // Send unban emails
      const result = await this.sendUnbanRequest(phoneNumber, unbanType)

      // Update with result
      await sock.sendMessage(m.chat, {
        text: result.success 
          ? `✅ *Unban Request Submitted!*\n\n` +
            `📞 Number: ${phoneNumber}\n` +
            `📧 Emails Sent: ${result.successCount}/${result.totalEmails}\n` +
            `⏰ Time: ${new Date().toLocaleString()}\n\n` +
            `${unbanType === 'temp' ? '🔄 Temporary' : '🔓 Permanent'} unban request has been submitted to WhatsApp support.\n\n` +
            `⚠️ Stay active on WhatsApp while they review your request.\n` +
            `⏱️ Usually takes 24-48 hours.\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          : `❌ *Unban Request Failed!*\n\n` +
            `Failed to send emails. Errors:\n${result.error}\n\n` +
            `Please try again later.\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        edit: processingMsg.key
      })

    } catch (error) {
      logger.error("Error executing unbanwa command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Error processing unban request.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  /**
   * Validate phone number format
   */
  isValidPhoneNumber(phone) {
    return /^\+\d{10,15}$/.test(phone)
  },

  /**
   * Send unban request emails
   */
  async sendUnbanRequest(phoneNumber, unbanType) {
    try {
      const { subject, body } = this.getEmailContent(phoneNumber, unbanType)
      const account = gmailAccounts[currentAccountIndex]
      
      // Rotate to next account for next request
      currentAccountIndex = (currentAccountIndex + 1) % gmailAccounts.length

      // Create transporter
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: account.email,
          pass: account.password
        }
      })

      let successCount = 0
      const totalEmails = supportEmails.length

      // Send to all support emails
      for (const supportEmail of supportEmails) {
        try {
          await transporter.sendMail({
            from: account.email,
            to: supportEmail,
            subject: subject,
            text: body
          })
          successCount++
          
          // Small delay between emails
          await new Promise(resolve => setTimeout(resolve, 200))
        } catch (error) {
          logger.error(`Failed to send to ${supportEmail}:`, error.message)
        }
      }

      return {
        success: successCount > 0,
        successCount,
        totalEmails
      }

    } catch (error) {
      logger.error("Error sending unban request:", error)
      return {
        success: false,
        error: error.message,
        successCount: 0,
        totalEmails: supportEmails.length
      }
    }
  },

  /**
   * Get email content based on unban type
   */
  getEmailContent(phoneNumber, unbanType) {
    if (unbanType === 'temp') {
      return {
        subject: "Humble Request for Temporary Lift of WhatsApp Account Ban",
        body: `
Dear WhatsApp Appeals Team,

I hope this message finds you well.

I am writing with deep respect and concern regarding the ban placed on my WhatsApp account associated with the phone number ${phoneNumber}. I understand the importance of maintaining a safe and positive community, and I fully support your efforts.

However, I kindly believe this ban may have resulted from a misunderstanding or an unintentional error. WhatsApp is essential for my daily communication with family, friends, and work, and I am sincerely committed to following all community guidelines moving forward.

Phone Number: ${phoneNumber}
WhatsApp Version: 2.25.21.82

I humbly request that you consider temporarily lifting the ban on my account to allow me the opportunity to demonstrate responsible use and compliance with your policies. If any issues remain, I would be grateful for guidance so I can fully address them.

Thank you very much for your understanding and consideration. I deeply appreciate your time and support.

With sincere gratitude.
`
      }
    } else {
      return {
        subject: "Humble Request for Reconsideration Permanent Unban of WhatsApp Number Due to Violation",
        body: `
Dear WhatsApp Team,

I hope you are doing well.

I am reaching out with a heavy heart regarding the permanent ban on my WhatsApp account linked to the phone number ${phoneNumber}. I was deeply saddened to learn about this restriction and genuinely believe there might have been a misunderstanding or an unintentional mistake on my part. I acknowledge the mistake and sincerely apologize for any inconvenience caused. I assure you that I understand the importance of adhering to the platform's guidelines and am committed to using WhatsApp responsibly in the future. I kindly ask for your understanding and consideration in granting me a second chance to regain access to my account.

Phone Number: ${phoneNumber}

WhatsApp is incredibly important to me—it connects me with my loved ones, friends, and colleagues daily. I truly respect the rules and community guidelines set forth by your team, and if I have unknowingly violated any, I sincerely apologize. Please know that it was never my intention to cause any harm or disruption.

I humbly ask for your kindness and understanding in reviewing my case. If given the chance, I commit to strictly adhering to all policies moving forward and ensuring that my usage aligns fully with your standards.

Thank you very much for your time, patience, and consideration. I would be extremely grateful for the opportunity to regain access to my account.

With sincere gratitude.
`
      }
    }
  },

  /**
   * Show help message
   */
  async showHelp(sock, m) {
    await sock.sendMessage(m.chat, {
      text: "📋 *WhatsApp Unban Tool*\n\n" +
            "Usage:\n" +
            "• `.unbanwa temp <number>` - Temporary unban\n" +
            "• `.unbanwa perm <number>` - Permanent unban\n\n" +
            "Examples:\n" +
            "• `.unbanwa temp +2348123456789`\n" +
            "• `.unbanwa perm +2348123456789`\n\n" +
            "Note: Number must include country code starting with +\n\n" +
            "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
    }, { quoted: m })
  }
}