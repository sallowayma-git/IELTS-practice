const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * 数据库迁移器
 * 负责初始化数据库和执行增量迁移
 */
class Migrator {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null;
    }

    /**
     * 初始化数据库连接
     */
    connect() {
        if (this.db) return this.db;

        // 确保数据库目录存在
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL'); // 提升并发性能
        this.db.pragma('foreign_keys = ON');  // 启用外键约束

        logger.info(`Database connected: ${this.dbPath}`);
        return this.db;
    }

    /**
     * 执行初始化和所有迁移
     */
    migrate() {
        this.connect();

        logger.info('Starting database migration...');

        try {
            // 1. 执行基础 schema
            this._executeSchema();

            // 2. 执行增量迁移 (如果有)
            this._executeMigrations();

            logger.info('Database migration completed successfully');
        } catch (error) {
            logger.error('Database migration failed', error);
            throw error;
        }
    }

    /**
     * 执行基础 schema
     */
    _executeSchema() {
        const schemaPath = path.join(__dirname, 'schema.sql');

        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Schema file not found: ${schemaPath}`);
        }

        const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

        // 使用事务执行 schema
        const migrate = this.db.transaction(() => {
            this.db.exec(schemaSql);

            // 记录 schema 版本
            const version = '1.0.0';
            const existing = this.db.prepare(
                'SELECT version FROM migrations WHERE version = ?'
            ).get(version);

            if (!existing) {
                this.db.prepare(
                    'INSERT INTO migrations (version) VALUES (?)'
                ).run(version);
                logger.info(`Applied schema version: ${version}`);
            } else {
                logger.info(`Schema version ${version} already applied`);
            }
        });

        migrate();
    }

    /**
     * 执行增量迁移
     */
    _executeMigrations() {
        const migrationsDir = path.join(__dirname, 'migrations');

        // 如果 migrations 目录不存在，则创建它
        if (!fs.existsSync(migrationsDir)) {
            fs.mkdirSync(migrationsDir, { recursive: true });
            logger.info('Created migrations directory');
            return;
        }

        // 读取所有迁移文件 (格式: YYYYMMDD_description.sql)
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort(); // 按文件名排序保证顺序

        if (files.length === 0) {
            logger.info('No additional migrations found');
            return;
        }

        for (const file of files) {
            const version = file.replace('.sql', '');

            // 检查是否已执行
            const existing = this.db.prepare(
                'SELECT version FROM migrations WHERE version = ?'
            ).get(version);

            if (existing) {
                logger.debug(`Migration ${version} already applied, skipping`);
                continue;
            }

            // 执行迁移
            const migrationPath = path.join(migrationsDir, file);
            const sql = fs.readFileSync(migrationPath, 'utf-8');

            const migrate = this.db.transaction(() => {
                this.db.exec(sql);
                this.db.prepare(
                    'INSERT INTO migrations (version) VALUES (?)'
                ).run(version);
            });

            migrate();
            logger.info(`Applied migration: ${version}`);
        }
    }

    /**
     * 关闭数据库连接
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            logger.info('Database connection closed');
        }
    }

    /**
     * 获取数据库实例
     */
    getDatabase() {
        if (!this.db) {
            throw new Error('Database not connected. Call migrate() first.');
        }
        return this.db;
    }
}

module.exports = Migrator;
