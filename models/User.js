const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

class User {
    constructor(db) {
        this.db = db;
    }

    async create({ email, password, name = null, plan = 'free' }) {
        const uuid = uuidv4();
        const passwordHash = await bcrypt.hash(password, 12);
        
        try {
            const result = await this.db.run(
                `INSERT INTO users (uuid, email, password_hash, name, plan) 
                 VALUES (?, ?, ?, ?, ?)`,
                [uuid, email, passwordHash, name, plan]
            );

            // Create initial subscription
            await this.db.run(
                `INSERT INTO subscriptions (user_id, plan_type, monthly_limit) 
                 VALUES (?, ?, ?)`,
                [result.id, plan, this.getPlanLimit(plan)]
            );

            return this.findByUuid(uuid);
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new Error('Email already exists');
            }
            throw error;
        }
    }

    async findByEmail(email) {
        return this.db.get(
            `SELECT u.*, s.plan_type, s.monthly_limit, s.current_usage, s.status as subscription_status
             FROM users u
             LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
             WHERE u.email = ? AND u.is_active = true`,
            [email]
        );
    }

    async findByUuid(uuid) {
        return this.db.get(
            `SELECT u.*, s.plan_type, s.monthly_limit, s.current_usage, s.status as subscription_status
             FROM users u
             LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
             WHERE u.uuid = ? AND u.is_active = true`,
            [uuid]
        );
    }

    async findById(id) {
        return this.db.get(
            `SELECT u.*, s.plan_type, s.monthly_limit, s.current_usage, s.status as subscription_status
             FROM users u
             LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
             WHERE u.id = ? AND u.is_active = true`,
            [id]
        );
    }

    async verifyPassword(plainPassword, hashedPassword) {
        return bcrypt.compare(plainPassword, hashedPassword);
    }

    async updatePassword(userId, newPassword) {
        const passwordHash = await bcrypt.hash(newPassword, 12);
        return this.db.run(
            'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [passwordHash, userId]
        );
    }

    async updateProfile(userId, { name, email }) {
        const updates = [];
        const params = [];
        
        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        
        if (email !== undefined) {
            updates.push('email = ?');
            params.push(email);
        }
        
        if (updates.length === 0) return null;
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(userId);
        
        return this.db.run(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            params
        );
    }

    async deactivate(userId) {
        return this.db.run(
            'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [userId]
        );
    }

    async getUsageStats(userId, period = 'month') {
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
                AVG(execution_time_ms) as avg_execution_time,
                COUNT(DISTINCT language) as languages_used
            FROM usage_logs 
            WHERE user_id = ? ${dateFilter}
        `, [userId]);

        const languageBreakdown = await this.db.all(`
            SELECT 
                language,
                COUNT(*) as count,
                AVG(execution_time_ms) as avg_time
            FROM usage_logs 
            WHERE user_id = ? ${dateFilter}
            GROUP BY language
            ORDER BY count DESC
        `, [userId]);

        return {
            ...stats,
            language_breakdown: languageBreakdown
        };
    }

    getPlanLimit(plan) {
        const limits = {
            'free': 100,
            'basic': 5000,
            'pro': 50000,
            'team': 500000
        };
        return limits[plan] || 100;
    }

    async incrementUsage(userId) {
        return this.db.run(
            'UPDATE subscriptions SET current_usage = current_usage + 1 WHERE user_id = ? AND status = "active"',
            [userId]
        );
    }

    async checkUsageLimit(userId) {
        const subscription = await this.db.get(
            'SELECT monthly_limit, current_usage FROM subscriptions WHERE user_id = ? AND status = "active"',
            [userId]
        );

        if (!subscription) return false;
        return subscription.current_usage < subscription.monthly_limit;
    }
}

module.exports = User;