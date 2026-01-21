//@ts-nocheck
import express from "express"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"
import compression from "compression"
import cookieParser from "cookie-parser"
import dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"

// Import API documentation
import { apiDocumentation } from "./utils/api-documentation"
import { generateApiDocsHTML } from "./utils/api-docs-template"

// Import routes
import authRoutes from "./routes/auth.routes"
import authOtpRoutes from "./routes/auth.otp.routes"
import userRoutes from "./routes/user.routes"
import fieldRoutes from "./routes/field.routes"
import bookingRoutes from "./routes/booking.routes"
import earningsRoutes from "./routes/earnings.routes"
import stripeConnectRoutes from "./routes/stripe-connect.routes"
import payoutRoutes from "./routes/payout.routes"
import paymentRoutes from "./routes/payment.routes"
import commissionRoutes from "./routes/commission.routes"
import adminRoutes from "./routes/admin.routes"
import chatRoutes from "./routes/chat.routes"
import amenityRoutes from "./routes/amenity.routes"
import fieldPropertiesRoutes from "./routes/field-properties.routes"
import contactQueryRoutes from "./routes/contact-query.routes"
import docsRoutes from "./routes/docs.routes"
import faqRoutes from "./routes/faq.routes"
import settingsRoutes from "./routes/settings.routes"
import termsRoutes from "./routes/terms.routes"
import aboutPageRoutes from "./routes/about-page.routes"
// Note: Slot lock cleanup is initialized in server.ts (the main entry point)
// Load environment variables


dotenv.config();

// Initialize Express app
const app = express()
const PORT = process.env.PORT || 5000

// Initialize Prisma
export const prisma = new PrismaClient()

// Middleware
app.set('trust proxy', 1);
app.use(helmet());

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    // List of allowed origins
    const allowedOrigins = [
      process.env.FRONTEND_URL || "http://localhost:3000", // Frontend development
      "http://localhost:3001", // Frontend alternate port
      "http://localhost:3002", // Frontend alternate port
      "http://localhost:3003", // Admin dashboard development
      "http://localhost:8081", // Expo web
      "http://localhost:19006", // Expo web alternate port
      "exp://localhost:8081", // Expo development
      // Production domains - fieldsy.co.uk
      "https://fieldsy.co.uk",
      "https://www.fieldsy.co.uk",
      "https://admin.fieldsy.co.uk",
      "https://api.fieldsy.co.uk",
      "http://fieldsy.co.uk",
      "http://www.fieldsy.co.uk",
      "http://admin.fieldsy.co.uk",
      "http://api.fieldsy.co.uk",
      // Legacy production domains - indiitserver.in
      "https://fieldsy.indiitserver.in", // Production frontend
      "https://fieldsy-admin.indiitserver.in", // Production admin
      "https://fieldsy-api.indiitserver.in", // Production API (for self-referential calls)
      "http://fieldsy.indiitserver.in", // Allow HTTP as fallback
      "http://fieldsy-admin.indiitserver.in", // Allow HTTP as fallback
      "http://fieldsy-api.indiitserver.in", // Allow HTTP API as fallback
    ];

    // Check if the origin is in the allowed list or is a local development URL
    if (allowedOrigins.includes(origin) ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes('192.168.') || // Local network IPs for physical devices
      origin.includes('10.0.') // Local network IPs
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires'],
}))


app.use(compression());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());



// API Documentation - Root route for production
app.get("/", (req, res) => {
  const acceptHeader = req.headers.accept || '';

  if (acceptHeader.includes('text/html')) {
    // Serve HTML documentation for browsers
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


// API Documentation - Also available at /api
app.get("/api", (req, res) => {
  const acceptHeader = req.headers.accept || '';

  if (acceptHeader.includes('text/html')) {
    // Serve HTML documentation for browsers
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
        socketDocs: '/api/socket-docs'
      },
    });
  }
});

// Socket Documentation for Mobile Developers
app.get("/api/socket-docs", (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const marked = require('marked');

  try {
    // Read the markdown file
    const mdPath = path.join(__dirname, '../../MOBILE_SOCKET_API_GUIDE.md');
    const mdContent = fs.readFileSync(mdPath, 'utf-8');

    // Convert markdown to HTML
    const htmlContent = marked.parse(mdContent);

    // Wrap in a styled HTML template
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
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        .nav-bar {
            background: #f7fafc;
            padding: 15px 30px;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }
        .nav-btn {
            padding: 8px 16px;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            text-decoration: none;
            color: #2d3748;
            font-size: 0.9rem;
            transition: all 0.2s;
        }
        .nav-btn:hover {
            background: #667eea;
            color: white;
            border-color: #667eea;
        }
        .content {
            padding: 40px;
        }
        .markdown-body {
            font-size: 16px;
            line-height: 1.6;
        }
        .markdown-body h1,
        .markdown-body h2 {
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
            margin-top: 30px;
            margin-bottom: 20px;
        }
        .markdown-body h3 {
            color: #667eea;
            margin-top: 25px;
            margin-bottom: 15px;
        }
        .markdown-body pre {
            background: #2d3748;
            border-radius: 8px;
            padding: 20px;
            overflow-x: auto;
            position: relative;
        }
        .markdown-body code {
            background: #edf2f7;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.9em;
        }
        .markdown-body pre code {
            background: transparent;
            padding: 0;
            color: #e2e8f0;
        }
        .markdown-body table {
            border-collapse: collapse;
            width: 100%;
            margin: 20px 0;
        }
        .markdown-body table th,
        .markdown-body table td {
            border: 1px solid #e2e8f0;
            padding: 12px;
            text-align: left;
        }
        .markdown-body table th {
            background: #f7fafc;
            font-weight: 600;
            color: #2d3748;
        }
        .markdown-body blockquote {
            border-left: 4px solid #667eea;
            padding-left: 20px;
            color: #718096;
            margin: 20px 0;
        }
        .copy-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            padding: 6px 12px;
            background: #4a5568;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .markdown-body pre:hover .copy-btn {
            opacity: 1;
        }
        .copy-btn:hover {
            background: #2b6cb0;
        }
        .back-to-top {
            position: fixed;
            bottom: 30px;
            right: 30px;
            padding: 12px 20px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 50px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            font-size: 0.9rem;
            opacity: 0;
            transition: opacity 0.3s;
        }
        .back-to-top.visible {
            opacity: 1;
        }
        .back-to-top:hover {
            background: #764ba2;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0,0,0,0.3);
        }
        @media (max-width: 768px) {
            .header h1 { font-size: 1.8rem; }
            .content { padding: 20px; }
            .nav-bar { padding: 10px 15px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📱 Mobile Socket API Guide</h1>
            <p>Complete guide for implementing real-time features in Fieldsy mobile app</p>
        </div>
        <div class="nav-bar">
            <a href="/" class="nav-btn">← Back to API Docs</a>
            <a href="/api" class="nav-btn">REST API Reference</a>
        </div>
        <div class="content">
            <div class="markdown-body">
                ${htmlContent}
            </div>
        </div>
    </div>
    <button class="back-to-top" onclick="scrollToTop()">↑ Top</button>
    <script>
        document.addEventListener('DOMContentLoaded', (event) => {
            document.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightBlock(block);
            });
            document.querySelectorAll('pre').forEach((pre) => {
                const button = document.createElement('button');
                button.className = 'copy-btn';
                button.textContent = 'Copy';
                button.onclick = () => {
                    const code = pre.querySelector('code').textContent;
                    navigator.clipboard.writeText(code).then(() => {
                        button.textContent = 'Copied!';
                        setTimeout(() => { button.textContent = 'Copy'; }, 2000);
                    });
                };
                pre.appendChild(button);
            });
        });
        window.addEventListener('scroll', () => {
            const btn = document.querySelector('.back-to-top');
            if (window.pageYOffset > 300) { btn.classList.add('visible'); }
            else { btn.classList.remove('visible'); }
        });
        function scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    </script>
</body>
</html>
    `;

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

// Routes
app.use("/api/auth", authRoutes)
app.use("/api/auth-otp", authOtpRoutes)
app.use("/api/users", userRoutes)
app.use("/api/fields", fieldRoutes)
app.use("/api/bookings", bookingRoutes)
app.use("/api/earnings", earningsRoutes)
app.use("/api/stripe-connect", stripeConnectRoutes)
app.use("/api/payouts", payoutRoutes)
app.use("/api/payment", paymentRoutes)
app.use("/api/commission", commissionRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/amenities', amenityRoutes)
app.use('/api/field-properties', fieldPropertiesRoutes)
app.use('/api/contact-queries', contactQueryRoutes)
app.use('/api/docs', docsRoutes)
app.use('/api/faqs', faqRoutes)
app.use('/api/settings', settingsRoutes)
console.log('Registering terms routes...');
app.use('/api/terms', termsRoutes)
app.use('/api/about-page', aboutPageRoutes)


// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() })
})


// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack)

  const statusCode = err.statusCode || err.status || 500;
  const status = err.status || (statusCode >= 400 && statusCode < 500 ? 'fail' : 'error');

  res.status(statusCode).json({
    success: false,
    status,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && {
      stack: err.stack,
      error: err
    }),
  })
})


// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" })
})


// Start server
// Note: This file is NOT the main entry point. server.ts is the main entry point.
// If running this file directly (for testing), the server will start here.
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
  // Slot lock cleanup is handled in server.ts
})


// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM signal received: closing HTTP server")
  await prisma.$disconnect();
  process.exit(0);
})
