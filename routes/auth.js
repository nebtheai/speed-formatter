const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

function createAuthRoutes(User, AuthMiddleware) {
    // Registration
    router.post('/register', [
        body('email')
            .isEmail()
            .normalizeEmail()
            .withMessage('Valid email is required'),
        body('password')
            .isLength({ min: 8 })
            .withMessage('Password must be at least 8 characters')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
            .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
        body('name')
            .optional()
            .trim()
            .isLength({ min: 1, max: 100 })
            .withMessage('Name must be between 1 and 100 characters')
    ], async (req, res) => {
        try {
            // Check validation errors
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { email, password, name } = req.body;
            
            // Create user
            const user = await User.create({
                email: email.toLowerCase(),
                password,
                name: name || null
            });

            // Generate JWT token
            const token = AuthMiddleware.generateToken(user);

            res.status(201).json({
                message: 'User created successfully',
                user: {
                    uuid: user.uuid,
                    email: user.email,
                    name: user.name,
                    plan: user.plan_type || user.plan,
                    created_at: user.created_at
                },
                token,
                expires_in: '7 days'
            });
        } catch (error) {
            if (error.message === 'Email already exists') {
                return res.status(409).json({
                    error: 'Email already exists',
                    details: 'An account with this email address already exists'
                });
            }

            console.error('Registration error:', error);
            res.status(500).json({
                error: 'Registration failed',
                details: 'Internal server error'
            });
        }
    });

    // Login
    router.post('/login', [
        body('email')
            .isEmail()
            .normalizeEmail()
            .withMessage('Valid email is required'),
        body('password')
            .notEmpty()
            .withMessage('Password is required')
    ], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { email, password } = req.body;
            
            // Find user by email
            const user = await User.findByEmail(email.toLowerCase());
            if (!user) {
                return res.status(401).json({
                    error: 'Invalid credentials',
                    details: 'Email or password is incorrect'
                });
            }

            // Verify password
            const validPassword = await User.verifyPassword(password, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({
                    error: 'Invalid credentials',
                    details: 'Email or password is incorrect'
                });
            }

            // Generate JWT token
            const token = AuthMiddleware.generateToken(user);

            res.json({
                message: 'Login successful',
                user: {
                    uuid: user.uuid,
                    email: user.email,
                    name: user.name,
                    plan: user.plan_type || user.plan,
                    monthly_limit: user.monthly_limit,
                    current_usage: user.current_usage
                },
                token,
                expires_in: '7 days'
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({
                error: 'Login failed',
                details: 'Internal server error'
            });
        }
    });

    // Get current user profile (requires authentication)
    router.get('/profile', AuthMiddleware.verifyToken(), async (req, res) => {
        try {
            const user = req.user;
            
            // Get usage statistics
            const usageStats = await User.getUsageStats(user.id, 'month');
            
            res.json({
                user: {
                    uuid: user.uuid,
                    email: user.email,
                    name: user.name,
                    plan: user.plan_type || user.plan,
                    monthly_limit: user.monthly_limit,
                    current_usage: user.current_usage,
                    subscription_status: user.subscription_status,
                    created_at: user.created_at
                },
                usage_stats: usageStats
            });
        } catch (error) {
            console.error('Profile error:', error);
            res.status(500).json({
                error: 'Failed to get profile',
                details: 'Internal server error'
            });
        }
    });

    // Update user profile
    router.patch('/profile', [
        AuthMiddleware.verifyToken(),
        body('name')
            .optional()
            .trim()
            .isLength({ min: 1, max: 100 })
            .withMessage('Name must be between 1 and 100 characters'),
        body('email')
            .optional()
            .isEmail()
            .normalizeEmail()
            .withMessage('Valid email is required')
    ], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { name, email } = req.body;
            const userId = req.user.id;

            await User.updateProfile(userId, { name, email });

            // Get updated user
            const updatedUser = await User.findById(userId);

            res.json({
                message: 'Profile updated successfully',
                user: {
                    uuid: updatedUser.uuid,
                    email: updatedUser.email,
                    name: updatedUser.name,
                    plan: updatedUser.plan_type || updatedUser.plan
                }
            });
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({
                    error: 'Email already exists',
                    details: 'Another account is using this email address'
                });
            }

            console.error('Profile update error:', error);
            res.status(500).json({
                error: 'Failed to update profile',
                details: 'Internal server error'
            });
        }
    });

    // Change password
    router.post('/change-password', [
        AuthMiddleware.verifyToken(),
        body('current_password')
            .notEmpty()
            .withMessage('Current password is required'),
        body('new_password')
            .isLength({ min: 8 })
            .withMessage('New password must be at least 8 characters')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
            .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number')
    ], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { current_password, new_password } = req.body;
            const user = req.user;

            // Verify current password
            const validPassword = await User.verifyPassword(current_password, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({
                    error: 'Invalid current password',
                    details: 'The current password you entered is incorrect'
                });
            }

            // Update password
            await User.updatePassword(user.id, new_password);

            res.json({
                message: 'Password changed successfully'
            });
        } catch (error) {
            console.error('Password change error:', error);
            res.status(500).json({
                error: 'Failed to change password',
                details: 'Internal server error'
            });
        }
    });

    // Get usage statistics
    router.get('/usage', AuthMiddleware.verifyToken(), async (req, res) => {
        try {
            const period = req.query.period || 'month';
            if (!['day', 'month'].includes(period)) {
                return res.status(400).json({
                    error: 'Invalid period',
                    details: 'Period must be either "day" or "month"'
                });
            }

            const stats = await User.getUsageStats(req.user.id, period);
            
            res.json({
                period,
                statistics: stats
            });
        } catch (error) {
            console.error('Usage stats error:', error);
            res.status(500).json({
                error: 'Failed to get usage statistics',
                details: 'Internal server error'
            });
        }
    });

    // Deactivate account
    router.delete('/account', AuthMiddleware.verifyToken(), async (req, res) => {
        try {
            await User.deactivate(req.user.id);
            
            res.json({
                message: 'Account deactivated successfully'
            });
        } catch (error) {
            console.error('Account deactivation error:', error);
            res.status(500).json({
                error: 'Failed to deactivate account',
                details: 'Internal server error'
            });
        }
    });

    return router;
}

module.exports = createAuthRoutes;