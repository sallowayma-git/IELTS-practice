const fs = require('node:fs/promises');
const path = require('node:path');

const MIGRATION_LOCK_KEY = [0x49454c54, 0x41544c53]; // "IELT", "ATLS"

async function ensureMigrationTable(db) {
    await db.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
        )
    `);
}

async function getAppliedMigrations(db) {
    const result = await db.query('SELECT filename FROM schema_migrations');
    return new Set(result.rows.map((row) => row.filename));
}

async function listMigrationFiles(migrationsDir) {
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
}

function createClientDb(client) {
    return {
        query(text, params) {
            return client.query(text, params);
        },
        async withTransaction(handler) {
            await client.query('BEGIN');
            try {
                const result = await handler(client);
                await client.query('COMMIT');
                return result;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
    };
}

async function withMigrationLock(client, handler) {
    const canLock = client && typeof client.query === 'function';
    if (!canLock) {
        return handler();
    }

    await client.query('SELECT pg_advisory_lock($1, $2)', MIGRATION_LOCK_KEY);
    let handlerError;
    let result;
    try {
        result = await handler();
    } catch (error) {
        handlerError = error;
    }

    try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', MIGRATION_LOCK_KEY);
    } catch (unlockError) {
        if (!handlerError) {
            throw unlockError;
        }
    }

    if (handlerError) {
        throw handlerError;
    }
    return result;
}

async function runPendingMigrations(db, migrationsDir) {
    await ensureMigrationTable(db);
    const applied = await getAppliedMigrations(db);
    const files = await listMigrationFiles(migrationsDir);
    const appliedNow = [];

    for (const filename of files) {
        if (applied.has(filename)) {
            continue;
        }
        const absolutePath = path.join(migrationsDir, filename);
        const sql = await fs.readFile(absolutePath, 'utf8');
        await db.withTransaction(async (client) => {
            await client.query(sql);
            await client.query(
                'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
                [filename]
            );
        });
        appliedNow.push(filename);
    }

    return {
        applied: appliedNow,
        total: files.length
    };
}

async function runMigrations(db, options = {}) {
    const migrationsDir = options.migrationsDir || path.resolve(__dirname, '..', 'migrations');
    const runWithLockedClient = (client) => withMigrationLock(client, () => (
        runPendingMigrations(createClientDb(client), migrationsDir)
    ));

    if (db && typeof db.withClient === 'function') {
        return db.withClient(runWithLockedClient);
    }
    if (db?.pool && typeof db.pool.connect === 'function') {
        const client = await db.pool.connect();
        try {
            return await runWithLockedClient(client);
        } finally {
            client.release();
        }
    }
    return runPendingMigrations(db, migrationsDir);
}

module.exports = {
    ensureMigrationTable,
    getAppliedMigrations,
    listMigrationFiles,
    runMigrations,
    MIGRATION_LOCK_KEY
};
