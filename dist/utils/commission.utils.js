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
    get calculatePayoutAmounts () {
        return calculatePayoutAmounts;
    },
    get getEffectiveCommissionRate () {
        return getEffectiveCommissionRate;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
const _settingscache = require("../config/settings-cache");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function getEffectiveCommissionRate(userId) {
    try {
        // Get the field owner's custom commission rate
        const user = await _database.default.user.findUnique({
            where: {
                id: userId
            },
            select: {
                commissionRate: true
            }
        });
        // Get the system default
        const settings = await (0, _settingscache.getSystemSettings)();
        const defaultRate = settings?.defaultCommissionRate || 20;
        // If user has a custom rate, use it
        if (user?.commissionRate !== null && user?.commissionRate !== undefined) {
            return {
                effectiveRate: user.commissionRate,
                isCustomRate: true,
                defaultRate
            };
        }
        // Otherwise, use the system default
        return {
            effectiveRate: defaultRate,
            isCustomRate: false,
            defaultRate
        };
    } catch (error) {
        console.error('Error getting commission rate:', error);
        // Return default 20% on error
        return {
            effectiveRate: 20,
            isCustomRate: false,
            defaultRate: 20
        };
    }
}
async function calculatePayoutAmounts(totalAmount, fieldOwnerId) {
    const { effectiveRate, isCustomRate, defaultRate } = await getEffectiveCommissionRate(fieldOwnerId);
    // Calculate Stripe fee (1.5% + £0.20)
    const stripeFee = totalAmount * 0.015 + 0.20;
    // Net amount after Stripe fee
    const amountAfterStripeFee = totalAmount - stripeFee;
    // Platform takes the commission percentage from the NET amount (after Stripe fee)
    const platformFeeAmount = amountAfterStripeFee * effectiveRate / 100;
    const platformCommission = platformFeeAmount; // Same value, different name for DB compatibility
    // Field owner gets the remaining net amount after platform commission
    // Owner Amount = Net (after Stripe) - PlatformCommission
    let fieldOwnerAmount = amountAfterStripeFee - platformFeeAmount;
    // Ensure we don't return negative amounts
    if (fieldOwnerAmount < 0) {
        fieldOwnerAmount = 0;
    }
    // Round to 2 decimal places to match currency format
    // Using Math.round((num + Number.EPSILON) * 100) / 100 for better precision
    fieldOwnerAmount = Math.round((fieldOwnerAmount + Number.EPSILON) * 100) / 100;
    return {
        fieldOwnerAmount,
        platformFeeAmount,
        platformCommission,
        commissionRate: effectiveRate,
        isCustomCommission: isCustomRate,
        defaultCommissionRate: defaultRate
    };
}

//# sourceMappingURL=commission.utils.js.map