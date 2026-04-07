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
    get RATE_LIMITER_ENABLED () {
        return RATE_LIMITER_ENABLED;
    },
    get SlidingWindowLimiter () {
        return SlidingWindowLimiter;
    },
    get authLimiter () {
        return authLimiter;
    },
    get bookingLimiter () {
        return bookingLimiter;
    },
    get bypassInDevelopment () {
        return bypassInDevelopment;
    },
    get conditionalRateLimit () {
        return conditionalRateLimit;
    },
    get createRateLimiter () {
        return createRateLimiter;
    },
    get dynamicLimiter () {
        return dynamicLimiter;
    },
    get generalLimiter () {
        return generalLimiter;
    },
    get messageLimiter () {
        return messageLimiter;
    },
    get passwordResetLimiter () {
        return passwordResetLimiter;
    },
    get paymentLimiter () {
        return paymentLimiter;
    },
    get reviewLimiter () {
        return reviewLimiter;
    },
    get searchLimiter () {
        return searchLimiter;
    },
    get slidingWindowMiddleware () {
        return slidingWindowMiddleware;
    },
    get socialAuthLimiter () {
        return socialAuthLimiter;
    },
    get strictLimiter () {
        return strictLimiter;
    },
    get uploadLimiter () {
        return uploadLimiter;
    }
});
const _expressratelimit = /*#__PURE__*/ _interop_require_default(require("express-rate-limit"));
const _ratelimitredis = /*#__PURE__*/ _interop_require_default(require("rate-limit-redis"));
const _ioredis = /*#__PURE__*/ _interop_require_default(require("ioredis"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const RATE_LIMITER_ENABLED = process.env.RATE_LIMITER_ENABLED !== 'false'; // Default to true unless explicitly disabled
const conditionalRateLimit = (limiter)=>{
    return (req, res, next)=>{
        // Skip rate limiting if disabled
        if (!RATE_LIMITER_ENABLED) {
            return next();
        }
        // Apply the rate limiter
        return limiter(req, res, next);
    };
};
// Create Redis client if available, otherwise use memory store
let redisClient = null;
if (process.env.REDIS_URL) {
    redisClient = new _ioredis.default(process.env.REDIS_URL);
    redisClient.on('error', (err)=>{
        console.error('Redis Client Error:', err);
        redisClient = null; // Fallback to memory store
    });
}
// Custom key generator to include user ID if authenticated
// Uses the built-in IP key generator for proper IPv6 handling
const keyGenerator = (req)=>{
    // If user is authenticated, use user ID for more accurate limiting
    const userId = req.user?.id || req.userId;
    if (userId) {
        return `user_${userId}`;
    }
    // For IP-based limiting, return undefined to use the default key generator
    // This ensures proper IPv6 handling
    return undefined;
};
// Custom handler to return 200 status with rate limit message instead of 429
const rateLimitHandler = (message)=>(req, res)=>{
        res.status(200).json({
            success: false,
            message: message,
            rateLimited: true,
            retryAfter: 60
        });
    };
const createRateLimiter = (options)=>{
    const message = options.message || 'Too many requests from this IP/user, please try again after a minute.';
    const config = {
        windowMs: options.windowMs || 60000,
        max: options.max || 120,
        handler: rateLimitHandler(message),
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: options.skipSuccessfulRequests || options.skipFailedRequests ? keyGenerator : undefined,
        skipSuccessfulRequests: options.skipSuccessfulRequests || false,
        skipFailedRequests: options.skipFailedRequests || true
    };
    // Use Redis store if available for distributed rate limiting
    if (redisClient) {
        config.store = new _ratelimitredis.default({
            sendCommand: (...args)=>redisClient.call(...args),
            prefix: 'rl:'
        });
    }
    const limiter = (0, _expressratelimit.default)(config);
    // Return wrapped limiter that respects the RATE_LIMITER_ENABLED flag
    return conditionalRateLimit(limiter);
};
// Base rate limiters (internal use) - all use custom handler to return 200 status
const _generalLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 800,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    standardHeaders: true,
    legacyHeaders: false
});
const _strictLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 100,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    standardHeaders: true,
    legacyHeaders: false
});
const _authLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 50,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false
});
const _socialAuthLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 60,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false
});
const _passwordResetLimiter = (0, _expressratelimit.default)({
    windowMs: 15 * 60000,
    max: 5,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    standardHeaders: true,
    legacyHeaders: false
});
const _uploadLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 80,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    standardHeaders: true,
    legacyHeaders: false
});
const _searchLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 50,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    standardHeaders: true,
    legacyHeaders: false
});
const _bookingLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 55,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    standardHeaders: true,
    legacyHeaders: false
});
const _reviewLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 15,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    standardHeaders: true,
    legacyHeaders: false
});
const _messageLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 70,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    standardHeaders: true,
    legacyHeaders: false
});
const _paymentLimiter = (0, _expressratelimit.default)({
    windowMs: 60000,
    max: 5,
    handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
    standardHeaders: true,
    legacyHeaders: false
});
const generalLimiter = conditionalRateLimit(_generalLimiter);
const strictLimiter = conditionalRateLimit(_strictLimiter);
const authLimiter = conditionalRateLimit(_authLimiter);
const socialAuthLimiter = conditionalRateLimit(_socialAuthLimiter);
const passwordResetLimiter = conditionalRateLimit(_passwordResetLimiter);
const uploadLimiter = conditionalRateLimit(_uploadLimiter);
const searchLimiter = conditionalRateLimit(_searchLimiter);
const bookingLimiter = conditionalRateLimit(_bookingLimiter);
const reviewLimiter = conditionalRateLimit(_reviewLimiter);
const messageLimiter = conditionalRateLimit(_messageLimiter);
const paymentLimiter = conditionalRateLimit(_paymentLimiter);
const bypassInDevelopment = (limiter)=>{
    return (req, res, next)=>{
        // Bypass rate limiting in development for localhost
        if (process.env.NODE_ENV === 'development' && (req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1')) {
            return next();
        }
        return limiter(req, res, next);
    };
};
const dynamicLimiter = (req, res, next)=>{
    // Skip if rate limiting is disabled
    if (!RATE_LIMITER_ENABLED) {
        return next();
    }
    const userRole = req.user?.role;
    let limiter;
    switch(userRole){
        case 'ADMIN':
            // Admins get higher limits
            limiter = (0, _expressratelimit.default)({
                windowMs: 60000,
                max: 200,
                handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
                standardHeaders: true,
                legacyHeaders: false
            });
            break;
        case 'FIELD_OWNER':
            // Field owners get moderate limits
            limiter = (0, _expressratelimit.default)({
                windowMs: 60000,
                max: 100,
                handler: rateLimitHandler('Too many requests from this IP/user, please try again after a minute.'),
                standardHeaders: true,
                legacyHeaders: false
            });
            break;
        default:
            // Regular users and unauthenticated users
            limiter = _generalLimiter; // Use base limiter directly since we already checked the flag
    }
    return limiter(req, res, next);
};
class SlidingWindowLimiter {
    requests = new Map();
    windowMs;
    maxRequests;
    constructor(windowMs = 60000, maxRequests = 60){
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        // Clean up old entries every minute
        setInterval(()=>this.cleanup(), 60000);
    }
    isAllowed(key) {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        // Get or create request timestamps for this key
        let timestamps = this.requests.get(key) || [];
        // Filter out timestamps outside the window
        timestamps = timestamps.filter((ts)=>ts > windowStart);
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
        for (const [key, timestamps] of this.requests.entries()){
            const filtered = timestamps.filter((ts)=>ts > windowStart);
            if (filtered.length === 0) {
                this.requests.delete(key);
            } else {
                this.requests.set(key, filtered);
            }
        }
    }
}
// Create a sliding window limiter instance
const slidingLimiter = new SlidingWindowLimiter(60000, 60);
const slidingWindowMiddleware = (windowMs = 60000, max = 60)=>{
    const limiter = new SlidingWindowLimiter(windowMs, max);
    return (req, res, next)=>{
        // Skip if rate limiting is disabled
        if (!RATE_LIMITER_ENABLED) {
            return next();
        }
        // Use IP or user ID as key
        const userId = req.user?.id || req.userId;
        const key = userId ? `user_${userId}` : req.ip || req.socket.remoteAddress || 'unknown';
        if (!limiter.isAllowed(key)) {
            return res.status(200).json({
                success: false,
                message: 'Too many requests from this IP/user, please try again after a minute.',
                rateLimited: true,
                retryAfter: Math.ceil(windowMs / 1000)
            });
        }
        next();
    };
};

//# sourceMappingURL=rateLimiter.middleware.js.map