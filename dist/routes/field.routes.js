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
const _fieldcontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/field.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
const _rateLimitermiddleware = require("../middleware/rateLimiter.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// Public routes (with optional auth for better data)
router.get('/', _rateLimitermiddleware.generalLimiter, _authmiddleware.optionalAuth, _fieldcontroller.default.getAllFields);
router.get('/active', _rateLimitermiddleware.generalLimiter, _authmiddleware.optionalAuth, _fieldcontroller.default.getActiveFields); // Public endpoint for active fields only (with isLiked if authenticated)
router.get('/price-range', _fieldcontroller.default.getPriceRange); // Get min and max prices
router.get('/suggestions', _fieldcontroller.default.getFieldSuggestions);
router.get('/search/location', _fieldcontroller.default.searchByLocation);
router.get('/nearby', _authmiddleware.optionalAuth, _fieldcontroller.default.getNearbyFields); // With isLiked if authenticated
router.get('/popular', _authmiddleware.optionalAuth, _fieldcontroller.default.getPopularFields); // With isLiked if authenticated
// Field ownership claiming routes (for field owners to claim unclaimed fields)
// These are NOT for booking - they're for claiming ownership of unclaimed fields
router.get('/unclaimed', _authmiddleware.protect, (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.getFieldForClaim);
router.post('/claim-ownership', _authmiddleware.protect, (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.claimField);
// My fields route (must come before /:id to avoid conflict)
router.get('/my-fields', _authmiddleware.protect, (0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _fieldcontroller.default.getMyFields);
// Optimized minimal field data endpoint (for SSG/ISR builds)
router.get('/:id/minimal', _fieldcontroller.default.getFieldMinimal);
// Google Reviews endpoint - fetches live reviews from Google Places API
router.get('/:id/google-reviews', _fieldcontroller.default.getGoogleReviews);
// Public route with ID parameter (must come after specific routes)
router.get('/:id', _authmiddleware.optionalAuth, _fieldcontroller.default.getField);
// All remaining routes require authentication
router.use(_authmiddleware.protect);
// Field owner routes
router.get('/owner/field', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.getOwnerField);
router.get('/owner/bookings', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.getFieldBookings);
router.get('/owner/bookings/recent', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.getRecentBookings);
router.get('/owner/bookings/today', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.getTodayBookings);
router.get('/owner/bookings/upcoming', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.getUpcomingBookings);
router.get('/owner/bookings/completed', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.getCompletedBookings);
router.post('/save-progress', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.saveFieldProgress);
router.put('/save-progress', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.saveFieldProgress);
router.post('/submit-for-review', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.submitFieldForReview);
router.post('/', (0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _fieldcontroller.default.createField);
// Field management routes
router.route('/:id').put((0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _fieldcontroller.default.updateField).patch((0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _fieldcontroller.default.updateField).delete((0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _fieldcontroller.default.deleteField);
// Toggle field active status
router.patch('/:id/toggle-status', (0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _fieldcontroller.default.toggleFieldStatus);
// Toggle field blocked status (admin only)
router.patch('/:id/toggle-blocked', (0, _authmiddleware.restrictTo)('ADMIN'), _fieldcontroller.default.toggleFieldBlocked);
// Toggle field approved status (admin only)
router.patch('/:id/toggle-approved', (0, _authmiddleware.restrictTo)('ADMIN'), _fieldcontroller.default.toggleFieldApproved);
// Update entry code (field owner only)
router.patch('/:fieldId/entry-code', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _fieldcontroller.default.updateEntryCode);
// Admin approval routes
router.get('/admin/pending-approval', (0, _authmiddleware.restrictTo)('ADMIN'), _fieldcontroller.default.getPendingFields);
router.patch('/:fieldId/approve', (0, _authmiddleware.restrictTo)('ADMIN'), _fieldcontroller.default.approveField);
router.patch('/:fieldId/reject', (0, _authmiddleware.restrictTo)('ADMIN'), _fieldcontroller.default.rejectField);
const _default = router;

//# sourceMappingURL=field.routes.js.map