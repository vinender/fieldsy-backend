//@ts-nocheck
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  bookingLimiter,
  paymentLimiter,
  searchLimiter,
  messageLimiter,
  reviewLimiter,
  bypassInDevelopment,
  dynamicLimiter
} from './middleware/rateLimiter.middleware';
import mongoSanitize from 'express-mongo-sanitize';
import { createServer } from 'http';
import { setupWebSocket } from './utils/websocket';
import { initializeKafka, shutdownKafka } from './config/kafka';

// Load environment variables
dotenv.config();

// Import configuration
import { PORT, NODE_ENV, FRONTEND_URL } from './config/constants';
import './config/database'; // Initialize database connection

// Import routes
import authRoutes from './routes/auth.routes';
import authOtpRoutes from './routes/auth.otp.routes';
import userRoutes from './routes/user.routes';
import fieldRoutes from './routes/field.routes';
import bookingRoutes from './routes/booking.routes';
import reviewRoutes from './routes/review.routes';
import notificationRoutes from './routes/notification.routes';
import paymentRoutes from './routes/payment.routes';
import stripeRoutes from './routes/stripe.routes';
import favoriteRoutes from './routes/favorite.routes';
import chatRoutes from './routes/chat.routes';
import payoutRoutes from './routes/payout.routes';
import claimRoutes from './routes/claim.routes';
import stripeConnectRoutes from './routes/stripe-connect.routes';
import userReportRoutes from './routes/user-report.routes';
import userBlockRoutes from './routes/user-block.routes';
import paymentMethodRoutes from './routes/payment-method.routes';
import adminRoutes from './routes/admin.routes';
import adminPayoutRoutes from './routes/admin-payout.routes';
import autoPayoutRoutes from './routes/auto-payout.routes';
import earningsRoutes from './routes/earnings.routes';
import commissionRoutes from './routes/commission.routes';
import settingsRoutes from './routes/settings.routes';
import faqRoutes from './routes/faq.routes';
import uploadRoutes from './routes/upload.routes';
import aboutPageRoutes from './routes/about-page.routes';
import amenityRoutes from './routes/amenity.routes';
import fieldPropertiesRoutes from './routes/field-properties.routes';
import contactQueryRoutes from './routes/contact-query.routes';
import deviceTokenRoutes from './routes/device-token.routes';

// Import Firebase for push notifications
import { initializeFirebase } from './config/firebase.config';

// Import middleware
import { errorHandler, notFound } from './middleware/error.middleware';

// Import API documentation
import { apiDocumentation } from './utils/api-documentation';
import { generateApiDocsHTML } from './utils/api-docs-template';

// Import scheduled jobs
import { initPayoutJobs } from './jobs/payout.job';
import { startHeldPayoutReleaseJobs } from './jobs/held-payout-release.job';
import { initRecurringBookingJobs } from './jobs/recurring-booking.job';
import { initBookingReminderJobs } from './jobs/booking-reminder.job';
import { initBookingStatusJob } from './jobs/booking-status.job';
import { startSlotLockCleanup, stopSlotLockCleanup } from './utils/slot-lock.utils';


class Server {
  private app: Application;
  private httpServer: any;
  private io: any;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.configureMiddleware();
    this.configureRoutes();
    this.configureErrorHandling();
    this.configureSocketAndKafka();
  }

  private configureMiddleware(): void {
    // Trust proxy - Required for rate limiting behind nginx/reverse proxy
    this.app.set('trust proxy', 1);

    // CORS configuration - MUST come before other middleware
    // ALLOW ALL ORIGINS WITH CREDENTIALS SUPPORT
    console.log('[REST API] CORS: Allowing all origins with credentials support');

    this.app.use(cors({
      // CRITICAL: Cannot use origin: '*' with credentials: true
      // Solution: Dynamically reflect the requesting origin
      origin: (origin, callback) => {
        // Always allow requests (reflect the origin back)
        // This allows credentials while accepting all origins
        callback(null, origin || true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires'],
      optionsSuccessStatus: 200,
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
    this.app.use(helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: false,
    }));

    // Apply general rate limiter to all API routes (60 requests per minute)
    // Bypass in development for localhost
    this.app.use('/api', bypassInDevelopment(generalLimiter));

    // Apply dynamic rate limiting based on user role
    this.app.use('/api', dynamicLimiter);

    // Data sanitization against NoSQL query injection
    this.app.use(mongoSanitize());

    // =========================================================================
    // STRIPE WEBHOOK ENDPOINTS
    // =========================================================================
    // IMPORTANT: These must be registered BEFORE express.json() middleware
    // Raw body is required for Stripe signature verification
    // =========================================================================

    const paymentController = new (require('./controllers/payment.controller').PaymentController)();
    const { webhookController } = require('./controllers/webhook.controller');

    // Legacy webhook endpoints (backward compatible - handles all events)
    this.app.post(
      '/api/payment/webhook',
      express.raw({ type: 'application/json' }),
      paymentController.handleWebhook
    );
    this.app.post(
      '/api/payments/webhook',
      express.raw({ type: 'application/json' }),
      paymentController.handleWebhook
    );

    // =========================================================================
    // DEDICATED WEBHOOK ENDPOINTS (Recommended for production)
    // =========================================================================

    /**
     * 1. PAYMENTS WEBHOOK - Platform Payment Events
     * URL: /api/webhooks/payments
     * Listen to: "Events on your account"
     * Secret: STRIPE_WEBHOOK_SECRET
     *
     * Events to enable:
     * - payment_intent.created
     * - payment_intent.succeeded
     * - payment_intent.payment_failed
     * - payment_intent.canceled
     * - payment_intent.processing
     * - charge.succeeded
     * - charge.failed
     * - charge.updated
     * - charge.captured
     */
    this.app.post(
      '/api/webhooks/payments',
      express.raw({ type: 'application/json' }),
      webhookController.handlePaymentWebhook.bind(webhookController)
    );

    /**
     * 2. CONNECT ACCOUNTS WEBHOOK - Field Owner Account Onboarding
     * URL: /api/webhooks/connect
     * Listen to: "Events on Connected accounts"
     * Secret: STRIPE_CONNECT_WEBHOOK_SECRET
     *
     * Events to enable:
     * - account.updated
     * - account.application.authorized
     * - account.application.deauthorized
     * - account.external_account.created
     * - account.external_account.updated
     * - account.external_account.deleted
     * - capability.updated
     * - person.created
     * - person.updated
     * - person.deleted
     */
    this.app.post(
      '/api/webhooks/connect',
      express.raw({ type: 'application/json' }),
      webhookController.handleConnectWebhook.bind(webhookController)
    );

    /**
     * 3. PAYOUTS WEBHOOK - Field Owner Payout Events
     * URL: /api/webhooks/payouts
     * Listen to: "Events on Connected accounts"
     * Secret: STRIPE_PAYOUT_WEBHOOK_SECRET
     *
     * Events to enable:
     * - payout.created
     * - payout.updated
     * - payout.paid
     * - payout.failed
     * - payout.canceled
     * - payout.reconciliation_completed
     * - transfer.created
     * - transfer.updated
     * - transfer.reversed
     * - balance.available
     */
    this.app.post(
      '/api/webhooks/payouts',
      express.raw({ type: 'application/json' }),
      webhookController.handlePayoutWebhook.bind(webhookController)
    );

    /**
     * 4. REFUNDS WEBHOOK - Customer Refund Events
     * URL: /api/webhooks/refunds
     * Listen to: "Events on your account"
     * Secret: STRIPE_REFUND_WEBHOOK_SECRET
     *
     * Events to enable:
     * - charge.refunded
     * - charge.refund.updated
     * - refund.created
     * - refund.updated
     * - refund.failed
     */
    this.app.post(
      '/api/webhooks/refunds',
      express.raw({ type: 'application/json' }),
      webhookController.handleRefundWebhook.bind(webhookController)
    );

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(cookieParser());

    // Compression middleware
    this.app.use(compression());

    // Logging middleware
    if (NODE_ENV === 'development') {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined'));
    }

    // Request timestamp
    this.app.use((req, res, next) => {
      req.requestTime = new Date().toISOString();
      next();
    });
  }

  private configureRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        uptime: process.uptime(),
      });
    });

    // API documentation - Root route for production
    this.app.get('/', (req, res) => {
      // Check if client accepts HTML
      const acceptHeader = req.headers.accept || '';

      if (acceptHeader.includes('text/html')) {
        // Serve HTML documentation
        res.setHeader('Content-Type', 'text/html');
        res.send(generateApiDocsHTML(apiDocumentation));
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
            chat: '/api/chat',
          },
        });
      }
    });

    // API documentation endpoint (also available at /api)
    this.app.get('/api', (req, res) => {
      // Check if client accepts HTML
      const acceptHeader = req.headers.accept || '';

      if (acceptHeader.includes('text/html')) {
        // Serve HTML documentation
        res.setHeader('Content-Type', 'text/html');
        res.send(generateApiDocsHTML(apiDocumentation));
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
          },
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
    this.app.get('/api/socket-docs', (req, res) => {
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
    this.app.use('/api/stripe', stripeRoutes);

    // Mount API routes with specific rate limiters
    // Auth routes - 5 requests per minute for login/register
    this.app.use('/api/auth', bypassInDevelopment(authLimiter), authRoutes);
    this.app.use('/api/auth/otp', bypassInDevelopment(authLimiter), authOtpRoutes);

    // User routes - general rate limit
    this.app.use('/api/users', userRoutes);

    // Fields routes - search endpoints get search limiter (30/min)
    this.app.use('/api/fields/search', bypassInDevelopment(searchLimiter));
    this.app.use('/api/fields', fieldRoutes);

    // Booking routes - 5 bookings per minute
    this.app.use('/api/bookings', bypassInDevelopment(bookingLimiter), bookingRoutes);

    // Review routes - 3 reviews per minute
    this.app.use('/api/reviews', bypassInDevelopment(reviewLimiter), reviewRoutes);

    // General routes with standard limits
    this.app.use('/api/notifications', notificationRoutes);

    // Payment routes - 5 payment attempts per minute
    this.app.use('/api/payments', bypassInDevelopment(paymentLimiter), paymentRoutes);
    // Alias for singular payment route to support existing Stripe config
    this.app.use('/api/payment', paymentRoutes);

    // General routes
    this.app.use('/api/favorites', favoriteRoutes);

    // Chat routes - 30 messages per minute
    this.app.use('/api/chat', bypassInDevelopment(messageLimiter), chatRoutes);

    // Payout and financial routes
    this.app.use('/api/payouts', payoutRoutes);
    this.app.use('/api/claims', claimRoutes);
    this.app.use('/api/stripe-connect', stripeConnectRoutes);

    // User interaction routes
    this.app.use('/api/user-reports', userReportRoutes);
    this.app.use('/api/user-blocks', userBlockRoutes);
    this.app.use('/api/payment-methods', paymentMethodRoutes);

    // Admin routes - handled by dynamic limiter (200/min for admins)
    this.app.use('/api/admin', adminRoutes);
    this.app.use('/api/admin/payouts', adminPayoutRoutes);
    this.app.use('/api/auto-payouts', autoPayoutRoutes);

    // Other routes
    this.app.use('/api/earnings', earningsRoutes);
    this.app.use('/api/commission', commissionRoutes);
    this.app.use('/api/settings', settingsRoutes);
    this.app.use('/api/faqs', faqRoutes);

    // Upload routes - 20 uploads per minute
    this.app.use('/api/upload', bypassInDevelopment(uploadLimiter), uploadRoutes);

    this.app.use('/api/about-page', aboutPageRoutes);

    // Amenities routes
    this.app.use('/api/amenities', amenityRoutes);

    // Field Options routes
    this.app.use('/api/field-properties', fieldPropertiesRoutes);

    // Contact Query routes
    this.app.use('/api/contact-queries', contactQueryRoutes);

    // Device Token routes (for push notifications)
    this.app.use('/api/device-tokens', deviceTokenRoutes);

    // Serve static files (if any)
    // this.app.use('/uploads', express.static('uploads'));
  }

  private configureSocketAndKafka(): void {
    // Socket.io is initialized in start() method via setupWebSocket
    // We'll get the io instance from there
  }

  private configureErrorHandling(): void {
    // Handle 404 errors
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`404 - Route not found: ${req.method} ${req.path}`);
      res.status(404).json({
        message: 'Route not found',
        path: req.path,
        method: req.method,
      });
    });

    // Global error handler
    this.app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      console.error('Error caught:', err.message);
      console.error('Stack:', err.stack);

      const statusCode = err.statusCode || err.status || 500;
      const status = err.status || (statusCode >= 400 && statusCode < 500 ? 'fail' : 'error');

      res.status(statusCode).json({
        success: false,
        status,
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && {
          stack: err.stack,
          error: err
        }),
      });
    });
  }

  public start(): void {
    // Initialize Firebase for push notifications
    initializeFirebase();

    // Setup WebSocket and get io instance
    const io = setupWebSocket(this.httpServer);
    this.io = io;

    // Make io globally available for notifications and Kafka
    (global as any).io = io;

    // Initialize Kafka with the io instance
    initializeKafka(io).catch(error => {
      console.log('Kafka initialization skipped - messages will be handled directly through Socket.io');
    });



    // Initialize scheduled jobs
    initPayoutJobs();
    startHeldPayoutReleaseJobs();
    initRecurringBookingJobs();
    initBookingReminderJobs();
    initBookingStatusJob();
    startSlotLockCleanup(); // Cleanup expired slot locks every 5 minutes
    console.log('✅ Scheduled jobs initialized');

    // Enhanced error handling for port conflicts
    this.httpServer.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use!`);
        console.log(`💡 Please try one of the following:`);
        console.log(`   1. Run: kill -9 $(lsof -ti:${PORT})`);
        console.log(`   2. Use a different port: PORT=5001 npm run dev`);
        console.log(`   3. Wait a moment for the port to be released`);
        process.exit(1);
      } else {
        console.error('Server error:', error);
        process.exit(1);
      }
    });

    this.httpServer.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║   🚀 Server is running successfully!               ║
║                                                    ║
║   Mode: ${NODE_ENV.padEnd(43)}║
║   Port: ${String(PORT).padEnd(43)}║
║   Time: ${new Date().toLocaleString().padEnd(43)}║
║                                                    ║
║   API: http://localhost:${PORT}/api                ║
║   Health: http://localhost:${PORT}/health          ║
║   WebSocket: ws://localhost:${PORT}                ║
║                                                    ║
╚════════════════════════════════════════════════════╝
      `);
    });

    const server = this.httpServer;

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM signal received: closing HTTP server');
      stopSlotLockCleanup(); // Stop slot lock cleanup job
      await shutdownKafka();
      server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT signal received: closing HTTP server');
      stopSlotLockCleanup(); // Stop slot lock cleanup job
      await shutdownKafka();
      server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      console.error('UNCAUGHT EXCEPTION! 💥');
      console.error(err.name, err.message);
      console.error(err.stack);

      // In production, exit to allow process manager to restart
      // In development, log and continue to avoid disruption
      if (NODE_ENV === 'production') {
        console.error('Shutting down due to uncaught exception...');
        process.exit(1);
      } else {
        console.error('⚠️ Continuing despite uncaught exception (development mode)');
      }
    });

    process.on('unhandledRejection', (err: any) => {
      console.error('UNHANDLED REJECTION! 💥');
      console.error(err?.name, err?.message);
      console.error(err?.stack);

      // In production, exit to allow process manager to restart
      // In development, log and continue to avoid disruption
      if (NODE_ENV === 'production') {
        console.error('Shutting down due to unhandled rejection...');
        server.close(() => {
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

// Export app for testing
export default server;
