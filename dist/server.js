//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, // Export app for testing
"default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _express = /*#__PURE__*/ _interop_require_default(require("express"));
const _cors = /*#__PURE__*/ _interop_require_default(require("cors"));
const _helmet = /*#__PURE__*/ _interop_require_default(require("helmet"));
const _morgan = /*#__PURE__*/ _interop_require_default(require("morgan"));
const _compression = /*#__PURE__*/ _interop_require_default(require("compression"));
const _cookieparser = /*#__PURE__*/ _interop_require_default(require("cookie-parser"));
const _dotenv = /*#__PURE__*/ _interop_require_default(require("dotenv"));
const _rateLimitermiddleware = require("./middleware/rateLimiter.middleware");
const _expressmongosanitize = /*#__PURE__*/ _interop_require_default(require("express-mongo-sanitize"));
const _http = require("http");
const _websocket = require("./utils/websocket");
const _kafka = require("./config/kafka");
const _constants = require("./config/constants");
require("./config/database");
const _authroutes = /*#__PURE__*/ _interop_require_default(require("./routes/auth.routes"));
const _authotproutes = /*#__PURE__*/ _interop_require_default(require("./routes/auth.otp.routes"));
const _userroutes = /*#__PURE__*/ _interop_require_default(require("./routes/user.routes"));
const _fieldroutes = /*#__PURE__*/ _interop_require_default(require("./routes/field.routes"));
const _bookingroutes = /*#__PURE__*/ _interop_require_default(require("./routes/booking.routes"));
const _reviewroutes = /*#__PURE__*/ _interop_require_default(require("./routes/review.routes"));
const _notificationroutes = /*#__PURE__*/ _interop_require_default(require("./routes/notification.routes"));
const _paymentroutes = /*#__PURE__*/ _interop_require_default(require("./routes/payment.routes"));
const _striperoutes = /*#__PURE__*/ _interop_require_default(require("./routes/stripe.routes"));
const _favoriteroutes = /*#__PURE__*/ _interop_require_default(require("./routes/favorite.routes"));
const _chatroutes = /*#__PURE__*/ _interop_require_default(require("./routes/chat.routes"));
const _payoutroutes = /*#__PURE__*/ _interop_require_default(require("./routes/payout.routes"));
const _claimroutes = /*#__PURE__*/ _interop_require_default(require("./routes/claim.routes"));
const _stripeconnectroutes = /*#__PURE__*/ _interop_require_default(require("./routes/stripe-connect.routes"));
const _userreportroutes = /*#__PURE__*/ _interop_require_default(require("./routes/user-report.routes"));
const _userblockroutes = /*#__PURE__*/ _interop_require_default(require("./routes/user-block.routes"));
const _paymentmethodroutes = /*#__PURE__*/ _interop_require_default(require("./routes/payment-method.routes"));
const _adminroutes = /*#__PURE__*/ _interop_require_default(require("./routes/admin.routes"));
const _adminpayoutroutes = /*#__PURE__*/ _interop_require_default(require("./routes/admin-payout.routes"));
const _autopayoutroutes = /*#__PURE__*/ _interop_require_default(require("./routes/auto-payout.routes"));
const _earningsroutes = /*#__PURE__*/ _interop_require_default(require("./routes/earnings.routes"));
const _commissionroutes = /*#__PURE__*/ _interop_require_default(require("./routes/commission.routes"));
const _settingsroutes = /*#__PURE__*/ _interop_require_default(require("./routes/settings.routes"));
const _faqroutes = /*#__PURE__*/ _interop_require_default(require("./routes/faq.routes"));
const _uploadroutes = /*#__PURE__*/ _interop_require_default(require("./routes/upload.routes"));
const _aboutpageroutes = /*#__PURE__*/ _interop_require_default(require("./routes/about-page.routes"));
const _amenityroutes = /*#__PURE__*/ _interop_require_default(require("./routes/amenity.routes"));
const _fieldpropertiesroutes = /*#__PURE__*/ _interop_require_default(require("./routes/field-properties.routes"));
const _contactqueryroutes = /*#__PURE__*/ _interop_require_default(require("./routes/contact-query.routes"));
const _devicetokenroutes = /*#__PURE__*/ _interop_require_default(require("./routes/device-token.routes"));
const _termsroutes = /*#__PURE__*/ _interop_require_default(require("./routes/terms.routes"));
const _privacypolicyroutes = /*#__PURE__*/ _interop_require_default(require("./routes/privacy-policy.routes"));
const _offerroutes = /*#__PURE__*/ _interop_require_default(require("./routes/offer.routes"));
const _discountroutes = /*#__PURE__*/ _interop_require_default(require("./routes/discount.routes"));
const _firebaseconfig = require("./config/firebase.config");
const _errornotifierservice = require("./services/error-notifier.service");
const _apidocumentation = require("./utils/api-documentation");
const _apidocstemplate = require("./utils/api-docs-template");
const _recurringbookingjob = require("./jobs/recurring-booking.job");
const _bookingreminderjob = require("./jobs/booking-reminder.job");
const _bookingstatusjob = require("./jobs/booking-status.job");
const _slotcreditexpiryjob = require("./jobs/slot-credit-expiry.job");
const _slotlockutils = require("./utils/slot-lock.utils");
const _payoutservices = require("./config/payout-services");
const _nodecron = /*#__PURE__*/ _interop_require_default(require("node-cron"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// Load environment variables
_dotenv.default.config();
class Server {
    app;
    httpServer;
    io;
    constructor(){
        this.app = (0, _express.default)();
        this.httpServer = (0, _http.createServer)(this.app);
        this.configureMiddleware();
        this.configureRoutes();
        this.configureErrorHandling();
        this.configureSocketAndKafka();
    }
    configureMiddleware() {
        // Trust proxy - Required for rate limiting behind nginx/reverse proxy
        this.app.set('trust proxy', 1);
        // CORS configuration - MUST come before other middleware
        // ALLOW ALL ORIGINS WITH CREDENTIALS SUPPORT
        console.log('[REST API] CORS: Allowing all origins with credentials support');
        this.app.use((0, _cors.default)({
            // CRITICAL: Cannot use origin: '*' with credentials: true
            // Solution: Dynamically reflect the requesting origin
            origin: (origin, callback)=>{
                // Always allow requests (reflect the origin back)
                // This allows credentials while accepting all origins
                callback(null, origin || true);
            },
            credentials: true,
            methods: [
                'GET',
                'POST',
                'PUT',
                'PATCH',
                'DELETE',
                'OPTIONS'
            ],
            allowedHeaders: [
                'Content-Type',
                'Authorization',
                'X-Requested-With',
                'Cache-Control',
                'Pragma',
                'Expires',
                'x-access-token'
            ],
            optionsSuccessStatus: 200
        }));
        // COMMENTED OUT: Origin validation function (restore for production)
        // this.app.use(cors({
        //   origin: (origin, callback) => {
        //     // Allow requests with no origin (like mobile apps or Postman)
        //     if (!origin || allowedOrigins.includes(origin)) {
        //       callback(null, true);
        //     } else {
        //       callback(new Error('Not allowed by CORS'));
        //     }
        //   },
        //   credentials: true,
        //   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        //   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        //   optionsSuccessStatus: 200,
        // }));
        // Security middleware - configure helmet to allow CORS
        this.app.use((0, _helmet.default)({
            crossOriginResourcePolicy: {
                policy: "cross-origin"
            },
            contentSecurityPolicy: false
        }));
        // Apply general rate limiter to all API routes (60 requests per minute)
        // Bypass in development for localhost
        this.app.use('/api', (0, _rateLimitermiddleware.bypassInDevelopment)(_rateLimitermiddleware.generalLimiter));
        // Apply dynamic rate limiting based on user role
        this.app.use('/api', _rateLimitermiddleware.dynamicLimiter);
        // Data sanitization against NoSQL query injection
        this.app.use((0, _expressmongosanitize.default)());
        // =========================================================================
        // STRIPE WEBHOOK ENDPOINTS
        // =========================================================================
        // IMPORTANT: These must be registered BEFORE express.json() middleware
        // Raw body is required for Stripe signature verification
        // =========================================================================
        const paymentController = new (require('./controllers/payment.controller')).PaymentController();
        // Legacy webhook endpoints (backward compatible - handles all events)
        this.app.post('/api/payment/webhook', _express.default.raw({
            type: 'application/json'
        }), paymentController.handleWebhook);
        this.app.post('/api/payments/webhook', _express.default.raw({
            type: 'application/json'
        }), paymentController.handleWebhook);
        // =========================================================================
        // DEDICATED WEBHOOK ENDPOINTS
        // =========================================================================
        if (_payoutservices.isPayoutEngineEnabled) {
            // Engine mode: single router handles /payments, /connect, /payouts, /refunds
            const engine = (0, _payoutservices.getPayoutEngine)();
            if (engine) {
                require('./config/payout-engine-events'); // Register event listeners
                this.app.use('/api/webhooks', engine.createWebhookRouter(_express.default));
            }
        } else {
            // Built-in mode: original webhook controller
            const { webhookController } = require('./controllers/webhook.controller');
            this.app.post('/api/webhooks/payments', _express.default.raw({
                type: 'application/json'
            }), webhookController.handlePaymentWebhook.bind(webhookController));
            this.app.post('/api/webhooks/connect', _express.default.raw({
                type: 'application/json'
            }), webhookController.handleConnectWebhook.bind(webhookController));
            this.app.post('/api/webhooks/payouts', _express.default.raw({
                type: 'application/json'
            }), webhookController.handlePayoutWebhook.bind(webhookController));
            this.app.post('/api/webhooks/refunds', _express.default.raw({
                type: 'application/json'
            }), webhookController.handleRefundWebhook.bind(webhookController));
        }
        // Body parsing middleware
        this.app.use(_express.default.json({
            limit: '10mb'
        }));
        this.app.use(_express.default.urlencoded({
            extended: true,
            limit: '10mb'
        }));
        this.app.use((0, _cookieparser.default)());
        // Prevent Chrome HTTP cache from serving stale authenticated responses
        this.app.set('etag', false);
        // Compression middleware
        this.app.use((0, _compression.default)());
        // Logging middleware
        if (_constants.NODE_ENV === 'development') {
            this.app.use((0, _morgan.default)('dev'));
        } else {
            this.app.use((0, _morgan.default)('combined'));
        }
        // Request timestamp
        this.app.use((req, res, next)=>{
            req.requestTime = new Date().toISOString();
            next();
        });
    }
    configureRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res)=>{
            res.status(200).json({
                success: true,
                status: 'OK',
                timestamp: new Date().toISOString(),
                environment: _constants.NODE_ENV,
                uptime: process.uptime()
            });
        });
        // API documentation - Root route for production
        this.app.get('/', (req, res)=>{
            // Check if client accepts HTML
            const acceptHeader = req.headers.accept || '';
            if (acceptHeader.includes('text/html')) {
                // Serve HTML documentation
                res.setHeader('Content-Type', 'text/html');
                res.send((0, _apidocstemplate.generateApiDocsHTML)(_apidocumentation.apiDocumentation));
            } else {
                // Serve JSON for API clients
                res.json({
                    success: true,
                    message: 'Fieldsy API',
                    version: '1.0.0',
                    documentation: 'Visit this URL in a browser for interactive documentation',
                    endpoints: {
                        auth: '/api/auth',
                        users: '/api/users',
                        fields: '/api/fields',
                        bookings: '/api/bookings',
                        reviews: '/api/reviews',
                        notifications: '/api/notifications',
                        payments: '/api/payments',
                        chat: '/api/chat'
                    }
                });
            }
        });
        // API documentation endpoint (also available at /api)
        this.app.get('/api', (req, res)=>{
            // Check if client accepts HTML
            const acceptHeader = req.headers.accept || '';
            if (acceptHeader.includes('text/html')) {
                // Serve HTML documentation
                res.setHeader('Content-Type', 'text/html');
                res.send((0, _apidocstemplate.generateApiDocsHTML)(_apidocumentation.apiDocumentation));
            } else {
                // Serve JSON for API clients
                res.json({
                    success: true,
                    message: 'Fieldsy API',
                    version: '1.0.0',
                    documentation: '/api (view in browser for interactive docs)',
                    endpoints: {
                        auth: '/api/auth',
                        users: '/api/users',
                        fields: '/api/fields',
                        bookings: '/api/bookings',
                        reviews: '/api/reviews',
                        notifications: '/api/notifications',
                        payments: '/api/payments',
                        chat: '/api/chat',
                        socketDocs: '/api/socket-docs'
                    }
                });
            }
        });
        // Socket Documentation for Mobile Developers
        //
        // This endpoint serves comprehensive Socket.IO documentation for mobile app development
        //
        // The guide includes:
        // • 5-minute Quick Start (install → import → connect → authenticate → listen)
        // • Complete Chat Implementation (join, send, receive, typing indicators, read receipts)
        // • All Notification Types (bookings, payments, reviews, system announcements)
        // • Reconnection Handling (for production reliability and offline scenarios)
        // • Full Working Example (copy-paste SocketService class)
        // • Troubleshooting Guide (common issues with step-by-step solutions)
        //
        // Each event documented with:
        // - WHY you need it
        // - WHEN to use it
        // - WHAT payload to send
        // - WHAT response you'll receive
        //
        // Perfect for mobile developers with no backend knowledge required!
        this.app.get('/api/socket-docs', (req, res)=>{
            const fs = require('fs');
            const path = require('path');
            const marked = require('marked');
            try {
                const mdPath = path.join(__dirname, '../MOBILE_SOCKET_API_GUIDE.md');
                const mdContent = fs.readFileSync(mdPath, 'utf-8');
                const htmlContent = marked.parse(mdContent);
                const styledHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Mobile Socket API Guide - Fieldsy</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown.min.css">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
      <style>
        /* Core Layout */
        body { font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif; background: linear-gradient(135deg,#667eea 0%,#764ba2 100%); padding:20px; min-height:100vh; }
        .container { max-width: 1200px; margin:0 auto; background:white; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.2); overflow:hidden; }
        .header { background: linear-gradient(135deg,#667eea 0%,#764ba2 100%); color:white; padding:30px; text-align:center; }
        .header h1 { font-size:2.5rem; margin-bottom:10px; }
        .nav-bar { background:#f7fafc; padding:15px 30px; border-bottom:1px solid #e2e8f0; display:flex; gap:15px; flex-wrap:wrap; }
        .nav-btn { padding:8px 16px; background:white; border:1px solid #e2e8f0; border-radius:6px; text-decoration:none; color:#2d3748; font-size:0.9rem; transition:all 0.2s; }
        .nav-btn:hover { background:#667eea; color:white; border-color:#667eea; }
        .content { padding:40px; }
        .markdown-body h1, .markdown-body h2 { border-bottom:2px solid #667eea; padding-bottom:10px; margin-top:30px; margin-bottom:20px; }
        .markdown-body h3 { color:#667eea; margin-top:25px; margin-bottom:15px; }
        .markdown-body pre { background:#2d3748; border-radius:8px; padding:20px; overflow-x:auto; position:relative; }
        .markdown-body pre code { color:#e2e8f0; background:transparent; }
        .copy-btn { position:absolute; top:10px; right:10px; padding:6px 12px; background:#4a5568; color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.8rem; opacity:0; transition:opacity 0.2s; }
        .markdown-body pre:hover .copy-btn { opacity:1; }
        .back-to-top { position:fixed; bottom:30px; right:30px; padding:12px 20px; background:#667eea; color:white; border:none; border-radius:50px; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.2); font-size:0.9rem; opacity:0; transition:opacity 0.3s; }
        .back-to-top.visible { opacity:1; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📱 Mobile Socket API Guide</h1>
          <p>Step-by-step implementation for Fieldsy mobile app</p>
        </div>
        <div class="nav-bar">
          <a href="/" class="nav-btn">← Back</a>
          <a href="/api" class="nav-btn">REST API Reference</a>
        </div>
        <div class="content">
          <div class="markdown-body">${htmlContent}</div>
        </div>
      </div>
      <button class="back-to-top" onclick="scrollToTop()">↑ Top</button>
      <script>
        document.addEventListener('DOMContentLoaded', () => {
          document.querySelectorAll('pre code').forEach(block => hljs.highlightBlock(block));
          document.querySelectorAll('pre').forEach(pre => {
            const btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.textContent = 'Copy';
            btn.onclick = () => {
              navigator.clipboard.writeText(pre.querySelector('code').textContent);
              btn.textContent = 'Copied!';
              setTimeout(() => btn.textContent = 'Copy', 2000);
            };
            pre.appendChild(btn);
          });
        });
        window.addEventListener('scroll', () => {
          const btn = document.querySelector('.back-to-top');
          if (window.pageYOffset > 300) btn.classList.add('visible');
          else btn.classList.remove('visible');
        });
        function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
      </script>
    </body>
    </html>`;
                res.setHeader('Content-Type', 'text/html');
                res.send(styledHTML);
            } catch (error) {
                console.error('Error serving socket docs:', error);
                res.status(500).json({
                    success: false,
                    message: 'Failed to load socket documentation',
                    error: error.message
                });
            }
        });
        // Stripe webhook route (must be before other routes due to raw body requirement)
        this.app.use('/api/stripe', _striperoutes.default);
        // Mount API routes with specific rate limiters
        // Auth routes - 5 requests per minute for login/register
        this.app.use('/api/auth', (0, _rateLimitermiddleware.bypassInDevelopment)(_rateLimitermiddleware.authLimiter), _authroutes.default);
        this.app.use('/api/auth/otp', (0, _rateLimitermiddleware.bypassInDevelopment)(_rateLimitermiddleware.authLimiter), _authotproutes.default);
        // User routes - general rate limit
        this.app.use('/api/users', _userroutes.default);
        // Fields routes - search endpoints get search limiter (30/min)
        this.app.use('/api/fields/search', (0, _rateLimitermiddleware.bypassInDevelopment)(_rateLimitermiddleware.searchLimiter));
        this.app.use('/api/fields', _fieldroutes.default);
        // Booking routes - 5 bookings per minute
        this.app.use('/api/bookings', (0, _rateLimitermiddleware.bypassInDevelopment)(_rateLimitermiddleware.bookingLimiter), _bookingroutes.default);
        // Review routes - 3 reviews per minute
        this.app.use('/api/reviews', (0, _rateLimitermiddleware.bypassInDevelopment)(_rateLimitermiddleware.reviewLimiter), _reviewroutes.default);
        // General routes with standard limits
        this.app.use('/api/notifications', _notificationroutes.default);
        // Payment routes - 5 payment attempts per minute
        this.app.use('/api/payments', (0, _rateLimitermiddleware.bypassInDevelopment)(_rateLimitermiddleware.paymentLimiter), _paymentroutes.default);
        // Alias for singular payment route to support existing Stripe config
        this.app.use('/api/payment', _paymentroutes.default);
        // General routes
        this.app.use('/api/favorites', _favoriteroutes.default);
        // Offer and discount routes
        this.app.use('/api/offers', _offerroutes.default);
        this.app.use('/api/discounts', _discountroutes.default);
        // Chat routes - 30 messages per minute
        this.app.use('/api/chat', (0, _rateLimitermiddleware.bypassInDevelopment)(_rateLimitermiddleware.messageLimiter), _chatroutes.default);
        // Payout and financial routes
        this.app.use('/api/payouts', _payoutroutes.default);
        this.app.use('/api/claims', _claimroutes.default);
        this.app.use('/api/stripe-connect', _stripeconnectroutes.default);
        // User interaction routes
        this.app.use('/api/user-reports', _userreportroutes.default);
        this.app.use('/api/user-blocks', _userblockroutes.default);
        this.app.use('/api/payment-methods', _paymentmethodroutes.default);
        // Admin routes - handled by dynamic limiter (200/min for admins)
        this.app.use('/api/admin', _adminroutes.default);
        this.app.use('/api/admin/payouts', _adminpayoutroutes.default);
        this.app.use('/api/auto-payouts', _autopayoutroutes.default);
        // Other routes
        this.app.use('/api/earnings', _earningsroutes.default);
        this.app.use('/api/commission', _commissionroutes.default);
        this.app.use('/api/settings', _settingsroutes.default);
        this.app.use('/api/faqs', _faqroutes.default);
        // Upload routes - 20 uploads per minute
        this.app.use('/api/upload', (0, _rateLimitermiddleware.bypassInDevelopment)(_rateLimitermiddleware.uploadLimiter), _uploadroutes.default);
        this.app.use('/api/about-page', _aboutpageroutes.default);
        this.app.use('/api/terms', _termsroutes.default);
        this.app.use('/api/privacy-policy', _privacypolicyroutes.default);
        // Amenities routes
        this.app.use('/api/amenities', _amenityroutes.default);
        // Field Options routes
        this.app.use('/api/field-properties', _fieldpropertiesroutes.default);
        // Contact Query routes
        this.app.use('/api/contact-queries', _contactqueryroutes.default);
        // Device Token routes (for push notifications)
        this.app.use('/api/device-tokens', _devicetokenroutes.default);
        // Client-side error reporting endpoint
        this.app.post('/api/error-report', (req, res)=>{
            const { message, stack, url, userAgent, userId, componentStack } = req.body;
            if (!message) return res.status(400).json({
                success: false
            });
            const error = new Error(message);
            error.stack = stack || componentStack || 'No stack trace from client';
            (0, _errornotifierservice.notifyError)(error, {
                type: 'API_ERROR',
                method: 'CLIENT',
                url: url || 'unknown',
                userId,
                statusCode: 500
            }).catch(()=>{});
            res.json({
                success: true
            });
        });
    // Serve static files (if any)
    // this.app.use('/uploads', express.static('uploads'));
    }
    configureSocketAndKafka() {
    // Socket.io is initialized in start() method via setupWebSocket
    // We'll get the io instance from there
    }
    configureErrorHandling() {
        // Handle 404 errors
        this.app.use((req, res, next)=>{
            console.log(`404 - Route not found: ${req.method} ${req.path}`);
            res.status(404).json({
                message: 'Route not found',
                path: req.path,
                method: req.method
            });
        });
        // Global error handler
        this.app.use((err, req, res, next)=>{
            console.error('Error caught:', err.message);
            console.error('Stack:', err.stack);
            const statusCode = err.statusCode || err.status || 500;
            const status = err.status || (statusCode >= 400 && statusCode < 500 ? 'fail' : 'error');
            // Email notification for server errors (5xx)
            if (statusCode >= 500) {
                (0, _errornotifierservice.notifyError)(err instanceof Error ? err : new Error(err.message), {
                    type: 'API_ERROR',
                    method: req.method,
                    url: req.originalUrl,
                    userId: req.user?.id,
                    body: req.body,
                    statusCode
                }).catch(()=>{});
            }
            // Prevent Chrome from caching error responses (especially 401s after logout)
            res.set({
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.removeHeader('ETag');
            res.status(statusCode).json({
                success: false,
                status,
                message: err.message || 'Internal Server Error',
                ...process.env.NODE_ENV === 'development' && {
                    stack: err.stack,
                    error: err
                }
            });
        });
    }
    start() {
        // Initialize Firebase for push notifications
        (0, _firebaseconfig.initializeFirebase)();
        // Setup WebSocket and get io instance
        const io = (0, _websocket.setupWebSocket)(this.httpServer);
        this.io = io;
        // Make io globally available for notifications and Kafka
        global.io = io;
        // Initialize Kafka with the io instance
        (0, _kafka.initializeKafka)(io).catch((error)=>{
            console.log('Kafka initialization skipped - messages will be handled directly through Socket.io');
        });
        // Initialize scheduled jobs
        if (_payoutservices.isPayoutEngineEnabled) {
            // Engine mode: payout jobs, held-payout release, and subscription retries handled by engine
            const engine = (0, _payoutservices.getPayoutEngine)();
            if (engine) engine.startScheduler(_nodecron.default);
        } else {
            // Built-in mode: original payout/held-payout jobs
            const { initPayoutJobs } = require('./jobs/payout.job');
            const { startHeldPayoutReleaseJobs } = require('./jobs/held-payout-release.job');
            initPayoutJobs();
            startHeldPayoutReleaseJobs();
        }
        (0, _recurringbookingjob.initRecurringBookingJobs)();
        (0, _bookingreminderjob.initBookingReminderJobs)();
        (0, _bookingstatusjob.initBookingStatusJob)();
        (0, _slotlockutils.startSlotLockCleanup)(); // Cleanup expired slot locks every 5 minutes
        (0, _slotcreditexpiryjob.startSlotCreditExpiryJob)(); // Expire slot credits past validity
        console.log('✅ Scheduled jobs initialized');
        // Enhanced error handling for port conflicts
        this.httpServer.on('error', (error)=>{
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${_constants.PORT} is already in use!`);
                console.log(`💡 Please try one of the following:`);
                console.log(`   1. Run: kill -9 $(lsof -ti:${_constants.PORT})`);
                console.log(`   2. Use a different port: PORT=5001 npm run dev`);
                console.log(`   3. Wait a moment for the port to be released`);
                process.exit(1);
            } else {
                console.error('Server error:', error);
                process.exit(1);
            }
        });
        this.httpServer.listen(_constants.PORT, ()=>{
            console.log(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║   🚀 Server is running successfully!               ║
║                                                    ║
║   Mode: ${_constants.NODE_ENV.padEnd(43)}║
║   Port: ${String(_constants.PORT).padEnd(43)}║
║   Time: ${new Date().toLocaleString('en-GB', {
                timeZone: 'Europe/London'
            }).padEnd(43)}║
║                                                    ║
║   API: http://localhost:${_constants.PORT}/api                ║
║   Health: http://localhost:${_constants.PORT}/health          ║
║   WebSocket: ws://localhost:${_constants.PORT}                ║
║                                                    ║
╚════════════════════════════════════════════════════╝
      `);
        });
        const server = this.httpServer;
        // Graceful shutdown
        process.on('SIGTERM', async ()=>{
            console.log('SIGTERM signal received: closing HTTP server');
            (0, _slotlockutils.stopSlotLockCleanup)(); // Stop slot lock cleanup job
            await (0, _kafka.shutdownKafka)();
            server.close(()=>{
                console.log('HTTP server closed');
                process.exit(0);
            });
        });
        process.on('SIGINT', async ()=>{
            console.log('SIGINT signal received: closing HTTP server');
            (0, _slotlockutils.stopSlotLockCleanup)(); // Stop slot lock cleanup job
            await (0, _kafka.shutdownKafka)();
            server.close(()=>{
                console.log('HTTP server closed');
                process.exit(0);
            });
        });
        // Handle uncaught exceptions
        process.on('uncaughtException', async (err)=>{
            console.error('UNCAUGHT EXCEPTION! 💥');
            console.error(err.name, err.message);
            console.error(err.stack);
            // Send email notification before shutting down
            try {
                await (0, _errornotifierservice.notifyError)(err, {
                    type: 'UNCAUGHT_EXCEPTION'
                });
            } catch (_) {}
            if (_constants.NODE_ENV === 'production') {
                console.error('Shutting down due to uncaught exception...');
                process.exit(1);
            } else {
                console.error('⚠️ Continuing despite uncaught exception (development mode)');
            }
        });
        process.on('unhandledRejection', async (err)=>{
            console.error('UNHANDLED REJECTION! 💥');
            console.error(err?.name, err?.message);
            console.error(err?.stack);
            // Send email notification
            try {
                await (0, _errornotifierservice.notifyError)(err instanceof Error ? err : new Error(String(err)), {
                    type: 'UNHANDLED_REJECTION'
                });
            } catch (_) {}
            if (_constants.NODE_ENV === 'production') {
                console.error('Shutting down due to unhandled rejection...');
                server.close(()=>{
                    process.exit(1);
                });
            } else {
                console.error('⚠️ Continuing despite unhandled rejection (development mode)');
            }
        });
    }
}
// Create and start server
const server = new Server();
server.start();
const _default = server;

//# sourceMappingURL=server.js.map