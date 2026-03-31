"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReviewsQuerySchema = exports.respondToReviewSchema = exports.updateReviewSchema = exports.createReviewSchema = void 0;
//@ts-nocheck
const zod_1 = require("zod");
exports.createReviewSchema = zod_1.z.object({
    body: zod_1.z.object({
        rating: zod_1.z.number().min(1).max(5),
        title: zod_1.z.string().optional(),
        comment: zod_1.z.string().min(10).max(1000),
        images: zod_1.z.array(zod_1.z.string().url()).optional().default([]),
    }),
});
exports.updateReviewSchema = zod_1.z.object({
    body: zod_1.z.object({
        rating: zod_1.z.number().min(1).max(5).optional(),
        title: zod_1.z.string().optional(),
        comment: zod_1.z.string().min(10).max(1000).optional(),
        images: zod_1.z.array(zod_1.z.string().url()).optional(),
    }),
});
exports.respondToReviewSchema = zod_1.z.object({
    body: zod_1.z.object({
        response: zod_1.z.string().min(10).max(500),
    }),
});
exports.getReviewsQuerySchema = zod_1.z.object({
    query: zod_1.z.object({
        page: zod_1.z.string().optional(),
        limit: zod_1.z.string().optional(),
        sortBy: zod_1.z.enum(['recent', 'helpful', 'rating_high', 'rating_low']).optional(),
        rating: zod_1.z.string().optional(),
    }),
});
