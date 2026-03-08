//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { notifyError } from '../services/error-notifier.service';

/**
 * Global error handling middleware
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error = { ...err } as any;
  error.message = err.message;

  // Log error to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('ERROR 💥', err);
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Invalid ID format';
    error = new AppError(message, 400);
  }

  // Mongoose duplicate key
  if ((err as any).code === 11000) {
    const value = (err as any).errmsg.match(/(["'])(\?.)*?\1/)[0];
    const message = `Duplicate field value: ${value}. Please use another value!`;
    error = new AppError(message, 400);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values((err as any).errors).map((el: any) => el.message);
    const message = `Invalid input data. ${errors.join('. ')}`;
    error = new AppError(message, 400);
  }

  // Prisma errors
  if ((err as any).code && (err as any).code.startsWith('P')) {
    // Prisma error codes start with 'P'
    const prismaCode = (err as any).code;
    let message = 'Something went wrong. Please try again.';

    // Handle specific Prisma errors
    if (prismaCode === 'P2002') {
      message = 'This record already exists. Please use different values.';
    } else if (prismaCode === 'P2025') {
      message = 'Record not found.';
    } else if (prismaCode === 'P2003') {
      message = 'Invalid reference. Related record not found.';
    } else if (prismaCode === 'P2014') {
      message = 'Invalid relation. Please check your input.';
    }

    error = new AppError(message, 400);
  }

  // Generic Prisma validation errors (Invalid invocation)
  if (err.message && err.message.includes('Invalid `prisma.')) {
    error = new AppError('Something went wrong. Please try again.', 400);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token. Please log in again!', 401);
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Your token has expired! Please log in again.', 401);
  }

  // Send error response
  const statusCode = error.statusCode || 500;
  const status = error.status || 'error';

  // Email notification for server errors (5xx)
  if (statusCode >= 500) {
    notifyError(err instanceof Error ? err : new Error(error.message), {
      type: 'API_ERROR',
      method: req.method,
      url: req.originalUrl,
      userId: (req as any).user?.id,
      body: req.body,
      statusCode,
    }).catch(() => {}); // fire-and-forget
  }

  res.status(statusCode).json({
    success: false,
    status,
    message: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && {
      error: err,
      stack: err.stack,
    }),
  });
};

/**
 * Handle 404 errors
 */
export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};
