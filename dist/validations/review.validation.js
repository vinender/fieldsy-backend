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
    get createReviewSchema () {
        return createReviewSchema;
    },
    get getReviewsQuerySchema () {
        return getReviewsQuerySchema;
    },
    get respondToReviewSchema () {
        return respondToReviewSchema;
    },
    get updateReviewSchema () {
        return updateReviewSchema;
    }
});
const _zod = require("zod");
const createReviewSchema = _zod.z.object({
    body: _zod.z.object({
        rating: _zod.z.number().min(1).max(5),
        title: _zod.z.string().optional(),
        comment: _zod.z.string().min(10).max(1000),
        images: _zod.z.array(_zod.z.string().url()).optional().default([])
    })
});
const updateReviewSchema = _zod.z.object({
    body: _zod.z.object({
        rating: _zod.z.number().min(1).max(5).optional(),
        title: _zod.z.string().optional(),
        comment: _zod.z.string().min(10).max(1000).optional(),
        images: _zod.z.array(_zod.z.string().url()).optional()
    })
});
const respondToReviewSchema = _zod.z.object({
    body: _zod.z.object({
        response: _zod.z.string().min(10).max(500)
    })
});
const getReviewsQuerySchema = _zod.z.object({
    query: _zod.z.object({
        page: _zod.z.string().optional(),
        limit: _zod.z.string().optional(),
        sortBy: _zod.z.enum([
            'recent',
            'helpful',
            'rating_high',
            'rating_low'
        ]).optional(),
        rating: _zod.z.string().optional()
    })
});

//# sourceMappingURL=review.validation.js.map