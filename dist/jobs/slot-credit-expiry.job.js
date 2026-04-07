//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "startSlotCreditExpiryJob", {
    enumerable: true,
    get: function() {
        return startSlotCreditExpiryJob;
    }
});
const _nodecron = /*#__PURE__*/ _interop_require_default(require("node-cron"));
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function startSlotCreditExpiryJob() {
    _nodecron.default.schedule('0 * * * *', async ()=>{
        try {
            const now = new Date();
            const result = await _database.default.slotCredit.updateMany({
                where: {
                    status: 'active',
                    expiresAt: {
                        lte: now
                    }
                },
                data: {
                    status: 'expired'
                }
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

//# sourceMappingURL=slot-credit-expiry.job.js.map