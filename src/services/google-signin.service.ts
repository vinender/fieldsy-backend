//@ts-nocheck
import { OAuth2Client, TokenPayload } from 'google-auth-library';

/**
 * Google Sign In Service
 * Handles Google authentication verification for both web and mobile apps
 * Verifies Google ID tokens to prevent spoofing
 */


interface GoogleUserInfo {
  email: string;
  emailVerified: boolean;
  sub: string; // Google's unique user identifier
  name?: string;
  picture?: string;
}


class GoogleSignInService {
  private webClientId: string;
  private iosClientId: string;
  private androidClientId: string;
  private firebaseClientId: string;
  private client: OAuth2Client;

  constructor() {
    // Load configuration from environment variables
    this.webClientId = process.env.GOOGLE_CLIENT_ID || '';
    this.iosClientId = process.env.GOOGLE_IOS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
    this.androidClientId = process.env.GOOGLE_ANDROID_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
    this.firebaseClientId = process.env.FIREBASE_CLIENT_ID || '';
    // Initialize OAuth2 client
    this.client = new OAuth2Client(this.webClientId);


    // Log warning if not configured
    if (!this.webClientId) {
      console.warn('[GoogleSignIn] Not fully configured - GOOGLE_CLIENT_ID is missing');
    }
  }

  
  /**
   * Verify Google ID token from client
   * Works for both web and mobile apps
   *
   * @param idToken - The ID token from Google Sign In
   * @returns Decoded and verified user information
   */
  async verifyIdToken(idToken: string): Promise<GoogleUserInfo> {
    try {
      // Get all valid client IDs (web, iOS, Android) and remove duplicates
      const uniqueAudiences = [...new Set([
        this.webClientId,
        this.iosClientId,
        this.androidClientId,
        this.firebaseClientId,
      ].filter(Boolean))];

      // Verify the token using Google's OAuth2Client
      const ticket = await this.client.verifyIdToken({
        idToken: idToken,
        audience: uniqueAudiences,
      });

      const payload = ticket.getPayload();

      if (!payload) {
        throw new Error('Unable to get token payload');
      }

      return {
        email: payload.email || '',
        emailVerified: payload.email_verified || false,
        sub: payload.sub,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (error: any) {
      console.error('[GoogleSignIn] Verification failed:', error.message);

      // Provide more specific error messages
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

  /**
   * Validate Google configuration
   * @returns true if all required config is present
   */
  isConfigured(): boolean {
    return !!this.webClientId;
  }

  /**
   * Get configuration status for debugging
   */
  getConfigStatus() {
    return {
      webClientId: !!this.webClientId,
      iosClientId: !!this.iosClientId,
      androidClientId: !!this.androidClientId,
      configured: this.isConfigured(),
    };
  }
}

// Export singleton instance
export const googleSignInService = new GoogleSignInService();
export default googleSignInService;
