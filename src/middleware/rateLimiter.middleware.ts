import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

// Flag to enable/disable rate limiting globally
// Can be set via environment variable or directly
export const RATE_LIMITER_ENABLED = process.env.RATE_LIMITER_ENABLED !== 'false'; // Default to true unless explicitly disabled

// Helper middleware to conditionally apply rate limiting
export const conditionalRateLimit = (limiter: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip rate limiting if disabled
    if (!RATE_LIMITER_ENABLED) {
      return next();
    }
    // Apply the rate limiter
    return limiter(req, res, next);
  };
};

// Create Redis client if available, otherwise use memory store
let redisClient: Redis | null = null;
if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL);
  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
    redisClient = null; // Fallback to memory store
  });
}

// Custom key generator to include user ID if authenticated
// Uses the built-in IP key generator for proper IPv6 handling
const keyGenerator = (req: Request): string => {
  // If user is authenticated, use user ID for more accurate limiting
  const userId = (req as any).user?.id || (req as any).userId;
  if (userId) {
    return `user_${userId}`;
  }
  // For IP-based limiting, return undefined to use the default key generator
  // This ensures proper IPv6 handling
  return undefined as any;
};

// Different rate limit configurations for different endpoints
export const createRateLimiter = (options: {
  windowMs?: number;
  max?: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}) => {
  const config: any = {
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
    config.store = new RedisStore({
      sendCommand: (...args: string[]) => (redisClient as any).call(...args),
      prefix: 'rl:', // Redis key prefix
    });
  }

  const limiter = rateLimit(config);

  // Return wrapped limiter that respects the RATE_LIMITER_ENABLED flag
  return conditionalRateLimit(limiter);
};

// Base rate limiters (internal use)
const _generalLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 100, // 60 requests per minute
  message: 'Too many requests from this IP/user, please try again after a minute.',
  standardHeaders: true,
  legacyHeaders: false,
  // Use default key generator for IP-based limiting
});

const _strictLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 20, // 10 requests per minute
  message: 'Too many requests to this endpoint, please try again after a minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

const _authLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 20, // 15 requests per minute (increased from 5 to handle social login flow)
  message: 'Too many authentication attempts, please try again after a minute.',
  skipSuccessfulRequests: true, // Don't count successful login attempts
  standardHeaders: true,
  legacyHeaders: false,
});

const _socialAuthLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 30, // 30 requests per minute (OAuth flow involves multiple requests)
  message: 'Too many social login attempts, please try again after a minute.',
  skipSuccessfulRequests: true, // Don't count successful attempts
  standardHeaders: true,
  legacyHeaders: false,
});

const _passwordResetLimiter = rateLimit({
  windowMs: 15 * 60000, // 15 minutes
  max: 5, // 3 requests per 15 minutes
  message: 'Too many password reset requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const _uploadLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 80, // 20 uploads per minute
  message: 'Too many upload requests, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
});

const _searchLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 50, // 30 searches per minute
  message: 'Too many search requests, please try again after a minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

const _bookingLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 55, // 5 bookings per minute
  message: 'Too many booking attempts, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
});

const _reviewLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 15, // 3 reviews per minute
  message: 'Too many review submissions, please wait before submitting another review.',
  standardHeaders: true,
  legacyHeaders: false,
});

const _messageLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 70, // 30 messages per minute
  message: 'Too many messages sent, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
});

const _paymentLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 5, // 5 payment attempts per minute
  message: 'Too many payment attempts, please try again after a minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Exported rate limiters with conditional wrapper
export const generalLimiter = conditionalRateLimit(_generalLimiter);
export const strictLimiter = conditionalRateLimit(_strictLimiter);
export const authLimiter = conditionalRateLimit(_authLimiter);
export const socialAuthLimiter = conditionalRateLimit(_socialAuthLimiter);
export const passwordResetLimiter = conditionalRateLimit(_passwordResetLimiter);
export const uploadLimiter = conditionalRateLimit(_uploadLimiter);
export const searchLimiter = conditionalRateLimit(_searchLimiter);
export const bookingLimiter = conditionalRateLimit(_bookingLimiter);
export const reviewLimiter = conditionalRateLimit(_reviewLimiter);
export const messageLimiter = conditionalRateLimit(_messageLimiter);
export const paymentLimiter = conditionalRateLimit(_paymentLimiter);

// Development mode bypass middleware
export const bypassInDevelopment = (limiter: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Bypass rate limiting in development for localhost
    if (process.env.NODE_ENV === 'development' && 
        (req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1')) {
      return next();
    }
    return limiter(req, res, next);
  };
};

// Dynamic rate limiter based on user role
export const dynamicLimiter = (req: Request, res: Response, next: NextFunction) => {
  // Skip if rate limiting is disabled
  if (!RATE_LIMITER_ENABLED) {
    return next();
  }

  const userRole = (req as any).user?.role;

  let limiter;
  switch (userRole) {
    case 'ADMIN':
      // Admins get higher limits
      limiter = rateLimit({
        windowMs: 60000,
        max: 200, // 200 requests per minute for admins
        standardHeaders: true,
        legacyHeaders: false,
      });
      break;
    case 'FIELD_OWNER':
      // Field owners get moderate limits
      limiter = rateLimit({
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

// Sliding window rate limiter for more accurate limiting
export class SlidingWindowLimiter {
  private requests: Map<string, number[]> = new Map();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 60) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    
    // Clean up old entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  isAllowed(key: string): boolean {
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
      } else {
        this.requests.set(key, filtered);
      }
    }
  }
}

// Create a sliding window limiter instance
const slidingLimiter = new SlidingWindowLimiter(60000, 60);

// Middleware using sliding window algorithm
export const slidingWindowMiddleware = (windowMs: number = 60000, max: number = 60) => {
  const limiter = new SlidingWindowLimiter(windowMs, max);

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if rate limiting is disabled
    if (!RATE_LIMITER_ENABLED) {
      return next();
    }

    // Use IP or user ID as key
    const userId = (req as any).user?.id || (req as any).userId;
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