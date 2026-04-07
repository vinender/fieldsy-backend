/**
 * Default logger implementation using console.
 * Can be overridden by passing a custom logger in the config.
 */

import type { Logger } from '../types/config';

export const defaultLogger: Logger = {
  info: (message: string, ...args: any[]) => console.log(`[StripeAutoPayout] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[StripeAutoPayout] ${message}`, ...args),
  error: (message: string, ...args: any[]) => console.error(`[StripeAutoPayout] ${message}`, ...args),
  debug: (message: string, ...args: any[]) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[StripeAutoPayout] ${message}`, ...args);
    }
  },
};
