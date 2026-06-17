const path = require('node:path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function createPool(options = {}) {
    return new Pool({
        connectionString: process.env.DATABASE_URL,
        ...options
    });
}

const pool = createPool();

async function query(text, params) {
    return pool.query(text, params);
}

async function withTransaction(handler) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await handler(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    createPool,
    pool,
    query,
    withTransaction
};
