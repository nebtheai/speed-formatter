const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const prettier = require('prettier');
const fs = require('fs').promises;
const path = require('path');
const { body, validationResult } = require('express-validator');

// Import our models and middleware
const Database = require('./database/init');
const User = require('./models/User');
const ApiKey = require('./models/ApiKey');
const AuthMiddleware = require('./middleware/auth');
const createAuthRoutes = require('./routes/auth');
const createApiKeyRoutes = require('./routes/api-keys');

class SpeedFormatterServer {
    constructor() {
        this.app = express();
        this.PORT = process.env.PORT || 3001;
        this.db = null;
        this.userModel = null;
        this.apiKeyModel = null;
        this.authMiddleware = null;
    }

    async initialize() {
        try {
            console.log('🔧 Initializing Speed Formatter SaaS...');
            
            // Initialize database
            this.db = new Database();
            await this.db.connect();
            await this.db.initializeSchema();
            
            // Initialize models
            this.userModel = new User(this.db);
            this.apiKeyModel = new ApiKey(this.db);
            this.authMiddleware = new AuthMiddleware(this.userModel, this.apiKeyModel, this.db);
            
            // Make models available to routes
            this.app.locals.db = this.db;
            this.app.locals.User = this.userModel;
            this.app.locals.ApiKey = this.apiKeyModel;
            this.app.locals.AuthMiddleware = this.authMiddleware;
            
            console.log('✅ Database and models initialized');
            
            // Setup middleware and routes
            this.setupMiddleware();
            this.setupRoutes();
            this.setupErrorHandlers();
            
            console.log('✅ Server configuration complete');
        } catch (error) {
            console.error('❌ Failed to initialize server:', error);
            process.exit(1);
        }
    }

    setupMiddleware() {
        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", "data:", "https:"],
                },
            },
        }));

        // CORS configuration
        this.app.use(cors({
            origin: process.env.NODE_ENV === 'production' 
                ? ['https://yourapp.com', 'https://www.yourapp.com']
                : true,
            credentials: true
        }));

        // Body parsing middleware
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));

        // Request logging middleware
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });

        // Static files
        this.app.use('/static', express.static('static'));
    }

    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                service: 'speed-formatter-saas',
                version: '1.0.0',
                runtime: 'node.js',
                database: 'connected',
                timestamp: new Date().toISOString()
            });
        });

        // Authentication routes
        this.app.use('/auth', createAuthRoutes(this.userModel, this.authMiddleware));

        // API key management routes  
        this.app.use('/api-keys', createApiKeyRoutes(this.apiKeyModel, this.authMiddleware));

        // Public formatting endpoint (with optional authentication)
        this.app.post('/format', [
            this.authMiddleware.optionalAuth(),
            this.authMiddleware.createRateLimit({
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: (req) => {
                    if (req.user) {
                        // Authenticated users get higher limits
                        return req.user.plan === 'free' ? 50 : 200;
                    }
                    return 10; // Anonymous users get 10 requests per 15 minutes
                }
            }),
            this.authMiddleware.trackUsage(),
            body('code').notEmpty().withMessage('Code is required'),
            body('language').isIn(['javascript', 'typescript', 'json', 'css', 'html', 'markdown', 'rust'])
                .withMessage('Invalid language')
        ], async (req, res) => {
            await this.handleFormat(req, res);
        });

        // API-only formatting endpoint (requires API key)
        this.app.post('/api/v1/format', [
            this.authMiddleware.verifyApiKey(),
            this.authMiddleware.createRateLimit({
                windowMs: 1 * 60 * 1000, // 1 minute
                max: (req) => {
                    const limits = {
                        'free': 10,
                        'basic': 100,
                        'pro': 1000,
                        'team': 10000
                    };
                    return limits[req.user?.plan] || 10;
                }
            }),
            this.authMiddleware.trackUsage(),
            body('code').notEmpty().withMessage('Code is required'),
            body('language').isIn(['javascript', 'typescript', 'json', 'css', 'html', 'markdown', 'rust'])
                .withMessage('Invalid language')
        ], async (req, res) => {
            await this.handleFormat(req, res);
        });

        // Performance benchmark endpoint
        this.app.get('/benchmark', async (req, res) => {
            const sampleCode = `const messyCode={name:"test",value:123,items:[1,2,3,4,5],processItems:function(){return this.items.map(x=>x*2).filter(x=>x>4);}};`;
            
            const iterations = 100;
            const times = [];
            
            for (let i = 0; i < iterations; i++) {
                const start = Date.now();
                await this.formatWithPrettier(sampleCode, 'babel');
                times.push(Date.now() - start);
            }
            
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const minTime = Math.min(...times);
            const maxTime = Math.max(...times);
            
            res.json({
                iterations,
                average_time_ms: Math.round(avgTime * 100) / 100,
                min_time_ms: minTime,
                max_time_ms: maxTime,
                sample_code_length: sampleCode.length,
                throughput_chars_per_ms: Math.round(sampleCode.length / avgTime)
            });
        });

        // Admin endpoint
        this.app.get('/admin/stats', this.authMiddleware.verifyToken(), async (req, res) => {
            try {
                // Only allow admin users
                if (req.user.email !== 'admin@speedformatter.com') {
                    return res.status(403).json({
                        error: 'Access denied',
                        details: 'Admin access required'
                    });
                }

                const stats = await this.db.all(`
                    SELECT 
                        COUNT(DISTINCT u.id) as total_users,
                        COUNT(DISTINCT ak.id) as total_api_keys,
                        COUNT(ul.id) as total_requests,
                        AVG(ul.execution_time_ms) as avg_execution_time,
                        SUM(ul.input_length) as total_chars_processed
                    FROM users u
                    LEFT JOIN api_keys ak ON u.id = ak.user_id
                    LEFT JOIN usage_logs ul ON u.id = ul.user_id
                `);

                const dailyUsage = await this.db.all(`
                    SELECT 
                        DATE(created_at) as date,
                        COUNT(*) as requests,
                        COUNT(DISTINCT user_id) as active_users
                    FROM usage_logs 
                    WHERE DATE(created_at) >= DATE('now', '-30 days')
                    GROUP BY DATE(created_at)
                    ORDER BY date DESC
                `);

                res.json({
                    global_stats: stats[0],
                    daily_usage: dailyUsage
                });
            } catch (error) {
                console.error('Admin stats error:', error);
                res.status(500).json({
                    error: 'Failed to get admin stats',
                    details: 'Internal server error'
                });
            }
        });

        // Serve the main page
        this.app.get('/', async (req, res) => {
            try {
                const html = await fs.readFile(path.join(__dirname, 'static', 'index.html'), 'utf8');
                res.send(html);
            } catch (error) {
                res.status(500).send('Error loading interface');
            }
        });

        // Serve login page
        this.app.get('/login.html', async (req, res) => {
            try {
                const html = await fs.readFile(path.join(__dirname, 'static', 'login.html'), 'utf8');
                res.send(html);
            } catch (error) {
                res.status(500).send('Error loading login page');
            }
        });

        // Serve dashboard page
        this.app.get('/dashboard.html', async (req, res) => {
            try {
                const html = await fs.readFile(path.join(__dirname, 'static', 'dashboard.html'), 'utf8');
                res.send(html);
            } catch (error) {
                res.status(500).send('Error loading dashboard');
            }
        });
    }

    setupErrorHandlers() {
        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Not found',
                details: 'The requested endpoint does not exist'
            });
        });

        // Global error handler
        this.app.use((error, req, res, next) => {
            console.error('Global error:', error);
            res.status(500).json({
                error: 'Internal server error',
                details: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
            });
        });
    }

    async handleFormat(req, res) {
        const startTime = Date.now();
        
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { code, language } = req.body;
            
            // Check usage limits for authenticated users
            if (req.user) {
                const canUse = await this.userModel.checkUsageLimit(req.user.id);
                if (!canUse) {
                    return res.status(429).json({
                        error: 'Usage limit exceeded',
                        details: 'Monthly formatting limit reached. Please upgrade your plan.'
                    });
                }
            }
            
            console.log(`Formatting ${language} code with ${code.length} characters for ${req.user?.email || 'anonymous'}`);
            
            // Store formatting data for usage tracking
            req.formattingData = {
                language,
                input_length: code.length
            };
            
            let formatted_code;
            let formatter_used;
            
            switch (language.toLowerCase()) {
                case 'javascript':
                case 'js':
                    formatted_code = await this.formatWithPrettier(code, 'babel');
                    formatter_used = 'prettier (babel)';
                    break;
                    
                case 'typescript':
                case 'ts':
                    formatted_code = await this.formatWithPrettier(code, 'typescript');
                    formatter_used = 'prettier (typescript)';
                    break;
                    
                case 'json':
                    formatted_code = await this.formatWithPrettier(code, 'json');
                    formatter_used = 'prettier (json)';
                    break;
                    
                case 'css':
                    formatted_code = await this.formatWithPrettier(code, 'css');
                    formatter_used = 'prettier (css)';
                    break;
                    
                case 'html':
                    formatted_code = await this.formatWithPrettier(code, 'html');
                    formatter_used = 'prettier (html)';
                    break;
                    
                case 'markdown':
                case 'md':
                    formatted_code = await this.formatWithPrettier(code, 'markdown');
                    formatter_used = 'prettier (markdown)';
                    break;
                    
                case 'rust':
                    formatted_code = this.formatRustBasic(code);
                    formatter_used = 'basic rust formatter';
                    break;
                    
                default:
                    return res.status(400).json({
                        error: 'Unsupported language',
                        details: `Language '${language}' is not supported`
                    });
            }
            
            const execution_time_ms = Date.now() - startTime;
            
            console.log(`Successfully formatted in ${execution_time_ms}ms using ${formatter_used}`);
            
            res.json({
                formatted_code,
                execution_time_ms,
                formatter_used,
                status: 'success',
                input_length: code.length,
                output_length: formatted_code.length,
                user_plan: req.user?.plan || 'anonymous'
            });
            
        } catch (error) {
            const execution_time_ms = Date.now() - startTime;
            console.error('Formatting failed:', error.message);
            
            res.status(500).json({
                error: 'Formatting failed',
                details: error.message,
                execution_time_ms
            });
        }
    }

    async formatWithPrettier(code, parser) {
        try {
            return await prettier.format(code, {
                parser,
                semi: true,
                singleQuote: true,
                trailingComma: 'es5',
                tabWidth: 2,
                printWidth: 80
            });
        } catch (error) {
            throw new Error(`Prettier formatting failed: ${error.message}`);
        }
    }

    formatRustBasic(code) {
        return code
            .replace(/([=!<>+\-*\/])([^=])/g, '$1 $2')
            .replace(/([^=])([=!<>+\-*\/])/g, '$1 $2')
            .replace(/,([^\s])/g, ', $1')
            .replace(/\{([^\s])/g, '{ $1')
            .replace(/([^\s])\}/g, '$1 }')
            .replace(/\s+/g, ' ')
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .replace(/\{/g, ' {\n    ')
            .replace(/\}/g, '\n}')
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }

    async start() {
        await this.initialize();
        
        this.app.listen(this.PORT, '0.0.0.0', () => {
            console.log('🚀 Speed Formatter SaaS Production Server running!');
            console.log(`📊 Health check: http://localhost:${this.PORT}/health`);
            console.log(`🎨 Format API: POST http://localhost:${this.PORT}/format`);
            console.log(`🔑 API endpoint: POST http://localhost:${this.PORT}/api/v1/format`);
            console.log(`👤 Auth endpoints: http://localhost:${this.PORT}/auth/*`);
            console.log(`🔐 API keys: http://localhost:${this.PORT}/api-keys/*`);
            console.log(`🌐 Web Interface: http://localhost:${this.PORT}`);
            console.log('\n💡 Production SaaS ready with auth, billing foundation, and API!');
        });

        // Graceful shutdown
        process.on('SIGTERM', async () => {
            console.log('SIGTERM received, shutting down gracefully');
            if (this.db) {
                await this.db.close();
            }
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            console.log('SIGINT received, shutting down gracefully');
            if (this.db) {
                await this.db.close();
            }
            process.exit(0);
        });
    }
}

// Start the server
if (require.main === module) {
    const server = new SpeedFormatterServer();
    server.start().catch(console.error);
}

module.exports = SpeedFormatterServer;