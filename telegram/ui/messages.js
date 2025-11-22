/**
 * TelegramMessages - Message templates for the bot
 */
export class TelegramMessages {
  /**
   * Welcome message
   */
  static welcome(firstName) {
    return `Welcome ${firstName}! 👋

I'm 𝕹 𝖊 𝖝 𝖚 𝖘   𝕭 𝖔 𝖙 - I help you connect your WhatsApp to Telegram.

*What can I do?*
- Connect your WhatsApp account
- Check connection status
- Manage your session

Ready to get started? Click "Connect WhatsApp" below!`
  }

  /**
   * Help message
   */
  static help() {
    return `*How to Connect:*

1️⃣ Click "Connect WhatsApp"
2️⃣ Enter your phone number with country code
3️⃣ I'll give you a pairing code
4️⃣ Open WhatsApp > Settings > Linked Devices
5️⃣ Tap "Link a Device" and enter the code

That's it! Your WhatsApp will be connected.

*Commands:*
/start - Show main menu
/connect - Connect WhatsApp
/status - Check connection status
/disconnect - Disconnect WhatsApp
/help - Show this help message`
  }

  /**
   * Ask for phone number
   */
  static askPhoneNumber() {
    return `*Enter Your Phone Number*

Please type your number with country code:

✅ Correct: +1234567890
✅ Correct: +447123456789
❌ Wrong: 1234567890 (missing +)
❌ Wrong: 234567890 (missing country code)

Type and send your number below:`
  }

  /**
   * Show pairing code
   */
  static showPairingCode(code) {
    return `*Your Pairing Code*

\`${code}\`

*Now follow these steps:*
1️⃣ Open WhatsApp on your phone
2️⃣ Go to Settings > Linked Devices
3️⃣ Tap "Link a Device"
4️⃣ Enter this code: ${code}

⏰ Code expires in 60 seconds
🔄 Need a new code? Click "New Code" below`
  }

  /**
   * Connected successfully
   */
  static connected(phoneNumber) {
    return `*Successfully Connected! ✅*

Your WhatsApp (${phoneNumber}) is now linked!

You can check your connection status anytime with /status`
  }

  /**
   * Already connected
   */
  static alreadyConnected(phoneNumber) {
    return `You're already connected! ✅

Phone: ${phoneNumber}

To connect a different number:
1. First /disconnect
2. Then /connect again`
  }

  /**
   * Not connected
   */
  static notConnected() {
    return `Not connected yet ❌

Click "Connect WhatsApp" to get started!`
  }

  /**
   * Connecting message
   */
  static connecting() {
    return `*Connecting to WhatsApp...*

Please wait while we establish the connection.

This may take up to 30 seconds.`
  }

  /**
   * Disconnecting message
   */
  static disconnecting(phoneNumber) {
    return `*Disconnecting...*

Unlinking WhatsApp: ${phoneNumber}

This may take a moment...`
  }

  /**
   * Disconnected successfully
   */
  static disconnected() {
    return `Disconnected successfully ✅

Your WhatsApp has been unlinked.
You can connect again anytime!`
  }

  /**
   * Confirm disconnect
   */
  static confirmDisconnect(phoneNumber) {
    return `*Confirm Disconnect*

This will unlink: ${phoneNumber}

Are you sure?`
  }

  /**
   * Status message
   */
  static status(isConnected, phoneNumber) {
    if (!isConnected) {
      return `*Status*

Connection: ❌ Not connected

Use /connect to link your WhatsApp`
    }

    return `*Status*

Connection: ✅ Active
Phone: ${phoneNumber}

Everything is running smoothly!`
  }

  /**
   * Invalid phone number
   */
  static invalidPhone() {
    return `Invalid phone number ❌

Remember to include:
- The + sign
- Country code
- Full number

Example: +1234567890

Please try again:`
  }

  /**
   * Phone in use
   */
  static phoneInUse() {
    return `This number is already connected to another account ❌

Each WhatsApp can only be linked to one Telegram account.`
  }

  /**
   * Error message
   */
  static error(details = null) {
    return `Something went wrong ❌${details ? `\n\nDetails: ${details}` : ''}

Please try again or contact support.`
  }

  /**
   * Unauthorized access
   */
  static unauthorized() {
    return `Access Denied ❌

You don't have permission to use this feature.`
  }

  /**
   * Operation success
   */
  static operationSuccess(message) {
    return `Success ✅

${message}`
  }
}