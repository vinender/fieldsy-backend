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
    get BCRYPT_ROUNDS () {
        return BCRYPT_ROUNDS;
    },
    get BOOKING_STATUS () {
        return BOOKING_STATUS;
    },
    get FIELD_TYPES () {
        return FIELD_TYPES;
    },
    get FRONTEND_URL () {
        return FRONTEND_URL;
    },
    get JWT_EXPIRES_IN () {
        return JWT_EXPIRES_IN;
    },
    get JWT_SECRET () {
        return JWT_SECRET;
    },
    get NODE_ENV () {
        return NODE_ENV;
    },
    get PORT () {
        return PORT;
    },
    get USER_ROLES () {
        return USER_ROLES;
    }
});
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.PRODUCTION_FRONTEND_URL || 'http://localhost:3000';
const USER_ROLES = {
    DOG_OWNER: 'DOG_OWNER',
    FIELD_OWNER: 'FIELD_OWNER',
    ADMIN: 'ADMIN'
};
const BOOKING_STATUS = {
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    CANCELLED: 'CANCELLED',
    COMPLETED: 'COMPLETED'
};
const FIELD_TYPES = {
    PRIVATE: 'PRIVATE',
    PUBLIC: 'PUBLIC',
    TRAINING: 'TRAINING'
};

//# sourceMappingURL=constants.js.map