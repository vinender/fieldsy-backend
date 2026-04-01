# Auth Flow Implementation Guide - Quick Start

## Overview
This guide shows exactly how to refactor each authentication flow to use the new structured logging system.

**Key Pattern:**
```typescript
const requestId = logger.generateRequestId();
logger.step('FLOW_START', { email, requestId });
// ... each step logs progress and errors
logger.success('FLOW_COMPLETE', userId, { requestId });
```

---

## Pattern 1: Standard Login (Refactored Example)

### File: `/src/controllers/auth.controller.ts`

**BEFORE:**
```typescript
login = asyncHandler(async (req: Request, res: Response) => {
  console.log('Registration request body:', req.body);
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  let user = await UserModel.findByEmail(email);

  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  if (!user.password) {
    const providers = await UserModel.getOAuthProviders(user.id);
    throw new AppError(`This account uses ${providers.join('/')}. Please sign in using social login.`, 401);
  }

  const isPasswordValid = await UserModel.verifyPassword(password, user.password);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401);
  }

  const token = jwt.sign({
    id: user.id,
    email: user.email,
    role: user.role
  }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });

  res.json({
    success: true,
    message: 'Login successful',
    data: { user, token },
  });
});
```

**AFTER:**
```typescript
login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const requestId = logger.generateRequestId();
  
  logger.step('LOGIN_START', { email, requestId });

  // ✅ Step 1: Validate input
  if (!email || !password) {
    logger.security('LOGIN_MISSING_FIELDS', { requestId });
    throw new AppError('Email and password are required', 400);
  }
  logger.step('VALIDATE_INPUT', { status: 'PASSED', requestId });

  // ✅ Step 2: Find user
  logger.step('FIND_USER', { email, requestId });
  const user = await UserModel.findByEmail(email);
  
  if (!user) {
    logger.security('LOGIN_USER_NOT_FOUND', { email, requestId });
    throw new AppError('Invalid email or password', 401);
  }
  logger.step('FIND_USER', { status: 'FOUND', userId: user.id, requestId });

  // ✅ Step 3: Check auth method
  if (!user.password) {
    const providers = await UserModel.getOAuthProviders(user.id);
    logger.security('LOGIN_OAUTH_ONLY', { email, providers, requestId });
    throw new AppError(`This account uses ${providers.join('/')}. Please sign in using social login.`, 401);
  }
  logger.step('CHECK_AUTH_METHOD', { method: 'PASSWORD', requestId });

  // ✅ Step 4: Verify password
  logger.step('VERIFY_PASSWORD', { email, requestId });
  const isPasswordValid = await UserModel.verifyPassword(password, user.password);
  
  if (!isPasswordValid) {
    logger.security('LOGIN_INVALID_PASSWORD', { email, requestId });
    throw new AppError('Invalid email or password', 401);
  }
  logger.step('VERIFY_PASSWORD', { status: 'VERIFIED', requestId });

  // ✅ Step 5: Generate token
  logger.step('GENERATE_TOKEN', { userId: user.userId || user.id, requestId });
  const token = jwt.sign({
    id: user.id,
    userId: user.userId,
    email: user.email,
    role: user.role
  }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
  logger.step('GENERATE_TOKEN', { status: 'CREATED', expiresIn: JWT_EXPIRES_IN, requestId });

  // ✅ Step 6: Return response
  logger.success('LOGIN_COMPLETE', user.userId || user.id, { requestId });

  res.json({
    success: true,
    message: 'Login successful',
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

**Key Changes:**
1. ✅ Generate `requestId` for request tracking
2. ✅ Log at each step with status
3. ✅ Log security events separately (user not found, invalid password)
4. ✅ Include userId in token (for consistency)
5. ✅ Log success milestone with userId

---

## Pattern 2: OTP Registration (Refactored Example)

### File: `/src/controllers/auth.otp.controller.ts`

**BEFORE:**
```typescript
export const registerWithOtp = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, role = 'DOG_OWNER', phone } = req.body;

  if (!name || !email || !password) {
    throw new AppError('Missing required fields', 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AppError('Invalid email format', 400);
  }

  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }

  const existingUser = await prisma.user.findFirst({
    where: { email },
  });

  if (existingUser) {
    if (existingUser.role !== role) {
      throw new AppError(`An account already exists with this email as a ${existingUser.role}.`, 409);
    }
    if (existingUser.emailVerified) {
      throw new AppError('User already exists with this email', 409);
    }
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: { name, password: hashedPassword, phone, emailVerified: null },
      })
    : await prisma.user.create({
        data: { name, email, password: hashedPassword, role, phone, emailVerified: null },
      });

  try {
    await otpService.sendOtp(email, 'SIGNUP', name);
  } catch (error) {
    if (!existingUser) {
      await prisma.user.delete({ where: { id: user.id } });
    }
    throw new AppError('Failed to send verification email. Please try again.', 500);
  }

  res.status(201).json({
    success: true,
    message: 'Registration successful. Please check your email for the verification code.',
    data: { email, role },
  });
});
```

**AFTER:**
```typescript
export const registerWithOtp = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, role = 'DOG_OWNER', phone } = req.body;
  const requestId = logger.generateRequestId();
  
  logger.step('OTP_REGISTER_START', { email, role, requestId });

  // ✅ Step 1: Validate input
  logger.step('VALIDATE_INPUT', { requestId });
  if (!name || !email || !password) {
    logger.error('VALIDATE_INPUT', 'Missing required fields', { requestId });
    throw new AppError('Missing required fields', 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    logger.error('VALIDATE_EMAIL_FORMAT', 'Invalid format', { email, requestId });
    throw new AppError('Invalid email format', 400);
  }

  if (password.length < 8) {
    logger.error('VALIDATE_PASSWORD', 'Too short', { minRequired: 8, requestId });
    throw new AppError('Password must be at least 8 characters long', 400);
  }
  logger.step('VALIDATE_INPUT', { status: 'PASSED', requestId });

  // ✅ Step 2: Check existing user
  logger.step('CHECK_EXISTING_USER', { email, requestId });
  const existingUser = await prisma.user.findFirst({ where: { email } });
  
  if (existingUser) {
    if (existingUser.role !== role) {
      logger.security('OTP_ROLE_MISMATCH', {
        email,
        existingRole: existingUser.role,
        requestRole: role,
        requestId
      });
      throw new AppError(`An account already exists with this email as a ${existingUser.role}.`, 409);
    }
    if (existingUser.emailVerified) {
      logger.security('OTP_ALREADY_VERIFIED', { email, requestId });
      throw new AppError('User already exists with this email', 409);
    }
    logger.step('CHECK_EXISTING_USER', { status: 'EXISTS_UNVERIFIED', requestId });
  } else {
    logger.step('CHECK_EXISTING_USER', { status: 'NEW_USER', requestId });
  }

  // ✅ Step 3: Hash password
  logger.step('HASH_PASSWORD', { requestId });
  const hashedPassword = await bcrypt.hash(password, 10);
  logger.step('HASH_PASSWORD', { status: 'COMPLETE', requestId });

  // ✅ Step 4: Generate userId for new users
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

  // ✅ Step 5: Create or update user
  logger.step('CREATE_OR_UPDATE_USER', {
    action: existingUser ? 'UPDATE' : 'CREATE',
    requestId
  });
  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: { name, password: hashedPassword, phone, emailVerified: null },
      })
    : await prisma.user.create({
        data: { name, email, password: hashedPassword, role, phone, userId, emailVerified: null },
      });
  logger.step('CREATE_OR_UPDATE_USER', {
    status: 'COMPLETE',
    userId: user.userId || user.id,
    requestId
  });

  // ✅ Step 6: Generate and send OTP
  logger.step('GENERATE_OTP', { email, type: 'SIGNUP', requestId });
  try {
    logger.external('OTP_SERVICE', 'SEND_OTP', 'START', { email, requestId });
    await otpService.sendOtp(email, 'SIGNUP', name);
    logger.external('OTP_SERVICE', 'SEND_OTP', 'SUCCESS', { email, requestId });
    logger.success('OTP_REGISTER_COMPLETE', user.userId || user.id, { requestId });
  } catch (error) {
    logger.external('OTP_SERVICE', 'SEND_OTP', 'FAILED', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId
    });
    
    // ✅ Step 7: Rollback if OTP fails
    if (!existingUser) {
      logger.step('ROLLBACK_USER', { userId: user.id, requestId });
      await prisma.user.delete({ where: { id: user.id } });
      logger.step('ROLLBACK_USER', { status: 'COMPLETE', requestId });
    }
    throw new AppError('Failed to send verification email. Please try again.', 500);
  }

  res.status(201).json({
    success: true,
    message: 'Registration successful. Please check your email for the verification code.',
    data: { email, role, requestId }, // Include requestId for client tracking
  });
});
```

**Key Changes:**
1. ✅ Generate `requestId` for tracking
2. ✅ Log each validation step
3. ✅ External service calls logged separately
4. ✅ Rollback logged if OTP fails
5. ✅ Return `requestId` to client (for support/debugging)
6. ✅ Generate `userId` before user creation

---

## Pattern 3: Token Verification Middleware (Refactored Example)

### File: `/src/middleware/auth.middleware.ts`

**BEFORE:**
```typescript
export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let token: string | undefined;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    throw new AppError('You are not logged in. Please log in to access this resource', 401);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const userId = decoded.userId || decoded.id;

    if (!userId) {
      throw new AppError('Invalid token format', 401);
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new AppError('The user belonging to this token no longer exists', 401);
    }

    req.user = user;
    next();
  } catch (error) {
    throw new AppError('Invalid token. Please log in again', 401);
  }
});
```

**AFTER:**
```typescript
export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const requestId = logger.generateRequestId();
  
  logger.step('PROTECT_MIDDLEWARE_START', { requestId });

  // ✅ Step 1: Extract token
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

  // ✅ Step 2: Verify token signature
  logger.step('VERIFY_TOKEN_SIGNATURE', { requestId });
  let decoded: any;
  
  try {
    decoded = jwt.verify(token, JWT_SECRET) as any;
    logger.step('VERIFY_TOKEN_SIGNATURE', { status: 'VALID', requestId });
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      logger.security('TOKEN_EXPIRED', {
        expiredAt: error.expiredAt,
        requestId
      });
      throw new AppError('Your session has expired. Please log in again', 401);
    }
    logger.security('TOKEN_INVALID', {
      error: error.message,
      requestId
    });
    throw new AppError('Invalid token. Please log in again', 401);
  }

  // ✅ Step 3: Extract user ID from token
  logger.step('EXTRACT_USER_ID', { requestId });
  const userId = decoded.userId || decoded.id;

  if (!userId) {
    logger.security('INVALID_TOKEN_FORMAT', { requestId });
    throw new AppError('Invalid token format', 401);
  }
  logger.step('EXTRACT_USER_ID', { status: 'FOUND', userId, requestId });

  // ✅ Step 4: Fetch fresh user data
  logger.step('FETCH_USER_DATA', { userId, requestId });
  const user = await UserModel.findById(userId);

  if (!user) {
    logger.security('USER_NOT_FOUND', { userId, requestId });
    throw new AppError('The user belonging to this token no longer exists', 401);
  }
  logger.step('FETCH_USER_DATA', {
    status: 'FOUND',
    email: user.email,
    role: user.role,
    requestId
  });

  // ✅ Step 5: Attach user to request
  logger.step('ATTACH_USER_TO_REQUEST', { userId, requestId });
  req.user = user;
  
  logger.success('PROTECT_MIDDLEWARE_COMPLETE', userId, { requestId });
  
  next();
});
```

**Key Changes:**
1. ✅ Generate `requestId` for tracing through middleware
2. ✅ Distinguish between token missing vs. invalid
3. ✅ Log token expiration separately
4. ✅ Log user not found (account deleted case)
5. ✅ Success logged at end
6. ✅ Each step includes status

---

## Pattern 4: Social Login with External Service (Refactored Example)

### File: `/src/controllers/auth.controller.ts` - socialLogin

**Key Pattern for External Services:**
```typescript
// Start external call
logger.external('GOOGLE', 'VERIFY_TOKEN', 'START', { requestId });

try {
  const verified = await googleSignInService.verifyIdToken(idToken, requestId);
  logger.external('GOOGLE', 'VERIFY_TOKEN', 'SUCCESS', { requestId });
} catch (error) {
  logger.external('GOOGLE', 'VERIFY_TOKEN', 'FAILED', {
    error: error.message,
    requestId
  });
  throw error;
}
```

---

## Implementation Checklist

- [ ] Create `/src/utils/logger.ts` with logger class
- [ ] Update `/src/controllers/auth.controller.ts` - all methods
- [ ] Update `/src/controllers/auth.otp.controller.ts` - all methods
- [ ] Update `/src/middleware/auth.middleware.ts` - protect middleware
- [ ] Update `/src/services/google-signin.service.ts` - verifyIdToken
- [ ] Update `/src/services/apple-signin.service.ts` - verifyIdToken
- [ ] Update `/src/services/otp.service.ts` - sendOtp, verifyOtp
- [ ] Test all auth flows and verify logs
- [ ] Add requestId to error responses
- [ ] Document log format for monitoring/alerts

---

## Log Output Examples

### Successful Login
```
[AUTH:STEP] LOGIN_START [requestId-123] { email: 'user@example.com' }
[AUTH:STEP] VALIDATE_INPUT [requestId-123] { status: 'PASSED' }
[AUTH:STEP] FIND_USER [requestId-123] { email: 'user@example.com' }
[AUTH:STEP] FIND_USER [requestId-123] { status: 'FOUND', userId: '507f1f77bcf86cd799439011' }
[AUTH:STEP] CHECK_AUTH_METHOD [requestId-123] { method: 'PASSWORD' }
[AUTH:STEP] VERIFY_PASSWORD [requestId-123] { email: 'user@example.com' }
[AUTH:STEP] VERIFY_PASSWORD [requestId-123] { status: 'VERIFIED' }
[AUTH:STEP] GENERATE_TOKEN [requestId-123] { userId: '7789' }
[AUTH:STEP] GENERATE_TOKEN [requestId-123] { status: 'CREATED', expiresIn: '7d' }
[AUTH:SUCCESS] LOGIN_COMPLETE [User: 7789] [requestId-123]
```

### Failed Login - User Not Found
```
[AUTH:STEP] LOGIN_START [requestId-124] { email: 'unknown@example.com' }
[AUTH:STEP] VALIDATE_INPUT [requestId-124] { status: 'PASSED' }
[AUTH:STEP] FIND_USER [requestId-124] { email: 'unknown@example.com' }
[AUTH:SECURITY] LOGIN_USER_NOT_FOUND [requestId-124] { email: 'unknown@example.com' }
```

### Successful OTP Registration
```
[AUTH:STEP] OTP_REGISTER_START [requestId-125] { email: 'new@example.com', role: 'DOG_OWNER' }
[AUTH:STEP] VALIDATE_INPUT [requestId-125]
[AUTH:STEP] VALIDATE_INPUT [requestId-125] { status: 'PASSED' }
[AUTH:STEP] CHECK_EXISTING_USER [requestId-125] { email: 'new@example.com' }
[AUTH:STEP] CHECK_EXISTING_USER [requestId-125] { status: 'NEW_USER' }
[AUTH:STEP] HASH_PASSWORD [requestId-125]
[AUTH:STEP] HASH_PASSWORD [requestId-125] { status: 'COMPLETE' }
[AUTH:STEP] GENERATE_USERID [requestId-125]
[AUTH:STEP] GENERATE_USERID [requestId-125] { status: 'CREATED', userId: '7890' }
[AUTH:STEP] CREATE_OR_UPDATE_USER [requestId-125] { action: 'CREATE' }
[AUTH:STEP] CREATE_OR_UPDATE_USER [requestId-125] { status: 'COMPLETE', userId: '7890' }
[AUTH:STEP] GENERATE_OTP [requestId-125] { email: 'new@example.com', type: 'SIGNUP' }
[AUTH:EXTERNAL] OTP_SERVICE:SEND_OTP[START] [requestId-125]
[AUTH:EXTERNAL] OTP_SERVICE:SEND_OTP[SUCCESS] [requestId-125]
[AUTH:SUCCESS] OTP_REGISTER_COMPLETE [User: 7890] [requestId-125]
```

### Failed Token Verification - Expired
```
[AUTH:STEP] PROTECT_MIDDLEWARE_START [requestId-126]
[AUTH:STEP] EXTRACT_TOKEN [requestId-126] { status: 'FOUND', tokenLength: 256 }
[AUTH:STEP] VERIFY_TOKEN_SIGNATURE [requestId-126]
[AUTH:SECURITY] TOKEN_EXPIRED [requestId-126] { expiredAt: '2025-04-08T10:30:00Z' }
```

---

## Tips for Implementation

1. **Start with high-value flows:** Login, OTP registration, token verification first
2. **Use copy-paste patterns:** Use the examples above as templates
3. **Test each flow:** Verify logs appear as expected
4. **Add to existing code:** Integrate logging without removing current functionality
5. **Monitor logs:** Set up log aggregation/alerts for AUTH:SECURITY events
6. **Track requestId:** Pass it through API responses for debugging

