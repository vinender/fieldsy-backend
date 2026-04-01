# Auth Flow - Quick Reference Card

## JWT Token at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│ eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature    │
│ ─────────────────────────────────────────────────────────── │
│ Base64 Header          Base64 Payload    Base64 Signature   │
│ {alg:HS256, typ:JWT}   {id,email,role}   HMACSHA256(...)   │
│                                                               │
│ ✅ Server has JWT_SECRET                                     │
│ ✅ Only server can forge/verify tokens                       │
│ ✅ Signature proves token wasn't modified                    │
│ ✅ Expiration checked automatically                          │
│ ⚠️  Payload is readable (base64 not encrypted)              │
│ ⚠️  No server-side token revocation                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Login Flow (3 Steps)

```
┌─────────────┐
│ Email Pass  │
└──────┬──────┘
       │
   ✅ Validate input
       │
   ✅ Find user
       │
   ✅ Verify password (bcrypt)
       │
   ✅ Generate JWT (HMACSHA256)
       │
┌──────▼──────┐
│ Return JWT  │
└─────────────┘
```

---

## OTP Registration Flow (6 Steps)

```
┌──────────────────┐
│ Email/Pass/Name  │
└────────┬─────────┘
         │
     ✅ Validate input
         │
     ✅ Check user exists
         │
     ✅ Hash password
         │
     ✅ Generate userId (counter: 7777, 7778...)
         │
     ✅ Create user (unverified)
         │
     ✅ Send OTP (Brevo) → Email
         │
┌────────▼──────────┐
│ "Check email"     │
└───────────────────┘
         │
    [User receives email]
         │
┌────────▼─────────────────┐
│ POST /verify-otp (code)  │
└────────┬────────────────┘
         │
     ✅ Verify OTP (validity + expiry)
         │
     ✅ Set emailVerified = now
         │
     ✅ Generate JWT
         │
┌────────▼──────────┐
│ Return JWT        │
└───────────────────┘
```

---

## Social Login Flow - Google (4 Steps)

```
┌────────────────┐
│ Google idToken │
└────────┬───────┘
         │
     ✅ Server verify with Google API (prevents spoofing)
         │
     ✅ Extract: email, sub (ID), name, picture
         │
     ✅ Check user exists
         ├─ YES: Update + auto-verify email
         └─ NO: Create user + generate userId + auto-verify email
         │
     ✅ Generate JWT
         │
┌────────▼──────────┐
│ Return JWT        │
└───────────────────┘
```

---

## Token Verification (5 Steps)

```
Authorization: Bearer <token>
         │
     ✅ Extract token
         │
     ✅ Verify signature (matches = not modified)
         │
     ✅ Check expiration (now < exp)
         │
     ✅ Fetch fresh user (catches deleted accounts)
         │
     ✅ Attach to req.user
         │
┌────────▼────────────┐
│ Proceed to handler  │
└─────────────────────┘
```

---

## Current Issues Summary

| Issue | Impact | Fix |
|-------|--------|-----|
| No step-by-step logging | Can't debug flows | Add logger at each step |
| No request ID tracking | Hard to trace issues | Generate + propagate ID |
| Security events not separated | Can't detect anomalies | Log security separately |
| OTP failure doesn't rollback | Orphaned user accounts | Check and rollback |
| No token blacklist | Old tokens valid 7 days after logout | Implement Redis blacklist |

---

## Logging Pattern (Copy This)

```typescript
const requestId = logger.generateRequestId();
logger.step('FLOW_START', { email, requestId });

// Step 1
logger.step('VALIDATE_INPUT', { requestId });
if (!valid) {
  logger.security('INVALID_INPUT', { reason, requestId });
  throw error;
}

// Step 2
logger.step('FIND_USER', { email, requestId });
const user = await User.findByEmail(email);
if (!user) {
  logger.security('USER_NOT_FOUND', { email, requestId });
  throw error;
}

// ... more steps ...

logger.success('FLOW_COMPLETE', user.id, { requestId });
```

---

## Endpoints at a Glance

```
Public Routes:
  POST /auth/register              → Immediate token
  POST /auth/login                 → Email/password
  POST /auth/social-login          → Google/Apple
  POST /auth/refresh-token         → New token
  POST /auth-otp/register          → OTP via email
  POST /auth-otp/verify-signup     → Complete registration

Protected Routes:
  GET  /auth/me                    → Current user
  POST /auth/logout                → Clear session
  PATCH /auth/update-role          → Change role (self)
```

---

## Environment Variables (Required)

```bash
# CRITICAL - Set to random 32+ chars, not default!
JWT_SECRET=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2

# Default values (can be overridden)
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=...
GOOGLE_IOS_CLIENT_ID=...
GOOGLE_ANDROID_CLIENT_ID=...
APPLE_CLIENT_ID=...
APPLE_MOBILE_CLIENT_ID=...
BREVO_API_KEY=...
```

---

## When to Use Each Flow

| Use Case | Flow | Notes |
|----------|------|-------|
| Web app users | Email/password register | Simple, instant access |
| Quick onboarding | Google/Apple sign-in | Auto-verified, no password |
| High security | OTP registration | Email verification required |
| Update access | Token refresh | Get new token (same expiry) |
| Access API | JWT in headers | Bearer <token> |

---

## Testing Checklist

- [ ] Login with valid credentials → Returns JWT ✅
- [ ] Login with wrong password → 401 error ✅
- [ ] Use JWT on protected route → Works ✅
- [ ] Use expired JWT → 401 error ✅
- [ ] Use forged JWT → 401 error ✅
- [ ] OTP register → Email received ✅
- [ ] Verify OTP → JWT returned ✅
- [ ] Google sign-in → JWT returned ✅
- [ ] Apple sign-in → JWT returned ✅
- [ ] Logout → Can't use old token (logout only client-side) ⚠️

---

## Security Checklist

- [ ] JWT_SECRET is 32+ random characters (not default)
- [ ] JWT_SECRET in .env only, not in code
- [ ] All servers have same JWT_SECRET
- [ ] Signature verified on every protected route
- [ ] User fetched from DB (not just trusting token claims)
- [ ] Password hashed with bcrypt (10 rounds)
- [ ] OTP expires after 10 minutes
- [ ] OTP not reusable (marked as used)
- [ ] Social login tokens verified server-side
- [ ] No sensitive data in JWT payload

---

## Common Log Patterns to Watch For

### ✅ Successful Login
```
[AUTH:STEP] LOGIN_START [req-123]
[AUTH:STEP] VALIDATE_INPUT [req-123] { status: 'PASSED' }
[AUTH:STEP] FIND_USER [req-123] { status: 'FOUND' }
[AUTH:STEP] VERIFY_PASSWORD [req-123] { status: 'VERIFIED' }
[AUTH:STEP] GENERATE_TOKEN [req-123] { status: 'CREATED' }
[AUTH:SUCCESS] LOGIN_COMPLETE [User: 7890] [req-123]
```

### ⚠️ Security Events (Watch These!)
```
[AUTH:SECURITY] LOGIN_INVALID_PASSWORD [req-124]
[AUTH:SECURITY] LOGIN_USER_NOT_FOUND [req-125]
[AUTH:SECURITY] TOKEN_EXPIRED [req-126]
[AUTH:SECURITY] TOKEN_INVALID [req-127]
[AUTH:SECURITY] USER_NOT_FOUND [req-128]
```

### ❌ Failed OTP Send
```
[AUTH:EXTERNAL] OTP_SERVICE:SEND_OTP[FAILED] [req-129]
→ Check email service (Brevo) is configured
```

---

## JWT Decoded Example

### Raw Token
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSIsInVzZXJJZCI6Ijc4OTAiLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJyb2xlIjoiRE9HX09XTkVSIiwiaWF0IjoxNjgwMDAwMDAwLCJleHAiOjE2ODA2MDQ4MDB9.
signature
```

### Decoded Header
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

### Decoded Payload
```json
{
  "id": "507f1f77bcf86cd799439011",
  "userId": "7890",
  "email": "user@example.com",
  "role": "DOG_OWNER",
  "iat": 1680000000,
  "exp": 1680604800
}
```

---

## Implementation Priority

### 🔴 Do First (Critical)
1. Add logger to login flow
2. Add logger to token verification middleware
3. Fix OTP registration rollback

### 🟡 Do Next (Important)
1. Add logger to OTP flows
2. Add logger to social login
3. Update services with logging

### 🟢 Do Later (Nice to Have)
1. Token blacklist implementation
2. Account lockout after failed attempts
3. Audit logging to database

---

## Files Reference

| File | Purpose | Status |
|------|---------|--------|
| `/auth.controller.ts` | Login, register, social | ✅ Functional, needs logging |
| `/auth.otp.controller.ts` | OTP register, verify | ✅ Functional, needs logging, rollback fix |
| `/auth.middleware.ts` | Token verification | ✅ Functional, needs logging |
| `/user.model.ts` | User CRUD, userId generation | ✅ Functional |
| `/google-signin.service.ts` | Google verification | ✅ Functional, needs logging |
| `/apple-signin.service.ts` | Apple verification | ✅ Functional, needs logging |
| `/otp.service.ts` | OTP generation, sending | ✅ Functional |
| `/logger.ts` | (NEW) Structured logging | ✅ Created |

---

## Quick Links

- JWT.io - Decode tokens: https://jwt.io
- OWASP Auth Cheat Sheet: https://cheatsheetseries.owasp.org/
- Fieldsy Backend Docs: See `/backend/*.md` files in this directory

