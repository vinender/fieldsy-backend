// DEPRECATED: Replaced by @fieldsy/stripe-auto-payout engine.
// Payout processing is now handled via payoutEngine.startScheduler() in server.ts.
// This file is kept for reference only. Safe to delete once integration is verified.
//@ts-nocheck
import cron from 'node-cron';
import { automaticPayoutService } from '../services/auto-payout.service';
import { createNotification } from '../controllers/notification.controller';
import prisma from '../config/database';

export class PayoutProcessorJob {
  private cronJob: cron.ScheduledTask | null = null;

  /**
   * Initialize the payout processor job
   * Runs every hour to check for eligible payouts
   */
  start() {
    // Run every hour at minute 0
    this.cronJob = cron.schedule('0 * * * *', async () => {
      console.log('🏦 Starting automatic payout processing job...');
      
      try {
        const startTime = Date.now();
        const results = await automaticPayoutService.processEligiblePayouts();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log(`✅ Payout processing completed in ${duration}s`);
        console.log(`   Processed: ${results.processed}`);
        console.log(`   Skipped: ${results.skipped}`);
        console.log(`   Failed: ${results.failed}`);
        
        // If there were any failures, notify admins
        if (results.failed > 0) {
          const adminUsers = await prisma.user.findMany({
            where: { role: 'ADMIN' }
          });
          
          for (const admin of adminUsers) {
            await createNotification({
              userId: admin.id,
              type: 'PAYOUT_JOB_ALERT',
              title: 'Payout Processing Alert',
              message: `Payout job completed with ${results.failed} failures. Please check the logs.`,
              data: {
                processed: results.processed,
                skipped: results.skipped,
                failed: results.failed,
                failedBookings: results.details.filter(d => d.status === 'failed')
              }
            });
          }
        }
        
        // Log successful payouts for audit
        if (results.processed > 0) {
          console.log('📊 Successful payouts:', 
            results.details
              .filter(d => d.status === 'processed')
              .map(d => `Booking ${d.bookingId}: £${d.amount}`)
              .join(', ')
          );
        }
        
      } catch (error) {
        console.error('❌ Error in payout processing job:', error);
        
        // Notify admins about job failure
        try {
          const adminUsers = await prisma.user.findMany({
            where: { role: 'ADMIN' }
          });
          
          for (const admin of adminUsers) {
            await createNotification({
              userId: admin.id,
              type: 'PAYOUT_JOB_ERROR',
              title: 'Payout Processing Job Failed',
              message: `The automatic payout processing job encountered an error: ${(error as any).message}`,
              data: {
                error: (error as any).message,
                timestamp: new Date()
              }
            });
          }
        } catch (notifyError) {
          console.error('Failed to notify admins about job error:', notifyError);
        }
      }
    });

    console.log('✅ Payout processor job initialized (runs every hour)');
    
    // Also set up a daily summary job at 9 AM
    this.setupDailySummaryJob();
  }

  /**
   * Set up a daily summary job that runs at 9 AM
   */
  private setupDailySummaryJob() {
    cron.schedule('0 9 * * *', async () => {
      console.log('📊 Generating daily payout summary...');
      
      try {
        // Get yesterday's date range
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Get all payouts from yesterday
        const yesterdaysPayouts = await prisma.payout.findMany({
          where: {
            createdAt: {
              gte: yesterday,
              lt: today
            }
          },
          include: {
            stripeAccount: {
              include: {
                user: true
              }
            }
          }
        });
        
        // Calculate totals
        const totalPayouts = yesterdaysPayouts.length;
        const totalAmount = yesterdaysPayouts.reduce((sum, p) => sum + p.amount, 0);
        
        // Group by field owner
        const payoutsByOwner = yesterdaysPayouts.reduce((acc, payout) => {
          const ownerId = payout.stripeAccount.userId;
          if (!acc[ownerId]) {
            acc[ownerId] = {
              ownerName: payout.stripeAccount.user.name || payout.stripeAccount.user.email,
              count: 0,
              total: 0
            };
          }
          acc[ownerId].count++;
          acc[ownerId].total += payout.amount;
          return acc;
        }, {} as Record<string, any>);
        
        // Notify admins with daily summary
        const adminUsers = await prisma.user.findMany({
          where: { role: 'ADMIN' }
        });
        
        const summaryMessage = `
Daily Payout Summary for ${yesterday.toLocaleDateString()}:
- Total Payouts: ${totalPayouts}
- Total Amount: £${totalAmount.toFixed(2)}
- Field Owners Paid: ${Object.keys(payoutsByOwner).length}

Top Recipients:
${Object.entries(payoutsByOwner)
  .sort((a, b) => b[1].total - a[1].total)
  .slice(0, 5)
  .map(([_, data]) => `- ${data.ownerName}: £${data.total.toFixed(2)} (${data.count} payouts)`)
  .join('\n')}
        `.trim();
        
        for (const admin of adminUsers) {
          await createNotification({
            userId: admin.id,
            type: 'PAYOUT_DAILY_SUMMARY',
            title: '📊 Daily Payout Summary',
            message: summaryMessage,
            data: {
              date: yesterday.toISOString(),
              totalPayouts,
              totalAmount,
              payoutsByOwner
            }
          });
        }
        
        console.log('✅ Daily payout summary sent to admins');
        
      } catch (error) {
        console.error('Error generating daily payout summary:', error);
      }
    });
    
    console.log('✅ Daily payout summary job initialized (runs at 9 AM)');
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      console.log('⏹️ Payout processor job stopped');
    }
  }

  /**
   * Manually trigger payout processing (for testing or admin use)
   */
  async triggerManually() {
    console.log('🔄 Manually triggering payout processing...');
    return await automaticPayoutService.processEligiblePayouts();
  }
}

export const payoutProcessorJob = new PayoutProcessorJob();
