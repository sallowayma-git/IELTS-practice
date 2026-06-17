import dbModule from '../src/db.js';
import bootstrapModule from '../src/bootstrapAdmin.js';

const db = dbModule.default || dbModule;
const { bootstrapAdmin } = bootstrapModule.default || bootstrapModule;

try {
    const result = await bootstrapAdmin({ db });
    console.log(JSON.stringify({
        status: 'ok',
        ...result,
        user: result.user ? {
            id: result.user.id,
            username: result.user.username,
            role: result.user.role
        } : null
    }, null, 2));
} finally {
    await db.pool.end();
}
