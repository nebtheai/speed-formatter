const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// JWT Secret (should be in environment variables in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

class AuthMiddleware {
    constructor(userModel, apiKeyModel, db) {
        this.User = userModel;
        this.ApiKey = apiKeyModel;
        this.db = db;
    }

    // Generate JWT token
    generateToken(user) {
        const payload = {
            userId: user.id,
            uuid: user.uuid,
            email: user.email,
            plan: user.plan
        };
        
        return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    }

    // Verify JWT token middleware
    verifyToken() {
        return async (req, res, next) => {
            try {
                const authHeader = req.headers.authorization;
                
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return res.status(401).json({
                        error: 'Authentication required',
                        details: 'Please provide a valid Bearer token'
                    });
                }
                
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, JWT_SECRET);
                
                // Get fresh user data
                const user = await this.User.findById(decoded.userId);
                if (!user) {
                    return res.status(401).json({
                        error: 'Invalid token',
                        details: 'User not found'
                    });
                }
                
                req.user = user;
                next();
            } catch (error) {
                if (error.name === 'JsonWebTokenError') {
                    return res.status(401).json({
                        error: 'Invalid token',
                        details: 'Token is malformed'
                    });
                }
                
                if (error.name === 'TokenExpiredError') {
                    return res.status(401).json({
                        error: 'Token expired',
                        details: 'Please login again'
                    });
                }
                
                return res.status(500).json({
                    error: 'Authentication error',
                    details: error.message
                });
            }
        };
    }

    // API Key authentication middleware
    verifyApiKey() {
        return async (req, res, next) => {
            try {
                let apiKey = req.headers['x-api-key'] || req.query.api_key;
                
                if (!apiKey) {
                    return res.status(401).json({
                        error: 'API key required',
                        details: 'Please provide an API key in X-API-Key header or api_key query parameter'
                    });
                }
                
                if (!this.ApiKey.isValidKeyFormat(apiKey)) {
                    return res.status(401).json({
                        error: 'Invalid API key format',
                        details: 'API key must start with sf_ and be properly formatted'
                    });
                }
                
                const keyData = await this.ApiKey.findByKey(apiKey);
                if (!keyData) {
                    return res.status(401).json({
                        error: 'Invalid API key',
                        details: 'API key not found or inactive'
                    });
                }
                
                // Check usage limits
                const canUse = await this.User.checkUsageLimit(keyData.user_id);
                if (!canUse) {
                    return res.status(429).json({
                        error: 'Usage limit exceeded',
                        details: 'Monthly API limit reached. Please upgrade your plan.',
                        current_usage: keyData.current_usage,
                        monthly_limit: keyData.monthly_limit
                    });
                }
                
                // Update last used timestamp
                await this.ApiKey.updateLastUsed(keyData.id);
                
                req.apiKey = keyData;
                req.user = {
                    id: keyData.user_id,
                    email: keyData.email,
                    plan: keyData.plan
                };
                
                next();
            } catch (error) {
                return res.status(500).json({
                    error: 'API key validation error',
                    details: error.message
                });
            }
        };
    }

    // Either JWT or API key authentication
    verifyAuth() {
        return async (req, res, next) => {
            const hasApiKey = req.headers['x-api-key'] || req.query.api_key;
            const hasBearerToken = req.headers.authorization?.startsWith('Bearer ');
            
            if (hasApiKey) {
                return this.verifyApiKey()(req, res, next);
            } else if (hasBearerToken) {
                return this.verifyToken()(req, res, next);
            } else {
                return res.status(401).json({
                    error: 'Authentication required',
                    details: 'Please provide either an API key or Bearer token'
                });
            }
        };
    }

    // Rate limiting middleware
    createRateLimit(options = {}) {
        const defaultOptions = {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // limit each IP to 100 requests per windowMs
            message: {
                error: 'Too many requests',
                details: 'Please slow down and try again later'
            },
            standardHeaders: true,
            legacyHeaders: false,
            keyGenerator: (req) => {
                // Use API key or IP for rate limiting
                return req.apiKey?.api_key || req.user?.id || req.ip;
            }
        };
        
        return rateLimit({...defaultOptions, ...options});
    }

    // Usage tracking middleware
    trackUsage() {
        return async (req, res, next) => {
            // Store original res.json to intercept response
            const originalJson = res.json;
            
            res.json = function(data) {
                // Track usage if formatting was successful
                if (req.formattingData && data.status === 'success') {
                    // Don't await - fire and forget
                    trackFormattingUsage(req, res, data).catch(console.error);
                }
                return originalJson.call(this, data);
            };
            
            next();
            
            async function trackFormattingUsage(req, res, data) {
                try {
                    await req.app.locals.db.run(`
                        INSERT INTO usage_logs (
                            user_id, api_key_id, language, input_length, 
                            output_length, execution_time_ms, formatter_used, 
                            ip_address, user_agent
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        req.user?.id || null,
                        req.apiKey?.id || null,
                        req.formattingData?.language || 'unknown',
                        req.formattingData?.input_length || 0,
                        data.formatted_code?.length || 0,
                        data.execution_time_ms || 0,
                        data.formatter_used || 'unknown',
                        req.ip,
                        req.headers['user-agent']
                    ]);
                    
                    // Increment user usage counter
                    if (req.user?.id) {
                        await req.app.locals.User.incrementUsage(req.user.id);
                    }
                } catch (error) {
                    console.error('Error tracking usage:', error);
                }
            }
        };
    }

    // Optional authentication (doesn't fail if no auth provided)
    optionalAuth() {
        return async (req, res, next) => {
            try {
                const hasApiKey = req.headers['x-api-key'] || req.query.api_key;
                const hasBearerToken = req.headers.authorization?.startsWith('Bearer ');
                
                if (hasApiKey || hasBearerToken) {
                    return this.verifyAuth()(req, res, next);
                } else {
                    // No authentication provided, continue as anonymous
                    next();
                }
            } catch (error) {
                // Authentication failed, but continue as anonymous
                next();
            }
        };
    }
}

module.exports = AuthMiddleware;