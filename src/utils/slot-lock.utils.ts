/**
 * Slot Lock Utilities
 *
 * This module provides utilities for managing slot locks to prevent double bookings.
 * Slot locks are temporary holds on time slots during the payment process.
 */

import prisma from '../config/database';

/**
 * Clean up expired slot locks
 * This should be called periodically (e.g., every 5 minutes) to remove stale locks
 */

export async function cleanupExpiredSlotLocks(): Promise<number> {
  try {
    const result = await prisma.slotLock.deleteMany({
      where: {
        expiresAt: { lt: new Date() }
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

/**
 * Release all locks for a specific user and field
 */
export async function releaseUserSlotLocks(
  userId: string,
  fieldId: string,
  date: Date
): Promise<number> {
  
  try {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    const result = await prisma.slotLock.deleteMany({
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

/**
 * Check if a slot is locked by another user
 */
export async function isSlotLockedByOther(
  fieldId: string,
  date: Date,
  startTime: string,
  userId: string
): Promise<{ isLocked: boolean; lockedByUserId?: string }> {
  try {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    const existingLock = await prisma.slotLock.findFirst({
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
  } catch (error) {
    console.error('[SlotLock] Error checking slot lock:', error);
    return { isLocked: false };
  }
}

/**
 * Get all active locks for a field on a specific date
 */


export async function getActiveLocksForField(
  fieldId: string,
  date: Date
): Promise<Array<{ startTime: string; endTime: string; userId: string; expiresAt: Date }>> {
  try {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    const locks = await prisma.slotLock.findMany({
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
  } catch (error) {
    console.error('[SlotLock] Error getting active locks:', error);
    return [];
  }
}

// Start periodic cleanup (every 5 minutes)
let cleanupInterval: NodeJS.Timeout | null = null;

export function startSlotLockCleanup(): void {
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

export function stopSlotLockCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[SlotLock] Stopped periodic cleanup');
  }
}
