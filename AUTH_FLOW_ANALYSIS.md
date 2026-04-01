# Authentication Flow Analysis & Refactoring Guide

## Executive Summary

The Fieldsy authentication system is functionally complete but lacks consistent step-by-step logging throughout the authentication pipeline. This guide documents the current state, identifies gaps, and provides refactored implementations with proper logging, error handling, and security.

---

## Current Issues

### 1. **Inconsistent Logging**
- ✅ Some flows log initial request body
- ❌ Missing step-by-step logging in sequential pipeline
- ❌ No logging for success milestones
- ❌ Limited error context in logs

### 2. **JWT Token Details**
- **Algorithm:** HS256 (HMAC SHA-256) - symmetric key
- **Secret:** `process.env.JWT_SECRET` (default: 'your-secret-key-change-in-production')
- **Expiry:** `process.env.JWT_EXPIRES_IN` (default: '7d')
- **Claims:** `{ id, email, role, provider? }`
- **Signing:** `jwt.sign(payload, JWT_SECRET, { expiresIn })`
- **Verification:** `jwt.verify(token, JWT_SECRET)`

**Issue:** HS256 uses symmetric key - token itself could be forged if secret is weak or compromised.

### 3. **Pipeline Consistency Issues**

#### Standard Login Flow
```
User Input → Validate → Find User → Verify Password → Generate Token → Response
[✅]         [✅]       [✅]         [✅]              [✅]               [✅]
Logged       Logged     Not logged   Not logged        Not logged         Not logged
```

#### OTP Registration Flow
```
User Input → Validate → Check Exists → Hash → Create User → Generate OTP → Send Email
[✅]         [✅]       [✅]           [✅]   [✅]            [Not clear]    [Not clear]
Logged       Logged     Not logged     Not    Not logged      Not logged     Not logged
```

#### Social Login Flow
```
User Input → Validate → Verify Google Token → Check User → Create/Update → Generate Token
[✅]         [✅]       [Partially]           [Not]        [Not]           [Not]
Logged       Logged     Partial logging       Not logged   Not logged      Not logged
```

---

## JWT Encryption Breakdown

### 1. How JWT Works
```
Header.Payload.Signature

Header: { alg: "HS256", typ: "JWT" }
Payload: { id: "...", email: "...", role: "...", iat: 1234567890, exp: 1234567890 }
Signature: HMACSHA256(base64(header) + "." + base64(payload), JWT_SECRET)
```

### 2. Security Implications

**Strengths:**
- ✅ Server-side JWT verification prevents token tampering
- ✅ Expiration prevents indefinite token validity
- ✅ Signature ensures integrity

**Weaknesses:**
- ⚠️ HS256 is symmetric - same secret signs and verifies
- ⚠️ If JWT_SECRET compromised, attacker can forge any token
- ⚠️ Default secret in code is weak
- ⚠️ No token blacklist for revocation
- ⚠️ Token remains valid for full 7 days after logout

### 3. Current Implementation
```typescript
// Generation
jwt.sign({
  id: user.id,              // ObjectId or userId
  email: user.email,
  role: user.role,
  provider: user.provider   // optional
}, JWT_SECRET, {
  expiresIn: JWT_EXPIRES_IN  // '7d' by default
})

// Verification
jwt.verify(token, JWT_SECRET)
```

---

## Refactored Flows with Proper Logging

### Logger Utility (Create `/src/utils/logger.ts`)

```typescript
// /src/utils/logger.ts
export const logger = {
  // Auth pipeline steps
  step: (step: string, details: any = {}) => {
    console.log(`[AUTH] ${step}`, details);
  },
  
  // Success milestone
  success: (action: string, userId?: string) => {
    console.log(`[AUTH:SUCCESS] ${action}${userId ? ` [User: ${userId}]` : ''}`);
  },
  
  // Security event
  security: (event: string, details: any = {}) => {
    console.log(`[AUTH:SECURITY] ${event}`, details);
  },
  
  // Error with context
  error: (action: string, error: any, context?: any) => {
    console.error(`[AUTH:ERROR] ${action}:`, error.message, context);
  }
};
```

---

## Refactored Controller - Standard Login

**Current Issues:**
- Only logs request body
- No step-by-step progress
- No error context

**Refactored Version:**

```typescript
// /src/controllers/auth.controller.ts - login method

login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.step('LOGIN_START', { email, requestId });

  // Step 1: Validate input
  if (!email || !password) {
    logger.security('LOGIN_MISSING_FIELDS', { email, requestId });
    throw new AppError('Email and password are required', 400);
  }
  logger.step('VALIDATE_INPUT', { status: 'PASSED', requestId });

  // Step 2: Find user
  logger.step('FIND_USER', { email, requestId });
  let user = await UserModel.findByEmail(email);
  
  if (!user) {
    logger.security('LOGIN_USER_NOT_FOUND', { email, requestId });
    throw new AppError('Invalid email or password', 401);
  }
  logger.step('FIND_USER', { status: 'FOUND', userId: user.id, requestId });

  // Step 3: Check OAuth-only accounts
  if (!user.password) {
    logger.step('CHECK_AUTH_METHOD', { method: 'OAUTH_ONLY', email, requestId });
    const providers = await UserModel.getOAuthProviders(user.id);
    throw new AppError(
      `This account is registered with ${providers.join('/')}. Please sign in using the social login option.`,
      401
    );
  }
  logger.step('CHECK_AUTH_METHOD', { method: 'PASSWORD', requestId });

  // Step 4: Verify password
  logger.step('VERIFY_PASSWORD', { email, requestId });
  const isPasswordValid = await UserModel.verifyPassword(password, user.password);
  
  if (!isPasswordValid) {
    logger.security('LOGIN_INVALID_PASSWORD', { email, requestId });
    throw new AppError('Invalid email or password', 401);
  }
  logger.step('VERIFY_PASSWORD', { status: 'VERIFIED', requestId });

  // Step 5: Generate token
  logger.step('GENERATE_TOKEN', { userId: user.id, requestId });
  const token = jwt.sign(
    {
      id: user.id,
      userId: user.userId,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  logger.step('GENERATE_TOKEN', { status: 'CREATED', expiresIn: JWT_EXPIRES_IN, requestId });

  // Step 6: Prepare response
  logger.step('PREPARE_RESPONSE', { userId: user.id, requestId });
  const responseUser = {
    id: user.userId || user.id,
    userId: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
  };
  logger.success('LOGIN_COMPLETE', user.userId || user.id);

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: responseUser,
      token,
    },
  });
});
```

---

## Refactored Controller - OTP Registration

**Current Issues:**
- Doesn't log each step clearly
- OTP sending/error handling not well logged
- Success milestones unclear

**Refactored Version:**

```typescript
// /src/controllers/auth.otp.controller.ts - registerWithOtp

registerWithOtp = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, role = 'DOG_OWNER', phone } = req.body;
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.step('OTP_REGISTER_START', { email, role, requestId });

  // Step 1: Validate input
  logger.step('VALIDATE_INPUT', { email, hasPassword: !!password, requestId });
  if (!name || !email || !password) {
    logger.error('VALIDATE_INPUT', new Error('Missing required fields'), { requestId });
    throw new AppError('Missing required fields', 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    logger.error('VALIDATE_EMAIL', new Error('Invalid format'), { email, requestId });
    throw new AppError('Invalid email format', 400);
  }

  if (password.length < 8) {
    logger.error('VALIDATE_PASSWORD', new Error('Too short'), { minLength: 8, requestId });
    throw new AppError('Password must be at least 8 characters long', 400);
  }
  logger.step('VALIDATE_INPUT', { status: 'PASSED', requestId });

  // Step 2: Check if user exists
  logger.step('CHECK_EXISTING_USER', { email, requestId });
  const existingUser = await prisma.user.findFirst({ where: { email } });
  
  if (existingUser) {
    if (existingUser.role !== role) {
      logger.security('OTP_ROLE_MISMATCH', { email, existingRole: existingUser.role, requestRole: role, requestId });
      throw new AppError(`An account already exists with this email as a ${existingUser.role.replace('_', ' ').toLowerCase()}.`, 409);
    }
    if (existingUser.emailVerified) {
      logger.security('OTP_ALREADY_VERIFIED', { email, requestId });
      throw new AppError('User already exists with this email', 409);
    }
    logger.step('CHECK_EXISTING_USER', { status: 'EXISTS_UNVERIFIED', requestId });
  } else {
    logger.step('CHECK_EXISTING_USER', { status: 'NEW_USER', requestId });
  }

  // Step 3: Hash password
  logger.step('HASH_PASSWORD', { requestId });
  const hashedPassword = await bcrypt.hash(password, 10);
  logger.step('HASH_PASSWORD', { status: 'COMPLETE', requestId });

  // Step 4: Generate userId for new users
  let userId: string | undefined;
  if (!existingUser) {
    logger.step('GENERATE_USERID', { requestId });
    const counter = await prisma.counter.upsert({
      where: { name: 'user' },
      update: { value: { increment: 1 } },
      create: { name: 'user', value: 7777 },
    });
    userId = counter.value.toString();
    logger.step('GENERATE_USERID', { status: 'CREATED', userId, requestId });
  }

  // Step 5: Create or update user
  logger.step('CREATE_OR_UPDATE_USER', { action: existingUser ? 'UPDATE' : 'CREATE', requestId });
  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: { name, password: hashedPassword, phone, emailVerified: null },
      })
    : await prisma.user.create({
        data: { name, email, password: hashedPassword, role, phone, userId, emailVerified: null },
      });
  logger.step('CREATE_OR_UPDATE_USER', { status: 'COMPLETE', userId: user.userId || user.id, requestId });

  // Step 6: Generate and send OTP
  logger.step('GENERATE_OTP', { email, type: 'SIGNUP', requestId });
  let otp: string;
  try {
    otp = await otpService.generateOtp(email, 'SIGNUP');
    logger.step('GENERATE_OTP', { status: 'GENERATED', otpLength: otp.length, requestId });

    logger.step('SEND_OTP_EMAIL', { email, requestId });
    await otpService.sendOtp(email, 'SIGNUP', name);
    logger.success('SEND_OTP_EMAIL', user.userId || user.id);
  } catch (error) {
    // Step 7: Rollback user if OTP fails
    logger.error('SEND_OTP_EMAIL', error, { email, requestId });
    if (!existingUser) {
      logger.step('ROLLBACK_USER', { userId: user.id, requestId });
      await prisma.user.delete({ where: { id: user.id } });
      logger.step('ROLLBACK_USER', { status: 'COMPLETE', requestId });
    }
    throw new AppError('Failed to send verification email. Please try again.', 500);
  }

  logger.success('OTP_REGISTER_COMPLETE', user.userId || user.id);

  res.status(201).json({
    success: true,
    message: 'Registration successful. Please check your email for the verification code.',
    data: { email, role, requestId },
  });
});
```

---

## Refactored Controller - OTP Verification

```typescript
// /src/controllers/auth.otp.controller.ts - verifySignupOtp

verifySignupOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp, role = 'DOG_OWNER' } = req.body;
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.step('OTP_VERIFY_START', { email, otpLength: otp?.length, requestId });

  // Step 1: Validate input
  if (!email || !otp) {
    logger.error('VALIDATE_INPUT', new Error('Missing email or OTP'), { requestId });
    throw new AppError('Email and OTP are required', 400);
  }
  logger.step('VALIDATE_INPUT', { status: 'PASSED', requestId });

  // Step 2: Verify OTP
  logger.step('VERIFY_OTP', { email, requestId });
  const isValid = await otpService.verifyOtp(email, otp, 'SIGNUP');
  
  if (!isValid) {
    logger.security('VERIFY_OTP_FAILED', { email, reason: 'INVALID_OR_EXPIRED', requestId });
    throw new AppError('Invalid or expired OTP', 400);
  }
  logger.step('VERIFY_OTP', { status: 'VERIFIED', requestId });

  // Step 3: Mark user as verified
  logger.step('MARK_EMAIL_VERIFIED', { email, requestId });
  const user = await prisma.user.update({
    where: { email_role: { email, role } },
    data: { emailVerified: new Date() },
  });
  logger.step('MARK_EMAIL_VERIFIED', { status: 'COMPLETE', userId: user.userId || user.id, requestId });

  // Step 4: Generate token
  logger.step('GENERATE_TOKEN', { userId: user.userId || user.id, requestId });
  const token = jwt.sign(
    {
      id: user.id,
      userId: user.userId,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  logger.step('GENERATE_TOKEN', { status: 'CREATED', expiresIn: JWT_EXPIRES_IN, requestId });

  logger.success('OTP_VERIFY_COMPLETE', user.userId || user.id);

  res.json({
    success: true,
    message: 'Email verified successfully',
    data: {
      user: {
        id: user.userId || user.id,
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
      },
      token,
    },
  });
});
```

---

## Refactored Middleware - Token Verification

```typescript
// /src/middleware/auth.middleware.ts - protect

export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.step('PROTECT_MIDDLEWARE_START', { requestId });

  // Step 1: Extract token
  let token: string | undefined;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    logger.security('TOKEN_MISSING', { requestId });
    throw new AppError('You are not logged in. Please log in to access this resource', 401);
  }
  logger.step('EXTRACT_TOKEN', { status: 'FOUND', tokenLength: token.length, requestId });

  // Step 2: Verify token
  logger.step('VERIFY_TOKEN', { requestId });
  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as any;
    logger.step('VERIFY_TOKEN', { status: 'VALID', requestId });
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      logger.security('TOKEN_EXPIRED', { expiredAt: error.expiredAt, requestId });
      throw new AppError('Your session has expired. Please log in again', 401);
    }
    logger.security('TOKEN_INVALID', { error: error.message, requestId });
    throw new AppError('Invalid token. Please log in again', 401);
  }

  // Step 3: Extract user ID
  logger.step('EXTRACT_USER_ID', { requestId });
  const userId = decoded.userId || decoded.id;
  if (!userId) {
    logger.security('INVALID_TOKEN_FORMAT', { requestId });
    throw new AppError('Invalid token format', 401);
  }
  logger.step('EXTRACT_USER_ID', { status: 'FOUND', userId, requestId });

  // Step 4: Fetch fresh user data
  logger.step('FETCH_USER_DATA', { userId, requestId });
  const user = await UserModel.findById(userId);
  
  if (!user) {
    logger.security('USER_NOT_FOUND', { userId, requestId });
    throw new AppError('The user belonging to this token no longer exists', 401);
  }
  logger.step('FETCH_USER_DATA', { status: 'FOUND', email: user.email, role: user.role, requestId });

  // Step 5: Attach user to request
  logger.step('ATTACH_USER_TO_REQUEST', { userId, requestId });
  req.user = user;
  logger.success('PROTECT_MIDDLEWARE_COMPLETE', userId);
  
  next();
});
```

---

## Refactored Service - Google Sign-In

```typescript
// /src/services/google-signin.service.ts

async verifyIdToken(idToken: string, requestId?: string): Promise<GoogleUserInfo> {
  const rid = requestId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.step('GOOGLE_VERIFY_START', { tokenLength: idToken.length, requestId: rid });

  try {
    // Step 1: Get unique audiences
    logger.step('GET_AUDIENCES', { requestId: rid });
    const uniqueAudiences = [...new Set([
      this.webClientId,
      this.iosClientId,
      this.androidClientId,
      this.firebaseClientId,
    ].filter(Boolean))];
    logger.step('GET_AUDIENCES', { status: 'FOUND', count: uniqueAudiences.length, requestId: rid });

    // Step 2: Verify with Google
    logger.step('VERIFY_WITH_GOOGLE', { audiences: uniqueAudiences.length, requestId: rid });
    const ticket = await this.client.verifyIdToken({
      idToken,
      audience: uniqueAudiences,
    });
    logger.step('VERIFY_WITH_GOOGLE', { status: 'VERIFIED', requestId: rid });

    // Step 3: Extract payload
    logger.step('EXTRACT_PAYLOAD', { requestId: rid });
    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error('Unable to get token payload');
    }
    logger.step('EXTRACT_PAYLOAD', { status: 'SUCCESS', email: payload.email, requestId: rid });

    // Step 4: Parse verified data
    logger.step('PARSE_VERIFIED_DATA', { requestId: rid });
    const result = {
      email: payload.email || '',
      emailVerified: payload.email_verified || false,
      sub: payload.sub,
      name: payload.name,
      picture: payload.picture,
    };
    logger.success('GOOGLE_VERIFY_COMPLETE', result.sub);
    
    return result;
  } catch (error: any) {
    logger.error('GOOGLE_VERIFY_FAILED', error, { requestId: rid });

    // Provide specific error messages
    if (error.message?.includes('Token used too late')) {
      throw new Error('Google ID token has expired. Please sign in again.');
    }
    if (error.message?.includes('Wrong recipient')) {
      throw new Error('Google ID token was not issued for this application.');
    }
    if (error.message?.includes('Invalid token signature')) {
      throw new Error('Google ID token signature is invalid.');
    }

    throw new Error('Invalid Google ID token');
  }
}
```

---

## Social Login - Complete Flow with Logging

```typescript
// /src/controllers/auth.controller.ts - socialLogin

socialLogin = asyncHandler(async (req: Request, res: Response) => {
  const { provider, idToken, role = 'DOG_OWNER' } = req.body;
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.step('SOCIAL_LOGIN_START', { provider, role, requestId });

  // Step 1: Validate provider
  logger.step('VALIDATE_PROVIDER', { provider, requestId });
  if (!['google', 'apple'].includes(provider)) {
    logger.error('VALIDATE_PROVIDER', new Error('Invalid provider'), { provider, requestId });
    throw new AppError('Invalid provider', 400);
  }
  if (!idToken) {
    logger.error('VALIDATE_IDTOKEN', new Error('Missing idToken'), { provider, requestId });
    throw new AppError(`No ${provider} token provided`, 400);
  }
  logger.step('VALIDATE_PROVIDER', { status: 'VALID', requestId });

  // Step 2: Verify token with provider
  logger.step('VERIFY_PROVIDER_TOKEN', { provider, requestId });
  let verifiedData: any;
  try {
    if (provider === 'google') {
      verifiedData = await googleSignInService.verifyIdToken(idToken, requestId);
    } else if (provider === 'apple') {
      verifiedData = await appleSignInService.verifyIdToken(idToken, undefined, undefined, requestId);
    }
    logger.step('VERIFY_PROVIDER_TOKEN', { status: 'VERIFIED', provider, requestId });
  } catch (error: any) {
    logger.security('VERIFY_PROVIDER_TOKEN_FAILED', { provider, error: error.message, requestId });
    throw new AppError(error.message, 401);
  }

  // Step 3: Validate role
  logger.step('VALIDATE_ROLE', { role, requestId });
  const validRoles = ['DOG_OWNER', 'FIELD_OWNER'];
  if (!validRoles.includes(role)) {
    logger.error('VALIDATE_ROLE', new Error('Invalid role'), { role, requestId });
    throw new AppError('Invalid role', 400);
  }
  logger.step('VALIDATE_ROLE', { status: 'VALID', requestId });

  // Step 4: Create or update user
  logger.step('CREATE_OR_UPDATE_USER', { provider, email: verifiedData.email, role, requestId });
  let user: any;
  try {
    user = await UserModel.createOrUpdateSocialUser({
      email: verifiedData.email,
      name: verifiedData.name || verifiedData.email.split('@')[0],
      image: verifiedData.picture,
      provider,
      providerId: verifiedData.sub,
      role,
    });
    logger.step('CREATE_OR_UPDATE_USER', { status: 'COMPLETE', userId: user.userId || user.id, requestId });
  } catch (error: any) {
    logger.error('CREATE_OR_UPDATE_USER', error, { provider, email: verifiedData.email, requestId });
    throw new AppError(error.message, 409);
  }

  // Step 5: Generate token
  logger.step('GENERATE_TOKEN', { userId: user.userId || user.id, requestId });
  const token = jwt.sign(
    {
      id: user.id,
      userId: user.userId,
      email: user.email,
      role: user.role,
      provider: user.provider,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  logger.success('SOCIAL_LOGIN_COMPLETE', user.userId || user.id);

  res.json({
    success: true,
    message: `${provider} login successful`,
    data: {
      user: {
        id: user.userId || user.id,
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      token,
    },
  });
});
```

---

## Security Checklist

### ✅ Currently Implemented
- [x] Password hashing with bcrypt (10 rounds)
- [x] Server-side token verification for social logins
- [x] Email format validation
- [x] Password strength validation (min 8 chars)
- [x] Role-based access control
- [x] OTP expiration (10 minutes)
- [x] JWT signature verification
- [x] User existence checks after token verification
- [x] Generic error messages (prevent user enumeration)

### ⚠️ Recommended Improvements
- [ ] Change default JWT secret or fail fast if not set
- [ ] Implement token blacklist on logout (Redis)
- [ ] Add account lockout after 5 failed login attempts
- [ ] Use separate refresh token with longer expiry
- [ ] Add CSRF protection for cookie-based auth
- [ ] Implement rate limiting on login endpoint
- [ ] Add IP-based anomaly detection for social logins
- [ ] Log all authentication attempts to audit table
- [ ] Hash OTP codes in database (not plaintext)
- [ ] Implement password reset without email disclosure

---

## Implementation Guide

### Step 1: Create Logger Utility
Create `/src/utils/logger.ts` with the logger implementation shown above.

### Step 2: Update Controllers
Replace controller methods with refactored versions that use step-by-step logging.

### Step 3: Update Services
Update `google-signin.service.ts` and `apple-signin.service.ts` with logging.

### Step 4: Update Middleware
Replace auth middleware with refactored versions.

### Step 5: Add Audit Logging (Optional)
Create audit log table to track all auth events:
```prisma
model AuditLog {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  action    String   // LOGIN, SIGNUP, OTP_VERIFY, etc
  email     String
  userId    String?  @db.ObjectId
  ip        String?
  userAgent String?
  status    String   // SUCCESS, FAILED
  reason    String?  // Error reason
  timestamp DateTime @default(now())
  
  @@index([email])
  @@index([userId])
  @@index([timestamp])
}
```

---

## JWT Token Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ JWT GENERATION & VERIFICATION FLOW                             │
└─────────────────────────────────────────────────────────────────┘

GENERATION (Login/Registration):
┌──────────────────────┐
│ User credentials     │
│ (email, password)    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ Verify password & create JWT payload:   │
│ {                                        │
│   id: user.id,                          │
│   userId: user.userId,                  │
│   email: user.email,                    │
│   role: user.role,                      │
│   iat: now,          (issued at)        │
│   exp: now + 7d      (expiration)       │
│ }                                        │
└──────────────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────┐
        │ HMACSHA256 Signature:   │
        │ Signature = HMAC(       │
        │   algorithm: 'HS256',   │
        │   message: header+payload│
        │   secret: JWT_SECRET    │
        │ )                        │
        └──────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────┐
        │ Final JWT Token:         │
        │ eyJhbGc...payload...sig │
        └──────────────────────────┘

VERIFICATION (Protected Route):
┌──────────────────────┐
│ Authorization header │
│ "Bearer {token}"     │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ Extract & Decode Token              │
│ Split by "." to get 3 parts:        │
│ [header, payload, signature]        │
└──────────────────────┬───────────────┘
                       │
                       ▼
┌──────────────────────────────────────┐
│ Verify Signature:                   │
│ 1. Decode header & payload          │
│ 2. Calculate expected signature:    │
│    HMACSHA256(header.payload,       │
│               JWT_SECRET)           │
│ 3. Compare with provided signature  │
└──────────────────────┬───────────────┘
                       │
       ┌───────────────┴───────────────┐
       │                               │
       ▼ (Match)                    ▼ (No Match)
  ┌────────────┐                ┌─────────────┐
  │ Valid      │                │ Invalid     │
  │ Token      │                │ Reject 401  │
  └────────────┘                └─────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ Check Expiration:                   │
│ if (exp < now) { throw Expired }   │
└──────────────────────┬───────────────┘
                       │
       ┌───────────────┴───────────────┐
       │                               │
       ▼ (Valid)                    ▼ (Expired)
  ┌────────────┐              ┌─────────────┐
  │ Extract    │              │ Expired     │
  │ Claims     │              │ Reject 401  │
  └────────────┘              └─────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ Verify User Still Exists:           │
│ SELECT * FROM users WHERE id=..     │
└──────────────────────┬───────────────┘
                       │
       ┌───────────────┴───────────────┐
       │                               │
       ▼ (Found)                    ▼ (Not Found)
  ┌────────────┐              ┌─────────────┐
  │ Attach     │              │ Deleted     │
  │ req.user   │              │ Reject 401  │
  │ Proceed ✅ │              └─────────────┘
  └────────────┘
```

---

## Summary

### Current State
- ✅ Functional multi-auth system
- ✅ Server-side token verification
- ✅ Role-based access control
- ⚠️ Limited logging at each step
- ⚠️ No standardized pipeline pattern

### After Refactoring
- ✅ Step-by-step logging at each pipeline stage
- ✅ Clear error context and security events
- ✅ Consistent request tracking with requestId
- ✅ Better debugging and audit trail
- ✅ Security milestones logged
- ✅ JWT encryption clearly documented

### Key Takeaways
1. **JWT is signed, not encrypted** - HS256 uses HMAC with shared secret
2. **Token verification happens server-side** - prevents tampering
3. **Step-by-step logging improves debugging** - each step tracked
4. **requestId enables request tracing** - correlate all log entries
5. **Security events separately logged** - clear anomaly detection

