/**
 * Slot Lock Utilities
 *
 * This module provides utilities for managing slot locks to prevent double bookings.
 * Slot locks are temporary holds on time slots during the payment process.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get cleanupExpiredSlotLocks () {
        return cleanupExpiredSlotLocks;
    },
    get getActiveLocksForField () {
        return getActiveLocksForField;
    },
    get isSlotLockedByOther () {
        return isSlotLockedByOther;
    },
    get releaseUserSlotLocks () {
        return releaseUserSlotLocks;
    },
    get startSlotLockCleanup () {
        return startSlotLockCleanup;
    },
    get stopSlotLockCleanup () {
        return stopSlotLockCleanup;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function cleanupExpiredSlotLocks() {
    try {
        const result = await _database.default.slotLock.deleteMany({
            where: {
                expiresAt: {
                    lt: new Date()
                }
            }
        });
        if (result.count > 0) {
            console.log(`[SlotLock] Cleaned up ${result.count} expired slot locks`);
        }
        return result.count;
    } catch (error) {
        console.error('[SlotLock] Error cleaning up expired locks:', error);
        return 0;
    }
}
async function releaseUserSlotLocks(userId, fieldId, date) {
    try {
        const normalizedDate = new Date(date);
        normalizedDate.setHours(0, 0, 0, 0);
        const result = await _database.default.slotLock.deleteMany({
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
    } catch (error) {
        console.error('[SlotLock] Error releasing user locks:', error);
        return 0;
    }
}
async function isSlotLockedByOther(fieldId, date, startTime, userId) {
    try {
        const normalizedDate = new Date(date);
        normalizedDate.setHours(0, 0, 0, 0);
        const existingLock = await _database.default.slotLock.findFirst({
            where: {
                fieldId,
                date: normalizedDate,
                startTime,
                expiresAt: {
                    gt: new Date()
                },
                NOT: {
                    userId
                } // Exclude current user's locks
            }
        });
        return {
            isLocked: !!existingLock,
            lockedByUserId: existingLock?.userId
        };
    } catch (error) {
        console.error('[SlotLock] Error checking slot lock:', error);
        return {
            isLocked: false
        };
    }
}
async function getActiveLocksForField(fieldId, date) {
    try {
        const normalizedDate = new Date(date);
        normalizedDate.setHours(0, 0, 0, 0);
        const locks = await _database.default.slotLock.findMany({
            where: {
                fieldId,
                date: normalizedDate,
                expiresAt: {
                    gt: new Date()
                }
            },
            select: {
                startTime: true,
                endTime: true,
                userId: true,
                expiresAt: true
            }
        });
        return locks;
    } catch (error) {
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
    cleanupInterval = setInterval(async ()=>{
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

//# sourceMappingURL=slot-lock.utils.js.map