import { Request, Response, NextFunction } from 'express';

interface CacheEntry {
  data: any;
  timestamp: number;
  etag: string;
}

const cache = new Map<string, CacheEntry>();

/**
 * In-memory cache middleware for GET endpoints.
 * Caches the JSON response for `ttlSeconds` and serves from memory.
 * Also sets Cache-Control and ETag headers for browser/CDN caching.
 *
 * Usage: router.get('/endpoint', cacheMiddleware(300), handler)
 */
export function cacheMiddleware(ttlSeconds: number = 300) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    const key = req.originalUrl || req.url;
    const entry = cache.get(key);
    const now = Date.now();

    // Check if cached and not expired
    if (entry && (now - entry.timestamp) < ttlSeconds * 1000) {
      // Check If-None-Match (ETag) — return 304 if unchanged
      const clientEtag = req.headers['if-none-match'];
      if (clientEtag === entry.etag) {
        return res.status(304).end();
      }

      // Serve from cache
      res.set('X-Cache', 'HIT');
      res.set('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`);
      res.set('ETag', entry.etag);
      return res.json(entry.data);
    }

    // Cache MISS — intercept res.json to capture the response
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const etag = `"${Buffer.from(JSON.stringify(body)).length}-${now}"`;
        cache.set(key, { data: body, timestamp: now, etag });
        res.set('ETag', etag);
      }
      res.set('X-Cache', 'MISS');
      res.set('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`);
      return originalJson(body);
    };

    next();
  };
}

/**
 * Invalidate cache entries matching a prefix.
 * Call this after admin updates (POST/PUT/DELETE).
 *
 * Usage: invalidateCache('/api/settings')
 */
export function invalidateCache(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Middleware that invalidates cache for the current route prefix on write operations.
 * Attach to POST/PUT/DELETE routes.
 *
 * Usage: router.post('/endpoint', invalidateCacheMiddleware('/api/settings'), handler)
 */
export function invalidateCacheMiddleware(prefix: string) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    invalidateCache(prefix);
    next();
  };
}
