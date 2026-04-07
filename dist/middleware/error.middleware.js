//@ts-nocheck
"use strict";
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
    get errorHandler () {
        return errorHandler;
    },
    get notFound () {
        return notFound;
    }
});
const _AppError = require("../utils/AppError");
const _errornotifierservice = require("../services/error-notifier.service");
const errorHandler = (err, req, res, next)=>{
    let error = {
        ...err
    };
    error.message = err.message;
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
        console.error('ERROR 💥', err);
    }
    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        const message = 'Invalid ID format';
        error = new _AppError.AppError(message, 400);
    }
    // Mongoose duplicate key
    if (err.code === 11000) {
        const value = err.errmsg.match(/(["'])(\?.)*?\1/)[0];
        const message = `Duplicate field value: ${value}. Please use another value!`;
        error = new _AppError.AppError(message, 400);
    }
    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map((el)=>el.message);
        const message = `Invalid input data. ${errors.join('. ')}`;
        error = new _AppError.AppError(message, 400);
    }
    // Prisma errors
    if (err.code && err.code.startsWith('P')) {
        // Prisma error codes start with 'P'
        const prismaCode = err.code;
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
        error = new _AppError.AppError(message, 400);
    }
    // Generic Prisma validation errors (Invalid invocation)
    if (err.message && err.message.includes('Invalid `prisma.')) {
        error = new _AppError.AppError('Something went wrong. Please try again.', 400);
    }
    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        error = new _AppError.AppError('Invalid token. Please log in again!', 401);
    }
    if (err.name === 'TokenExpiredError') {
        error = new _AppError.AppError('Your token has expired! Please log in again.', 401);
    }
    // Send error response
    const statusCode = error.statusCode || 500;
    const status = error.status || 'error';
    // Email notification for server errors (5xx)
    if (statusCode >= 500) {
        (0, _errornotifierservice.notifyError)(err instanceof Error ? err : new Error(error.message), {
            type: 'API_ERROR',
            method: req.method,
            url: req.originalUrl,
            userId: req.user?.id,
            body: req.body,
            statusCode
        }).catch(()=>{}); // fire-and-forget
    }
    res.status(statusCode).json({
        success: false,
        status,
        message: error.message || 'Internal Server Error',
        ...process.env.NODE_ENV === 'development' && {
            error: err,
            stack: err.stack
        }
    });
};
const notFound = (req, res, next)=>{
    const error = new _AppError.AppError(`Route ${req.originalUrl} not found`, 404);
    next(error);
};

//# sourceMappingURL=error.middleware.js.map