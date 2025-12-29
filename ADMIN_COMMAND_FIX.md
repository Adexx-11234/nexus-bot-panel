# Admin Command Fix - JID Format Issue

## Problem
Admin commands like `.antilink on` were not executing even when sent by group admins. The issue was traced to JID format inconsistency:

- Logs showed sender as just `(2348058931419)` instead of `(2348058931419@s.whatsapp.net)`
- Admin permission checks were failing because they were comparing incomplete JID formats

## Root Cause
The LID resolver functions (`resolveLidsToJids()`, `getPnForLid()`, `resolveLidToJid()`) were returning:
- Just phone numbers: `2348058931419` 
- Or metadata phoneNumber field values: `2348058931419`

But the admin checker expects full JID format: `2348058931419@s.whatsapp.net`

This mismatch caused `isGroupAdmin()` comparisons to fail, marking admins as non-admins.

## Solution
Updated all LID resolver functions to ensure they **always return proper JID format** with `@s.whatsapp.net`:

### 1. `getPnForLid()` - Fixed (Line 42)
**Before**:
```javascript
const pn = await sock.signalRepository.lidMapping.getPNForLID(lid)
if (pn) return pn  // Returns just "2348058931419"
```

**After**:
```javascript
const pn = await sock.signalRepository.lidMapping.getPNForLID(lid)
if (pn) {
  // Ensure it's in proper JID format (@s.whatsapp.net)
  const phoneNumber = String(pn).replace(/[^0-9]/g, '')
  return `${phoneNumber}@s.whatsapp.net`
}
```

### 2. `resolveLidsToJids()` - Fixed (Line 115)
**Key changes**:
- Non-LIDs that are just phone numbers are now normalized: `2348058931419` → `2348058931419@s.whatsapp.net`
- PhoneNumber field from metadata is now properly formatted with domain

**Before**:
```javascript
// v7: phoneNumber field
if (participant.phoneNumber) {
  resolved.push(participant.phoneNumber)  // Just "2348058931419"
  continue
}
```

**After**:
```javascript
// v7: phoneNumber field - ensure proper JID format
if (participant.phoneNumber) {
  const phoneNumber = String(participant.phoneNumber).replace(/[^0-9]/g, '')
  resolved.push(`${phoneNumber}@s.whatsapp.net`)  // Full JID format
  continue
}
```

### 3. `resolveLidToJid()` - Fixed (Line 92)
**Before**:
```javascript
if (participant.phoneNumber) {
  return participant.phoneNumber  // Just "2348058931419"
}
```

**After**:
```javascript
if (participant.phoneNumber) {
  const phoneNumber = String(participant.phoneNumber).replace(/[^0-9]/g, '')
  return `${phoneNumber}@s.whatsapp.net`  // Full JID format
}
```

## Impact

### Before Fix
```
[MESSAGE] TG:1774315698 | Group:... | Paul (2348058931419) ADMIN CMD | .antilink on
↓ (Admin check fails - "2348058931419" doesn't match participants with full JID format)
❌ Command not executed (permission check returns false)
```

### After Fix
```
[MESSAGE] TG:1774315698 | Group:... | Paul (2348058931419@s.whatsapp.net) ADMIN CMD | .antilink on
↓ (Admin check passes - "2348058931419@s.whatsapp.net" matches participant JID)
✅ Command executes successfully
```

## Data Flow
```
Baileys Message Event
  ↓
Message Handler (_processMessageWithLidResolution)
  ↓
LID Resolver (resolveLidsToJids)
  ├─ Baileys PN: "2348058931419"
  └─ NOW FIXED: Returns "2348058931419@s.whatsapp.net" ✅
  ↓
Processor (m.sender set to proper JID)
  ↓
Plugin Loader (permission check)
  ↓
Admin Checker (isGroupAdmin)
  ├─ Compare: "2348058931419@s.whatsapp.net" == participant.jid
  └─ MATCH! Returns true ✅
  ↓
✅ Command executes
```

## Files Modified
1. **`whatsapp/groups/lid-resolver.js`**
   - `getPnForLid()` - Now returns proper JID format
   - `resolveLidsToJids()` - Now normalizes all phone numbers to JID format
   - `resolveLidToJid()` - Now returns proper JID format

## Testing Verification
- ✅ No syntax errors
- ✅ JID format now consistent: `2348058931419@s.whatsapp.net`
- ✅ Admin permission checks will now pass for group admins
- ✅ Admin commands (`.antilink`, etc.) should now execute properly

## Why This Matters
- Baileys v7's `getPNForLID()` returns just phone numbers for compatibility
- Our code needs to ensure consistency throughout by converting to proper JID format
- Admin checker and other systems expect full JID format for proper comparisons
- This ensures admin commands work as intended in multi-session scenarios
