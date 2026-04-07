//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _express = /*#__PURE__*/ _interop_require_wildcard(require("express"));
const _paymentcontroller = require("../controllers/payment.controller");
const _authmiddleware = require("../middleware/auth.middleware");
const _rateLimitermiddleware = require("../middleware/rateLimiter.middleware");
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
const router = (0, _express.Router)();
const paymentController = new _paymentcontroller.PaymentController();
// Webhook endpoint (no authentication, raw body needed)
router.post('/webhook', _express.default.raw({
    type: 'application/json'
}), paymentController.handleWebhook);
// Protected routes
router.use(_authmiddleware.protect);
// Create payment intent
router.post('/create-payment-intent', _rateLimitermiddleware.paymentLimiter, paymentController.createPaymentIntent);
// Confirm payment
router.post('/confirm-payment', paymentController.confirmPayment);
// Get user's payment methods
router.get('/payment-methods', paymentController.getPaymentMethods);
const _default = router;

//# sourceMappingURL=payment.routes.js.map