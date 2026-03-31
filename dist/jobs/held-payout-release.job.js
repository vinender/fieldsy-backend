"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startHeldPayoutReleaseJobs = void 0;
// DEPRECATED: Replaced by @fieldsy/stripe-auto-payout engine.
// Held payout release is now handled via payoutEngine.startScheduler() in server.ts.
// This file is kept for reference only. Safe to delete once integration is verified.
//@ts-nocheck
const node_cron_1 = __importDefault(require("node-cron"));
const held_payout_service_1 = require("../services/held-payout.service");
// Run every hour to check for held payouts that should be released
const scheduleHeldPayoutRelease = () => {
    // Run every hour at minute 0
    node_cron_1.default.schedule('0 * * * *', async () => {
        console.log('[Held Payout Release Job] Starting scheduled release check...');
        try {
            await held_payout_service_1.heldPayoutService.processScheduledReleases();
            console.log('[Held Payout Release Job] Completed scheduled release check');
        }
        catch (error) {
            console.error('[Held Payout Release Job] Error processing scheduled releases:', error);
        }
    });
    console.log('[Held Payout Release Job] Scheduled to run every hour');
};
// For weekend releases, run a special check on Fridays at 6 PM
const scheduleWeekendPayoutRelease = () => {
    // Run every Friday at 6:00 PM
    node_cron_1.default.schedule('0 18 * * 5', async () => {
        console.log('[Weekend Payout Release Job] Starting weekend payout release...');
        try {
            await held_payout_service_1.heldPayoutService.processScheduledReleases();
            console.log('[Weekend Payout Release Job] Completed weekend payout release');
        }
        catch (error) {
            console.error('[Weekend Payout Release Job] Error processing weekend releases:', error);
        }
    });
    console.log('[Weekend Payout Release Job] Scheduled to run on Fridays at 6 PM');
};
const startHeldPayoutReleaseJobs = () => {
    scheduleHeldPayoutRelease();
    scheduleWeekendPayoutRelease();
};
exports.startHeldPayoutReleaseJobs = startHeldPayoutReleaseJobs;
