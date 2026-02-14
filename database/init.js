const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');

class Database {
    constructor(dbPath = './database/speed_formatter.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('📊 Connected to SQLite database');
                    resolve();
                }
            });
        });
    }

    async initializeSchema() {
        try {
            // Check if tables already exist
            const tableExists = await this.get(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='users'
            `);
            
            if (tableExists) {
                console.log('✅ Database tables already exist, skipping schema initialization');
                return;
            }
            
            const schemaSQL = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
            
            // Split schema into individual statements and execute them
            const statements = schemaSQL
                .split(';')
                .map(stmt => stmt.trim())
                .filter(stmt => stmt.length > 0);

            for (const statement of statements) {
                try {
                    await this.run(statement);
                } catch (error) {
                    // Skip errors for statements that might already exist
                    if (!error.message.includes('already exists')) {
                        throw error;
                    }
                }
            }
            
            console.log('✅ Database schema initialized successfully');
        } catch (error) {
            console.error('❌ Error initializing schema:', error);
            throw error;
        }
    }

    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async close() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        console.log('📊 Database connection closed');
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
}

// Initialize database if run directly
async function initDatabase() {
    const db = new Database();
    
    try {
        await db.connect();
        await db.initializeSchema();
        console.log('🚀 Database initialization complete!');
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    } finally {
        await db.close();
    }
}

// Run if executed directly
if (require.main === module) {
    initDatabase();
}

module.exports = Database;