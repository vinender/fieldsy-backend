//@ts-nocheck
import appleSignin from 'apple-signin-auth';
import jwt from 'jsonwebtoken';

/**
 * Apple Sign In Service
 * Handles Apple authentication for both web and mobile apps
 * Verifies Apple ID tokens and generates client secrets
 */

interface AppleUserInfo {
  email: string;
  emailVerified: boolean;
  sub: string; // Apple's unique user identifier
  name?: {
    firstName?: string;
    lastName?: string;
  };
}

interface AppleTokenPayload {
  iss: string; // Issuer (always https://appleid.apple.com)
  sub: string; // Subject (user's unique ID)
  aud: string; // Audience (your client ID)
  iat: number; // Issued at
  exp: number; // Expiration time
  nonce?: string;
  nonce_supported?: boolean;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  real_user_status?: number;
  transfer_sub?: string;
}

class AppleSignInService {
  private teamId: string;
  private keyId: string;
  private clientId: string;
  private mobileClientId: string; // Bundle ID for iOS app
  private privateKey: string;

  constructor() {
    // Load configuration from environment variables
    this.teamId = process.env.APPLE_TEAM_ID || '';
    this.keyId = process.env.APPLE_KEY_ID || '';
    this.clientId = process.env.APPLE_CLIENT_ID || ''; // Web Service ID (e.g., com.fieldsy.web)
    this.mobileClientId = process.env.APPLE_MOBILE_CLIENT_ID || process.env.APPLE_BUNDLE_ID || ''; // iOS Bundle ID (e.g., com.fieldsy.app)
    this.privateKey = process.env.APPLE_SECRET || '';

    // Log configuration status
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('[AppleSignIn] Service Initialization');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('[AppleSignIn] Configuration:');
    console.log('  - Team ID:', this.teamId ? `✅ ${this.teamId}` : '❌ NOT SET');
    console.log('  - Key ID:', this.keyId ? `✅ ${this.keyId}` : '❌ NOT SET');
    console.log('  - Web Client ID:', this.clientId ? `✅ ${this.clientId}` : '❌ NOT SET');
    console.log('  - Mobile Client ID:', this.mobileClientId ? `✅ ${this.mobileClientId}` : '⚠️ NOT SET');
    console.log('  - Private Key:', this.privateKey ? '✅ SET' : '❌ NOT SET');
    console.log('  - Fully Configured:', this.isConfigured() ? '✅ YES' : '❌ NO');
    console.log('═══════════════════════════════════════════════════════════════');

    if (!this.teamId || !this.keyId || !this.clientId || !this.privateKey) {
      console.warn('[AppleSignIn] ⚠️ Not fully configured - some features may not work');
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
  async verifyIdToken(idToken: string, clientId?: string, source: string = 'unknown'): Promise<AppleUserInfo> {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`[AppleSignIn] Starting token verification (source: ${source})`);
    console.log('═══════════════════════════════════════════════════════════════');

    try {
      if (!idToken) {
        console.error('[AppleSignIn] ❌ ID token is missing');
        throw new Error('ID token is missing');
      }

      console.log('[AppleSignIn] Token received, length:', idToken.length);
      console.log('[AppleSignIn] Token preview:', idToken.substring(0, 50) + '...');

      // Decode token to get audience for client ID resolution
      let decodedToken: AppleTokenPayload | null = null;
      try {
        decodedToken = jwt.decode(idToken, { complete: false }) as AppleTokenPayload;
        console.log('[AppleSignIn] Decoded token payload:');
        console.log('  - iss (issuer):', decodedToken?.iss);
        console.log('  - sub (user ID):', decodedToken?.sub);
        console.log('  - aud (audience):', decodedToken?.aud);
        console.log('  - email:', decodedToken?.email);
        console.log('  - email_verified:', decodedToken?.email_verified);
        console.log('  - iat (issued at):', decodedToken?.iat, decodedToken?.iat ? new Date(decodedToken.iat * 1000).toISOString() : '');
        console.log('  - exp (expires):', decodedToken?.exp, decodedToken?.exp ? new Date(decodedToken.exp * 1000).toISOString() : '');
      } catch (decodeErr) {
        console.warn('[AppleSignIn] ⚠️ Could not decode token:', decodeErr);
      }

      // Determine the correct client ID to use for verification
      const tokenAudience = decodedToken?.aud;
      let audienceToVerify = clientId || this.clientId;

      console.log('[AppleSignIn] Configured client IDs:');
      console.log('  - Web Client ID:', this.clientId || 'NOT SET');
      console.log('  - Mobile Client ID:', this.mobileClientId || 'NOT SET');
      console.log('  - Passed clientId param:', clientId || 'none');
      console.log('  - Token audience:', tokenAudience || 'unknown');

      // Match audience to configured client IDs
      if (tokenAudience && this.mobileClientId && tokenAudience === this.mobileClientId) {
        audienceToVerify = this.mobileClientId;
        console.log('[AppleSignIn] ✓ Matched mobile client ID');
      } else if (tokenAudience && tokenAudience === this.clientId) {
        audienceToVerify = this.clientId;
        console.log('[AppleSignIn] ✓ Matched web client ID');
      } else if (tokenAudience && (tokenAudience.startsWith('com.') || tokenAudience.includes('.'))) {
        // For mobile apps, try using token's audience if it looks like a bundle ID
        audienceToVerify = tokenAudience;
        console.log('[AppleSignIn] ⚠️ Using token audience as fallback (looks like bundle ID)');
      } else {
        console.log('[AppleSignIn] ⚠️ No audience match, using default:', audienceToVerify);
      }

      console.log('[AppleSignIn] Will verify with audience:', audienceToVerify);

      // Verify with apple-signin-auth library
      let appleRes: any;
      try {
        console.log('[AppleSignIn] Attempting verification with primary audience...');
        appleRes = await appleSignin.verifyIdToken(idToken, {
          audience: audienceToVerify,
          nonce: undefined,
          ignoreExpiration: process.env.NODE_ENV === 'development',
        });
        console.log('[AppleSignIn] ✅ Primary verification succeeded');
      } catch (verifyError: any) {
        console.error('[AppleSignIn] ❌ Primary verification failed:', verifyError.message);

        // If verification failed, try mobile client ID as fallback
        if (this.mobileClientId && audienceToVerify !== this.mobileClientId) {
          console.log('[AppleSignIn] Trying fallback with mobile client ID:', this.mobileClientId);
          try {
            appleRes = await appleSignin.verifyIdToken(idToken, {
              audience: this.mobileClientId,
              nonce: undefined,
              ignoreExpiration: process.env.NODE_ENV === 'development',
            });
            console.log('[AppleSignIn] ✅ Fallback verification succeeded');
          } catch (fallbackError: any) {
            console.error('[AppleSignIn] ❌ Fallback verification also failed:', fallbackError.message);
            throw verifyError;
          }
        } else {
          throw verifyError;
        }
      }

      console.log('[AppleSignIn] ✅ Token verified successfully');
      console.log('[AppleSignIn] Verified user info:');
      console.log('  - sub:', appleRes.sub);
      console.log('  - email:', appleRes.email);
      console.log('  - email_verified:', appleRes.email_verified);
      console.log('═══════════════════════════════════════════════════════════════');

      return {
        email: appleRes.email || '',
        emailVerified: this.parseEmailVerified(appleRes.email_verified),
        sub: appleRes.sub,
        name: undefined, // Name is only provided on first sign-in from client
      };
    } catch (error: any) {
      // Log error with context for debugging
      console.error('═══════════════════════════════════════════════════════════════');
      console.error(`[AppleSignIn] ❌ VERIFICATION FAILED (source: ${source})`);
      console.error('[AppleSignIn] Error:', error.message);
      console.error('[AppleSignIn] Full error:', error);
      console.error('═══════════════════════════════════════════════════════════════');
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
  generateClientSecret(): string {
    if (!this.privateKey) {
      throw new Error('Apple private key not configured');
    }

    return jwt.sign(
      {
        iss: this.teamId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 15777000, // 6 months
        aud: 'https://appleid.apple.com',
        sub: this.clientId,
      },
      this.privateKey,
      {
        algorithm: 'ES256',
        header: {
          alg: 'ES256',
          kid: this.keyId,
        },
      }
    );
  }

  /**
   * Exchange authorization code for tokens
   * Used in web OAuth flow
   *
   * @param code - Authorization code from Apple
   * @returns Access token and ID token
   */
  async getAuthorizationToken(code: string): Promise<any> {
    const clientSecret = this.generateClientSecret();

    return appleSignin.getAuthorizationToken(code, {
      clientID: this.clientId,
      clientSecret: clientSecret,
      redirectUri: process.env.APPLE_REDIRECT_URI || 'http://localhost:3000/api/auth/callback/apple',
    });
  }

  /**
   * Refresh Apple access token
   *
   * @param refreshToken - The refresh token from Apple
   * @returns New access token
   */
  async refreshAuthorizationToken(refreshToken: string): Promise<any> {
    const clientSecret = this.generateClientSecret();

    return appleSignin.refreshAuthorizationToken(refreshToken, {
      clientID: this.clientId,
      clientSecret: clientSecret,
    });
  }

  /**
   * Get Apple's public keys for token verification
   * Cached by the library
   */
  async getApplePublicKeys(): Promise<any> {
    return appleSignin.getAuthorizationToken.getApplePublicKeys();
  }

  /**
   * Helper method to parse email_verified field
   * Apple returns it as boolean or string "true"/"false"
   */
  private parseEmailVerified(value: any): boolean {
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
  isConfigured(): boolean {
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
  getMobileClientId(): string {
    return this.mobileClientId;
  }

  /**
   * Get web client ID (Service ID)
   */
  getWebClientId(): string {
    return this.clientId;
  }
}

// Export singleton instance
export const appleSignInService = new AppleSignInService();
export default appleSignInService;
