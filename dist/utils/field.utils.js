//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "resolveField", {
    enumerable: true,
    get: function() {
        return resolveField;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function resolveField(fieldId, includeOptions) {
    const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
    if (isObjectId) {
        return _database.default.field.findUnique({
            where: {
                id: fieldId
            },
            ...includeOptions || {}
        });
    }
    return _database.default.field.findFirst({
        where: {
            fieldId: fieldId
        },
        ...includeOptions || {}
    });
}

//# sourceMappingURL=field.utils.js.map