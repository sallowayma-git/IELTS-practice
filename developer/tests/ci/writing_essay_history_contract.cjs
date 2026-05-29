#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const EssaysDAO = require(path.join(repoRoot, 'electron', 'db', 'dao', 'essays.dao.js'));
const EssayService = require(path.join(repoRoot, 'electron', 'services', 'essay.service.js'));

function tiptapText(text) {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }]
      }
    ]
  });
}

function makePoisonedSummaryRow() {
  const row = {
    id: 7,
    topic_id: null,
    topic_text: 'Custom topic snapshot for history list',
    topic_title: null,
    task_type: 'task2',
    word_count: 281,
    llm_provider: 'openai',
    model_name: 'history-model',
    total_score: 7,
    task_achievement: 7,
    coherence_cohesion: 6.5,
    lexical_resource: 7,
    grammatical_range: 7,
    submitted_at: '2026-05-22T10:00:00.000Z'
  };
  Object.defineProperty(row, 'content', {
    enumerable: true,
    get() {
      throw new Error('history summary must not read essay content');
    }
  });
  Object.defineProperty(row, 'evaluation_json', {
    enumerable: true,
    get() {
      throw new Error('history summary must not read evaluation_json');
    }
  });
  return row;
}

function createHistoryDbMock() {
  const calls = [];

  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      if (sql.includes('SELECT COUNT(*) as total') && sql.includes('FROM essays e')) {
        return {
          get() {
            return { total: 1 };
          }
        };
      }
      if (sql.includes('LIMIT ? OFFSET ?')) {
        const selectedColumns = sql.slice(0, sql.indexOf('FROM essays e'));
        assert(sql.includes('e.topic_text'), 'history list should select topic_text snapshot');
        assert(!selectedColumns.includes('e.content'), 'history list SQL must not select essay content');
        assert(!selectedColumns.includes('e.evaluation_json'), 'history list SQL must not select evaluation_json');
        assert(sql.includes('e.topic_text LIKE ? OR e.content LIKE ?'), 'history search should use topic_text and content');
        assert(!sql.includes('e.evaluation_json LIKE ?'), 'history search must not scan evaluation_json');
        return {
          all() {
            return [makePoisonedSummaryRow()];
          }
        };
      }
      if (sql.includes('WHERE e.id = ?')) {
        return {
          get() {
            return {
              id: 7,
              topic_id: 4,
              topic_text: 'Topic row snapshot',
              topic_title: tiptapText('Topic bank title'),
              task_type: 'task2',
              content: 'Full essay detail text',
              word_count: 281,
              llm_provider: 'openai',
              model_name: 'history-model',
              total_score: 7,
              task_achievement: 7,
              coherence_cohesion: 6.5,
              lexical_resource: 7,
              grammatical_range: 7,
              evaluation_json: JSON.stringify({
                input_context: {
                  topic_text: 'Topic row snapshot',
                  topic_source: 'topic_bank'
                },
                analysis: {
                  task_analysis: { coverage: 'clear' },
                  band_rationale: { task_achievement: 'complete' },
                  improvement_plan: ['tighten examples']
                }
              }),
              submitted_at: '2026-05-22T10:00:00.000Z'
            };
          }
        };
      }
      throw new Error(`Unexpected SQL in history mock: ${sql}`);
    }
  };
}

function createInsertDbMock() {
  let inserted = null;
  return {
    get inserted() {
      return inserted;
    },
    prepare(sql) {
      if (sql.includes('INSERT INTO essays')) {
        assert(sql.includes('topic_id, topic_text, task_type'), 'essay insert must persist topic_text beside topic_id');
        return {
          run(...values) {
            inserted = values;
            return { lastInsertRowid: 22 };
          }
        };
      }
      throw new Error(`Unexpected SQL in insert mock: ${sql}`);
    }
  };
}

async function main() {
  const db = createHistoryDbMock();
  const service = new EssayService(db);
  let parseCount = 0;
  const originalParse = service._parseEvaluationJson.bind(service);
  service._parseEvaluationJson = (value) => {
    parseCount += 1;
    return originalParse(value);
  };

  const listResult = await service.list({ search: 'snapshot' }, { page: 1, limit: 20 });
  assert.strictEqual(parseCount, 0, 'history list must not parse evaluation_json');
  assert.strictEqual(listResult.data.length, 1);
  assert.strictEqual(listResult.data[0].display_topic_title, 'Custom topic snapshot for history list');
  assert.strictEqual(listResult.data[0].topic_source, 'custom_input');
  assert(!Object.prototype.hasOwnProperty.call(listResult.data[0], 'content'), 'history summary response must omit content');
  assert(!Object.prototype.hasOwnProperty.call(listResult.data[0], 'evaluation_json'), 'history summary response must omit evaluation_json');

  const detail = await service.getById(7);
  assert.strictEqual(parseCount, 1, 'history detail should parse evaluation_json once');
  assert.strictEqual(detail.content, 'Full essay detail text');
  assert.strictEqual(detail.display_topic_title, 'Topic bank title');
  assert.deepStrictEqual(detail.task_analysis, { coverage: 'clear' });

  const insertDb = createInsertDbMock();
  const dao = new EssaysDAO(insertDb);
  const id = dao.create({
    topic_id: null,
    topic_text: 'Persisted free topic snapshot',
    task_type: 'task2',
    content: 'Essay content',
    word_count: 260,
    llm_provider: 'openai',
    model_name: 'history-model',
    total_score: 7,
    task_achievement: 7,
    coherence_cohesion: 7,
    lexical_resource: 7,
    grammatical_range: 7,
    evaluation_json: '{}'
  });
  assert.strictEqual(id, 22);
  assert.strictEqual(insertDb.inserted[1], 'Persisted free topic snapshot', 'topic_text must be the second insert value');

  const daoSource = require('fs').readFileSync(path.join(repoRoot, 'electron', 'db', 'dao', 'essays.dao.js'), 'utf8');
  const serviceSource = require('fs').readFileSync(path.join(repoRoot, 'electron', 'services', 'essay.service.js'), 'utf8');
  const migratorSource = require('fs').readFileSync(path.join(repoRoot, 'electron', 'db', 'migrator.js'), 'utf8');
  assert(!daoSource.includes('e.evaluation_json LIKE ?'), 'history search must not depend on evaluation_json LIKE');
  assert(serviceSource.includes('_decorateEssaySummary'), 'EssayService should keep a summary decorator separate from detail records');
  assert(migratorSource.includes("this._ensureColumn('essays', 'topic_text', 'TEXT')"), 'migrator must add topic_text to existing essay tables');

  process.stdout.write(JSON.stringify({
    status: 'pass',
    checked: [
      'history list summary SQL omits content/evaluation_json',
      'history list avoids evaluation_json parsing',
      'history detail still parses full evaluation_json',
      'essay insert persists topic_text snapshot'
    ]
  }));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
