//@ts-nocheck
import prisma from './database';

let cachedSettings: any = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns system settings from cache (5-min TTL) or DB.
 * Drop-in replacement for prisma.systemSettings.findFirst()
 */
export async function getSystemSettings(select?: Record<string, boolean>) {
  const now = Date.now();

  if (cachedSettings && now < cacheExpiry) {
    // If caller wants specific fields, pick from cache
    if (select) {
      const result: any = { id: cachedSettings.id };
      for (const key of Object.keys(select)) {
        if (select[key]) result[key] = cachedSettings[key];
      }
      return result;
    }
    return cachedSettings;
  }

  // Fetch fresh from DB (no select — cache the full record)
  const settings = await prisma.systemSettings.findFirst();
  if (settings) {
    cachedSettings = settings;
    cacheExpiry = now + CACHE_TTL_MS;
  }

  if (select && settings) {
    const result: any = { id: settings.id };
    for (const key of Object.keys(select)) {
      if (select[key]) result[key] = settings[key];
    }
    return result;
  }

  return settings;
}

/** Invalidate cache — call after admin updates settings */
export function invalidateSettingsCache() {
  cachedSettings = null;
  cacheExpiry = 0;
}
