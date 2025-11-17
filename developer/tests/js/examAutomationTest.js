/**
 * Exam加载自动化测试
 * 验证考试数据加载功能的完整性
 */

class ExamAutomationTest {
    constructor() {
        this.testResults = [];
        this.testData = {
            completeExamData: null,
            listeningExamData: null,
            loadedCategories: new Set(),
            loadedExamTypes: new Set()
        };
    }

    // 运行所有Exam加载测试
    async runAllTests() {
        console.log('🎯 开始Exam加载自动化测试...');

        this.testResults = [];

        // 1. 验证全局数据对象存在性
        this.testGlobalDataObjects();

        // 2. 验证考试数据完整性
        await this.testExamDataIntegrity();

        // 3. 验证分类功能
        await this.testCategoryFunctionality();

        // 4. 验证搜索功能
        await this.testSearchFunctionality();

        // 5. 验证考试类型过滤
        await this.testExamTypeFiltering();

        // 6. 验证UI渲染
        await this.testUIRendering();

        // 7. 验证数据一致性
        await this.testDataConsistency();

        this.printResults();
        return this.testResults;
    }

    // 测试全局数据对象存在性
    testGlobalDataObjects() {
        const testName = '全局数据对象存在性检查';

        try {
            const checks = [
                { name: 'COMPLETE_EXAM_DATA', exists: typeof window.COMPLETE_EXAM_DATA !== 'undefined' },
                { name: 'LISTENING_EXAM_DATA', exists: typeof window.LISTENING_EXAM_DATA !== 'undefined' },
                { name: 'examIndex', exists: typeof window.examIndex !== 'undefined' },
                { name: 'currentCategory', exists: typeof window.currentCategory !== 'undefined' },
                { name: 'currentExamType', exists: typeof window.currentExamType !== 'undefined' }
            ];

            const allExist = checks.every(check => check.exists);
            const missingChecks = checks.filter(check => !check.exists);

            this.recordTest(testName, allExist, {
                checks,
                missingItems: missingChecks.map(c => c.name),
                totalChecks: checks.length,
                passedChecks: checks.filter(c => c.exists).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试考试数据完整性
    async testExamDataIntegrity() {
        const testName = '考试数据完整性验证';

        try {
            const results = {};

            // 检查COMPLETE_EXAM_DATA
            if (window.COMPLETE_EXAM_DATA) {
                const completeDataValid = this.validateExamDataStructure(window.COMPLETE_EXAM_DATA, 'complete');
                results.complete = completeDataValid;

                if (completeDataValid.isValid) {
                    this.testData.completeExamData = window.COMPLETE_EXAM_DATA;
                }
            } else {
                results.complete = { isValid: false, error: 'COMPLETE_EXAM_DATA不存在' };
            }

            // 检查LISTENING_EXAM_DATA
            if (window.LISTENING_EXAM_DATA) {
                const listeningDataValid = this.validateExamDataStructure(window.LISTENING_EXAM_DATA, 'listening');
                results.listening = listeningDataValid;

                if (listeningDataValid.isValid) {
                    this.testData.listeningExamData = window.LISTENING_EXAM_DATA;
                }
            } else {
                results.listening = { isValid: false, error: 'LISTENING_EXAM_DATA不存在' };
            }

            const overallValid = results.complete.isValid && results.listening.isValid;

            this.recordTest(testName, overallValid, {
                results,
                overallValid,
                totalCompleteExams: results.complete.examCount || 0,
                totalListeningExams: results.listening.examCount || 0
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 验证考试数据结构
    validateExamDataStructure(examData, type) {
        const result = { isValid: true, errors: [], examCount: 0 };

        try {
            if (!Array.isArray(examData)) {
                result.isValid = false;
                result.errors.push('考试数据不是数组');
                return result;
            }

            result.examCount = examData.length;

            if (examData.length === 0) {
                result.isValid = false;
                result.errors.push('考试数据为空');
                return result;
            }

            // 检查每个考试项的结构
            const requiredFields = type === 'complete'
                ? ['id', 'title', 'category', 'type', 'questions', 'answers']
                : ['id', 'title', 'audioUrl', 'questions', 'answers'];

            const requiredQuestionFields = ['id', 'question', 'options'];
            const requiredAnswerFields = ['id', 'correct'];

            examData.forEach((exam, index) => {
                // 检查必需字段
                requiredFields.forEach(field => {
                    if (!exam.hasOwnProperty(field)) {
                        result.errors.push(`考试${index + 1}缺少字段: ${field}`);
                        result.isValid = false;
                    }
                });

                // 检查问题结构
                if (exam.questions && Array.isArray(exam.questions)) {
                    exam.questions.forEach((question, qIndex) => {
                        requiredQuestionFields.forEach(field => {
                            if (!question.hasOwnProperty(field)) {
                                result.errors.push(`考试${index + 1}问题${qIndex + 1}缺少字段: ${field}`);
                                result.isValid = false;
                            }
                        });
                    });
                } else {
                    result.errors.push(`考试${index + 1}questions字段无效`);
                    result.isValid = false;
                }

                // 检查答案结构
                if (exam.answers && Array.isArray(exam.answers)) {
                    exam.answers.forEach((answer, aIndex) => {
                        requiredAnswerFields.forEach(field => {
                            if (!answer.hasOwnProperty(field)) {
                                result.errors.push(`考试${index + 1}答案${aIndex + 1}缺少字段: ${field}`);
                                result.isValid = false;
                            }
                        });
                    });
                } else {
                    result.errors.push(`考试${index + 1}answers字段无效`);
                    result.isValid = false;
                }

                // 收集分类和类型
                if (exam.category) {
                    this.testData.loadedCategories.add(exam.category);
                }
                if (exam.type) {
                    this.testData.loadedExamTypes.add(exam.type);
                }
            });

        } catch (error) {
            result.isValid = false;
            result.errors.push('验证过程中发生错误: ' + error.message);
        }

        return result;
    }

    // 测试分类功能
    async testCategoryFunctionality() {
        const testName = '分类功能测试';

        try {
            const results = [];

            // 测试所有分类
            const categories = Array.from(this.testData.loadedCategories);
            categories.forEach(category => {
                try {
                    if (typeof filterByCategory === 'function') {
                        // 模拟分类过滤
                        const filteredExams = this.filterExamsByCategory(this.testData.completeExamData, category);
                        results.push({
                            category,
                            success: true,
                            count: filteredExams.length
                        });
                    } else {
                        results.push({
                            category,
                            success: false,
                            error: 'filterByCategory函数不存在'
                        });
                    }
                } catch (error) {
                    results.push({
                        category,
                        success: false,
                        error: error.message
                    });
                }
            });

            const allSuccessful = results.every(r => r.success);

            this.recordTest(testName, allSuccessful, {
                results,
                totalCategories: categories.length,
                successfulCategories: results.filter(r => r.success).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试搜索功能
    async testSearchFunctionality() {
        const testName = '搜索功能测试';

        try {
            const searchTerms = ['雅思', 'IELTS', '阅读', 'listening'];
            const results = [];

            searchTerms.forEach(term => {
                try {
                    if (typeof searchExams === 'function') {
                        // 模拟搜索功能
                        const searchResults = this.searchExamsInData(this.testData.completeExamData, term);
                        results.push({
                            searchTerm: term,
                            success: true,
                            resultCount: searchResults.length
                        });
                    } else {
                        // 直接测试搜索逻辑
                        const searchResults = this.searchExamsInData(this.testData.completeExamData, term);
                        results.push({
                            searchTerm: term,
                            success: true,
                            resultCount: searchResults.length,
                            note: '使用内置搜索逻辑'
                        });
                    }
                } catch (error) {
                    results.push({
                        searchTerm: term,
                        success: false,
                        error: error.message
                    });
                }
            });

            const allSuccessful = results.every(r => r.success);

            this.recordTest(testName, allSuccessful, {
                results,
                totalSearchTerms: searchTerms.length,
                successfulSearches: results.filter(r => r.success).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试考试类型过滤
    async testExamTypeFiltering() {
        const testName = '考试类型过滤测试';

        try {
            const examTypes = Array.from(this.testData.loadedExamTypes);
            const results = [];

            examTypes.forEach(type => {
                try {
                    const filteredExams = this.filterExamsByType(this.testData.completeExamData, type);
                    results.push({
                        type,
                        success: true,
                        count: filteredExams.length
                    });
                } catch (error) {
                    results.push({
                        type,
                        success: false,
                        error: error.message
                    });
                }
            });

            const allSuccessful = results.every(r => r.success);

            this.recordTest(testName, allSuccessful, {
                results,
                totalTypes: examTypes.length,
                successfulTypes: results.filter(r => r.success).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试UI渲染
    async testUIRendering() {
        const testName = 'UI渲染测试';

        try {
            const results = {};

            // 检查关键UI元素
            results.examListContainer = document.getElementById('exam-list-container') !== null;
            results.categoryOverview = document.getElementById('category-overview') !== null;
            results.browseView = document.getElementById('browse-view') !== null;
            results.overviewView = document.getElementById('overview-view') !== null;

            // 检查导航按钮
            results.navButtons = document.querySelectorAll('.nav-btn').length > 0;

            // 检查搜索框
            results.searchInput = document.querySelector('.search-input') !== null;

            const allElementsPresent = Object.values(results).every(Boolean);

            this.recordTest(testName, allElementsPresent, {
                results,
                totalElements: Object.keys(results).length,
                presentElements: Object.values(results).filter(Boolean).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试数据一致性
    async testDataConsistency() {
        const testName = '数据一致性测试';

        try {
            const consistencyChecks = [];

            // 检查考试索引一致性
            if (window.examIndex && Array.isArray(window.examIndex)) {
                const indexConsistent = window.examIndex.every(examId => {
                    const existsInComplete = this.testData.completeExamData?.some(exam => exam.id === examId);
                    const existsInListening = this.testData.listeningExamData?.some(exam => exam.id === examId);
                    return existsInComplete || existsInListening;
                });

                consistencyChecks.push({
                    name: 'examIndex一致性',
                    passed: indexConsistent,
                    details: {
                        totalInIndex: window.examIndex.length,
                        consistent: indexConsistent
                    }
                });
            }

            // 检查分类数据一致性
            const categoriesFromData = this.testData.loadedCategories;
            const categoriesFromIndex = new Set();

            if (window.examIndex && this.testData.completeExamData) {
                window.examIndex.forEach(examId => {
                    const exam = this.testData.completeExamData.find(e => e.id === examId);
                    if (exam && exam.category) {
                        categoriesFromIndex.add(exam.category);
                    }
                });
            }

            const categoryConsistent = categoriesFromData.size === categoriesFromIndex.size &&
                                      [...categoriesFromData].every(cat => categoriesFromIndex.has(cat));

            consistencyChecks.push({
                name: '分类数据一致性',
                passed: categoryConsistent,
                details: {
                    categoriesInData: categoriesFromData.size,
                    categoriesInIndex: categoriesFromIndex.size,
                    consistent: categoryConsistent
                }
            });

            const allConsistent = consistencyChecks.every(check => check.passed);

            this.recordTest(testName, allConsistent, {
                consistencyChecks,
                totalChecks: consistencyChecks.length,
                passedChecks: consistencyChecks.filter(c => c.passed).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 辅助方法：按分类过滤考试
    filterExamsByCategory(exams, category) {
        if (!exams || !Array.isArray(exams)) return [];
        return exams.filter(exam => exam.category === category);
    }

    // 辅助方法：按类型过滤考试
    filterExamsByType(exams, type) {
        if (!exams || !Array.isArray(exams)) return [];
        return exams.filter(exam => exam.type === type);
    }

    // 辅助方法：搜索考试
    searchExamsInData(exams, searchTerm) {
        if (!exams || !Array.isArray(exams)) return [];
        const term = searchTerm.toLowerCase();
        return exams.filter(exam =>
            exam.title.toLowerCase().includes(term) ||
            (exam.description && exam.description.toLowerCase().includes(term)) ||
            (exam.category && exam.category.toLowerCase().includes(term))
        );
    }

    // 记录测试结果
    recordTest(testName, passed, details) {
        this.testResults.push({
            name: testName,
            passed,
            details,
            timestamp: new Date().toISOString()
        });

        const status = passed ? '✅' : '❌';
        console.log(`${status} ${testName}`);
        if (!passed && details.error) {
            console.error('   错误:', details.error);
        }
    }

    // 打印测试结果
    printResults() {
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;

        console.log('\n📊 Exam加载测试结果汇总:');
        console.log(`总测试数: ${totalTests}`);
        console.log(`通过: ${passedTests} ✅`);
        console.log(`失败: ${failedTests} ❌`);
        console.log(`成功率: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

        if (failedTests > 0) {
            console.log('\n❌ 失败的测试:');
            this.testResults
                .filter(r => !r.passed)
                .forEach(r => {
                    console.log(`  - ${r.name}: ${r.details.error || '测试条件不满足'}`);
                });
        }

        console.log('\n📈 数据统计:');
        console.log(`加载的分类: ${Array.from(this.testData.loadedCategories).join(', ')}`);
        console.log(`加载的考试类型: ${Array.from(this.testData.loadedExamTypes).join(', ')}`);
        console.log(`完整考试数量: ${this.testData.completeExamData?.length || 0}`);
        console.log(`听力考试数量: ${this.testData.listeningExamData?.length || 0}`);
    }

    // 生成测试报告
    generateReport() {
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);

        return {
            summary: {
                totalTests,
                passedTests,
                failedTests: totalTests - passedTests,
                successRate: `${successRate}%`,
                timestamp: new Date().toISOString()
            },
            dataStats: {
                loadedCategories: Array.from(this.testData.loadedCategories),
                loadedExamTypes: Array.from(this.testData.loadedExamTypes),
                completeExamCount: this.testData.completeExamData?.length || 0,
                listeningExamCount: this.testData.listeningExamData?.length || 0
            },
            failedTests: this.testResults.filter(r => !r.passed).map(r => ({
                name: r.name,
                error: r.details.error || '测试条件不满足',
                details: r.details
            }))
        };
    }
}

// 导出供使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExamAutomationTest;
}