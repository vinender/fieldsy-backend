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

    // Log configuration status (only warn if not configured)
    if (!this.teamId || !this.keyId || !this.clientId || !this.privateKey) {
      console.warn('[AppleSignIn] Not fully configured - missing required env vars');
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
    try {
      if (!idToken) {
        throw new Error('ID token is missing');
      }

      // Decode token to get audience for client ID resolution
      let decodedToken: AppleTokenPayload | null = null;
      try {
        decodedToken = jwt.decode(idToken, { complete: false }) as AppleTokenPayload;
      } catch {
        // Continue with verification even if decode fails
      }

      // Determine the correct client ID to use for verification
      const tokenAudience = decodedToken?.aud;
      let audienceToVerify = clientId || this.clientId;

      // Match audience to configured client IDs
      if (tokenAudience && this.mobileClientId && tokenAudience === this.mobileClientId) {
        audienceToVerify = this.mobileClientId;
      } else if (tokenAudience && tokenAudience === this.clientId) {
        audienceToVerify = this.clientId;
      } else if (tokenAudience && (tokenAudience.startsWith('com.') || tokenAudience.includes('.'))) {
        // For mobile apps, try using token's audience if it looks like a bundle ID
        audienceToVerify = tokenAudience;
      }

      // Verify with apple-signin-auth library
      let appleRes: any;
      try {
        appleRes = await appleSignin.verifyIdToken(idToken, {
          audience: audienceToVerify,
          nonce: undefined,
          ignoreExpiration: process.env.NODE_ENV === 'development',
        });
      } catch (verifyError: any) {
        // If verification failed, try mobile client ID as fallback
        if (this.mobileClientId && audienceToVerify !== this.mobileClientId) {
          appleRes = await appleSignin.verifyIdToken(idToken, {
            audience: this.mobileClientId,
            nonce: undefined,
            ignoreExpiration: process.env.NODE_ENV === 'development',
          });
        } else {
          throw verifyError;
        }
      }

      return {
        email: appleRes.email || '',
        emailVerified: this.parseEmailVerified(appleRes.email_verified),
        sub: appleRes.sub,
        name: undefined, // Name is only provided on first sign-in from client
      };
    } catch (error: any) {
      // Log error with context for debugging
      console.error(`[AppleSignIn] Verification failed (source: ${source}):`, error.message);
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
