"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.restrictTo = exports.protect = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const constants_1 = require("../config/constants");
const AppError_1 = require("../utils/AppError");
const asyncHandler_1 = require("../utils/asyncHandler");
const user_model_1 = __importDefault(require("../models/user.model"));
/**
 * Middleware to protect routes - requires valid JWT token
 */
exports.protect = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
    let token;
    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    // Check for token in cookies
    else if (req.cookies?.token) {
        token = req.cookies.token;
    }
    if (!token) {
        throw new AppError_1.AppError('You are not logged in. Please log in to access this resource', 401);
    }
    try {
        // Verify token
        const decoded = jsonwebtoken_1.default.verify(token, constants_1.JWT_SECRET);
        // Get user ID from token (support both 'id' and 'userId' fields)
        const userId = decoded.userId || decoded.id;
        if (!userId) {
            throw new AppError_1.AppError('Invalid token format', 401);
        }
        // Check if user still exists
        const user = await user_model_1.default.findById(userId);
        if (!user) {
            throw new AppError_1.AppError('The user belonging to this token no longer exists', 401);
        }
        // Grant access to protected route
        req.user = user;
        next();
    }
    catch (error) {
        throw new AppError_1.AppError('Invalid token. Please log in again', 401);
    }
});
/**
 * Middleware to restrict access to specific roles
 */
const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            throw new AppError_1.AppError('You must be logged in to access this resource', 401);
        }
        if (!roles.includes(req.user.role)) {
            throw new AppError_1.AppError('You do not have permission to perform this action', 403);
        }
        next();
    };
};
exports.restrictTo = restrictTo;
/**
 * Optional auth middleware - attaches user if token exists but doesn't require it
 */
exports.optionalAuth = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
    let token;
    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    // Check for token in cookies
    else if (req.cookies?.token) {
        token = req.cookies.token;
    }
    if (token) {
        try {
            // Verify token
            const decoded = jsonwebtoken_1.default.verify(token, constants_1.JWT_SECRET);
            // Get user ID from token (support both 'id' and 'userId' fields)
            const userId = decoded.userId || decoded.id;
            if (userId) {
                // Check if user still exists
                const user = await user_model_1.default.findById(userId);
                if (user) {
                    req.user = user;
                }
            }
        }
        catch (error) {
            // Invalid token, but continue without user
        }
    }
    next();
});
