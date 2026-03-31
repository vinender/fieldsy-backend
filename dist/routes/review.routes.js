"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const review_controller_1 = __importDefault(require("../controllers/review.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const review_validation_1 = require("../validations/review.validation");
const router = (0, express_1.Router)();
// Public routes
router.get('/field/:fieldId', (0, validation_middleware_1.validateRequest)(review_validation_1.getReviewsQuerySchema), review_controller_1.default.getFieldReviews);
// Protected routes
router.use(auth_middleware_1.protect);
// Create a review
router.post('/field/:fieldId', (0, validation_middleware_1.validateRequest)(review_validation_1.createReviewSchema), review_controller_1.default.createReview);
// Update a review
router.put('/:reviewId', (0, validation_middleware_1.validateRequest)(review_validation_1.updateReviewSchema), review_controller_1.default.updateReview);
// Delete a review
router.delete('/:reviewId', review_controller_1.default.deleteReview);
// Mark review as helpful
router.post('/:reviewId/helpful', review_controller_1.default.markHelpful);
// Field owner response
router.post('/:reviewId/response', (0, validation_middleware_1.validateRequest)(review_validation_1.respondToReviewSchema), review_controller_1.default.respondToReview);
// Get user's reviews
router.get('/user/:userId?', review_controller_1.default.getUserReviews);
exports.default = router;
