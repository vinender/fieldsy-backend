//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ContactQuery", {
    enumerable: true,
    get: function() {
        return ContactQuery;
    }
});
const _mongoose = /*#__PURE__*/ _interop_require_wildcard(require("mongoose"));
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const ContactQuerySchema = new _mongoose.Schema({
    name: {
        type: String,
        required: [
            true,
            'Name is required'
        ],
        trim: true
    },
    email: {
        type: String,
        required: [
            true,
            'Email is required'
        ],
        trim: true,
        lowercase: true
    },
    phone: {
        type: String,
        trim: true
    },
    subject: {
        type: String,
        required: [
            true,
            'Subject is required'
        ],
        trim: true
    },
    message: {
        type: String,
        required: [
            true,
            'Message is required'
        ],
        trim: true
    },
    status: {
        type: String,
        enum: [
            'new',
            'in-progress',
            'resolved'
        ],
        default: 'new'
    },
    adminNotes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});
// Index for faster queries
ContactQuerySchema.index({
    createdAt: -1
});
ContactQuerySchema.index({
    status: 1
});
ContactQuerySchema.index({
    email: 1
});
const ContactQuery = _mongoose.default.model('ContactQuery', ContactQuerySchema);

//# sourceMappingURL=contact-query.model.js.map