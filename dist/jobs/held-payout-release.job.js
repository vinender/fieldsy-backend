// DEPRECATED: Replaced by @fieldsy/stripe-auto-payout engine.
// Held payout release is now handled via payoutEngine.startScheduler() in server.ts.
// This file is kept for reference only. Safe to delete once integration is verified.
//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "startHeldPayoutReleaseJobs", {
    enumerable: true,
    get: function() {
        return startHeldPayoutReleaseJobs;
    }
});
const _nodecron = /*#__PURE__*/ _interop_require_default(require("node-cron"));
const _heldpayoutservice = require("../services/held-payout.service");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// Run every hour to check for held payouts that should be released
const scheduleHeldPayoutRelease = ()=>{
    // Run every hour at minute 0
    _nodecron.default.schedule('0 * * * *', async ()=>{
        console.log('[Held Payout Release Job] Starting scheduled release check...');
        try {
            await _heldpayoutservice.heldPayoutService.processScheduledReleases();
            console.log('[Held Payout Release Job] Completed scheduled release check');
        } catch (error) {
            console.error('[Held Payout Release Job] Error processing scheduled releases:', error);
        }
    });
    console.log('[Held Payout Release Job] Scheduled to run every hour');
};
// For weekend releases, run a special check on Fridays at 6 PM
const scheduleWeekendPayoutRelease = ()=>{
    // Run every Friday at 6:00 PM
    _nodecron.default.schedule('0 18 * * 5', async ()=>{
        console.log('[Weekend Payout Release Job] Starting weekend payout release...');
        try {
            await _heldpayoutservice.heldPayoutService.processScheduledReleases();
            console.log('[Weekend Payout Release Job] Completed weekend payout release');
        } catch (error) {
            console.error('[Weekend Payout Release Job] Error processing weekend releases:', error);
        }
    });
    console.log('[Weekend Payout Release Job] Scheduled to run on Fridays at 6 PM');
};
const startHeldPayoutReleaseJobs = ()=>{
    scheduleHeldPayoutRelease();
    scheduleWeekendPayoutRelease();
};

//# sourceMappingURL=held-payout-release.job.js.map