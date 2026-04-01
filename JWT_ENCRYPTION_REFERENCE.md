# JWT Encryption - Technical Reference

## How HMAC SHA-256 Works

```
┌─────────────────────────────────────────────────────────────────────┐
│ JWT TOKEN STRUCTURE (3 parts separated by dots)                    │
└─────────────────────────────────────────────────────────────────────┘

eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
│                                    │
│                                    └──── Part 1: HEADER (base64url)
│
.
│
eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSIsInVzZXJJZCI6Ijc4OTAiLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJyb2xlIjoiRE9HX09XTkVSIn0
│                                                                      │
│                                                                      └──── Part 2: PAYLOAD (base64url)
│
.
│
signature_here
│         │
│         └──── Part 3: SIGNATURE (base64url)
│
└──── 3 parts = valid JWT format
```

---

## Part 1: HEADER

### What It Contains
```json
{
  "alg": "HS256",     // Algorithm: HMAC with SHA-256
  "typ": "JWT"        // Type: JSON Web Token
}
```

### Base64URL Encoded
```
Raw JSON:
{"alg":"HS256","typ":"JWT"}

Base64URL:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

### What It Tells You
- ✅ How the signature was created (HS256)
- ✅ This is a JWT (not other token types)
- ❌ Does NOT validate the token
- ❌ Can be read by anyone (not encrypted)

---

## Part 2: PAYLOAD

### What It Contains
```json
{
  "id": "507f1f77bcf86cd799439011",    // MongoDB ObjectId (24-char hex)
  "userId": "7890",                     // Human-readable sequential ID
  "email": "user@example.com",          // User email
  "role": "DOG_OWNER",                  // User role
  "provider": "google",                 // Auth method (optional)
  "iat": 1680000000,                    // Issued At (seconds since epoch)
  "exp": 1680604800                     // Expiration (seconds since epoch)
}
```

### Timestamp Explanation
```
iat (Issued At):     1680000000 = April 1, 2023 10:00:00 UTC
exp (Expiration):    1680604800 = April 8, 2023 10:00:00 UTC
                     ────────────────────────────────────
Duration:            7 days (604800 seconds)

Current behavior: If (now > exp), token is INVALID
```

### Base64URL Encoded
```
Raw JSON (minified):
{"id":"507f1f77bcf86cd799439011","userId":"7890","email":"user@example.com","role":"DOG_OWNER","iat":1680000000,"exp":1680604800}

Base64URL:
eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSIsInVzZXJJZCI6Ijc4OTAiLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJyb2xlIjoiRE9HX09XTkVSIiwiaWF0IjoxNjgwMDAwMDAwLCJleHAiOjE2ODA2MDQ4MDB9
```

### Important
- ❌ Base64 is encoding, NOT encryption
- ❌ Anyone can decode the payload
- ❌ Claims in payload can be read by browser DevTools
- ✅ Payload cannot be modified without invalidating signature

---

## Part 3: SIGNATURE

### How It's Calculated

```
┌────────────────────────────────────────────────────────────┐
│ HMAC SHA-256 Signature Calculation                         │
└────────────────────────────────────────────────────────────┘

Step 1: Get the first two parts (header.payload)
────────────────────────────────────────────────────────
header_base64url = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
payload_base64url = "eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSI..."

message = header_base64url + "." + payload_base64url
        = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSI..."


Step 2: Get the secret key
────────────────────────────────────────────────────────
JWT_SECRET = "your-super-secret-key-change-in-production" (from env)

⚠️ CRITICAL: This secret MUST be:
   - ✅ At least 32 characters long
   - ✅ Cryptographically random
   - ✅ Never hardcoded in production
   - ✅ Same on all servers (to verify same tokens)
   - ❌ Never shared with clients


Step 3: Calculate HMAC SHA-256
────────────────────────────────────────────────────────
signature = HMACSHA256(
  message = "eyJhbGciOi...eyJpZCI6Ij...",
  key = "your-super-secret-key-change-in-production"
)

Result (hex):
a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2

Encoded as base64url:
obLDdOX2obLDdOX2obLDdOX2obLDdOX2obLDdOX2obLDdOX2obLDdOX2


Step 4: Final JWT
────────────────────────────────────────────────────────
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSI6IjcwMDciLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJyb2xlIjoiRE9HX09XTkVSIiwiaWF0IjoxNjgwMDAwMDAwLCJleHAiOjE2ODA2MDQ4MDB9.
obLDdOX2obLDdOX2obLDdOX2obLDdOX2obLDdOX2obLDdOX2obLDdOX2
```

### Why the Signature Matters

```
┌─────────────────────────────────────────────────────────┐
│ SIGNATURE = PROOF OF AUTHENTICITY                       │
└─────────────────────────────────────────────────────────┘

✅ Token NOT Modified
────────────────────────────────────
Original payload:  { "id": "507f...", "role": "DOG_OWNER" }
Signature: HMACSHA256(header.payload, SECRET) = ABC123

Server receives same token:
1. Recalculate signature: HMACSHA256(header.payload, SECRET) = ABC123
2. Compare: ABC123 == ABC123 ✅ MATCH
3. Verdict: Token is authentic, payload not modified


❌ Token Modified (attacker changed payload)
────────────────────────────────────────────
Original payload:  { "id": "507f...", "role": "DOG_OWNER" }
Signature: ABC123

Attacker modifies:  { "id": "507f...", "role": "ADMIN" }
Signature: ABC123 (unchanged)

Server receives modified token:
1. Recalculate signature: HMACSHA256(header.modified_payload, SECRET) = XYZ789
2. Compare: XYZ789 != ABC123 ❌ MISMATCH
3. Verdict: Token is FORGED, reject it


❌ Token Forged (attacker signs with wrong secret)
────────────────────────────────────────────────────
Attacker creates:  { "id": "hacker...", "role": "ADMIN" }
Attacker signs with their own SECRET: "wrong-secret" = DEF456
Creates token: header.payload.DEF456

Server receives forged token:
1. Recalculate signature: HMACSHA256(header.payload, JWT_SECRET) = GHI789
2. Compare: GHI789 != DEF456 ❌ MISMATCH
3. Verdict: Token is FORGED, reject it

⚠️ Attacker can only forge tokens if they know JWT_SECRET
```

---

## Verification Flow (Server-Side)

```
┌─────────────────────────────────────────────────────────┐
│ HOW SERVER VERIFIES TOKEN                               │
└─────────────────────────────────────────────────────────┘

Client sends: Authorization: Bearer eyJhbGciOi...

Step 1: Extract token
────────────────────────────────────────
token = "eyJhbGciOi...eyJpZCI6Ij...obLDdOX2"


Step 2: Split by "."
────────────────────────────────────────
parts = token.split(".")
header = parts[0]    = "eyJhbGciOi..."
payload = parts[1]   = "eyJpZCI6Ij..."
signature = parts[2] = "obLDdOX2"


Step 3: Verify signature
────────────────────────────────────────
expected_sig = HMACSHA256(
  header + "." + payload,
  JWT_SECRET
)

if (signature === expected_sig) {
  console.log("✅ Signature valid");
} else {
  throw new Error("❌ Signature invalid - token forged");
}


Step 4: Decode payload (base64url → JSON)
────────────────────────────────────────
decoded = base64url_decode(payload)
= {
    "id": "507f1f77bcf86cd799439011",
    "userId": "7890",
    "email": "user@example.com",
    "role": "DOG_OWNER",
    "iat": 1680000000,
    "exp": 1680604800
  }


Step 5: Check expiration
────────────────────────────────────────
now = Math.floor(Date.now() / 1000)  = 1680500000 (current time)
exp = decoded.exp                     = 1680604800 (token expires)

if (now > exp) {
  throw new Error("❌ Token expired");
}


Step 6: Fetch fresh user
────────────────────────────────────────
userId = decoded.userId || decoded.id
user = await User.findById(userId)

if (!user) {
  throw new Error("❌ User no longer exists");
}


Step 7: Grant access
────────────────────────────────────────
req.user = user
next()

✅ Request proceeds
```

---

## Fieldsy Implementation Details

### Current JWT Generation
```typescript
// From: /src/controllers/auth.controller.ts

jwt.sign(
  {
    id: user.id,                    // ObjectId: "507f1f77bcf86cd799439011"
    userId: user.userId,            // Sequential ID: "7890"
    email: user.email,              // Email: "user@example.com"
    role: user.role,                // Role: "DOG_OWNER" | "FIELD_OWNER" | "ADMIN"
    provider: user.provider         // Provider: "general" | "google" | "apple"
  },
  process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  }
)
```

### Current JWT Verification
```typescript
// From: /src/middleware/auth.middleware.ts

jwt.verify(token, JWT_SECRET)  // Throws error if:
                               // - Signature invalid
                               // - Expired
                               // - Malformed
```

---

## Security Analysis

### Strengths ✅

1. **Signature Verification**
   ```
   Token cannot be modified without invalidating signature
   Requires knowledge of JWT_SECRET to forge
   ```

2. **Expiration Check**
   ```
   Token only valid for 7 days
   After expiration, token automatically rejected
   ```

3. **User Validation**
   ```
   Server fetches fresh user from database
   Catches deleted accounts
   Catches role changes
   ```

4. **Server-Side Secret**
   ```
   JWT_SECRET never sent to client
   Only server knows the signing key
   Clients cannot forge tokens
   ```

### Weaknesses ⚠️

1. **Symmetric Key (HS256)**
   ```
   ❌ Problem: Same secret signs AND verifies
   ❌ If JWT_SECRET leaked, attacker can forge any token
   ✅ Mitigation: Protect JWT_SECRET, use strong random value
   ```

2. **Default Secret Hardcoded**
   ```
   ❌ Problem: Falls back to weak default if env var missing
   ✅ Mitigation: Fail fast if JWT_SECRET not configured
   ✅ Mitigation: Use strong, random secret (min 32 chars)
   ```

3. **No Token Revocation**
   ```
   ❌ Problem: Token valid for full 7 days after logout
   ❌ Old token can still be used if leaked
   ✅ Mitigation: Implement token blacklist (Redis)
   ```

4. **Refresh Token Same Secret**
   ```
   ❌ Problem: Refresh token uses same expiry as access token
   ❌ No separate lifecycle for refresh tokens
   ✅ Mitigation: Use longer expiry for refresh tokens
   ```

---

## Comparison: HS256 vs RS256

### HMAC SHA-256 (HS256) - Current
```
Signature Method: Symmetric (same key signs and verifies)

Pros:
  ✅ Simple to implement
  ✅ Fast
  ✅ Works for monolithic apps
  ✅ No key management complexity

Cons:
  ❌ If secret leaked, attacker can forge tokens
  ❌ Secret must be kept very secure
  ❌ Harder to manage across multiple services
  ❌ All servers must have same secret
```

### RSA SHA-256 (RS256) - More Secure
```
Signature Method: Asymmetric (private key signs, public key verifies)

Pros:
  ✅ Private key only needed on signing server
  ✅ Public key can be shared safely
  ✅ Better for microservices
  ✅ Harder to forge (requires private key)

Cons:
  ❌ More complex to implement
  ❌ Slightly slower
  ❌ Requires key management system
  ❌ Not needed for monolithic app
```

### Fieldsy Recommendation
**Stay with HS256** (current implementation)
- Simple, secure enough for monolithic app
- Just ensure JWT_SECRET is:
  - ✅ At least 32 random characters
  - ✅ Set via environment variable
  - ✅ Never hardcoded
  - ✅ Rotated regularly

---

## Environment Variables (CRITICAL)

### Current
```
JWT_SECRET=your-secret-key-change-in-production    ❌ Default is weak
JWT_EXPIRES_IN=7d                                   ✅ Good
```

### Recommended
```
# Generate strong secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Output: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2

JWT_SECRET=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  ✅ 64 chars, random
JWT_EXPIRES_IN=7d                                                                ✅ 7 days
JWT_REFRESH_EXPIRES_IN=30d                                                       ⚠️ (future improvement)
```

---

## How Fieldsy Uses JWT

```
┌──────────────────────────────────────────────────────────┐
│ FIELDSY TOKEN FLOW                                       │
└──────────────────────────────────────────────────────────┘

1. REGISTRATION / LOGIN
   ┌──────────────────────────────────────────┐
   │ User signs up or logs in                 │
   │ POST /api/auth/register or /api/auth/login
   └──────────────────┬───────────────────────┘
                      │
                      ▼
   ┌──────────────────────────────────────────┐
   │ Server generates JWT token               │
   │ jwt.sign({ id, userId, email, role, ... })
   └──────────────────┬───────────────────────┘
                      │
                      ▼
   ┌──────────────────────────────────────────┐
   │ Return token to client                   │
   │ { token: "eyJhbGc...", user: { ... } }  │
   └──────────────────┬───────────────────────┘
                      │
                      ▼
   ┌──────────────────────────────────────────┐
   │ Client stores token in localStorage      │
   │ localStorage.setItem('token', token)     │
   └──────────────────────────────────────────┘


2. MAKING AUTHENTICATED REQUESTS
   ┌──────────────────────────────────────────┐
   │ Client makes request with token          │
   │ GET /api/auth/me                         │
   │ Headers: Authorization: Bearer eyJhbGc...
   └──────────────────┬───────────────────────┘
                      │
                      ▼
   ┌──────────────────────────────────────────┐
   │ Server receives token                    │
   │ Extracts from Authorization header       │
   └──────────────────┬───────────────────────┘
                      │
                      ▼
   ┌──────────────────────────────────────────┐
   │ protect middleware verifies token:       │
   │ 1. Check signature                       │
   │ 2. Check expiration                      │
   │ 3. Fetch fresh user                      │
   └──────────────────┬───────────────────────┘
                      │
       ┌──────────────┴──────────────┐
       │                             │
       ▼ (Valid)                  ▼ (Invalid)
   ┌─────────────┐            ┌─────────────┐
   │ Proceed ✅  │            │ 401 Error ❌ │
   │ req.user set│            │ Login again │
   └─────────────┘            └─────────────┘


3. LOGOUT
   ┌──────────────────────────────────────────┐
   │ User clicks logout                       │
   │ POST /api/auth/logout                    │
   └──────────────────┬───────────────────────┘
                      │
                      ▼
   ┌──────────────────────────────────────────┐
   │ Server clears cookie (if using cookies)  │
   │ Returns success                          │
   └──────────────────┬───────────────────────┘
                      │
                      ▼
   ┌──────────────────────────────────────────┐
   │ Client deletes token from localStorage   │
   │ localStorage.removeItem('token')         │
   │ Redirects to login page                  │
   └──────────────────────────────────────────┘

⚠️ Note: Token still valid server-side until expiration
   (This is why token blacklist is recommended)
```

---

## Testing JWT Manually

### Decode JWT Online
Go to https://jwt.io and paste your token
- See header, payload, and signature
- Verify it matches what you expect

### Generate Test Token
```javascript
const jwt = require('jsonwebtoken');

const token = jwt.sign(
  {
    id: '507f1f77bcf86cd799439011',
    userId: '7890',
    email: 'test@example.com',
    role: 'DOG_OWNER'
  },
  'test-secret-key',
  { expiresIn: '7d' }
);

console.log(token);
// eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSIsInVzZXJJZCI6Ijc4OTAiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJyb2xlIjoiRE9HX09XTkVSIiwiaWF0IjoxNjgwMjk1OTYwLCJleHAiOjE2ODA5MDA3NjB9.Ib3...
```

### Verify Test Token
```javascript
const jwt = require('jsonwebtoken');

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSIsInVzZXJJZCI6Ijc4OTAiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJyb2xlIjoiRE9HX09XTkVSIn0.Ib3...';

try {
  const decoded = jwt.verify(token, 'test-secret-key');
  console.log('✅ Token valid:', decoded);
} catch (error) {
  console.error('❌ Token invalid:', error.message);
}
```

---

## Checklist

- [ ] JWT_SECRET is set to strong random value (min 32 chars)
- [ ] JWT_SECRET is NOT in code, only in .env
- [ ] All servers have same JWT_SECRET
- [ ] JWT expiry is 7 days
- [ ] Signature verification happens on every protected route
- [ ] User is fetched from database (not just token claims)
- [ ] Expired tokens are rejected
- [ ] Token revocation not implemented yet (future: Redis blacklist)

---

## Summary

**JWT with HS256 in Fieldsy:**
- ✅ Signs token with JWT_SECRET
- ✅ Sends token to client
- ✅ Verifies signature on every request
- ✅ Checks expiration (7 days)
- ✅ Validates user still exists
- ⚠️ No server-side token revocation (logout doesn't invalidate)
- ⚠️ Token is base64, not encrypted (payload readable)

**Security depends on:**
1. Keeping JWT_SECRET safe and random
2. Verifying signature on every request
3. Checking user still exists in database
4. Eventually implementing token blacklist

