#!/usr/bin/env node
/**
 * Generate Apple Client Secret for NextAuth
 *
 * This script generates a JWT token that serves as the Apple client secret.
 * The token is signed with your Apple private key and is valid for 6 months.
 *
 * Usage:
 *   node generate-apple-client-secret.js
 *
 * Output:
 *   - Displays the generated client secret
 *   - Shows expiration date
 *   - Provides instructions for updating .env files
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');

console.log('\n🍎 Apple Client Secret Generator\n');
console.log('='.repeat(60));

// Load configuration from .env
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const APPLE_KEY_ID = process.env.APPLE_KEY_ID;
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;
let APPLE_SECRET = process.env.APPLE_SECRET;

// Handle multiline private key - dotenv might not parse it correctly
if (!APPLE_SECRET) {
  const fs = require('fs');
  const path = require('path');
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const secretMatch = envContent.match(/APPLE_SECRET='([^']+)'/s);
  if (secretMatch) {
    APPLE_SECRET = secretMatch[1];
  }
}

// Validate configuration
console.log('\n📋 Configuration Status:');
console.log('  Team ID:', APPLE_TEAM_ID ? `✅ ${APPLE_TEAM_ID}` : '❌ Missing');
console.log('  Key ID:', APPLE_KEY_ID ? `✅ ${APPLE_KEY_ID}` : '❌ Missing');
console.log('  Client ID:', APPLE_CLIENT_ID ? `✅ ${APPLE_CLIENT_ID}` : '❌ Missing');
console.log('  Private Key:', APPLE_SECRET ? '✅ Loaded' : '❌ Missing');

if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_CLIENT_ID || !APPLE_SECRET) {
  console.error('\n❌ Error: Missing required Apple configuration in backend/.env');
  console.error('\nRequired environment variables:');
  console.error('  - APPLE_TEAM_ID');
  console.error('  - APPLE_KEY_ID');
  console.error('  - APPLE_CLIENT_ID');
  console.error('  - APPLE_SECRET (private key)');
  process.exit(1);
}

try {
  console.log('\n🔑 Generating Apple Client Secret...');

  // Generate JWT token (valid for 6 months)
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 15777000; // 6 months in seconds

  const clientSecret = jwt.sign(
    {
      iss: APPLE_TEAM_ID,
      iat: now,
      exp: expiration,
      aud: 'https://appleid.apple.com',
      sub: APPLE_CLIENT_ID,
    },
    APPLE_SECRET,
    {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: APPLE_KEY_ID,
      },
    }
  );

  const expirationDate = new Date(expiration * 1000);

  console.log('\n✅ Apple Client Secret Generated Successfully!');
  console.log('='.repeat(60));
  console.log('\n📝 Client Secret:');
  console.log('─'.repeat(60));
  console.log(clientSecret);
  console.log('─'.repeat(60));

  console.log('\n📅 Expiration:', expirationDate.toLocaleString());
  console.log('⏰ Valid for:', '6 months from now');

  console.log('\n📋 Next Steps:');
  console.log('─'.repeat(60));
  console.log('1. Copy the client secret above');
  console.log('2. Add it to frontend/.env.local:');
  console.log('   APPLE_CLIENT_SECRET=<paste-the-secret-here>');
  console.log('');
  console.log('3. Also update the APPLE_CLIENT_ID in frontend/.env.local:');
  console.log(`APPLE_CLIENT_ID=${APPLE_CLIENT_ID}`);
  console.log('');
  console.log('4. Restart your frontend dev server:');
  console.log('   cd frontend && npm run dev');
  console.log('');
  console.log('5. Test Apple Sign In from the login page');
  console.log('─'.repeat(60));

  console.log('\n⚠️  Important Notes:');
  console.log('  • This secret expires in 6 months');
  console.log('  • Keep it secure - do not commit to git');
  console.log('  • Regenerate before expiration to avoid service interruption');
  console.log('  • For production, use environment variables or secrets manager');

  console.log('\n='.repeat(60));
  console.log('✅ Complete!\n');

} catch (error) {
  console.error('\n❌ Error generating client secret:', error.message);
  console.error('\nPossible issues:');
  console.error('  • Invalid private key format');
  console.error('  • Wrong algorithm (should be ES256)');
  console.error('  • Corrupted .env file');
  console.error('\nStack trace:', error.stack);
  process.exit(1);
}
