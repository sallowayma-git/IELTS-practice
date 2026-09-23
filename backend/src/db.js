const path = require('node:path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function createPool(options = {}) {
    const baseConfig = process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {};
    return new Pool({
        ...baseConfig,
        ...options
    });
}

const pool = createPool();

async function withClient(handler) {
    const client = await pool.connect();
    try {
        return await handler(client);
    } finally {
        client.release();
    }
}

async function query(text, params) {
    return pool.query(text, params);
}

async function withTransaction(handler) {
    return withClient(async (client) => {
        await client.query('BEGIN');
        try {
            const result = await handler(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    });
}

module.exports = {
    createPool,
    pool,
    query,
    withClient,
    withTransaction
};
