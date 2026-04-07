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
    get loginSchema () {
        return loginSchema;
    },
    get registerSchema () {
        return registerSchema;
    }
});
const _zod = require("zod");
const registerSchema = _zod.z.object({
    body: _zod.z.object({
        name: _zod.z.string().min(2, 'Name must be at least 2 characters'),
        email: _zod.z.string().email('Invalid email format'),
        password: _zod.z.string().min(8, 'Password must be at least 8 characters'),
        role: _zod.z.enum([
            'DOG_OWNER',
            'FIELD_OWNER'
        ]).optional(),
        phone: _zod.z.string().optional()
    })
});
const loginSchema = _zod.z.object({
    body: _zod.z.object({
        email: _zod.z.string().email('Invalid email format'),
        password: _zod.z.string().min(1, 'Password is required')
    })
});

//# sourceMappingURL=auth.validation.js.map