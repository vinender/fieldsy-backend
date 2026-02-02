//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import { getAutoPayoutService } from '../config/payout-services';
const automaticPayoutService = getAutoPayoutService();
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/database';

class AutoPayoutController {
  /**
   * Manually trigger payout processing (Admin only)
   */
  triggerPayoutProcessing = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).user.role;
    
    if (userRole !== 'ADMIN') {
      throw new AppError('Only admins can trigger manual payout processing', 403);
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
   */
  getPayoutSummary = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    
    if (userRole !== 'FIELD_OWNER' && userRole !== 'ADMIN') {
      throw new AppError('Only field owners can view payout summary', 403);
    }

    const summary = await automaticPayoutService.getPayoutSummary(userId);

    res.json({
      success: true,
      data: summary
    });
  });

  /**
   * Process a specific booking payout (Admin only)
   */
  processBookingPayout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).user.role;
    const { bookingId } = req.params;
    
    if (userRole !== 'ADMIN') {
      throw new AppError('Only admins can manually process payouts', 403);
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
   */
  processRefundWithFees = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { bookingId } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Verify authorization
    if (userRole !== 'ADMIN') {
      // If not admin, verify the user owns the booking
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId }
      });

      if (!booking) {
        throw new AppError('Booking not found', 404);
      }

      if (booking.userId !== userId) {
        throw new AppError('You are not authorized to refund this booking', 403);
      }
    }

    const refund = await automaticPayoutService.processRefundWithFeeAdjustment(
      bookingId,
      reason || 'Customer requested refund'
    );

    res.json({
      success: true,
      message: 'Refund processed successfully. The amount will be credited to your account within 5-7 business days.',
      data: refund
    });
  });
}

export default new AutoPayoutController();
