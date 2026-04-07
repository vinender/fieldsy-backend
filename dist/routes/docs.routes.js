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
const _express = require("express");
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _marked = require("marked");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// Serve Socket.IO documentation
router.get('/socket-docs', (req, res)=>{
    try {
        // Read the markdown file
        const markdownPath = _path.default.join(process.cwd(), '..', 'NOTIFICATION_SOCKET_INTEGRATION_GUIDE.md');
        const markdownContent = _fs.default.readFileSync(markdownPath, 'utf-8');
        // Convert markdown to HTML
        const htmlContent = (0, _marked.marked)(markdownContent);
        // Create a styled HTML page
        const htmlPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fieldsy - Socket.IO & Notification Integration Guide</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        .header-content {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 2rem;
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
        }

        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }

        .content {
            background: white;
            padding: 3rem;
            border-radius: 8px;
            box-shadow: 0 2px 20px rgba(0,0,0,0.1);
        }

        h1, h2, h3, h4, h5, h6 {
            margin-top: 2rem;
            margin-bottom: 1rem;
            color: #2d3748;
        }

        h1 {
            font-size: 2.5rem;
            border-bottom: 3px solid #667eea;
            padding-bottom: 0.5rem;
        }

        h2 {
            font-size: 2rem;
            color: #667eea;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 0.5rem;
        }

        h3 {
            font-size: 1.5rem;
            color: #4a5568;
        }

        h4 {
            font-size: 1.25rem;
            color: #718096;
        }

        p {
            margin-bottom: 1rem;
            line-height: 1.8;
        }

        code {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 0.2rem 0.4rem;
            font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
            font-size: 0.9em;
            color: #d73a49;
        }

        pre {
            background: #1e293b;
            border-radius: 8px;
            padding: 1.5rem;
            overflow-x: auto;
            margin: 1.5rem 0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        }

        pre code {
            background: none;
            border: none;
            color: #e2e8f0;
            padding: 0;
            font-size: 0.95rem;
            line-height: 1.6;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin: 2rem 0;
            background: white;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            border-radius: 8px;
            overflow: hidden;
        }

        th {
            background: #667eea;
            color: white;
            padding: 1rem;
            text-align: left;
            font-weight: 600;
        }

        td {
            padding: 1rem;
            border-bottom: 1px solid #e2e8f0;
        }

        tr:hover {
            background: #f7fafc;
        }

        ul, ol {
            margin-left: 2rem;
            margin-bottom: 1rem;
        }

        li {
            margin-bottom: 0.5rem;
            line-height: 1.6;
        }

        a {
            color: #667eea;
            text-decoration: none;
            border-bottom: 1px solid transparent;
            transition: border-bottom 0.2s;
        }

        a:hover {
            border-bottom: 1px solid #667eea;
        }

        blockquote {
            border-left: 4px solid #667eea;
            background: #f7fafc;
            padding: 1rem 1.5rem;
            margin: 1.5rem 0;
            border-radius: 4px;
        }

        .badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            background: #10b981;
            color: white;
            border-radius: 12px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-left: 0.5rem;
        }

        .warning {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 4px;
        }

        .info {
            background: #dbeafe;
            border-left: 4px solid #3b82f6;
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 4px;
        }

        .success {
            background: #d1fae5;
            border-left: 4px solid #10b981;
            padding: 1rem;
            margin: 1rem 0;
            border-radius: 4px;
        }

        .toc {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }

        .toc h2 {
            margin-top: 0;
            font-size: 1.5rem;
            border: none;
        }

        .toc ul {
            margin-left: 1.5rem;
        }

        .footer {
            text-align: center;
            padding: 2rem;
            color: #718096;
            border-top: 1px solid #e2e8f0;
            margin-top: 3rem;
        }

        .endpoint-badge {
            background: #667eea;
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            display: inline-block;
            margin: 1rem 0;
            font-family: monospace;
            font-size: 0.95rem;
        }

        @media (max-width: 768px) {
            .header h1 {
                font-size: 1.75rem;
            }

            .content {
                padding: 1.5rem;
            }

            .container {
                padding: 1rem;
            }

            table {
                font-size: 0.9rem;
            }

            th, td {
                padding: 0.75rem 0.5rem;
            }
        }

        /* Syntax highlighting for code blocks */
        .hljs-keyword { color: #c792ea; }
        .hljs-string { color: #c3e88d; }
        .hljs-number { color: #f78c6c; }
        .hljs-comment { color: #676e95; font-style: italic; }
        .hljs-function { color: #82aaff; }
        .hljs-class { color: #ffcb6b; }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1>🚀 Fieldsy API Documentation</h1>
            <p>Socket.IO & Real-Time Notification Integration Guide for Mobile Developers</p>
            <div class="endpoint-badge">GET /api/docs/socket-docs</div>
        </div>
    </div>

    <div class="container">
        <div class="content">
            ${htmlContent}
        </div>

        <div class="footer">
            <p>Fieldsy API Documentation • Last Updated: ${new Date().toLocaleDateString('en-GB', {
            timeZone: 'Europe/London'
        })}</p>
            <p>For support, contact the backend team</p>
        </div>
    </div>

    <script>
        // Add smooth scrolling for anchor links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });

        // Add copy button to code blocks
        document.querySelectorAll('pre').forEach(block => {
            const button = document.createElement('button');
            button.textContent = 'Copy';
            button.style.cssText = 'position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;';

            block.style.position = 'relative';
            block.appendChild(button);

            button.addEventListener('click', () => {
                const code = block.querySelector('code').textContent;
                navigator.clipboard.writeText(code).then(() => {
                    button.textContent = 'Copied!';
                    setTimeout(() => button.textContent = 'Copy', 2000);
                });
            });
        });
    </script>
</body>
</html>
    `;
        res.setHeader('Content-Type', 'text/html');
        res.send(htmlPage);
    } catch (error) {
        console.error('Error serving documentation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load documentation',
            error: error.message
        });
    }
});
// API reference endpoint (JSON format)
router.get('/api-reference', (req, res)=>{
    const apiReference = {
        version: '1.0.0',
        baseUrl: process.env.API_URL || 'http://localhost:5000',
        socketUrl: process.env.SOCKET_URL || 'http://localhost:5000',
        authentication: {
            type: 'Bearer Token (JWT)',
            header: 'Authorization: Bearer <token>'
        },
        socketEvents: {
            client: {
                'fetch-notifications': {
                    description: 'Fetch notification history',
                    payload: {
                        page: 'number',
                        limit: 'number'
                    },
                    response: 'notifications-fetched'
                },
                'mark-notification-read': {
                    description: 'Mark a notification as read',
                    payload: {
                        notificationId: 'string'
                    },
                    response: 'notification-read'
                },
                'mark-all-notifications-read': {
                    description: 'Mark all notifications as read',
                    payload: null,
                    response: 'all-notifications-read'
                }
            },
            server: {
                notification: {
                    description: 'New notification received',
                    payload: {
                        id: 'string',
                        userId: 'string',
                        type: 'string',
                        title: 'string',
                        message: 'string',
                        data: 'object',
                        read: 'boolean',
                        createdAt: 'Date',
                        readAt: 'Date | null'
                    }
                },
                'notifications-fetched': {
                    description: 'Notification history response',
                    payload: {
                        notifications: 'Array<Notification>',
                        unreadCount: 'number',
                        pagination: 'object'
                    }
                },
                unreadCount: {
                    description: 'Unread notification count',
                    payload: 'number'
                }
            }
        },
        notificationTypes: {
            fieldOwner: [
                'field_submitted',
                'booking_received',
                'booking_cancelled',
                'payment_received',
                'payout_processed',
                'payout_failed',
                'review_received'
            ],
            dogOwner: [
                'booking_confirmed',
                'booking_reminder',
                'booking_completed',
                'booking_cancelled',
                'payment_successful',
                'payment_failed',
                'refund_processed',
                'message_received'
            ],
            admin: [
                'field_submitted',
                'field_claimed',
                'payout_requested',
                'user_reported',
                'review_flagged'
            ]
        }
    };
    res.json({
        success: true,
        data: apiReference
    });
});
const _default = router;

//# sourceMappingURL=docs.routes.js.map