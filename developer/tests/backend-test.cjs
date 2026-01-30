#!/usr/bin/env node

/**
 * Phase 04 Backend Automated Test (Node.js Standalone)
 * 
 * 直接在 Node.js 环境中测试 DAO 和 Service 层
 * 不依赖 Electron 和前端界面
 * 
 * 运行方式：node developer/tests/backend-test.js
 */

const path = require('path');
const fs = require('fs');

// Mock logger to avoid Electron dependency
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === '../../utils/logger' || id.includes('utils/logger')) {
        const logger = {
            info: (...args) => console.log('[INFO]', ...args),
            warn: (...args) => console.warn('[WARN]', ...args),
            error: (...args) => console.error('[ERROR]', ...args),
            debug: (...args) => console.log('[DEBUG]', ...args)
        };
        return logger;
    }
    return originalRequire.apply(this, arguments);
};

// 测试结果汇总
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

// 临时测试数据库路径
const testDbPath = path.join(__dirname, 'test.db');

// 日志工具
function log(testName, passed, message = '') {
    const result = { testName, passed, message, timestamp: new Date().toISOString() };
    results.tests.push(result);

    if (passed) {
        results.passed++;
        console.log(`✅ PASS: ${testName}${message ? ' - ' + message : ''}`);
    } else {
        results.failed++;
        console.error(`❌ FAIL: ${testName} - ${message}`);
    }
}

// 清理测试数据库
function cleanupTestDb() {
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }
}

// 初始化测试环境
async function setupTest() {
    console.log('========================================');
    console.log('Phase 04 Backend Automated Test');
    console.log('========================================\n');

    // 清理旧的测试数据库
    cleanupTestDb();

    // 初始化数据库
    const Migrator = require('../../electron/db/migrator');
    const migrator = new Migrator(testDbPath);
    migrator.migrate();
    const db = migrator.getDatabase();

    return db;
}

// ====== 1. Topics DAO 测试 ======
async function testTopicsDAO(db) {
    console.log('\n===== Topics DAO Tests =====');

    const TopicsDAO = require('../../electron/db/dao/topics.dao');
    const dao = new TopicsDAO(db);

    let createdTopicId = null;

    // 1.1 创建题目
    try {
        createdTopicId = dao.create({
            type: 'task1',
            category: 'bar_chart',
            difficulty: 3,
            title_json: JSON.stringify({
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test Topic' }] }]
            })
        });
        log('Topics DAO: Create', createdTopicId > 0, `ID: ${createdTopicId}`);
    } catch (error) {
        log('Topics DAO: Create', false, error.message);
    }

    // 1.2 查询题目
    try {
        const topic = dao.getById(createdTopicId);
        log('Topics DAO: Get by ID', topic && topic.type === 'task1');
    } catch (error) {
        log('Topics DAO: Get by ID', false, error.message);
    }

    // 1.3 列表查询
    try {
        const result = dao.list({ type: 'task1' }, { page: 1, limit: 10 });
        log('Topics DAO: List with filter', result.data.length > 0 && result.total > 0);
    } catch (error) {
        log('Topics DAO: List with filter', false, error.message);
    }

    // 1.4 批量导入
    try {
        const topics = [
            { type: 'task2', category: 'technology', difficulty: 4, title_json: '{"type":"doc","content":[]}' },
            { type: 'task2', category: 'environment', difficulty: 5, title_json: '{"type":"doc","content":[]}' }
        ];
        const result = dao.batchImport(topics);
        log('Topics DAO: Batch import', result.success === 2, `Imported: ${result.success}`);
    } catch (error) {
        log('Topics DAO: Batch import', false, error.message);
    }

    // 1.5 统计
    try {
        const stats = dao.getStatistics();
        log('Topics DAO: Statistics', stats.total >= 3, `Total: ${stats.total}`);
    } catch (error) {
        log('Topics DAO: Statistics', false, error.message);
    }

    // 1.6 删除
    try {
        dao.delete(createdTopicId);
        log('Topics DAO: Delete', true);
    } catch (error) {
        log('Topics DAO: Delete', false, error.message);
    }
}

// ====== 2. Topics Service 测试 ======
async function testTopicsService(db) {
    console.log('\n===== Topics Service Tests =====');

    const TopicService = require('../../electron/services/topic.service');
    const service = new TopicService(db);

    // 2.1 验证非法 category（边界测试）
    try {
        await service.create({
            type: 'task1',
            category: 'education', // task1 不应该有这个 category
            difficulty: 3,
            title_json: '{"type":"doc","content":[]}'
        });
        log('Topics Service: Invalid category validation', false, 'Should reject invalid category');
    } catch (error) {
        log('Topics Service: Invalid category validation', error.message.includes('category'), error.message);
    }

    // 2.2 验证非法 difficulty
    try {
        await service.create({
            type: 'task1',
            category: 'bar_chart',
            difficulty: 10, // 超出范围
            title_json: '{"type":"doc","content":[]}'
        });
        log('Topics Service: Invalid difficulty validation', false, 'Should reject invalid difficulty');
    } catch (error) {
        log('Topics Service: Invalid difficulty validation', error.message.includes('Difficulty'), error.message);
    }
}

// ====== 3. Essays DAO 测试 ======
async function testEssaysDAO(db) {
    console.log('\n===== Essays DAO Tests =====');

    const EssaysDAO = require('../../electron/db/dao/essays.dao');
    const dao = new EssaysDAO(db);

    let createdEssayId = null;

    // 3.1 创建作文记录
    try {
        createdEssayId = dao.create({
            topic_id: null,
            task_type: 'task1',
            content: 'Test essay content',
            word_count: 150,
            llm_provider: 'openai',
            model_name: 'gpt-4-test',
            total_score: 6.5,
            task_achievement: 6.0,
            coherence_cohesion: 7.0,
            lexical_resource: 6.5,
            grammatical_range: 6.0,
            evaluation_json: JSON.stringify({ total_score: 6.5 })
        });
        log('Essays DAO: Create', createdEssayId > 0, `ID: ${createdEssayId}`);
    } catch (error) {
        log('Essays DAO: Create', false, error.message);
    }

    // 3.2 查询记录
    try {
        const essay = dao.getById(createdEssayId);
        log('Essays DAO: Get by ID', essay && essay.task_type === 'task1');
    } catch (error) {
        log('Essays DAO: Get by ID', false, error.message);
    }

    // 3.3 列表筛选
    try {
        const result = dao.list({ task_type: 'task1' }, { page: 1, limit: 10 });
        log('Essays DAO: List with filter', result.data.length > 0);
    } catch (error) {
        log('Essays DAO: List with filter', false, error.message);
    }

    // 3.4 统计数据
    try {
        const stats = dao.getStatistics('all', null);
        log('Essays DAO: Statistics', typeof stats.average_total_score === 'number' && stats.count > 0, `Avg: ${stats.average_total_score}, Count: ${stats.count}`);
    } catch (error) {
        log('Essays DAO: Statistics', false, error.message);
    }

    // 3.5 CSV 导出
    try {
        const data = dao.exportData({});
        log('Essays DAO: Export data', Array.isArray(data) && data.length > 0, `Exported: ${data.length} records`);
    } catch (error) {
        log('Essays DAO: Export data', false, error.message);
    }

    // 3.6 删除
    try {
        dao.delete(createdEssayId);
        log('Essays DAO: Delete', true);
    } catch (error) {
        log('Essays DAO: Delete', false, error.message);
    }
}

// ====== 4. Settings DAO 测试 ======
async function testSettingsDAO(db) {
    console.log('\n===== Settings DAO Tests =====');

    const SettingsDAO = require('../../electron/db/dao/settings.dao');
    const dao = new SettingsDAO(db);

    // 4.1 获取所有设置（应包含默认值）
    try {
        const settings = dao.getAll();
        log('Settings DAO: Get all', settings.language && settings.temperature_mode, `Found ${Object.keys(settings).length} settings`);
    } catch (error) {
        log('Settings DAO: Get all', false, error.message);
    }

    // 4.2 获取单个设置
    try {
        const language = dao.get('language');
        log('Settings DAO: Get single', language === 'zh-CN' || language === 'en', `Language: ${language}`);
    } catch (error) {
        log('Settings DAO: Get single', false, error.message);
    }

    // 4.3 设置更新
    try {
        dao.set('temperature_mode', 'creative');
        const updated = dao.get('temperature_mode');
        log('Settings DAO: Set', updated === 'creative');
    } catch (error) {
        log('Settings DAO: Set', false, error.message);
    }

    // 4.4 批量更新
    try {
        dao.setMultiple({ temperature_mode: 'precise', max_tokens: 2048 });
        const mode = dao.get('temperature_mode');
        const tokens = dao.get('max_tokens');
        log('Settings DAO: Set multiple', mode === 'precise' && tokens === 2048);
    } catch (error) {
        log('Settings DAO: Set multiple', false, error.message);
    }

    // 4.5 重置
    try {
        dao.reset();
        const resetSettings = dao.getAll();
        log('Settings DAO: Reset', resetSettings.temperature_mode === 'balanced');
    } catch (error) {
        log('Settings DAO: Reset', false, error.message);
    }
}

// ====== 5. Settings Service 测试 ======
async function testSettingsService(db) {
    console.log('\n===== Settings Service Tests =====');

    const SettingsService = require('../../electron/services/settings.service');
    const service = new SettingsService(db);

    // 5.1 验证非法语言（边界测试）
    try {
        await service.update({ language: 'fr' });
        log('Settings Service: Invalid language validation', false, 'Should reject invalid language');
    } catch (error) {
        log('Settings Service: Invalid language validation', error.message.includes('language'), error.message);
    }

    // 5.2 验证非法 temperature
    try {
        await service.update({ temperature_task1: 2.5 });
        log('Settings Service: Invalid temperature validation', false, 'Should reject out-of-range temperature');
    } catch (error) {
        log('Settings Service: Invalid temperature validation', error.message.includes('temperature'), error.message);
    }
}

// ====== 主测试流程 ======
async function runAllTests() {
    let db;

    try {
        // 1. 初始化测试环境
        db = await setupTest();

        // 2. 执行 DAO 测试
        await testTopicsDAO(db);
        await testEssaysDAO(db);
        await testSettingsDAO(db);

        // 3. 执行 Service 测试（验证逻辑）
        await testTopicsService(db);
        await testSettingsService(db);

        // 4. 输出汇总
        console.log('\n========================================');
        console.log('Test Summary');
        console.log('========================================');
        console.log(`✅ Passed: ${results.passed}`);
        console.log(`❌ Failed: ${results.failed}`);
        console.log(`Total: ${results.tests.length}`);
        console.log('========================================\n');

        // 5. 输出详细结果
        if (results.failed > 0) {
            console.log('Failed Tests:');
            results.tests.filter(t => !t.passed).forEach(t => {
                console.log(`  - ${t.testName}: ${t.message}`);
            });
            console.log('');
        }

        // 6. 清理
        db.close();
        cleanupTestDb();

        // 7. 退出码
        process.exit(results.failed === 0 ? 0 : 1);

    } catch (error) {
        console.error('\n❌ Test execution failed:', error);
        if (db) db.close();
        cleanupTestDb();
        process.exit(1);
    }
}

// 执行测试
runAllTests();
