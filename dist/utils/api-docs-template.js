"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateApiDocsHTML = void 0;
//@ts-nocheck
const generateApiDocsHTML = (docs) => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${docs.title} - v${docs.version}</title>
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            background: white;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        h1 {
            color: #2d3748;
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        
        .subtitle {
            color: #718096;
            font-size: 1.1rem;
        }
        
        .version {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9rem;
            margin-left: 10px;
        }
        
        .base-url {
            background: #f7fafc;
            padding: 10px 15px;
            border-radius: 8px;
            margin-top: 15px;
            font-family: 'Courier New', monospace;
            color: #2b6cb0;
        }
        
        .nav-tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 30px;
            flex-wrap: wrap;
        }
        
        .nav-tab {
            background: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 500;
            transition: all 0.3s;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        
        .nav-tab:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .nav-tab.active {
            background: #667eea;
            color: white;
        }
        
        .section {
            display: none;
        }
        
        .section.active {
            display: block;
        }
        
        .endpoint-card {
            background: white;
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.08);
        }
        
        .method {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 0.85rem;
            margin-right: 10px;
        }
        
        .method.GET { background: #48bb78; color: white; }
        .method.POST { background: #4299e1; color: white; }
        .method.PUT { background: #ed8936; color: white; }
        .method.DELETE { background: #f56565; color: white; }
        .method.PATCH { background: #9f7aea; color: white; }
        
        .path {
            font-family: 'Courier New', monospace;
            font-size: 1.1rem;
            color: #2d3748;
            font-weight: 600;
        }
        
        .description {
            color: #718096;
            margin: 10px 0;
        }
        
        .code-block {
            background: #2d3748;
            color: #e2e8f0;
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
            overflow-x: auto;
            position: relative;
        }
        
        .code-block pre {
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .copy-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            background: #4a5568;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
        }
        
        .copy-btn:hover {
            background: #2b6cb0;
        }
        
        h3 {
            color: #2d3748;
            margin: 20px 0 10px 0;
            font-size: 1.2rem;
        }
        
        h4 {
            color: #4a5568;
            margin: 15px 0 8px 0;
            font-size: 1rem;
        }
        
        .params-table {
            width: 100%;
            margin: 10px 0;
            border-collapse: collapse;
        }
        
        .params-table th,
        .params-table td {
            text-align: left;
            padding: 10px;
            border: 1px solid #e2e8f0;
        }
        
        .params-table th {
            background: #f7fafc;
            font-weight: 600;
            color: #2d3748;
        }
        
        .params-table td {
            background: white;
        }
        
        .params-table code {
            background: #edf2f7;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.85rem;
        }
        
        .response-tabs {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        
        .response-tab {
            padding: 8px 16px;
            background: #edf2f7;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.2s;
        }
        
        .response-tab.success {
            background: #c6f6d5;
            color: #22543d;
        }
        
        .response-tab.error {
            background: #fed7d7;
            color: #742a2a;
        }
        
        .info-card {
            background: #bee3f8;
            border-left: 4px solid #2b6cb0;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }
        
        .warning-card {
            background: #feebc8;
            border-left: 4px solid #c05621;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            h1 {
                font-size: 1.8rem;
            }
            
            .nav-tabs {
                flex-direction: column;
            }
            
            .nav-tab {
                width: 100%;
            }
        }
        
        .search-box {
            width: 100%;
            padding: 12px;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            font-size: 1rem;
            margin-bottom: 20px;
        }
        
        .search-box:focus {
            outline: none;
            border-color: #667eea;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>${docs.title} <span class="version">v${docs.version}</span></h1>
            <p class="subtitle">${docs.description}</p>
            <div class="base-url">Base URL: ${docs.baseUrl}</div>
        </header>
        
        <input type="text" class="search-box" placeholder="Search endpoints..." id="searchBox" onkeyup="searchEndpoints()">
        
        <div class="nav-tabs">
            <button class="nav-tab active" onclick="showSection('overview')">Overview</button>
            ${(docs.categories || docs.sections || []).map((section) => `<button class="nav-tab" onclick="showSection('${section.name.toLowerCase().replace(/\s+/g, '-')}')">${section.name}</button>`).join('')}
        </div>
        
        <!-- Overview Section -->
        <div id="overview" class="section active">
            <div class="endpoint-card">
                <h2>🚀 Getting Started</h2>
                <p style="margin-top: 15px;">Welcome to the Fieldsy API! This REST API provides programmatic access to the Fieldsy platform.</p>
                
                <h3>Authentication</h3>
                <p>${docs.authentication.description}</p>
                <div class="code-block">
                    <button class="copy-btn" onclick="copyToClipboard('${docs.authentication.format}')">Copy</button>
                    <pre>${docs.authentication.format}</pre>
                </div>
                
                <h3>Rate Limiting</h3>
                <p>${docs.rateLimiting ? docs.rateLimiting.description : (docs.rateLimit ? docs.rateLimit.description : 'API rate limiting is enforced')}</p>
                <ul style="margin-left: 20px; margin-top: 10px;">
                    <li>Development: ${docs.rateLimiting ? docs.rateLimiting.limits.development : (docs.rateLimit ? docs.rateLimit.limits.development : '10000 requests per 15 minutes')}</li>
                    <li>Production: ${docs.rateLimiting ? docs.rateLimiting.limits.production : (docs.rateLimit ? docs.rateLimit.limits.production : '100 requests per 15 minutes')}</li>
                </ul>
                
                <h3>Error Codes</h3>
                <table class="params-table">
                    <thead>
                        <tr>
                            <th>Code</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(docs.errorCodes).map(([code, desc]) => `
                            <tr>
                                <td><code>${code}</code></td>
                                <td>${desc}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <h3>WebSocket Events</h3>
                <p>Connect to: <code>${docs.websocket.endpoint}</code></p>
                <table class="params-table">
                    <thead>
                        <tr>
                            <th>Event</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(docs.websocket.events).map(([event, desc]) => `
                            <tr>
                                <td><code>${event}</code></td>
                                <td>${desc}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        
        <!-- API Sections -->
        ${(docs.categories || docs.sections || []).map((section) => `
            <div id="${section.name.toLowerCase().replace(/\s+/g, '-')}" class="section">
                <div class="endpoint-card">
                    <h2>${section.name}</h2>
                    <p style="margin-top: 10px; color: #718096;">${section.description}</p>
                </div>
                
                ${(section.endpoints || []).map((endpoint) => `
                    <div class="endpoint-card searchable-endpoint">
                        <div style="display: flex; align-items: center; margin-bottom: 10px;">
                            <span class="method ${endpoint.method}">${endpoint.method}</span>
                            <span class="path">${endpoint.path}</span>
                        </div>
                        <p class="description">${endpoint.description}</p>
                        
                        ${endpoint.authentication === false ? `
                            <p style="color: #38a169; font-size: 0.9rem; margin-top: 5px;">🔓 No authentication required</p>
                        ` : ''}
                        
                        ${endpoint.authorization ? `
                            <p style="color: #e53e3e; font-size: 0.9rem; margin-top: 5px;">🔒 Requires: ${endpoint.authorization}</p>
                        ` : ''}
                        
                        ${endpoint.headers ? `
                            <h4>Headers</h4>
                            <div class="code-block">
                                <button class="copy-btn" onclick='copyToClipboard(${JSON.stringify(JSON.stringify(endpoint.headers, null, 2))})'>Copy</button>
                                <pre>${JSON.stringify(endpoint.headers, null, 2)}</pre>
                            </div>
                        ` : ''}
                        
                        ${endpoint.queryParams ? `
                            <h4>Query Parameters</h4>
                            <div class="code-block">
                                <button class="copy-btn" onclick='copyToClipboard(${JSON.stringify(JSON.stringify(endpoint.queryParams, null, 2))})'>Copy</button>
                                <pre>${JSON.stringify(endpoint.queryParams, null, 2)}</pre>
                            </div>
                        ` : ''}
                        
                        ${endpoint.requestBody ? `
                            <h4>Request Body</h4>
                            <div class="code-block">
                                <button class="copy-btn" onclick='copyToClipboard(${JSON.stringify(JSON.stringify(endpoint.requestBody, null, 2))})'>Copy</button>
                                <pre>${JSON.stringify(endpoint.requestBody, null, 2)}</pre>
                            </div>
                        ` : ''}
                        
                        ${endpoint.responses && endpoint.responses.success ? `
                            <h4>✅ Success Response (${endpoint.responses.success.status})</h4>
                            <div class="code-block">
                                <button class="copy-btn" onclick='copyToClipboard(${JSON.stringify(JSON.stringify(endpoint.responses.success.body, null, 2))})'>Copy</button>
                                <pre>${JSON.stringify(endpoint.responses.success.body, null, 2)}</pre>
                            </div>
                        ` : endpoint.successResponse ? `
                            <h4>✅ Success Response (${endpoint.successResponse.status})</h4>
                            <div class="code-block">
                                <button class="copy-btn" onclick='copyToClipboard(${JSON.stringify(JSON.stringify(endpoint.successResponse.body, null, 2))})'>Copy</button>
                                <pre>${JSON.stringify(endpoint.successResponse.body, null, 2)}</pre>
                            </div>
                        ` : ''}
                        
                        ${endpoint.responses && endpoint.responses.error ? `
                            <h4>❌ Error Response (${endpoint.responses.error.status})</h4>
                            <div class="code-block">
                                <button class="copy-btn" onclick='copyToClipboard(${JSON.stringify(JSON.stringify(endpoint.responses.error.body, null, 2))})'>Copy</button>
                                <pre>${JSON.stringify(endpoint.responses.error.body, null, 2)}</pre>
                            </div>
                        ` : endpoint.errorResponse ? `
                            <h4>❌ Error Response (${endpoint.errorResponse.status})</h4>
                            <div class="code-block">
                                <button class="copy-btn" onclick='copyToClipboard(${JSON.stringify(JSON.stringify(endpoint.errorResponse.body, null, 2))})'>Copy</button>
                                <pre>${JSON.stringify(endpoint.errorResponse.body, null, 2)}</pre>
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `).join('')}
    </div>
    
    <script>
        function showSection(sectionName) {
            // Hide all sections
            document.querySelectorAll('.section').forEach(section => {
                section.classList.remove('active');
            });
            
            // Remove active class from all tabs
            document.querySelectorAll('.nav-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Show selected section
            const section = document.getElementById(sectionName);
            if (section) {
                section.classList.add('active');
            }
            
            // Mark tab as active
            event.target.classList.add('active');
        }
        
        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            });
        }
        
        function searchEndpoints() {
            const searchTerm = document.getElementById('searchBox').value.toLowerCase();
            const endpoints = document.querySelectorAll('.searchable-endpoint');
            
            endpoints.forEach(endpoint => {
                const text = endpoint.textContent.toLowerCase();
                if (text.includes(searchTerm)) {
                    endpoint.style.display = 'block';
                } else {
                    endpoint.style.display = 'none';
                }
            });
        }
    </script>
</body>
</html>
  `;
};
exports.generateApiDocsHTML = generateApiDocsHTML;
