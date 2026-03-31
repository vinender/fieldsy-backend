"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSlotCreditExpiryJob = startSlotCreditExpiryJob;
//@ts-nocheck
const node_cron_1 = __importDefault(require("node-cron"));
const database_1 = __importDefault(require("../config/database"));
// Run every hour to expire slot credits past their expiry date
function startSlotCreditExpiryJob() {
    node_cron_1.default.schedule('0 * * * *', async () => {
        try {
            const now = new Date();
            const result = await database_1.default.slotCredit.updateMany({
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
        }
        catch (error) {
            console.error('[SlotCreditExpiry] Error expiring slot credits:', error);
        }
    });
    console.log('[SlotCreditExpiry] Slot credit expiry job scheduled (every hour)');
}
