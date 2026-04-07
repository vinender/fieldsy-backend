//@ts-nocheck
/**
 * Custom error class for application errors
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AppError", {
    enumerable: true,
    get: function() {
        return AppError;
    }
});
class AppError extends Error {
    statusCode;
    status;
    isOperational;
    constructor(message, statusCode){
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

//# sourceMappingURL=AppError.js.map