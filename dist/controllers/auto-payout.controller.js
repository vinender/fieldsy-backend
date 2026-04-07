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
const _payoutservices = require("../config/payout-services");
const _asyncHandler = require("../utils/asyncHandler");
const _AppError = require("../utils/AppError");
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const automaticPayoutService = (0, _payoutservices.getAutoPayoutService)();
class AutoPayoutController {
    /**
   * Manually trigger payout processing (Admin only)
   */ triggerPayoutProcessing = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userRole = req.user.role;
        if (userRole !== 'ADMIN') {
            throw new _AppError.AppError('Only admins can trigger manual payout processing', 403);
        }
        const results = await automaticPayoutService.processEligiblePayouts();
        res.json({
            success: true,
            message: 'Payout processing completed',
            data: {
                processed: results.processed,
                skipped: results.skipped,
                failed: results.failed,
                details: results.details
            }
        });
    });
    /**
   * Get payout summary for field owner
   */ getPayoutSummary = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const userRole = req.user.role;
        if (userRole !== 'FIELD_OWNER' && userRole !== 'ADMIN') {
            throw new _AppError.AppError('Only field owners can view payout summary', 403);
        }
        const summary = await automaticPayoutService.getPayoutSummary(userId);
        res.json({
            success: true,
            data: summary
        });
    });
    /**
   * Process a specific booking payout (Admin only)
   */ processBookingPayout = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userRole = req.user.role;
        const { bookingId } = req.params;
        if (userRole !== 'ADMIN') {
            throw new _AppError.AppError('Only admins can manually process payouts', 403);
        }
        const payout = await automaticPayoutService.processBookingPayoutAfterCancellationWindow(bookingId);
        if (!payout) {
            return res.json({
                success: false,
                message: 'Booking not eligible for payout or already processed'
            });
        }
        res.json({
            success: true,
            message: 'Payout processed successfully',
            data: payout
        });
    });
    /**
   * Process refund with fee adjustment
   */ processRefundWithFees = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const { bookingId } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;
        // Verify authorization
        if (userRole !== 'ADMIN') {
            // If not admin, verify the user owns the booking
            const booking = await _database.default.booking.findUnique({
                where: {
                    id: bookingId
                }
            });
            if (!booking) {
                throw new _AppError.AppError('Booking not found', 404);
            }
            if (booking.userId !== userId) {
                throw new _AppError.AppError('You are not authorized to refund this booking', 403);
            }
        }
        const refund = await automaticPayoutService.processRefundWithFeeAdjustment(bookingId, reason || 'Customer requested refund');
        res.json({
            success: true,
            message: 'Refund processed successfully. The amount will be credited to your account within 5-7 business days.',
            data: refund
        });
    });
}
const _default = new AutoPayoutController();

//# sourceMappingURL=auto-payout.controller.js.map