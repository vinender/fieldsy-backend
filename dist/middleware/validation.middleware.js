"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequest = void 0;
const zod_1 = require("zod");
/**
 * Middleware to validate request body using Zod schemas
 */
const validateRequest = (schema) => {
    return async (req, res, next) => {
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            next();
        }
        catch (error) {
            if (error instanceof zod_1.ZodError) {
                const errorMessages = error.errors.map((issue) => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                }));
                res.status(400).json({
                    success: false,
                    status: 'fail',
                    message: 'Validation error',
                    errors: errorMessages,
                });
            }
            else {
                next(error);
            }
        }
    };
};
exports.validateRequest = validateRequest;
