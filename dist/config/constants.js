"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_TYPES = exports.BOOKING_STATUS = exports.USER_ROLES = exports.FRONTEND_URL = exports.NODE_ENV = exports.PORT = exports.BCRYPT_ROUNDS = exports.JWT_EXPIRES_IN = exports.JWT_SECRET = void 0;
//@ts-nocheck
exports.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
exports.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
exports.BCRYPT_ROUNDS = 10;
exports.PORT = process.env.PORT || 5000;
exports.NODE_ENV = process.env.NODE_ENV || 'development';
exports.FRONTEND_URL = process.env.FRONTEND_URL || process.env.PRODUCTION_FRONTEND_URL || 'http://localhost:3000';
// User roles
exports.USER_ROLES = {
    DOG_OWNER: 'DOG_OWNER',
    FIELD_OWNER: 'FIELD_OWNER',
    ADMIN: 'ADMIN',
};
// Booking status
exports.BOOKING_STATUS = {
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    CANCELLED: 'CANCELLED',
    COMPLETED: 'COMPLETED',
};
// Field types
exports.FIELD_TYPES = {
    PRIVATE: 'PRIVATE',
    PUBLIC: 'PUBLIC',
    TRAINING: 'TRAINING',
};
