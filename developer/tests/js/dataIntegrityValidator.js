/**
 * 数据完整性验证器
 * 验证序列化/反序列化过程的数据完整性
 */

class DataIntegrityValidator {
    constructor() {
        this.validationResults = [];
        this.testCases = this.createTestCases();
    }

    // 创建测试用例
    createTestCases() {
        return {
            // 基础类型测试
            basicTypes: {
                simpleSet: new Set([1, 2, 3]),
                simpleMap: new Map([['a', 1], ['b', 2]]),
                emptySet: new Set(),
                emptyMap: new Map(),
                mixedSet: new Set(['string', 42, true, null]),
                mixedMap: new Map([['key1', 'value1'], [42, 'number key'], [null, 'null key']])
            },

            // 复杂嵌套测试
            complexNesting: {
                level1: {
                    level2: {
                        level3: {
                            deepSet: new Set(['deep1', 'deep2', 'deep3']),
                            deepMap: new Map([['deepKey1', { nested: 'object' }]])
                        }
                    },
                    arrayWithCollections: [
                        new Set(['set in array']),
                        new Map([['map', 'in array']]),
                        { normal: 'object' }
                    ]
                }
            },

            // 实际应用状态模拟
            appStateSimulation: {
                exam: {
                    index: ['exam1', 'exam2', 'exam3'],
                    currentCategory: 'reading',
                    currentExamType: 'academic',
                    filteredExams: ['exam1', 'exam3'],
                    configurations: new Map([
                        ['exam1', { timeLimit: 60, difficulty: 'medium' }],
                        ['exam2', { timeLimit: 80, difficulty: 'hard' }]
                    ])
                },
                practice: {
                    records: [
                        { id: 'r1', score: 85, type: 'reading', date: '2024-01-01' },
                        { id: 'r2', score: 92, type: 'listening', date: '2024-01-02' }
                    ],
                    selectedRecords: new Set(['r1', 'r2']),
                    bulkDeleteMode: false
                },
                ui: {
                    browseFilter: { category: 'reading', type: 'academic' },
                    loading: false,
                    currentVirtualScroller: null
                },
                system: {
                    processedSessions: new Set(['session1', 'session2', 'session3']),
                    fallbackExamSessions: new Map([
                        ['fallback1', { examId: 'exam1', data: 'backup1' }],
                        ['fallback2', { examId: 'exam2', data: 'backup2' }]
                    ]),
                    failedScripts: new Set(['script1'])
                }
            },

            // 边界情况测试
            edgeCases: {
                largeSet: new Set(Array.from({ length: 1000 }, (_, i) => `item${i}`)),
                largeMap: new Map(Array.from({ length: 1000 }, (_, i) => [`key${i}`, { data: `value${i}` }])),
                specialChars: new Set(['特殊字符', 'emoji 🚀', 'quotes "test"', "apostrophe 'test'"]),
                unicodeKeys: new Map([['键1', '值1'], ['🔑', '🔒'], ['café', 'résumé']]),
                cyclicReference: null // 将在运行时设置
            }
        };
    }

    // 设置循环引用测试
    setupCyclicReference() {
        const obj = { name: 'cyclic' };
        obj.self = obj;
        this.testCases.edgeCases.cyclicReference = {
            container: obj,
            normalSet: new Set([1, 2, 3])
        };
    }

    // 运行所有验证测试
    async runAllValidations() {
        console.log('🔍 开始数据完整性验证...');

        this.validationResults = [];

        // 设置循环引用测试
        this.setupCyclicReference();

        // 基础类型验证
        await this.validateBasicTypes();

        // 复杂嵌套验证
        await this.validateComplexNesting();

        // 应用状态验证
        await this.validateAppState();

        // 边界情况验证
        await this.validateEdgeCases();

        // 性能测试
        await this.validatePerformance();

        // 存储往返测试
        await this.validateStorageRoundTrip();

        this.printValidationResults();
        return this.validationResults;
    }

    // 验证基础类型
    async validateBasicTypes() {
        const category = '基础类型验证';

        for (const [name, value] of Object.entries(this.testCases.basicTypes)) {
            const result = await this.validateSingleValue(name, value, category);
            this.validationResults.push(result);
        }
    }

    // 验证复杂嵌套
    async validateComplexNesting() {
        const category = '复杂嵌套验证';

        for (const [name, value] of Object.entries(this.testCases.complexNesting)) {
            const result = await this.validateSingleValue(name, value, category);
            this.validationResults.push(result);
        }
    }

    // 验证应用状态
    async validateAppState() {
        const category = '应用状态验证';

        const result = await this.validateSingleValue('appState', this.testCases.appStateSimulation, category);
        this.validationResults.push(result);

        // 详细验证应用状态的各个部分
        const detailedChecks = [
            { path: 'exam.configurations', value: this.testCases.appStateSimulation.exam.configurations },
            { path: 'practice.selectedRecords', value: this.testCases.appStateSimulation.practice.selectedRecords },
            { path: 'system.processedSessions', value: this.testCases.appStateSimulation.system.processedSessions },
            { path: 'system.fallbackExamSessions', value: this.testCases.appStateSimulation.system.fallbackExamSessions }
        ];

        for (const check of detailedChecks) {
            const detailedResult = await this.validateSingleValue(check.path, check.value, `${category} - 详细检查`);
            this.validationResults.push(detailedResult);
        }
    }

    // 验证边界情况
    async validateEdgeCases() {
        const category = '边界情况验证';

        for (const [name, value] of Object.entries(this.testCases.edgeCases)) {
            const result = await this.validateSingleValue(name, value, category);
            this.validationResults.push(result);
        }
    }

    // 验证性能
    async validatePerformance() {
        const category = '性能验证';

        // 测试大Set的序列化性能
        const largeSet = this.testCases.edgeCases.largeSet;
        const iterations = 10;

        const startTime = performance.now();

        for (let i = 0; i < iterations; i++) {
            const serialized = StateSerializer.serialize(largeSet);
            const deserialized = StateSerializer.deserialize(serialized);
        }

        const endTime = performance.now();
        const avgTime = (endTime - startTime) / iterations;

        this.validationResults.push({
            category,
            name: '大Set序列化性能',
            passed: avgTime < 100, // 100ms阈值
            details: {
                iterations,
                totalTime: endTime - startTime,
                avgTime: avgTime.toFixed(2),
                setSize: largeSet.size
            }
        });

        // 测试大Map的序列化性能
        const largeMap = this.testCases.edgeCases.largeMap;
        const mapStartTime = performance.now();

        for (let i = 0; i < iterations; i++) {
            const serialized = StateSerializer.serialize(largeMap);
            const deserialized = StateSerializer.deserialize(serialized);
        }

        const mapEndTime = performance.now();
        const mapAvgTime = (mapEndTime - mapStartTime) / iterations;

        this.validationResults.push({
            category,
            name: '大Map序列化性能',
            passed: mapAvgTime < 100, // 100ms阈值
            details: {
                iterations,
                totalTime: mapEndTime - mapStartTime,
                avgTime: mapAvgTime.toFixed(2),
                mapSize: largeMap.size
            }
        });
    }

    // 验证存储往返
    async validateStorageRoundTrip() {
        const category = '存储往返验证';

        const testData = this.testCases.appStateSimulation;

        try {
            // 序列化并存储
            const serialized = StateSerializer.serialize(testData);
            await storage.set('integrity_test_data', serialized);

            // 从存储读取并反序列化
            const stored = await storage.get('integrity_test_data');
            const deserialized = StateSerializer.deserialize(stored);

            // 验证数据完整性
            const isIntact = this.validateDataEquality(testData, deserialized);

            // 清理测试数据
            await storage.remove('integrity_test_data');

            this.validationResults.push({
                category,
                name: 'LocalStorage往返',
                passed: isIntact,
                details: {
                    storageSuccess: true,
                    dataIntegrity: isIntact,
                    originalSize: JSON.stringify(serialized).length,
                    restoredSize: JSON.stringify(stored).length
                }
            });

        } catch (error) {
            this.validationResults.push({
                category,
                name: 'LocalStorage往返',
                passed: false,
                details: { error: error.message }
            });
        }
    }

    // 验证单个值
    async validateSingleValue(name, value, category) {
        try {
            const startTime = performance.now();

            // 序列化
            const serialized = StateSerializer.serialize(value);

            // 反序列化
            const deserialized = StateSerializer.deserialize(serialized);

            const endTime = performance.now();

            // 验证数据相等性
            const isEqual = this.validateDataEquality(value, deserialized);

            return {
                category,
                name,
                passed: isEqual,
                details: {
                    processingTime: (endTime - startTime).toFixed(2),
                    serializedSize: JSON.stringify(serialized).length,
                    type: value?.constructor?.name || typeof value,
                    ...(value instanceof Set && { setSize: value.size }),
                    ...(value instanceof Map && { mapSize: value.size })
                }
            };

        } catch (error) {
            return {
                category,
                name,
                passed: false,
                details: { error: error.message }
            };
        }
    }

    // 验证数据相等性
    validateDataEquality(original, restored) {
        // 处理null/undefined
        if (original === null || original === undefined) {
            return original === restored;
        }

        // 处理Set
        if (original instanceof Set) {
            if (!(restored instanceof Set) || original.size !== restored.size) {
                return false;
            }
            const origArray = Array.from(original).sort();
            const restArray = Array.from(restored).sort();
            return JSON.stringify(origArray) === JSON.stringify(restArray);
        }

        // 处理Map
        if (original instanceof Map) {
            if (!(restored instanceof Map) || original.size !== restored.size) {
                return false;
            }
            const origArray = Array.from(original.entries()).sort();
            const restArray = Array.from(restored.entries()).sort();
            return JSON.stringify(origArray) === JSON.stringify(restArray);
        }

        // 处理Date
        if (original instanceof Date) {
            return restored instanceof Date && original.getTime() === restored.getTime();
        }

        // 处理数组
        if (Array.isArray(original)) {
            if (!Array.isArray(restored) || original.length !== restored.length) {
                return false;
            }
            return original.every((item, index) => this.validateDataEquality(item, restored[index]));
        }

        // 处理普通对象
        if (typeof original === 'object') {
            if (typeof restored !== 'object' || original === null || restored === null) {
                return false;
            }

            const origKeys = Object.keys(original).sort();
            const restKeys = Object.keys(restored).sort();

            if (JSON.stringify(origKeys) !== JSON.stringify(restKeys)) {
                return false;
            }

            return origKeys.every(key => this.validateDataEquality(original[key], restored[key]));
        }

        // 处理基本类型
        return original === restored;
    }

    // 打印验证结果
    printValidationResults() {
        const totalTests = this.validationResults.length;
        const passedTests = this.validationResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;

        console.log('\n📊 数据完整性验证结果:');
        console.log(`总验证数: ${totalTests}`);
        console.log(`通过: ${passedTests} ✅`);
        console.log(`失败: ${failedTests} ❌`);
        console.log(`成功率: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

        // 按分类显示结果
        const categories = [...new Set(this.validationResults.map(r => r.category))];

        categories.forEach(category => {
            const categoryResults = this.validationResults.filter(r => r.category === category);
            const categoryPassed = categoryResults.filter(r => r.passed).length;
            const categoryTotal = categoryResults.length;

            console.log(`\n📁 ${category}: ${categoryPassed}/${categoryTotal} 通过`);

            const failedInCategory = categoryResults.filter(r => !r.passed);
            if (failedInCategory.length > 0) {
                console.log('  ❌ 失败项目:');
                failedInCategory.forEach(r => {
                    console.log(`    - ${r.name}: ${r.details.error || '数据不匹配'}`);
                });
            }
        });

        // 性能汇总
        const performanceResults = this.validationResults.filter(r =>
            r.category === '性能验证' && r.details.avgTime
        );

        if (performanceResults.length > 0) {
            console.log('\n⚡ 性能汇总:');
            performanceResults.forEach(r => {
                console.log(`  ${r.name}: ${r.details.avgTime}ms`);
            });
        }
    }

    // 生成验证报告
    generateReport() {
        const totalTests = this.validationResults.length;
        const passedTests = this.validationResults.filter(r => r.passed).length;
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);

        return {
            summary: {
                totalTests,
                passedTests,
                failedTests: totalTests - passedTests,
                successRate: `${successRate}%`,
                timestamp: new Date().toISOString()
            },
            categories: [...new Set(this.validationResults.map(r => r.category))].map(category => {
                const categoryResults = this.validationResults.filter(r => r.category === category);
                const passed = categoryResults.filter(r => r.passed).length;
                return {
                    name: category,
                    total: categoryResults.length,
                    passed,
                    failed: categoryResults.length - passed,
                    successRate: `${((passed / categoryResults.length) * 100).toFixed(1)}%`
                };
            }),
            failedTests: this.validationResults.filter(r => !r.passed).map(r => ({
                category: r.category,
                name: r.name,
                error: r.details.error || '数据不匹配'
            }))
        };
    }
}

// 导出供使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataIntegrityValidator;
}