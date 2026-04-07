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
    get optionalAuth () {
        return optionalAuth;
    },
    get protect () {
        return protect;
    },
    get restrictTo () {
        return restrictTo;
    }
});
const _jsonwebtoken = /*#__PURE__*/ _interop_require_default(require("jsonwebtoken"));
const _constants = require("../config/constants");
const _AppError = require("../utils/AppError");
const _asyncHandler = require("../utils/asyncHandler");
const _usermodel = /*#__PURE__*/ _interop_require_default(require("../models/user.model"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const protect = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
    let token;
    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
        token = req.cookies.token;
    }
    if (!token) {
        throw new _AppError.AppError('You are not logged in. Please log in to access this resource', 401);
    }
    try {
        // Verify token
        const decoded = _jsonwebtoken.default.verify(token, _constants.JWT_SECRET);
        // Get user ID from token (support both 'id' and 'userId' fields)
        const userId = decoded.userId || decoded.id;
        if (!userId) {
            throw new _AppError.AppError('Invalid token format', 401);
        }
        // Check if user still exists
        const user = await _usermodel.default.findById(userId);
        if (!user) {
            throw new _AppError.AppError('The user belonging to this token no longer exists', 401);
        }
        // Grant access to protected route
        req.user = user;
        next();
    } catch (error) {
        throw new _AppError.AppError('Invalid token. Please log in again', 401);
    }
});
const restrictTo = (...roles)=>{
    return (req, res, next)=>{
        if (!req.user) {
            throw new _AppError.AppError('You must be logged in to access this resource', 401);
        }
        if (!roles.includes(req.user.role)) {
            throw new _AppError.AppError('You do not have permission to perform this action', 403);
        }
        next();
    };
};
const optionalAuth = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
    let token;
    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
        token = req.cookies.token;
    }
    if (token) {
        try {
            // Verify token
            const decoded = _jsonwebtoken.default.verify(token, _constants.JWT_SECRET);
            // Get user ID from token (support both 'id' and 'userId' fields)
            const userId = decoded.userId || decoded.id;
            if (userId) {
                // Check if user still exists
                const user = await _usermodel.default.findById(userId);
                if (user) {
                    req.user = user;
                }
            }
        } catch (error) {
        // Invalid token, but continue without user
        }
    }
    next();
});

//# sourceMappingURL=auth.middleware.js.map