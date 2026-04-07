//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "validateRequest", {
    enumerable: true,
    get: function() {
        return validateRequest;
    }
});
const _zod = require("zod");
const validateRequest = (schema)=>{
    return async (req, res, next)=>{
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params
            });
            next();
        } catch (error) {
            if (error instanceof _zod.ZodError) {
                const errorMessages = error.errors.map((issue)=>({
                        field: issue.path.join('.'),
                        message: issue.message
                    }));
                res.status(400).json({
                    success: false,
                    status: 'fail',
                    message: 'Validation error',
                    errors: errorMessages
                });
            } else {
                next(error);
            }
        }
    };
};

//# sourceMappingURL=validation.middleware.js.map