//@ts-nocheck
import * as admin from 'firebase-admin';

let firebaseApp: admin.app.App | null = null;

/**
 * Initialize Firebase Admin SDK for push notifications
 * Requires FIREBASE_SERVICE_ACCOUNT_KEY environment variable
 */
export const initializeFirebase = (): admin.app.App | null => {
  if (firebaseApp) {
    return firebaseApp;
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔥 FIREBASE ADMIN SDK INITIALIZATION');
  console.log('═══════════════════════════════════════════════════════════════');

  if (!serviceAccountKey) {
    console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_KEY not configured');
    console.warn('   Push notifications will NOT be sent');
    console.warn('   To enable push notifications:');
    console.warn('   1. Create a Firebase project at console.firebase.google.com');
    console.warn('   2. Go to Project Settings > Service Accounts');
    console.warn('   3. Generate a new private key');
    console.warn('   4. Set FIREBASE_SERVICE_ACCOUNT_KEY in .env as a JSON string');
    console.log('═══════════════════════════════════════════════════════════════');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountKey);

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

    console.log('✅ Firebase Admin SDK initialized successfully');
    console.log('   Project ID:', serviceAccount.project_id);
    console.log('   Service Account:', serviceAccount.client_email?.substring(0, 30) + '...');
    console.log('═══════════════════════════════════════════════════════════════');

    return firebaseApp;
  } catch (error: any) {
    console.error('❌ Firebase initialization FAILED');
    console.error('   Error:', error.message);
    console.error('   Make sure FIREBASE_SERVICE_ACCOUNT_KEY is valid JSON');
    console.log('═══════════════════════════════════════════════════════════════');
    return null;
  }
};

/**
 * Get the initialized Firebase App instance
 */
export const getFirebaseApp = (): admin.app.App | null => firebaseApp;

/**
 * Get Firebase Cloud Messaging instance
 * Returns null if Firebase is not initialized
 */
export const getMessaging = (): admin.messaging.Messaging | null => {
  if (!firebaseApp) {
    return null;
  }
  return admin.messaging(firebaseApp);
};

/**
 * Check if Firebase is initialized and ready
 */
export const isFirebaseReady = (): boolean => {
  return firebaseApp !== null;
};
