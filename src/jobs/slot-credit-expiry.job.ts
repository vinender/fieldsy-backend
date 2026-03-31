//@ts-nocheck
import cron from 'node-cron';
import prisma from '../config/database';

// Run every hour to expire slot credits past their expiry date
export function startSlotCreditExpiryJob() {
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const result = await prisma.slotCredit.updateMany({
        where: {
          status: 'active',
          expiresAt: { lte: now },
        },
        data: {
          status: 'expired',
        },
      });

      if (result.count > 0) {
        console.log(`[SlotCreditExpiry] Expired ${result.count} slot credits`);
      }
    } catch (error) {
      console.error('[SlotCreditExpiry] Error expiring slot credits:', error);
    }
  });

  console.log('[SlotCreditExpiry] Slot credit expiry job scheduled (every hour)');
}
