//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "asyncHandler", {
    enumerable: true,
    get: function() {
        return asyncHandler;
    }
});
const asyncHandler = (fn)=>{
    return (req, res, next)=>{
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

//# sourceMappingURL=asyncHandler.js.map