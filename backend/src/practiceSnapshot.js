const crypto = require('node:crypto');

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function snapshotOf(records) {
    const ordered = records.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
    return { revision: crypto.createHash('sha256').update(canonical(ordered)).digest('hex'), records };
}

function requireRevision(records, revision) {
    if (typeof revision !== 'string' || snapshotOf(records).revision !== revision) {
        throw Object.assign(new Error('Records changed on another device. Refresh before saving.'), { status: 409 });
    }
}

module.exports = { snapshotOf, requireRevision };
