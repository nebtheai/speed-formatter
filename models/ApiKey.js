const crypto = require('crypto');

class ApiKey {
    constructor(db) {
        this.db = db;
    }

    generateApiKey() {
        // Generate a secure API key with prefix for easy identification
        const randomBytes = crypto.randomBytes(32).toString('hex');
        return `sf_${randomBytes}`;
    }

    async create(userId, keyName = 'Default API Key') {
        const apiKey = this.generateApiKey();
        
        try {
            const result = await this.db.run(
                'INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)',
                [userId, keyName, apiKey]
            );
            
            return this.findById(result.id);
        } catch (error) {
            throw new Error('Failed to create API key: ' + error.message);
        }
    }

    async findByKey(apiKey) {
        return this.db.get(`
            SELECT ak.*, u.id as user_id, u.email, u.plan, u.is_active as user_active,
                   s.monthly_limit, s.current_usage, s.status as subscription_status
            FROM api_keys ak
            JOIN users u ON ak.user_id = u.id
            LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
            WHERE ak.api_key = ? AND ak.is_active = true AND u.is_active = true
        `, [apiKey]);
    }

    async findById(id) {
        return this.db.get(
            'SELECT * FROM api_keys WHERE id = ?',
            [id]
        );
    }

    async findByUser(userId) {
        return this.db.all(`
            SELECT id, key_name, api_key, is_active, last_used_at, created_at,
                   CASE 
                       WHEN last_used_at IS NULL THEN 'Never used'
                       ELSE datetime(last_used_at, 'localtime')
                   END as last_used_formatted
            FROM api_keys 
            WHERE user_id = ? 
            ORDER BY created_at DESC
        `, [userId]);
    }

    async updateLastUsed(apiKeyId) {
        return this.db.run(
            'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
            [apiKeyId]
        );
    }

    async deactivate(id, userId) {
        return this.db.run(
            'UPDATE api_keys SET is_active = false WHERE id = ? AND user_id = ?',
            [id, userId]
        );
    }

    async delete(id, userId) {
        return this.db.run(
            'DELETE FROM api_keys WHERE id = ? AND user_id = ?',
            [id, userId]
        );
    }

    async updateName(id, userId, newName) {
        return this.db.run(
            'UPDATE api_keys SET key_name = ? WHERE id = ? AND user_id = ?',
            [newName, id, userId]
        );
    }

    async getUsageStats(apiKeyId, period = 'month') {
        let dateFilter = '';
        if (period === 'day') {
            dateFilter = "AND DATE(created_at) = DATE('now')";
        } else if (period === 'month') {
            dateFilter = "AND DATE(created_at) >= DATE('now', '-30 days')";
        }

        const stats = await this.db.get(`
            SELECT 
                COUNT(*) as total_requests,
                SUM(input_length) as total_input_chars,
                SUM(output_length) as total_output_chars,
                AVG(execution_time_ms) as avg_execution_time
            FROM usage_logs 
            WHERE api_key_id = ? ${dateFilter}
        `, [apiKeyId]);

        const dailyUsage = await this.db.all(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as requests
            FROM usage_logs 
            WHERE api_key_id = ? AND DATE(created_at) >= DATE('now', '-7 days')
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `, [apiKeyId]);

        return {
            ...stats,
            daily_usage: dailyUsage
        };
    }

    // Validate API key format
    isValidKeyFormat(apiKey) {
        return typeof apiKey === 'string' && 
               apiKey.startsWith('sf_') && 
               apiKey.length === 67; // sf_ + 64 hex chars
    }
}

module.exports = ApiKey;