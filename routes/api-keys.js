const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();

function createApiKeyRoutes(ApiKey, AuthMiddleware) {
    // Get all API keys for authenticated user
    router.get('/', AuthMiddleware.verifyToken(), async (req, res) => {
        try {
            const apiKeys = await ApiKey.findByUser(req.user.id);
            
            res.json({
                api_keys: apiKeys.map(key => ({
                    id: key.id,
                    key_name: key.key_name,
                    api_key: key.api_key,
                    is_active: Boolean(key.is_active),
                    last_used_at: key.last_used_at,
                    last_used_formatted: key.last_used_formatted,
                    created_at: key.created_at
                }))
            });
        } catch (error) {
            console.error('Get API keys error:', error);
            res.status(500).json({
                error: 'Failed to get API keys',
                details: 'Internal server error'
            });
        }
    });

    // Create new API key
    router.post('/', [
        AuthMiddleware.verifyToken(),
        body('key_name')
            .trim()
            .isLength({ min: 1, max: 100 })
            .withMessage('Key name must be between 1 and 100 characters')
    ], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { key_name } = req.body;
            const userId = req.user.id;

            // Check if user already has maximum number of API keys (limit to 10)
            const existingKeys = await ApiKey.findByUser(userId);
            if (existingKeys.length >= 10) {
                return res.status(400).json({
                    error: 'API key limit reached',
                    details: 'You can have a maximum of 10 API keys'
                });
            }

            const apiKey = await ApiKey.create(userId, key_name);

            res.status(201).json({
                message: 'API key created successfully',
                api_key: {
                    id: apiKey.id,
                    key_name: apiKey.key_name,
                    api_key: apiKey.api_key,
                    is_active: Boolean(apiKey.is_active),
                    created_at: apiKey.created_at
                }
            });
        } catch (error) {
            console.error('Create API key error:', error);
            res.status(500).json({
                error: 'Failed to create API key',
                details: 'Internal server error'
            });
        }
    });

    // Get API key usage statistics
    router.get('/:id/usage', [
        AuthMiddleware.verifyToken(),
        param('id').isInt({ min: 1 }).withMessage('Invalid API key ID')
    ], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const apiKeyId = parseInt(req.params.id);
            const period = req.query.period || 'month';
            
            if (!['day', 'month'].includes(period)) {
                return res.status(400).json({
                    error: 'Invalid period',
                    details: 'Period must be either "day" or "month"'
                });
            }

            // Verify the API key belongs to the user
            const userApiKeys = await ApiKey.findByUser(req.user.id);
            const apiKey = userApiKeys.find(key => key.id === apiKeyId);
            
            if (!apiKey) {
                return res.status(404).json({
                    error: 'API key not found',
                    details: 'API key not found or you do not have access to it'
                });
            }

            const stats = await ApiKey.getUsageStats(apiKeyId, period);
            
            res.json({
                api_key: {
                    id: apiKey.id,
                    key_name: apiKey.key_name,
                    created_at: apiKey.created_at
                },
                period,
                statistics: stats
            });
        } catch (error) {
            console.error('API key usage stats error:', error);
            res.status(500).json({
                error: 'Failed to get usage statistics',
                details: 'Internal server error'
            });
        }
    });

    // Update API key name
    router.patch('/:id', [
        AuthMiddleware.verifyToken(),
        param('id').isInt({ min: 1 }).withMessage('Invalid API key ID'),
        body('key_name')
            .trim()
            .isLength({ min: 1, max: 100 })
            .withMessage('Key name must be between 1 and 100 characters')
    ], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const apiKeyId = parseInt(req.params.id);
            const { key_name } = req.body;
            const userId = req.user.id;

            const result = await ApiKey.updateName(apiKeyId, userId, key_name);
            
            if (result.changes === 0) {
                return res.status(404).json({
                    error: 'API key not found',
                    details: 'API key not found or you do not have access to it'
                });
            }

            res.json({
                message: 'API key name updated successfully'
            });
        } catch (error) {
            console.error('Update API key error:', error);
            res.status(500).json({
                error: 'Failed to update API key',
                details: 'Internal server error'
            });
        }
    });

    // Deactivate API key
    router.patch('/:id/deactivate', [
        AuthMiddleware.verifyToken(),
        param('id').isInt({ min: 1 }).withMessage('Invalid API key ID')
    ], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const apiKeyId = parseInt(req.params.id);
            const userId = req.user.id;

            const result = await ApiKey.deactivate(apiKeyId, userId);
            
            if (result.changes === 0) {
                return res.status(404).json({
                    error: 'API key not found',
                    details: 'API key not found or you do not have access to it'
                });
            }

            res.json({
                message: 'API key deactivated successfully'
            });
        } catch (error) {
            console.error('Deactivate API key error:', error);
            res.status(500).json({
                error: 'Failed to deactivate API key',
                details: 'Internal server error'
            });
        }
    });

    // Delete API key
    router.delete('/:id', [
        AuthMiddleware.verifyToken(),
        param('id').isInt({ min: 1 }).withMessage('Invalid API key ID')
    ], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const apiKeyId = parseInt(req.params.id);
            const userId = req.user.id;

            const result = await ApiKey.delete(apiKeyId, userId);
            
            if (result.changes === 0) {
                return res.status(404).json({
                    error: 'API key not found',
                    details: 'API key not found or you do not have access to it'
                });
            }

            res.json({
                message: 'API key deleted successfully'
            });
        } catch (error) {
            console.error('Delete API key error:', error);
            res.status(500).json({
                error: 'Failed to delete API key',
                details: 'Internal server error'
            });
        }
    });

    return router;
}

module.exports = createApiKeyRoutes;