/**
 * Structured Logger for Authentication Pipeline
 *
 * Provides consistent logging format for auth flows with:
 * - Step-by-step pipeline tracking
 * - Security event logging
 * - Error context preservation
 * - Request ID correlation
 */

interface LogContext {
  requestId?: string;
  userId?: string;
  email?: string;
  [key: string]: any;
}

class AuthLogger {
  /**
   * Log a step in the authentication pipeline
   * Format: [AUTH] STEP_NAME { details }
   */
  step(step: string, context: LogContext = {}) {
    const { requestId, ...details } = context;
    const rid = requestId ? ` [${requestId}]` : '';
    console.log(`[AUTH:STEP] ${step}${rid}`, Object.keys(details).length > 0 ? details : '');
  }

  /**
   * Log a successful authentication milestone
   * Format: [AUTH:SUCCESS] ACTION [User: userId]
   */
  success(action: string, userId?: string, context: LogContext = {}) {
    const { requestId, ...details } = context;
    const rid = requestId ? ` [${requestId}]` : '';
    const user = userId ? ` [User: ${userId}]` : '';
    console.log(`[AUTH:SUCCESS] ${action}${user}${rid}`, Object.keys(details).length > 0 ? details : '');
  }

  /**
   * Log a security-related event (suspicious activity, failures, etc)
   * Format: [AUTH:SECURITY] EVENT { details }
   */
  security(event: string, context: LogContext = {}) {
    const { requestId, ...details } = context;
    const rid = requestId ? ` [${requestId}]` : '';
    console.warn(`[AUTH:SECURITY] ${event}${rid}`, details);
  }

  /**
   * Log an error with context
   * Format: [AUTH:ERROR] ACTION: errorMessage { context }
   */
  error(action: string, error: Error | string, context: LogContext = {}) {
    const { requestId, ...details } = context;
    const rid = requestId ? ` [${requestId}]` : '';
    const errorMsg = error instanceof Error ? error.message : error;
    console.error(`[AUTH:ERROR] ${action}${rid}:`, errorMsg, details);
  }

  /**
   * Log when role-based access is denied
   * Format: [AUTH:FORBIDDEN] RESOURCE [User: userId, Role: role]
   */
  forbidden(resource: string, context: LogContext = {}) {
    const { requestId, ...details } = context;
    const rid = requestId ? ` [${requestId}]` : '';
    console.warn(`[AUTH:FORBIDDEN] ${resource}${rid}`, details);
  }

  /**
   * Log external service calls (Google, Apple, email, etc)
   * Format: [AUTH:EXTERNAL] SERVICE: action { details }
   */
  external(service: string, action: string, status: 'START' | 'SUCCESS' | 'FAILED', context: LogContext = {}) {
    const { requestId, ...details } = context;
    const rid = requestId ? ` [${requestId}]` : '';
    const logFn = status === 'FAILED' ? console.error : console.log;
    logFn(`[AUTH:EXTERNAL] ${service}:${action}[${status}]${rid}`, details);
  }

  /**
   * Generate a unique request ID for tracking
   * Format: timestamp-randomString
   */
  generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const logger = new AuthLogger();

/**
 * Usage Examples:
 *
 * // Starting a flow
 * const requestId = logger.generateRequestId();
 * logger.step('LOGIN_START', { email: user.email, requestId });
 *
 * // Pipeline step
 * logger.step('VERIFY_PASSWORD', { requestId });
 * const isValid = await bcrypt.compare(password, user.password);
 * if (!isValid) {
 *   logger.security('LOGIN_INVALID_PASSWORD', { email, requestId });
 *   throw new Error('Invalid password');
 * }
 *
 * // External service call
 * logger.external('GOOGLE', 'VERIFY_TOKEN', 'START', { requestId });
 * try {
 *   const result = await googleService.verify(token);
 *   logger.external('GOOGLE', 'VERIFY_TOKEN', 'SUCCESS', { requestId });
 * } catch (error) {
 *   logger.external('GOOGLE', 'VERIFY_TOKEN', 'FAILED', {
 *     error: error.message,
 *     requestId
 *   });
 * }
 *
 * // Success milestone
 * logger.success('LOGIN_COMPLETE', user.userId, { requestId });
 *
 * // Error with context
 * logger.error('CREATE_USER', error, { email, requestId });
 *
 * // Access denied
 * logger.forbidden('DELETE_USER', { userId: req.user.id, requestId });
 */
