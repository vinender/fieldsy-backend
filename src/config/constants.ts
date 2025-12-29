//@ts-nocheck
export const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
export const BCRYPT_ROUNDS = 10;
export const PORT = process.env.PORT || 5000;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const FRONTEND_URL = process.env.FRONTEND_URL || process.env.PRODUCTION_FRONTEND_URL || 'http://localhost:3000';

// User roles
export const USER_ROLES = {
  DOG_OWNER: 'DOG_OWNER',
  FIELD_OWNER: 'FIELD_OWNER',
  ADMIN: 'ADMIN',
} as const;

// Booking status
export const BOOKING_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;

// Field types
export const FIELD_TYPES = {
  PRIVATE: 'PRIVATE',
  PUBLIC: 'PUBLIC',
  TRAINING: 'TRAINING',
} as const;
