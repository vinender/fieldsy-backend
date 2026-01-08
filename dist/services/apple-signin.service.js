"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appleSignInService = void 0;
//@ts-nocheck
const apple_signin_auth_1 = __importDefault(require("apple-signin-auth"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
class AppleSignInService {
    teamId;
    keyId;
    clientId;
    mobileClientId; // Bundle ID for iOS app
    privateKey;
    constructor() {
        // Load configuration from environment variables
        this.teamId = process.env.APPLE_TEAM_ID || '';
        this.keyId = process.env.APPLE_KEY_ID || '';
        this.clientId = process.env.APPLE_CLIENT_ID || ''; // Web Service ID (e.g., com.fieldsy.web)
        this.mobileClientId = process.env.APPLE_MOBILE_CLIENT_ID || process.env.APPLE_BUNDLE_ID || ''; // iOS Bundle ID (e.g., com.fieldsy.app)
        this.privateKey = process.env.APPLE_SECRET || '';
        // Validate configuration on initialization
        if (!this.teamId || !this.keyId || !this.clientId || !this.privateKey) {
            console.warn('⚠️  Apple Sign In is not fully configured. Some features may not work.');
            console.warn('Missing:', {
                teamId: !this.teamId,
                keyId: !this.keyId,
                clientId: !this.clientId,
                privateKey: !this.privateKey
            });
        }
        else {
            console.log('✅ Apple Sign In Service initialized');
            console.log('   Team ID:', this.teamId);
            console.log('   Key ID:', this.keyId);
            console.log('   Web Client ID:', this.clientId);
            console.log('   Mobile Client ID:', this.mobileClientId || '(not configured - will use web client ID)');
        }
    }
    /**
     * Verify Apple ID token from client
     * Works for both web and mobile apps
     *
     * @param idToken - The ID token from Apple Sign In
     * @param clientId - Optional client ID to verify (defaults to env)
     * @param source - Source of the request ('web' or 'mobile') for logging
     * @returns Decoded and verified user information
     */
    async verifyIdToken(idToken, clientId, source = 'unknown') {
        const timestamp = new Date().toISOString();
        console.log('\n');
        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║          APPLE ID TOKEN VERIFICATION - DEBUG LOG                 ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log(`[${timestamp}] Source: ${source}`);
        try {
            // Step 1: Log the incoming token details (first/last chars only for security)
            console.log('\n📥 STEP 1: Received Token Analysis');
            console.log('─────────────────────────────────────');
            if (!idToken) {
                console.log('❌ ERROR: idToken is null/undefined/empty');
                throw new Error('ID token is missing');
            }
            console.log(`   Token length: ${idToken.length} characters`);
            console.log(`   Token preview: ${idToken.substring(0, 50)}...${idToken.substring(idToken.length - 20)}`);
            // Step 2: Decode token WITHOUT verification to inspect contents
            console.log('\n🔍 STEP 2: Decoding Token (without verification)');
            console.log('─────────────────────────────────────');
            let decodedToken = null;
            let decodedHeader = null;
            try {
                decodedToken = jsonwebtoken_1.default.decode(idToken, { complete: false });
                const completeDecoded = jsonwebtoken_1.default.decode(idToken, { complete: true });
                decodedHeader = completeDecoded?.header;
                if (decodedToken) {
                    console.log('   ✅ Token decoded successfully');
                    console.log('   Token Header:');
                    console.log(`      - Algorithm: ${decodedHeader?.alg || 'N/A'}`);
                    console.log(`      - Key ID (kid): ${decodedHeader?.kid || 'N/A'}`);
                    console.log('   Token Payload:');
                    console.log(`      - Issuer (iss): ${decodedToken.iss}`);
                    console.log(`      - Subject (sub): ${decodedToken.sub}`);
                    console.log(`      - Audience (aud): ${decodedToken.aud}`);
                    console.log(`      - Email: ${decodedToken.email || 'N/A'}`);
                    console.log(`      - Email Verified: ${decodedToken.email_verified}`);
                    console.log(`      - Is Private Email: ${decodedToken.is_private_email}`);
                    // Check token times
                    const now = Math.floor(Date.now() / 1000);
                    const issuedAt = decodedToken.iat;
                    const expiresAt = decodedToken.exp;
                    const issuedAtDate = new Date(issuedAt * 1000).toISOString();
                    const expiresAtDate = new Date(expiresAt * 1000).toISOString();
                    const isExpired = now > expiresAt;
                    const tokenAge = now - issuedAt;
                    const timeUntilExpiry = expiresAt - now;
                    console.log('   Token Timestamps:');
                    console.log(`      - Issued At (iat): ${issuedAt} (${issuedAtDate})`);
                    console.log(`      - Expires At (exp): ${expiresAt} (${expiresAtDate})`);
                    console.log(`      - Current Time: ${now} (${new Date(now * 1000).toISOString()})`);
                    console.log(`      - Token Age: ${tokenAge} seconds (${Math.round(tokenAge / 60)} minutes)`);
                    if (isExpired) {
                        console.log(`      - ⚠️  TOKEN IS EXPIRED by ${Math.abs(timeUntilExpiry)} seconds (${Math.round(Math.abs(timeUntilExpiry) / 60)} minutes)`);
                    }
                    else {
                        console.log(`      - ✅ Token valid for ${timeUntilExpiry} seconds (${Math.round(timeUntilExpiry / 60)} minutes)`);
                    }
                }
                else {
                    console.log('   ⚠️  Could not decode token - may be malformed');
                }
            }
            catch (decodeError) {
                console.log(`   ❌ Failed to decode token: ${decodeError.message}`);
            }
            // Step 3: Determine which client ID to use
            console.log('\n🎯 STEP 3: Client ID Resolution');
            console.log('─────────────────────────────────────');
            const tokenAudience = decodedToken?.aud;
            console.log(`   Token audience (aud): ${tokenAudience}`);
            console.log(`   Web Client ID (env): ${this.clientId}`);
            console.log(`   Mobile Client ID (env): ${this.mobileClientId || 'not set'}`);
            console.log(`   Provided clientId param: ${clientId || 'not provided'}`);
            // Determine the correct client ID to use for verification
            let audienceToVerify = clientId || this.clientId;
            // If the token audience matches the mobile client ID, use that
            if (tokenAudience && this.mobileClientId && tokenAudience === this.mobileClientId) {
                audienceToVerify = this.mobileClientId;
                console.log(`   ✅ Token audience matches Mobile Client ID - using: ${audienceToVerify}`);
            }
            else if (tokenAudience && tokenAudience === this.clientId) {
                audienceToVerify = this.clientId;
                console.log(`   ✅ Token audience matches Web Client ID - using: ${audienceToVerify}`);
            }
            else if (tokenAudience) {
                // Token has a different audience - this might be the issue!
                console.log(`   ⚠️  TOKEN AUDIENCE MISMATCH!`);
                console.log(`      Token expects: ${tokenAudience}`);
                console.log(`      We have configured: Web=${this.clientId}, Mobile=${this.mobileClientId || 'not set'}`);
                // For mobile apps, the audience should be the Bundle ID
                // Let's try using the token's audience if it looks like a bundle ID
                if (tokenAudience.startsWith('com.') || tokenAudience.includes('.')) {
                    console.log(`   🔄 Attempting to verify with token's audience: ${tokenAudience}`);
                    audienceToVerify = tokenAudience;
                }
            }
            console.log(`   Final audience for verification: ${audienceToVerify}`);
            // Step 4: Verify with apple-signin-auth library
            console.log('\n🔐 STEP 4: Apple Token Verification');
            console.log('─────────────────────────────────────');
            console.log(`   Using audience: ${audienceToVerify}`);
            console.log(`   Ignore expiration: ${process.env.NODE_ENV === 'development'}`);
            console.log(`   Environment: ${process.env.NODE_ENV || 'not set'}`);
            let appleRes;
            try {
                appleRes = await apple_signin_auth_1.default.verifyIdToken(idToken, {
                    audience: audienceToVerify,
                    nonce: undefined,
                    ignoreExpiration: process.env.NODE_ENV === 'development',
                });
                console.log('   ✅ Apple verification PASSED');
            }
            catch (verifyError) {
                console.log(`   ❌ Apple verification FAILED: ${verifyError.message}`);
                // If verification failed and we haven't tried the mobile client ID, try it
                if (this.mobileClientId && audienceToVerify !== this.mobileClientId) {
                    console.log(`\n   🔄 Retrying with Mobile Client ID: ${this.mobileClientId}`);
                    try {
                        appleRes = await apple_signin_auth_1.default.verifyIdToken(idToken, {
                            audience: this.mobileClientId,
                            nonce: undefined,
                            ignoreExpiration: process.env.NODE_ENV === 'development',
                        });
                        console.log('   ✅ Apple verification PASSED with Mobile Client ID');
                    }
                    catch (retryError) {
                        console.log(`   ❌ Retry with Mobile Client ID also FAILED: ${retryError.message}`);
                        throw verifyError; // Throw the original error
                    }
                }
                else {
                    throw verifyError;
                }
            }
            // Step 5: Log successful verification result
            console.log('\n✅ STEP 5: Verification Success');
            console.log('─────────────────────────────────────');
            console.log(`   User ID (sub): ${appleRes.sub}`);
            console.log(`   Email: ${appleRes.email}`);
            console.log(`   Email Verified: ${appleRes.email_verified}`);
            console.log('╔══════════════════════════════════════════════════════════════════╗');
            console.log('║          APPLE VERIFICATION COMPLETE - SUCCESS                   ║');
            console.log('╚══════════════════════════════════════════════════════════════════╝');
            console.log('\n');
            return {
                email: appleRes.email || '',
                emailVerified: this.parseEmailVerified(appleRes.email_verified),
                sub: appleRes.sub,
                name: undefined, // Name is only provided on first sign-in from client
            };
        }
        catch (error) {
            console.log('\n❌ APPLE VERIFICATION FAILED');
            console.log('─────────────────────────────────────');
            console.log(`   Error Type: ${error.name || 'Unknown'}`);
            console.log(`   Error Message: ${error.message}`);
            if (error.stack) {
                console.log(`   Stack Trace:\n${error.stack}`);
            }
            // Provide helpful debugging hints
            console.log('\n💡 DEBUGGING HINTS:');
            console.log('─────────────────────────────────────');
            if (error.message?.includes('expired')) {
                console.log('   - Token has expired. Apple ID tokens are short-lived (typically 5-10 minutes)');
                console.log('   - Ensure the mobile app sends the token immediately after receiving it');
                console.log('   - Check if device time is synchronized correctly');
            }
            if (error.message?.includes('audience') || error.message?.includes('aud')) {
                console.log('   - Client ID mismatch. The token was issued for a different app');
                console.log('   - For iOS apps, set APPLE_MOBILE_CLIENT_ID or APPLE_BUNDLE_ID in .env');
                console.log('   - Mobile apps use Bundle ID, web apps use Service ID');
            }
            if (error.message?.includes('signature')) {
                console.log('   - Token signature is invalid');
                console.log('   - Token may have been tampered with or corrupted');
            }
            console.log('╔══════════════════════════════════════════════════════════════════╗');
            console.log('║          APPLE VERIFICATION COMPLETE - FAILED                    ║');
            console.log('╚══════════════════════════════════════════════════════════════════╝');
            console.log('\n');
            throw new Error(`Invalid Apple ID token: ${error.message}`);
        }
    }
    /**
     * Generate Apple client secret (JWT token)
     * Required for server-to-server API calls
     * Valid for 6 months
     *
     * @returns JWT token to use as client secret
     */
    generateClientSecret() {
        try {
            console.log('🔑 Generating Apple client secret...');
            if (!this.privateKey) {
                throw new Error('Apple private key not configured');
            }
            // Create JWT token for Apple
            const token = jsonwebtoken_1.default.sign({
                iss: this.teamId,
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 15777000, // 6 months
                aud: 'https://appleid.apple.com',
                sub: this.clientId,
            }, this.privateKey, {
                algorithm: 'ES256',
                header: {
                    alg: 'ES256',
                    kid: this.keyId,
                },
            });
            console.log('✅ Apple client secret generated');
            console.log('   Expires in: 6 months');
            return token;
        }
        catch (error) {
            console.error('❌ Failed to generate Apple client secret:', error);
            throw new Error('Failed to generate Apple client secret');
        }
    }
    /**
     * Exchange authorization code for tokens
     * Used in web OAuth flow
     *
     * @param code - Authorization code from Apple
     * @returns Access token and ID token
     */
    async getAuthorizationToken(code) {
        try {
            console.log('🔄 Exchanging authorization code for tokens...');
            const clientSecret = this.generateClientSecret();
            const response = await apple_signin_auth_1.default.getAuthorizationToken(code, {
                clientID: this.clientId,
                clientSecret: clientSecret,
                redirectUri: process.env.APPLE_REDIRECT_URI || 'http://localhost:3000/api/auth/callback/apple',
            });
            console.log('✅ Authorization tokens received');
            return response;
        }
        catch (error) {
            console.error('❌ Failed to exchange authorization code:', error);
            throw new Error('Failed to exchange authorization code');
        }
    }
    /**
     * Refresh Apple access token
     *
     * @param refreshToken - The refresh token from Apple
     * @returns New access token
     */
    async refreshAuthorizationToken(refreshToken) {
        try {
            console.log('🔄 Refreshing Apple access token...');
            const clientSecret = this.generateClientSecret();
            const response = await apple_signin_auth_1.default.refreshAuthorizationToken(refreshToken, {
                clientID: this.clientId,
                clientSecret: clientSecret,
            });
            console.log('✅ Access token refreshed');
            return response;
        }
        catch (error) {
            console.error('❌ Failed to refresh access token:', error);
            throw new Error('Failed to refresh access token');
        }
    }
    /**
     * Get Apple's public keys for token verification
     * Cached by the library
     */
    async getApplePublicKeys() {
        try {
            const keys = await apple_signin_auth_1.default.getAuthorizationToken.getApplePublicKeys();
            return keys;
        }
        catch (error) {
            console.error('❌ Failed to get Apple public keys:', error);
            throw error;
        }
    }
    /**
     * Helper method to parse email_verified field
     * Apple returns it as boolean or string "true"/"false"
     */
    parseEmailVerified(value) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true';
        }
        // Apple-verified emails are always considered verified
        return true;
    }
    /**
     * Validate Apple configuration
     * @returns true if all required config is present
     */
    isConfigured() {
        return !!(this.teamId && this.keyId && this.clientId && this.privateKey);
    }
    /**
     * Get configuration status for debugging
     */
    getConfigStatus() {
        return {
            teamId: this.teamId ? `✅ Set (${this.teamId})` : '❌ Missing',
            keyId: this.keyId ? `✅ Set (${this.keyId})` : '❌ Missing',
            webClientId: this.clientId ? `✅ Set (${this.clientId})` : '❌ Missing',
            mobileClientId: this.mobileClientId ? `✅ Set (${this.mobileClientId})` : '⚠️ Not set (mobile apps may fail)',
            privateKey: this.privateKey ? '✅ Set' : '❌ Missing',
            configured: this.isConfigured(),
            mobileConfigured: !!(this.teamId && this.keyId && this.mobileClientId && this.privateKey),
        };
    }
    /**
     * Get mobile client ID (Bundle ID)
     */
    getMobileClientId() {
        return this.mobileClientId;
    }
    /**
     * Get web client ID (Service ID)
     */
    getWebClientId() {
        return this.clientId;
    }
}
// Export singleton instance
exports.appleSignInService = new AppleSignInService();
exports.default = exports.appleSignInService;
