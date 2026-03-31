"use strict";
/**
 * Slot Lock Utilities
 *
 * This module provides utilities for managing slot locks to prevent double bookings.
 * Slot locks are temporary holds on time slots during the payment process.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupExpiredSlotLocks = cleanupExpiredSlotLocks;
exports.releaseUserSlotLocks = releaseUserSlotLocks;
exports.isSlotLockedByOther = isSlotLockedByOther;
exports.getActiveLocksForField = getActiveLocksForField;
exports.startSlotLockCleanup = startSlotLockCleanup;
exports.stopSlotLockCleanup = stopSlotLockCleanup;
const database_1 = __importDefault(require("../config/database"));
/**
 * Clean up expired slot locks
 * This should be called periodically (e.g., every 5 minutes) to remove stale locks
 */
async function cleanupExpiredSlotLocks() {
    try {
        const result = await database_1.default.slotLock.deleteMany({
            where: {
                expiresAt: { lt: new Date() }
            }
        });
        if (result.count > 0) {
            console.log(`[SlotLock] Cleaned up ${result.count} expired slot locks`);
        }
        return result.count;
    }
    catch (error) {
        console.error('[SlotLock] Error cleaning up expired locks:', error);
        return 0;
    }
}
/**
 * Release all locks for a specific user and field
 */
async function releaseUserSlotLocks(userId, fieldId, date) {
    try {
        const normalizedDate = new Date(date);
        normalizedDate.setHours(0, 0, 0, 0);
        const result = await database_1.default.slotLock.deleteMany({
            where: {
                userId,
                fieldId,
                date: normalizedDate
            }
        });
        if (result.count > 0) {
            console.log(`[SlotLock] Released ${result.count} locks for user ${userId} on field ${fieldId}`);
        }
        return result.count;
    }
    catch (error) {
        console.error('[SlotLock] Error releasing user locks:', error);
        return 0;
    }
}
/**
 * Check if a slot is locked by another user
 */
async function isSlotLockedByOther(fieldId, date, startTime, userId) {
    try {
        const normalizedDate = new Date(date);
        normalizedDate.setHours(0, 0, 0, 0);
        const existingLock = await database_1.default.slotLock.findFirst({
            where: {
                fieldId,
                date: normalizedDate,
                startTime,
                expiresAt: { gt: new Date() }, // Only consider non-expired locks
                NOT: { userId } // Exclude current user's locks
            }
        });
        return {
            isLocked: !!existingLock,
            lockedByUserId: existingLock?.userId
        };
    }
    catch (error) {
        console.error('[SlotLock] Error checking slot lock:', error);
        return { isLocked: false };
    }
}
/**
 * Get all active locks for a field on a specific date
 */
async function getActiveLocksForField(fieldId, date) {
    try {
        const normalizedDate = new Date(date);
        normalizedDate.setHours(0, 0, 0, 0);
        const locks = await database_1.default.slotLock.findMany({
            where: {
                fieldId,
                date: normalizedDate,
                expiresAt: { gt: new Date() }
            },
            select: {
                startTime: true,
                endTime: true,
                userId: true,
                expiresAt: true
            }
        });
        return locks;
    }
    catch (error) {
        console.error('[SlotLock] Error getting active locks:', error);
        return [];
    }
}
// Start periodic cleanup (every 5 minutes)
let cleanupInterval = null;
function startSlotLockCleanup() {
    if (cleanupInterval) {
        console.log('[SlotLock] Cleanup already running');
        return;
    }
    // Run cleanup every 5 minutes
    const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
    cleanupInterval = setInterval(async () => {
        await cleanupExpiredSlotLocks();
    }, CLEANUP_INTERVAL_MS);
    // Also run immediately on startup
    cleanupExpiredSlotLocks();
    console.log('[SlotLock] Started periodic cleanup (every 5 minutes)');
}
function stopSlotLockCleanup() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        console.log('[SlotLock] Stopped periodic cleanup');
    }
}
