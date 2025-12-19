"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.slidingWindowMiddleware = exports.SlidingWindowLimiter = exports.dynamicLimiter = exports.bypassInDevelopment = exports.paymentLimiter = exports.messageLimiter = exports.reviewLimiter = exports.bookingLimiter = exports.searchLimiter = exports.uploadLimiter = exports.passwordResetLimiter = exports.socialAuthLimiter = exports.authLimiter = exports.strictLimiter = exports.generalLimiter = exports.createRateLimiter = exports.conditionalRateLimit = exports.RATE_LIMITER_ENABLED = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const rate_limit_redis_1 = __importDefault(require("rate-limit-redis"));
const ioredis_1 = __importDefault(require("ioredis"));
// Flag to enable/disable rate limiting globally
// Can be set via environment variable or directly
exports.RATE_LIMITER_ENABLED = process.env.RATE_LIMITER_ENABLED !== 'false'; // Default to true unless explicitly disabled
// Helper middleware to conditionally apply rate limiting
const conditionalRateLimit = (limiter) => {
    return (req, res, next) => {
        // Skip rate limiting if disabled
        if (!exports.RATE_LIMITER_ENABLED) {
            return next();
        }
        // Apply the rate limiter
        return limiter(req, res, next);
    };
};
exports.conditionalRateLimit = conditionalRateLimit;
// Create Redis client if available, otherwise use memory store
let redisClient = null;
if (process.env.REDIS_URL) {
    redisClient = new ioredis_1.default(process.env.REDIS_URL);
    redisClient.on('error', (err) => {
        console.error('Redis Client Error:', err);
        redisClient = null; // Fallback to memory store
    });
}
// Custom key generator to include user ID if authenticated
// Uses the built-in IP key generator for proper IPv6 handling
const keyGenerator = (req) => {
    // If user is authenticated, use user ID for more accurate limiting
    const userId = req.user?.id || req.userId;
    if (userId) {
        return `user_${userId}`;
    }
    // For IP-based limiting, return undefined to use the default key generator
    // This ensures proper IPv6 handling
    return undefined;
};
// Different rate limit configurations for different endpoints
const createRateLimiter = (options) => {
    const config = {
        windowMs: options.windowMs || 60000, // Default: 1 minute
        max: options.max || 60, // Default: 60 requests per minute
        message: options.message || 'Too many requests, please try again later.',
        standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
        legacyHeaders: false, // Disable the `X-RateLimit-*` headers
        keyGenerator: options.skipSuccessfulRequests || options.skipFailedRequests ? keyGenerator : undefined,
        skipSuccessfulRequests: options.skipSuccessfulRequests || false,
        skipFailedRequests: options.skipFailedRequests || true,
    };
    // Use Redis store if available for distributed rate limiting
    if (redisClient) {
        config.store = new rate_limit_redis_1.default({
            sendCommand: (...args) => redisClient.call(...args),
            prefix: 'rl:', // Redis key prefix
        });
    }
    const limiter = (0, express_rate_limit_1.default)(config);
    // Return wrapped limiter that respects the RATE_LIMITER_ENABLED flag
    return (0, exports.conditionalRateLimit)(limiter);
};
exports.createRateLimiter = createRateLimiter;
// Base rate limiters (internal use)
const _generalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 100, // 60 requests per minute
    message: 'Too many requests from this IP/user, please try again after a minute.',
    standardHeaders: true,
    legacyHeaders: false,
    // Use default key generator for IP-based limiting
});
const _strictLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 20, // 10 requests per minute
    message: 'Too many requests to this endpoint, please try again after a minute.',
    standardHeaders: true,
    legacyHeaders: false,
});
const _authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 20, // 15 requests per minute (increased from 5 to handle social login flow)
    message: 'Too many authentication attempts, please try again after a minute.',
    skipSuccessfulRequests: true, // Don't count successful login attempts
    standardHeaders: true,
    legacyHeaders: false,
});
const _socialAuthLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 30, // 30 requests per minute (OAuth flow involves multiple requests)
    message: 'Too many social login attempts, please try again after a minute.',
    skipSuccessfulRequests: true, // Don't count successful attempts
    standardHeaders: true,
    legacyHeaders: false,
});
const _passwordResetLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60000, // 15 minutes
    max: 5, // 3 requests per 15 minutes
    message: 'Too many password reset requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
const _uploadLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 80, // 20 uploads per minute
    message: 'Too many upload requests, please slow down.',
    standardHeaders: true,
    legacyHeaders: false,
});
const _searchLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 50, // 30 searches per minute
    message: 'Too many search requests, please try again after a minute.',
    standardHeaders: true,
    legacyHeaders: false,
});
const _bookingLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 55, // 5 bookings per minute
    message: 'Too many booking attempts, please slow down.',
    standardHeaders: true,
    legacyHeaders: false,
});
const _reviewLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 15, // 3 reviews per minute
    message: 'Too many review submissions, please wait before submitting another review.',
    standardHeaders: true,
    legacyHeaders: false,
});
const _messageLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 70, // 30 messages per minute
    message: 'Too many messages sent, please slow down.',
    standardHeaders: true,
    legacyHeaders: false,
});
const _paymentLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 5, // 5 payment attempts per minute
    message: 'Too many payment attempts, please try again after a minute.',
    standardHeaders: true,
    legacyHeaders: false,
});
// Exported rate limiters with conditional wrapper
exports.generalLimiter = (0, exports.conditionalRateLimit)(_generalLimiter);
exports.strictLimiter = (0, exports.conditionalRateLimit)(_strictLimiter);
exports.authLimiter = (0, exports.conditionalRateLimit)(_authLimiter);
exports.socialAuthLimiter = (0, exports.conditionalRateLimit)(_socialAuthLimiter);
exports.passwordResetLimiter = (0, exports.conditionalRateLimit)(_passwordResetLimiter);
exports.uploadLimiter = (0, exports.conditionalRateLimit)(_uploadLimiter);
exports.searchLimiter = (0, exports.conditionalRateLimit)(_searchLimiter);
exports.bookingLimiter = (0, exports.conditionalRateLimit)(_bookingLimiter);
exports.reviewLimiter = (0, exports.conditionalRateLimit)(_reviewLimiter);
exports.messageLimiter = (0, exports.conditionalRateLimit)(_messageLimiter);
exports.paymentLimiter = (0, exports.conditionalRateLimit)(_paymentLimiter);
// Development mode bypass middleware
const bypassInDevelopment = (limiter) => {
    return (req, res, next) => {
        // Bypass rate limiting in development for localhost
        if (process.env.NODE_ENV === 'development' &&
            (req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1')) {
            return next();
        }
        return limiter(req, res, next);
    };
};
exports.bypassInDevelopment = bypassInDevelopment;
// Dynamic rate limiter based on user role
const dynamicLimiter = (req, res, next) => {
    // Skip if rate limiting is disabled
    if (!exports.RATE_LIMITER_ENABLED) {
        return next();
    }
    const userRole = req.user?.role;
    let limiter;
    switch (userRole) {
        case 'ADMIN':
            // Admins get higher limits
            limiter = (0, express_rate_limit_1.default)({
                windowMs: 60000,
                max: 200, // 200 requests per minute for admins
                standardHeaders: true,
                legacyHeaders: false,
            });
            break;
        case 'FIELD_OWNER':
            // Field owners get moderate limits
            limiter = (0, express_rate_limit_1.default)({
                windowMs: 60000,
                max: 100, // 100 requests per minute for field owners
                standardHeaders: true,
                legacyHeaders: false,
            });
            break;
        default:
            // Regular users and unauthenticated users
            limiter = _generalLimiter; // Use base limiter directly since we already checked the flag
    }
    return limiter(req, res, next);
};
exports.dynamicLimiter = dynamicLimiter;
// Sliding window rate limiter for more accurate limiting
class SlidingWindowLimiter {
    requests = new Map();
    windowMs;
    maxRequests;
    constructor(windowMs = 60000, maxRequests = 60) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        // Clean up old entries every minute
        setInterval(() => this.cleanup(), 60000);
    }
    isAllowed(key) {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        // Get or create request timestamps for this key
        let timestamps = this.requests.get(key) || [];
        // Filter out timestamps outside the window
        timestamps = timestamps.filter(ts => ts > windowStart);
        // Check if limit is exceeded
        if (timestamps.length >= this.maxRequests) {
            return false;
        }
        // Add current timestamp
        timestamps.push(now);
        this.requests.set(key, timestamps);
        return true;
    }
    cleanup() {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        // Remove old timestamps and empty entries
        for (const [key, timestamps] of this.requests.entries()) {
            const filtered = timestamps.filter(ts => ts > windowStart);
            if (filtered.length === 0) {
                this.requests.delete(key);
            }
            else {
                this.requests.set(key, filtered);
            }
        }
    }
}
exports.SlidingWindowLimiter = SlidingWindowLimiter;
// Create a sliding window limiter instance
const slidingLimiter = new SlidingWindowLimiter(60000, 60);
// Middleware using sliding window algorithm
const slidingWindowMiddleware = (windowMs = 60000, max = 60) => {
    const limiter = new SlidingWindowLimiter(windowMs, max);
    return (req, res, next) => {
        // Skip if rate limiting is disabled
        if (!exports.RATE_LIMITER_ENABLED) {
            return next();
        }
        // Use IP or user ID as key
        const userId = req.user?.id || req.userId;
        const key = userId ? `user_${userId}` : (req.ip || req.socket.remoteAddress || 'unknown');
        if (!limiter.isAllowed(key)) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests, please try again later.',
                retryAfter: Math.ceil(windowMs / 1000), // Retry after X seconds
            });
        }
        next();
    };
};
exports.slidingWindowMiddleware = slidingWindowMiddleware;
