"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleSignInService = void 0;
//@ts-nocheck
const google_auth_library_1 = require("google-auth-library");
class GoogleSignInService {
    webClientId;
    iosClientId;
    androidClientId;
    firebaseClientId;
    client;
    constructor() {
        // Load configuration from environment variables
        this.webClientId = process.env.GOOGLE_CLIENT_ID || '';
        this.iosClientId = process.env.GOOGLE_IOS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
        this.androidClientId = process.env.GOOGLE_ANDROID_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
        this.firebaseClientId = process.env.FIREBASE_CLIENT_ID || '';
        // Initialize OAuth2 client
        this.client = new google_auth_library_1.OAuth2Client(this.webClientId);
        // Validate configuration on initialization
        if (!this.webClientId) {
            console.warn('⚠️  Google Sign In is not fully configured. GOOGLE_CLIENT_ID is missing.');
        }
        else {
            console.log('✅ Google Sign In Service initialized');
            console.log('  Web Client ID:', this.webClientId.substring(0, 20) + '...');
            if (this.iosClientId !== this.webClientId) {
                console.log('  iOS Client ID:', this.iosClientId.substring(0, 20) + '...');
            }
            if (this.androidClientId !== this.webClientId) {
                console.log('   Android Client ID:', this.androidClientId.substring(0, 20) + '...');
            }
            if (this.firebaseClientId !== this.webClientId) {
                console.log('   Firebase Client ID:', this.firebaseClientId.substring(0, 20) + '...');
            }
        }
    }
    /**
     * Verify Google ID token from client
     * Works for both web and mobile apps
     *
     * @param idToken - The ID token from Google Sign In
     * @returns Decoded and verified user information
     */
    async verifyIdToken(idToken) {
        try {
            console.log('🔐 Verifying Google ID token...');
            // Get all valid client IDs (web, iOS, Android)
            const validAudiences = [
                this.webClientId,
                this.iosClientId,
                this.androidClientId,
                this.firebaseClientId,
            ].filter(Boolean); // Remove empty strings
            // Remove duplicates
            const uniqueAudiences = [...new Set(validAudiences)];
            console.log('   Valid audiences configured:', uniqueAudiences.map(a => a.substring(0, 30) + '...'));
            // Decode token to see the audience (for debugging)
            try {
                const tokenParts = idToken.split('.');
                if (tokenParts.length === 3) {
                    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
                    console.log(' Token audience (aud):', payload.aud);
                    console.log(' Token issuer (iss):', payload.iss);
                }
            }
            catch (decodeError) {
                console.log('   Could not decode token for debugging');
            }
            // Verify the token using Google's OAuth2Client
            const ticket = await this.client.verifyIdToken({
                idToken: idToken,
                audience: uniqueAudiences, // Accept tokens from any of our client IDs
            });
            const payload = ticket.getPayload();
            if (!payload) {
                throw new Error('Unable to get token payload');
            }
            console.log('✅ Google ID token verified successfully');
            console.log('   User ID (sub):', payload.sub);
            console.log('   Email:', payload.email);
            console.log('   Email Verified:', payload.email_verified);
            console.log('   Name:', payload.name);
            return {
                email: payload.email || '',
                emailVerified: payload.email_verified || false,
                sub: payload.sub,
                name: payload.name,
                picture: payload.picture,
            };
        }
        catch (error) {
            console.error('❌ Google ID token verification failed:', error.message);
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
    isConfigured() {
        return !!this.webClientId;
    }
    /**
     * Get configuration status for debugging
     */
    getConfigStatus() {
        return {
            webClientId: this.webClientId ? '✅ Set' : '❌ Missing',
            iosClientId: this.iosClientId ? '✅ Set' : '❌ Missing',
            androidClientId: this.androidClientId ? '✅ Set' : '❌ Missing',
            configured: this.isConfigured(),
        };
    }
}
// Export singleton instance
exports.googleSignInService = new GoogleSignInService();
exports.default = exports.googleSignInService;
