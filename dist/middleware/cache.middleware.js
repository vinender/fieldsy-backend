"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheMiddleware = cacheMiddleware;
exports.invalidateCache = invalidateCache;
exports.invalidateCacheMiddleware = invalidateCacheMiddleware;
const cache = new Map();
/**
 * In-memory cache middleware for GET endpoints.
 * Caches the serialized JSON response for `ttlSeconds` and serves from memory.
 * Bypasses all downstream middleware (compression, serialization) on cache HIT.
 */
function cacheMiddleware(ttlSeconds = 300) {
    return (req, res, next) => {
        if (req.method !== 'GET')
            return next();
        const key = req.originalUrl || req.url;
        const entry = cache.get(key);
        const now = Date.now();
        // Cache HIT — serve directly without touching DB or downstream middleware
        if (entry && (now - entry.timestamp) < ttlSeconds * 1000) {
            const clientEtag = req.headers['if-none-match'];
            if (clientEtag === entry.etag) {
                res.writeHead(304, {
                    'X-Cache': 'HIT',
                    'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
                    'ETag': entry.etag,
                });
                return res.end();
            }
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(entry.body),
                'X-Cache': 'HIT',
                'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
                'ETag': entry.etag,
            });
            return res.end(entry.body);
        }
        // Cache MISS — intercept res.json to capture the response
        const originalJson = res.json.bind(res);
        res.json = function (body) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const serialized = JSON.stringify(body);
                const etag = `"cache-${Buffer.byteLength(serialized)}-${now}"`;
                cache.set(key, { body: serialized, timestamp: now, etag });
                res.setHeader('ETag', etag);
            }
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`);
            return originalJson(body);
        };
        next();
    };
}
/**
 * Invalidate cache entries matching a prefix.
 */
function invalidateCache(prefix) {
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) {
            cache.delete(key);
        }
    }
}
/**
 * Middleware that invalidates cache on write operations.
 */
function invalidateCacheMiddleware(prefix) {
    return (_req, _res, next) => {
        invalidateCache(prefix);
        next();
    };
}
