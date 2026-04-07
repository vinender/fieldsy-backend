//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _express = require("express");
const _reviewcontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/review.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
const _validationmiddleware = require("../middleware/validation.middleware");
const _reviewvalidation = require("../validations/review.validation");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// Public routes
router.get('/field/:fieldId', (0, _validationmiddleware.validateRequest)(_reviewvalidation.getReviewsQuerySchema), _reviewcontroller.default.getFieldReviews);
// Protected routes
router.use(_authmiddleware.protect);
// Create a review
router.post('/field/:fieldId', (0, _validationmiddleware.validateRequest)(_reviewvalidation.createReviewSchema), _reviewcontroller.default.createReview);
// Update a review
router.put('/:reviewId', (0, _validationmiddleware.validateRequest)(_reviewvalidation.updateReviewSchema), _reviewcontroller.default.updateReview);
// Delete a review
router.delete('/:reviewId', _reviewcontroller.default.deleteReview);
// Mark review as helpful
router.post('/:reviewId/helpful', _reviewcontroller.default.markHelpful);
// Field owner response
router.post('/:reviewId/response', (0, _validationmiddleware.validateRequest)(_reviewvalidation.respondToReviewSchema), _reviewcontroller.default.respondToReview);
// Get user's reviews
router.get('/user/:userId?', _reviewcontroller.default.getUserReviews);
const _default = router;

//# sourceMappingURL=review.routes.js.map