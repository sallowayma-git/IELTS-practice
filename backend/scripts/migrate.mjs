import dbModule from '../src/db.js';
import migrationsModule from '../src/migrations.js';

const db = dbModule.default || dbModule;
const { runMigrations } = migrationsModule.default || migrationsModule;

try {
    const result = await runMigrations(db);
    console.log(JSON.stringify({
        status: 'ok',
        applied: result.applied,
        total: result.total
    }, null, 2));
} finally {
    await db.pool.end();
}
