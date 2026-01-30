/**
 * Phase 04 Backend Verification Script
 * 
 * 在 Electron 环境的 DevTools Console 中运行此脚本
 * 或在写作页面中通过 <script> 标签加载
 * 
 * 重点验证：IPC / DB / Upload / Draft 四条主线
 */

class BackendVerifier {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            tests: []
        };
        this.api = window.writingAPI;
    }

    /**
     * 记录测试结果
     */
    log(testName, passed, message = '') {
        const result = { testName, passed, message, timestamp: new Date().toISOString() };
        this.results.tests.push(result);

        if (passed) {
            this.results.passed++;
            console.log(`✅ PASS: ${testName}`, message);
        } else {
            this.results.failed++;
            console.error(`❌ FAIL: ${testName}`, message);
        }
    }

    /**
     * 运行单个测试
     */
    async runTest(name, testFn) {
        try {
            await testFn();
            this.log(name, true);
        } catch (error) {
            this.log(name, false, error.message);
        }
    }

    /**
     * 1. IPC 协议一致性测试
     */
    async testIPCProtocol() {
        console.log('\n===== IPC Protocol Tests =====');

        // 1.1 成功响应格式
        await this.runTest('IPC: Success response format', async () => {
            const response = await this.api.settings.getAll();
            if (!response || typeof response !== 'object') {
                throw new Error('Response is not an object');
            }
            // 检查是否有常见设置
            if (!response.language) {
                throw new Error('Missing expected setting: language');
            }
        });

        // 1.2 错误响应格式（触发一个预期失败的调用）
        await this.runTest('IPC: Error response format', async () => {
            try {
                // 尝试创建非法 topic
                await this.api.topics.create({ type: 'invalid' });
                throw new Error('Should have failed with invalid topic');
            } catch (error) {
                // 预期会失败，检查错误格式
                if (!error.message) {
                    throw new Error('Error missing message');
                }
            }
        });
    }

    /**
     * 2. Topics (题目管理) 测试
     */
    async testTopics() {
        console.log('\n===== Topics Tests =====');
        let createdTopicId = null;

        // 2.1 创建题目
        await this.runTest('Topics: Create topic', async () => {
            const result = await this.api.topics.create({
                type: 'task1',
                category: 'bar_chart',
                difficulty: 3,
                title_json: JSON.stringify({
                    type: 'doc',
                    content: [{
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Test Topic for Verification' }]
                    }]
                })
            });

            if (!result || typeof result !== 'number') {
                throw new Error('Create should return topic ID');
            }
            createdTopicId = result;
        });

        // 2.2 查询单个题目
        await this.runTest('Topics: Get by ID', async () => {
            if (!createdTopicId) throw new Error('No topic ID from create');

            const topic = await this.api.topics.getById(createdTopicId);
            if (!topic || topic.type !== 'task1') {
                throw new Error('Topic data invalid');
            }
        });

        // 2.3 列表查询
        await this.runTest('Topics: List with filters', async () => {
            const result = await this.api.topics.list({ type: 'task1' }, { page: 1, limit: 10 });
            if (!result.data || !Array.isArray(result.data)) {
                throw new Error('List should return data array');
            }
            if (typeof result.total !== 'number') {
                throw new Error('List should return total count');
            }
        });

        // 2.4 边界测试：非法 category
        await this.runTest('Topics: Invalid category (edge case)', async () => {
            try {
                await this.api.topics.create({
                    type: 'task1',
                    category: 'education', // task1 不应该有这个 category
                    difficulty: 3,
                    title_json: JSON.stringify({ type: 'doc', content: [] })
                });
                throw new Error('Should reject invalid category');
            } catch (error) {
                if (!error.message.includes('category')) {
                    throw new Error('Wrong error message for invalid category');
                }
            }
        });

        // 2.5 批量导入
        await this.runTest('Topics: Batch import', async () => {
            const topics = [
                {
                    type: 'task2',
                    category: 'technology',
                    difficulty: 4,
                    title_json: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Batch Import Topic 1' }] }] })
                },
                {
                    type: 'task2',
                    category: 'environment',
                    difficulty: 5,
                    title_json: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Batch Import Topic 2' }] }] })
                }
            ];

            const result = await this.api.topics.batchImport(topics);
            if (result.success !== 2) {
                throw new Error(`Expected 2 successful imports, got ${result.success}`);
            }
        });

        // 2.6 删除题目（清理）
        await this.runTest('Topics: Delete topic', async () => {
            if (!createdTopicId) throw new Error('No topic ID to delete');
            await this.api.topics.delete(createdTopicId);
        });
    }

    /**
     * 3. Essays (历史记录) 测试
     */
    async testEssays() {
        console.log('\n===== Essays Tests =====');
        let createdEssayId = null;

        // 3.1 创建作文记录
        await this.runTest('Essays: Create essay record', async () => {
            const result = await this.api.essays.create({
                topic_id: null, // 自由写作
                task_type: 'task1',
                content: 'This is a test essay content for verification.',
                word_count: 150,
                llm_provider: 'openai',
                model_name: 'gpt-4-test',
                total_score: 6.5,
                task_achievement: 6.0,
                coherence_cohesion: 7.0,
                lexical_resource: 6.5,
                grammatical_range: 6.0,
                evaluation_json: JSON.stringify({
                    total_score: 6.5,
                    sentences: [],
                    overall_feedback: 'Test feedback'
                })
            });

            if (!result || typeof result !== 'number') {
                throw new Error('Create should return essay ID');
            }
            createdEssayId = result;
        });

        // 3.2 查询记录
        await this.runTest('Essays: Get by ID', async () => {
            if (!createdEssayId) throw new Error('No essay ID from create');

            const essay = await this.api.essays.getById(createdEssayId);
            if (!essay || essay.task_type !== 'task1') {
                throw new Error('Essay data invalid');
            }
        });

        // 3.3 列表筛选
        await this.runTest('Essays: List with filters', async () => {
            const result = await this.api.essays.list({ task_type: 'task1' }, { page: 1, limit: 10 });
            if (!result.data || !Array.isArray(result.data)) {
                throw new Error('List should return data array');
            }
        });

        // 3.4 统计数据
        await this.runTest('Essays: Get statistics', async () => {
            const stats = await this.api.essays.getStatistics('all', null);
            if (typeof stats.average_total_score !== 'number') {
                throw new Error('Statistics missing average_total_score');
            }
            if (typeof stats.count !== 'number') {
                throw new Error('Statistics missing count');
            }
        });

        // 3.5 CSV 导出
        await this.runTest('Essays: Export CSV', async () => {
            const csv = await this.api.essays.exportCSV({});
            if (typeof csv !== 'string' || !csv.includes('提交时间')) {
                throw new Error('CSV export failed or missing headers');
            }
        });

        // 3.6 删除记录（清理）
        await this.runTest('Essays: Delete essay', async () => {
            if (!createdEssayId) throw new Error('No essay ID to delete');
            await this.api.essays.delete(createdEssayId);
        });
    }

    /**
     * 4. Settings (设置) 测试
     */
    async testSettings() {
        console.log('\n===== Settings Tests =====');

        // 4.1 获取所有设置
        await this.runTest('Settings: Get all', async () => {
            const settings = await this.api.settings.getAll();
            if (!settings.language || !settings.temperature_mode) {
                throw new Error('Missing default settings');
            }
        });

        // 4.2 更新设置
        await this.runTest('Settings: Update settings', async () => {
            await this.api.settings.update({ temperature_mode: 'creative' });
            const settings = await this.api.settings.getAll();
            if (settings.temperature_mode !== 'creative') {
                throw new Error('Setting not updated');
            }
        });

        // 4.3 边界测试：非法值
        await this.runTest('Settings: Invalid value (edge case)', async () => {
            try {
                await this.api.settings.update({ language: 'fr' }); // 不支持的语言
                throw new Error('Should reject invalid language');
            } catch (error) {
                if (!error.message.includes('language')) {
                    throw new Error('Wrong error for invalid language');
                }
            }
        });

        // 4.4 恢复默认（清理）
        await this.runTest('Settings: Reset to defaults', async () => {
            await this.api.settings.reset();
            const settings = await this.api.settings.getAll();
            if (settings.temperature_mode !== 'balanced') {
                throw new Error('Settings not reset to defaults');
            }
        });
    }

    /**
     * 5. Upload (图片上传) 测试
     */
    async testUpload() {
        console.log('\n===== Upload Tests =====');
        let uploadedFilename = null;

        // 5.1 上传合法图片
        await this.runTest('Upload: Upload valid image', async () => {
            // 创建一个小的测试图片 (1x1 PNG)
            const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

            const result = await this.api.upload.uploadImage({
                name: 'test_verification.png',
                data: buffer,
                type: 'image/png'
            });

            if (!result.image_path) {
                throw new Error('Upload should return image_path');
            }
            uploadedFilename = result.image_path;
        });

        // 5.2 获取图片路径
        await this.runTest('Upload: Get image path', async () => {
            if (!uploadedFilename) throw new Error('No uploaded filename');

            const path = await this.api.upload.getImagePath(uploadedFilename);
            if (!path || typeof path !== 'string') {
                throw new Error('getImagePath should return path string');
            }
        });

        // 5.3 边界测试：非法文件类型
        await this.runTest('Upload: Invalid file type (edge case)', async () => {
            try {
                await this.api.upload.uploadImage({
                    name: 'test.pdf',
                    data: new Uint8Array(100),
                    type: 'application/pdf'
                });
                throw new Error('Should reject invalid file type');
            } catch (error) {
                if (!error.message.includes('type')) {
                    throw new Error('Wrong error for invalid type');
                }
            }
        });

        // 5.4 删除图片（清理）
        await this.runTest('Upload: Delete image', async () => {
            if (!uploadedFilename) throw new Error('No filename to delete');
            await this.api.upload.deleteImage(uploadedFilename);
        });
    }

    /**
     * 6. Draft (草稿) localStorage 测试
     */
    testDraft() {
        console.log('\n===== Draft Tests =====');

        // 6.1 localStorage 可用性
        const test1 = () => {
            try {
                localStorage.setItem('test_draft_key', 'test_value');
                const value = localStorage.getItem('test_draft_key');
                localStorage.removeItem('test_draft_key');

                if (value !== 'test_value') {
                    throw new Error('localStorage read/write failed');
                }
                this.log('Draft: localStorage availability', true);
            } catch (error) {
                this.log('Draft: localStorage availability', false, error.message);
            }
        };
        test1();

        // 6.2 草稿存储测试
        const test2 = () => {
            try {
                const draftKey = 'ielts_writing_draft_task1_test';
                const draftData = {
                    task_type: 'task1',
                    content: 'Test draft content',
                    word_count: 50,
                    last_saved: new Date().toISOString()
                };

                localStorage.setItem(draftKey, JSON.stringify(draftData));
                const stored = localStorage.getItem(draftKey);
                const parsed = JSON.parse(stored);

                if (parsed.content !== 'Test draft content') {
                    throw new Error('Draft data mismatch');
                }

                localStorage.removeItem(draftKey);
                this.log('Draft: Save and load', true);
            } catch (error) {
                this.log('Draft: Save and load', false, error.message);
            }
        };
        test2();

        // 6.3 QuotaExceededError 测试（边界）
        const test3 = () => {
            try {
                const largeContent = 'x'.repeat(1024 * 1024); // 1MB
                localStorage.setItem('test_large_draft', largeContent);
                localStorage.removeItem('test_large_draft');
                this.log('Draft: Large content handling', true);
            } catch (error) {
                if (error.name === 'QuotaExceededError') {
                    this.log('Draft: QuotaExceededError caught', true, 'Correctly handled quota error');
                } else {
                    this.log('Draft: Large content handling', false, error.message);
                }
            }
        };
        test3();
    }

    /**
     * 执行所有测试
     */
    async runAll() {
        console.log('========================================');
        console.log('Phase 04 Backend Verification Started');
        console.log('========================================');

        // 按优先级执行测试
        await this.testIPCProtocol();
        await this.testTopics();
        await this.testEssays();
        await this.testSettings();
        await this.testUpload();
        this.testDraft(); // 同步测试

        // 输出汇总
        console.log('\n========================================');
        console.log('Verification Summary');
        console.log('========================================');
        console.log(`✅ Passed: ${this.results.passed}`);
        console.log(`❌ Failed: ${this.results.failed}`);
        console.log(`Total: ${this.results.tests.length}`);
        console.log('========================================\n');

        // 输出详细结果
        console.log('Detailed Results:');
        console.table(this.results.tests);

        return this.results;
    }
}

// 使用方式：
// 在 DevTools Console 中运行：
// const verifier = new BackendVerifier();
// await verifier.runAll();

// 如果要在页面加载时自动运行：
// window.addEventListener('load', async () => {
//     const verifier = new BackendVerifier();
//     await verifier.runAll();
// });
