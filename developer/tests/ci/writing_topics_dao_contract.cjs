#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const TopicsDAO = require(path.join(repoRoot, 'electron', 'db', 'dao', 'topics.dao.js'));

function createDbMock({ columns, topics = [] }) {
  const calls = [];

  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      if (sql === 'PRAGMA table_info(topics)') {
        return {
          all() {
            return columns.map((name) => ({ name }));
          }
        };
      }
      if (sql.includes('SELECT COUNT(*) as total FROM topics')) {
        return {
          get() {
            return { total: topics.length };
          }
        };
      }
      if (sql.includes('SELECT * FROM topics')) {
        return {
          all() {
            return topics;
          }
        };
      }
      if (sql.includes('UPDATE topics')) {
        return {
          run() {
            return { changes: 1 };
          }
        };
      }
      throw new Error(`Unexpected SQL in mock: ${sql}`);
    }
  };
}

function main() {
  const legacyDb = createDbMock({
    columns: ['id', 'type', 'category', 'difficulty', 'title_json', 'image_path', 'is_official'],
    topics: [{ id: 1 }]
  });
  const legacyDao = new TopicsDAO(legacyDb);
  legacyDao.list({}, { page: 1, limit: 20 });

  const legacyListSql = legacyDb.calls.find((sql) => sql.includes('SELECT * FROM topics'));
  assert(legacyListSql.includes('ORDER BY id DESC'), 'legacy schema should fall back to ORDER BY id DESC');

  const modernDb = createDbMock({
    columns: ['id', 'created_at', 'updated_at', 'usage_count'],
    topics: [{ id: 2 }]
  });
  const modernDao = new TopicsDAO(modernDb);
  modernDao.list({}, { page: 1, limit: 20 });
  modernDao.incrementUsageCount(2);

  const modernListSql = modernDb.calls.find((sql) => sql.includes('SELECT * FROM topics'));
  assert(modernListSql.includes('ORDER BY created_at DESC'), 'modern schema should keep created_at ordering');

  const modernUpdateSql = modernDb.calls.find((sql) => sql.includes('usage_count = COALESCE'));
  assert(modernUpdateSql.includes('updated_at = CURRENT_TIMESTAMP'), 'usage_count update should also refresh updated_at when column exists');

  const partialDb = createDbMock({
    columns: ['id', 'usage_count'],
    topics: []
  });
  const partialDao = new TopicsDAO(partialDb);
  partialDao.incrementUsageCount(3);
  const partialUpdateSql = partialDb.calls.find((sql) => sql.includes('usage_count = COALESCE'));
  assert(partialUpdateSql && !partialUpdateSql.includes('updated_at = CURRENT_TIMESTAMP'), 'partial schema must not reference missing updated_at column');

  process.stdout.write(JSON.stringify({
    status: 'pass',
    legacyOrderBy: 'id DESC',
    modernOrderBy: 'created_at DESC',
    checked: ['list legacy fallback', 'list modern ordering', 'usage_count compatibility']
  }));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
