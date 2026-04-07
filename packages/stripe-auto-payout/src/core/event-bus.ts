/**
 * Typed EventEmitter wrapper for the payout system.
 * Replaces all direct notification/email calls with events
 * that the consuming application subscribes to.
 */

import { EventEmitter } from 'events';
import type { PayoutEventType, PayoutEvent } from '../types/events';
import type { Logger } from '../types/config';

export class PayoutEventBus extends EventEmitter {
  private logger: Logger;

  constructor(logger?: Logger) {
    super();
    this.logger = logger || console;
    this.setMaxListeners(50);
  }

  /** Emit a typed payout event */
  emitEvent<T = any>(
    type: PayoutEventType,
    payload: Omit<PayoutEvent<T>, 'type' | 'timestamp'>
  ): boolean {
    const event: PayoutEvent<T> = {
      ...payload,
      type,
      timestamp: new Date(),
    };

    this.logger.debug(`[EventBus] Emitting: ${type}`, {
      targetUserId: event.targetUserId,
      isAdminEvent: event.isAdminEvent,
    });

    return this.emit(type, event);
  }

  /** Convenience: emit a user-targeted event */
  notifyUser<T = any>(
    userId: string,
    type: PayoutEventType,
    title: string,
    message: string,
    data?: T
  ): void {
    this.emitEvent(type, {
      targetUserId: userId,
      isAdminEvent: false,
      title,
      message,
      data: data || ({} as T),
    });
  }

  /** Convenience: emit an admin-targeted event */
  notifyAdmins<T = any>(
    type: PayoutEventType,
    title: string,
    message: string,
    data?: T
  ): void {
    this.emitEvent(type, {
      isAdminEvent: true,
      title,
      message,
      data: data || ({} as T),
    });
  }

  /** Subscribe to a specific event type */
  on(event: PayoutEventType | string, listener: (payload: PayoutEvent) => void): this {
    return super.on(event, listener);
  }

  /** Subscribe to all events (wildcard) */
  onAny(listener: (payload: PayoutEvent) => void): this {
    return this.on('*', listener);
  }

  /** Override emit to also emit wildcard */
  emit(event: string | symbol, ...args: any[]): boolean {
    const result = super.emit(event, ...args);
    if (event !== '*') {
      super.emit('*', ...args);
    }
    return result;
  }
}
