"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFirebaseReady = exports.getMessaging = exports.getFirebaseApp = exports.initializeFirebase = void 0;
//@ts-nocheck
const admin = __importStar(require("firebase-admin"));
let firebaseApp = null;
/**
 * Initialize Firebase Admin SDK for push notifications
 * Requires FIREBASE_SERVICE_ACCOUNT_KEY environment variable
 */
const initializeFirebase = () => {
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
    }
    catch (error) {
        console.error('❌ Firebase initialization FAILED');
        console.error('   Error:', error.message);
        console.error('   Make sure FIREBASE_SERVICE_ACCOUNT_KEY is valid JSON');
        console.log('═══════════════════════════════════════════════════════════════');
        return null;
    }
};
exports.initializeFirebase = initializeFirebase;
/**
 * Get the initialized Firebase App instance
 */
const getFirebaseApp = () => firebaseApp;
exports.getFirebaseApp = getFirebaseApp;
/**
 * Get Firebase Cloud Messaging instance
 * Returns null if Firebase is not initialized
 */
const getMessaging = () => {
    if (!firebaseApp) {
        return null;
    }
    return admin.messaging(firebaseApp);
};
exports.getMessaging = getMessaging;
/**
 * Check if Firebase is initialized and ready
 */
const isFirebaseReady = () => {
    return firebaseApp !== null;
};
exports.isFirebaseReady = isFirebaseReady;
