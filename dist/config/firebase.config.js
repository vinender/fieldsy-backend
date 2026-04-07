//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get getFirebaseApp () {
        return getFirebaseApp;
    },
    get getMessaging () {
        return getMessaging;
    },
    get initializeFirebase () {
        return initializeFirebase;
    },
    get isFirebaseReady () {
        return isFirebaseReady;
    }
});
const _firebaseadmin = /*#__PURE__*/ _interop_require_wildcard(require("firebase-admin"));
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
let firebaseApp = null;
const initializeFirebase = ()=>{
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
        firebaseApp = _firebaseadmin.initializeApp({
            credential: _firebaseadmin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id
        });
        console.log('✅ Firebase Admin SDK initialized successfully');
        console.log('   Project ID:', serviceAccount.project_id);
        console.log('   Service Account:', serviceAccount.client_email?.substring(0, 30) + '...');
        console.log('═══════════════════════════════════════════════════════════════');
        return firebaseApp;
    } catch (error) {
        console.error('❌ Firebase initialization FAILED');
        console.error('   Error:', error.message);
        console.error('   Make sure FIREBASE_SERVICE_ACCOUNT_KEY is valid JSON');
        console.log('═══════════════════════════════════════════════════════════════');
        return null;
    }
};
const getFirebaseApp = ()=>firebaseApp;
const getMessaging = ()=>{
    if (!firebaseApp) {
        return null;
    }
    return _firebaseadmin.messaging(firebaseApp);
};
const isFirebaseReady = ()=>{
    return firebaseApp !== null;
};

//# sourceMappingURL=firebase.config.js.map