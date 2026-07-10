# Device-Based Passwordless Authentication Implementation Guide

## Overview

This guide explains how device-based passwordless authentication works and how to integrate it into your application. The system allows users to set up a device once via QR code/link, then sign in with a single click—no OTP needed.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin Panel (hdeomniflow)                │
│  - Generate setup tokens                                     │
│  - Display QR codes                                          │
│  - Manage customer devices                                   │
│  - Revoke device access                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │   Supabase Backend      │
        │  - setup_tokens table   │
        │  - device_credentials   │
        │  - RPC functions        │
        │  - Row-level security   │
        └────────────┬────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Mobile PWA (home-decor-insider)                │
│  - /setup page (initial device setup)                       │
│  - /quick-login page (one-click signin)                     │
│  - Device credentials storage (localStorage)                │
│  - Device token verification                                │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### setup_tokens Table
Stores one-time tokens for initial device setup.

```sql
CREATE TABLE public.setup_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES public.elite_customers(id),
  token           text NOT NULL UNIQUE,  -- setup_xxxxx
  setup_data      jsonb,
  used_at         timestamptz,           -- NULL = unused
  expires_at      timestamptz NOT NULL,  -- 24 hours
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### device_credentials Table
Stores validated device tokens for passwordless login.

```sql
CREATE TABLE public.device_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES public.elite_customers(id),
  device_token      text NOT NULL UNIQUE,  -- device_xxxxx (secret)
  device_name       text,                   -- "Mobile Device June 10"
  device_id         text NOT NULL,          -- fingerprint
  user_agent        text,                   -- for tracking
  ip_address        text,                   -- for tracking
  public_key        text,                   -- reserved for future crypto
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz,           -- track usage
  expires_at        timestamptz,           -- auto-renewal (~1 year)
  revoked_at        timestamptz            -- NULL = active
);
```

### Security

- ✅ Row-level security on both tables
- ✅ Service role can manage setup_tokens
- ✅ Authenticated users can complete setup
- ✅ Public can verify device tokens (no PII exposed)
- ✅ Tokens are 256-bit random, cryptographically secure

## API Endpoints (RPC Functions)

### 1. generate_setup_token(customer_id)

**Access**: Service role only  
**Purpose**: Create a one-time setup token  
**Returns**: Text (setup token)

```typescript
// Usage in backend service
const { data: token, error } = await supabase.rpc('generate_setup_token', {
  _customer_id: 'a1b2c3d4-...'
});

// Returns: "setup_a1f3c9e2b4d7f9a1c3e5b7d9f1a3c5e7..."
```

**Security**:
- Only callable by service_role
- Token expires in 24 hours
- One-time use (marked used_at when redeemed)

### 2. complete_device_setup(setup_token, device_id, device_name, user_agent, ip_address)

**Access**: Authenticated user  
**Purpose**: Exchange setup_token for device_token  
**Returns**: JSON with device_token and customer_id

```typescript
// Usage in PWA setup page
const { data, error } = await supabase.rpc('complete_device_setup', {
  _setup_token: setupTokenFromQR,
  _device_id: generateDeviceId(),           // hash of fingerprint
  _device_name: 'Mobile Device June 10',    // friendly name
  _user_agent: navigator.userAgent,         // tracking
  _ip_address: clientIpAddress              // tracking
});

// Returns JSON:
{
  "success": true,
  "device_token": "device_f3c9e2b4d7f9a1c3e5b7d9f1a3c5e7a1...",
  "customer_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "device_id": "h4s7d9k2l0p3c5v1n6m8q2w5e9r3t7u1"
}
```

**Security**:
- Requires active auth session (auth.uid() not null)
- Validates setup_token exists and not expired
- Validates setup_token not already used
- Creates app_user link if needed
- Activates customer in elite_customers
- Tokens valid for ~1 year

### 3. verify_device_token(device_token)

**Access**: Public (no auth required)  
**Purpose**: Validate device token and retrieve customer info  
**Returns**: JSON with customer details or error

```typescript
// Usage in quick-login page
const { data, error } = await supabase.rpc('verify_device_token', {
  _device_token: storedDeviceToken
});

// Returns JSON:
{
  "customer_id": "a1b2c3d4-...",
  "device_id": "h4s7d9k2l0p3c5v1n6m8q2w5e9r3t7u1",
  "customer_name": "John Doe",
  "card_number": "****1234",
  "card_tier": "elite"
}
```

**Security**:
- Does NOT require auth (public endpoint)
- Validates token against device_credentials
- Checks token not revoked (revoked_at IS NULL)
- Checks token not expired
- Updates last_used_at timestamp
- Returns only non-sensitive customer data

### 4. revoke_device_token(device_token)

**Access**: Public (any user)  
**Purpose**: Revoke/logout a device  
**Returns**: Boolean (true if revoked)

```typescript
// Usage: logout from device
const { data: success, error } = await supabase.rpc('revoke_device_token', {
  _device_token: storedDeviceToken
});

// Marks revoked_at = now()
// Subsequent calls to verify_device_token will fail
```

**Security**:
- Sets revoked_at timestamp
- Old tokens won't verify
- Customer can revoke from app
- Admin can revoke from backend

## Frontend Integration

### Setup Flow (Initial)

```typescript
// 1. Generate device ID (fingerprinting)
import { generateDeviceId, completeDeviceSetup } from '@/lib/device-auth';

const deviceId = generateDeviceId();

// 2. Exchange setup token for device token
const result = await completeDeviceSetup(setupTokenFromURL);

if (result.success) {
  // 3. Device credentials stored locally
  // 4. Redirect to home
  navigate({ to: '/home' });
}
```

### Quick Login Flow (Subsequent Visits)

```typescript
import { getStoredDeviceCredential, verifyDeviceAndLogin } from '@/lib/device-auth';

// 1. Check for stored credentials on app load
const credential = getStoredDeviceCredential();

if (credential) {
  // 2. Show quick-login page instead of signup
  navigate({ to: '/quick-login' });
}

// 3. User clicks signin button
const result = await verifyDeviceAndLogin(credential.deviceToken);

if (result.success) {
  // 4. Logged in! Redirect to home
  navigate({ to: '/home' });
}
```

### Local Storage Format

```javascript
// Key: 'hd_insider_device'
// Value (base64 encoded JSON):
{
  "deviceToken": "device_f3c9e2b4d7f9a1c3e5b7d9f1a3c5e7a1",
  "deviceId": "h4s7d9k2l0p3c5v1n6m8q2w5e9r3t7u1",
  "customerId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "deviceName": "Mobile Device June 10"
}
```

**Security Note**: localStorage is not encrypted. For production:
- Use browser's Web Crypto API for encryption
- On mobile PWA: Use secure storage (Keychain/Keystore)
- Consider IndexedDB with encryption

## Admin Interface

### Component Usage

```typescript
import { DeviceSetupAdmin } from '@/components/DeviceSetupAdmin';

export function CustomerDeviceManagement() {
  const customerId = 'uuid-of-customer';
  
  return (
    <DeviceSetupAdmin 
      customerId={customerId}
      onClose={() => {/* ... */}}
    />
  );
}
```

### Features

- Generate setup token
- Display QR code
- Copy deep link
- Share via WhatsApp/SMS
- List customer's devices
- View device usage history
- Revoke individual devices

## Integration Checklist

### Database
- [ ] Run migration: `supabase migration deploy`
- [ ] Verify tables created
- [ ] Verify RPC functions exist
- [ ] Test RPC functions directly

### Backend (hdeomniflow)
- [ ] Import device-setup utilities
- [ ] Add DeviceSetupAdmin component to customer mgmt
- [ ] Implement setup token generation endpoint
- [ ] Add device management UI
- [ ] Test QR code generation

### Frontend (home-decor-insider)
- [ ] Import device-auth utilities
- [ ] Run database migration
- [ ] Verify /setup and /quick-login routes work
- [ ] Test device credential storage
- [ ] Test quick-login detection
- [ ] Test device revocation

### Testing
- [ ] Setup flow: Generate token → scan QR → complete setup
- [ ] Quick-login: Return to app → auto-redirect → one-click signin
- [ ] Device revocation: Revoke from app → old token rejected
- [ ] OTP fallback: Verify OTP still works
- [ ] Multiple devices: Setup 2+ devices, switch between them
- [ ] Cross-browser: Test on Chrome, Safari, Firefox
- [ ] Mobile: Test on iOS and Android

### Deployment
- [ ] Create migration in supabase/migrations/
- [ ] Deploy database changes
- [ ] Build PWA with new routes
- [ ] Test in staging environment
- [ ] Create feature flag (optional)
- [ ] Gradual rollout (optional)

## Troubleshooting

### Issue: "Device token not found"
**Cause**: Token revoked or expired  
**Solution**: Generate new setup token, redo setup

### Issue: "Setup token invalid"
**Cause**: Token expired (24h) or already used  
**Solution**: Generate fresh token

### Issue: Quick-login not showing
**Cause**: localStorage empty or corrupted  
**Solution**: Clear and redo setup

### Issue: Device token verification fails
**Cause**: Token revoked, expired, or device_credentials table issue  
**Solution**: Check Supabase logs, verify table exists

## Performance Considerations

### Database
- Indexes on `device_token` and `customer_id` for fast lookups
- Cleanup job to delete expired/revoked tokens (optional)
- Monitor `verify_device_token` RPC performance

### Frontend
- localStorage lookup is instant (< 1ms)
- Device verification RPC typically < 100ms
- Consider caching customer data locally (optional)

### Security vs UX
- Setup token expiry: 24 hours (balance between access and security)
- Device token expiry: ~1 year (balance between session length and reauthentication)
- Consider shorter expiry (e.g., 30 days) for higher security

## Future Enhancements

1. **Biometric Authentication**
   - Face ID / fingerprint unlock
   - Requires device-specific crypto APIs

2. **Encrypted Local Storage**
   - Use Web Crypto API
   - Or sqlite3 with encryption (electron-based)

3. **Backup Codes**
   - Generate codes during setup
   - Store in secure location
   - Use for account recovery

4. **Push Notifications**
   - Alert on new device login
   - Approve/deny new device setup
   - Requires OneSignal or FCM integration

5. **Risk-Based Authentication**
   - Detect unusual patterns
   - Require OTP fallback for risky logins
   - Track location, device, time

6. **Hardware Security Keys**
   - Support FIDO2/WebAuthn
   - For high-security customers

## Support

For questions or issues:
1. Check database migration status
2. Review Supabase logs
3. Verify RPC functions exist
4. Test with Supabase console
5. Check browser DevTools console
6. Refer to PASSWORDLESS_AUTH.md

---

**Version**: 1.0  
**Last Updated**: 2026-07-10  
**Maintainer**: Development Team
