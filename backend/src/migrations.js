const fs = require('node:fs/promises');
const path = require('node:path');

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

async function runMigrations(db, options = {}) {
    const migrationsDir = options.migrationsDir || path.resolve(__dirname, '..', 'migrations');
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

module.exports = {
    ensureMigrationTable,
    getAppliedMigrations,
    listMigrationFiles,
    runMigrations
};
