/**
 * 状态序列化器测试套件
 * 验证Set/Map对象的序列化/反序列化一致性
 */

class StateSerializerTest {
    constructor() {
        this.testResults = [];
        this.testData = {
            setExample: new Set(['item1', 'item2', 'item3']),
            mapExample: new Map([
                ['key1', 'value1'],
                ['key2', 'value2'],
                ['key3', { complex: 'object' }]
            ]),
            nestedObject: {
                level1: {
                    level2: {
                        setInside: new Set(['nested', 'set']),
                        mapInside: new Map([['nested', 'map']])
                    }
                },
                array: [
                    new Set(['set in array']),
                    new Map([['map', 'in array']])
                ]
            },
            mixedState: {
                exam: {
                    filteredExams: ['exam1', 'exam2'],
                    configurations: new Map([['config1', { enabled: true }]])
                },
                practice: {
                    selectedRecords: new Set(['record1', 'record2', 'record3']),
                    bulkDeleteMode: false
                },
                system: {
                    processedSessions: new Set(['session1', 'session2']),
                    fallbackExamSessions: new Map([['fallback1', { data: 'test' }]])
                }
            }
        };
    }

    // 运行所有测试
    async runAllTests() {
        console.log('🧪 开始状态序列化测试...');

        this.testResults = [];

        // 基础类型测试
        this.testSetSerialization();
        this.testMapSerialization();
        this.testDateSerialization();
        this.testNestedObjectSerialization();

        // 实际应用场景测试
        this.testActualAppState();
        this.testLocalStorageRoundTrip();
        this.testDataConsistency();

        this.printResults();
        return this.testResults;
    }

    // 测试Set序列化
    testSetSerialization() {
        const testName = 'Set序列化/反序列化';
        const original = this.testData.setExample;

        try {
            const serialized = StateSerializer.serialize(original);
            const deserialized = StateSerializer.deserialize(serialized);

            const isValid = this.validateSetEquality(original, deserialized);
            this.recordTest(testName, isValid, {
                original: Array.from(original),
                serialized,
                deserialized: Array.from(deserialized)
            });
        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试Map序列化
    testMapSerialization() {
        const testName = 'Map序列化/反序列化';
        const original = this.testData.mapExample;

        try {
            const serialized = StateSerializer.serialize(original);
            const deserialized = StateSerializer.deserialize(serialized);

            const isValid = this.validateMapEquality(original, deserialized);
            this.recordTest(testName, isValid, {
                original: Array.from(original.entries()),
                serialized,
                deserialized: Array.from(deserialized.entries())
            });
        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试Date序列化
    testDateSerialization() {
        const testName = 'Date序列化/反序列化';
        const original = new Date('2024-01-01T00:00:00.000Z');

        try {
            const serialized = StateSerializer.serialize(original);
            const deserialized = StateSerializer.deserialize(serialized);

            const isValid = deserialized instanceof Date && deserialized.getTime() === original.getTime();
            this.recordTest(testName, isValid, {
                original: original.toISOString(),
                serialized,
                deserialized: deserialized.toISOString()
            });
        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试嵌套对象序列化
    testNestedObjectSerialization() {
        const testName = '嵌套对象序列化/反序列化';
        const original = this.testData.nestedObject;

        try {
            const serialized = StateSerializer.serialize(original);
            const deserialized = StateSerializer.deserialize(serialized);

            const isValid = this.validateNestedObjectEquality(original, deserialized);
            this.recordTest(testName, isValid, {
                hasSetInside: deserialized.level1.level2.setInside instanceof Set,
                hasMapInside: deserialized.level1.level2.mapInside instanceof Map,
                setInsideSize: deserialized.level1.level2.setInside.size,
                mapInsideSize: deserialized.level1.level2.mapInside.size
            });
        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试实际应用状态
    testActualAppState() {
        const testName = '实际应用状态序列化';
        const original = this.testData.mixedState;

        try {
            const serialized = StateSerializer.serialize(original);
            const deserialized = StateSerializer.deserialize(serialized);

            const isValid = this.validateAppStateEquality(original, deserialized);
            this.recordTest(testName, isValid, {
                selectedRecordsCount: deserialized.practice.selectedRecords.size,
                processedSessionsCount: deserialized.system.processedSessions.size,
                fallbackSessionsCount: deserialized.system.fallbackExamSessions.size
            });
        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试LocalStorage往返
    async testLocalStorageRoundTrip() {
        const testName = 'LocalStorage往返测试';
        const original = this.testData.mixedState;

        try {
            // 序列化并存储
            const serialized = StateSerializer.serialize(original);
            const testKey = 'test_state_roundtrip';
            await storage.set(testKey, serialized);

            // 从存储读取并反序列化
            const stored = await storage.get(testKey);
            const deserialized = StateSerializer.deserialize(stored);

            // 清理测试数据
            await storage.remove(testKey);

            const isValid = this.validateAppStateEquality(original, deserialized);
            this.recordTest(testName, isValid, {
                storageSuccess: true,
                dataIntegrity: isValid
            });
        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试数据一致性
    testDataConsistency() {
        const testName = '数据一致性验证';
        const testCases = [
            new Set([]),
            new Set(['single']),
            new Set(['a', 'b', 'c', 'd', 'e']),
            new Map([]),
            new Map([['key', 'value']]),
            new Map([['a', 1], ['b', 2], ['c', 3]])
        ];

        let allPassed = true;
        const results = [];

        testCases.forEach((testCase, index) => {
            const isValid = StateSerializer.validate(testCase);
            results.push({ index, type: testCase.constructor.name, isValid });
            if (!isValid) allPassed = false;
        });

        this.recordTest(testName, allPassed, { results });
    }

    // 验证Set相等性
    validateSetEquality(set1, set2) {
        if (!(set2 instanceof Set)) return false;
        if (set1.size !== set2.size) return false;

        const arr1 = Array.from(set1).sort();
        const arr2 = Array.from(set2).sort();

        return JSON.stringify(arr1) === JSON.stringify(arr2);
    }

    // 验证Map相等性
    validateMapEquality(map1, map2) {
        if (!(map2 instanceof Map)) return false;
        if (map1.size !== map2.size) return false;

        const arr1 = Array.from(map1.entries()).sort();
        const arr2 = Array.from(map2.entries()).sort();

        return JSON.stringify(arr1) === JSON.stringify(arr2);
    }

    // 验证嵌套对象相等性
    validateNestedObjectEquality(obj1, obj2) {
        // 检查Set
        if (!this.validateSetEquality(obj1.level1.level2.setInside, obj2.level1.level2.setInside)) {
            return false;
        }

        // 检查Map
        if (!this.validateMapEquality(obj1.level1.level2.mapInside, obj2.level1.level2.mapInside)) {
            return false;
        }

        // 检查数组中的Set和Map
        if (!this.validateSetEquality(obj1.array[0], obj2.array[0])) {
            return false;
        }

        if (!this.validateMapEquality(obj1.array[1], obj2.array[1])) {
            return false;
        }

        return true;
    }

    // 验证应用状态相等性
    validateAppStateEquality(state1, state2) {
        // 检查practice.selectedRecords
        if (!this.validateSetEquality(state1.practice.selectedRecords, state2.practice.selectedRecords)) {
            return false;
        }

        // 检查system.processedSessions
        if (!this.validateSetEquality(state1.system.processedSessions, state2.system.processedSessions)) {
            return false;
        }

        // 检查system.fallbackExamSessions
        if (!this.validateMapEquality(state1.system.fallbackExamSessions, state2.system.fallbackExamSessions)) {
            return false;
        }

        return true;
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
        if (!passed) {
            console.error('   详情:', details);
        }
    }

    // 打印测试结果
    printResults() {
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;

        console.log('\n📊 测试结果汇总:');
        console.log(`总测试数: ${totalTests}`);
        console.log(`通过: ${passedTests} ✅`);
        console.log(`失败: ${failedTests} ❌`);
        console.log(`成功率: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

        if (failedTests > 0) {
            console.log('\n❌ 失败的测试:');
            this.testResults
                .filter(r => !r.passed)
                .forEach(r => console.log(`  - ${r.name}: ${r.details.error || '数据不匹配'}`));
        }
    }

    // 创建刷新测试页面
    static createRefreshTestPage() {
        const testPage = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>状态序列化刷新测试</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .test-section { margin: 20px 0; padding: 15px; border: 1px solid #ccc; }
        .result { margin: 10px 0; }
        .pass { color: green; }
        .fail { color: red; }
        button { padding: 10px 15px; margin: 5px; }
    </style>
</head>
<body>
    <h1>🔄 状态序列化刷新测试</h1>

    <div class="test-section">
        <h3>测试步骤:</h3>
        <ol>
            <li>点击"创建测试数据"创建Set/Map状态</li>
            <li>点击"保存状态到存储"</li>
            <li>刷新页面 (F5)</li>
            <li>点击"验证恢复的状态"</li>
        </ol>

        <button onclick="createTestData()">创建测试数据</button>
        <button onclick="saveState()">保存状态到存储</button>
        <button onclick="loadState()">加载状态</button>
        <button onclick="verifyState()">验证恢复的状态</button>
        <button onclick="runFullTest()">运行完整测试</button>
    </div>

    <div class="test-section">
        <h3>测试结果:</h3>
        <div id="test-results"></div>
    </div>

    <div class="test-section">
        <h3>当前状态:</h3>
        <pre id="current-state">无状态数据</pre>
    </div>

    <script src="js/utils/storage.js"></script>
    <script src="js/utils/stateSerializer.js"></script>
    <script src="js/utils/stateSerializerTest.js"></script>
    <script>
        let testState = null;
        const test = new StateSerializerTest();

        function createTestData() {
            testState = {
                selectedRecords: new Set(['record1', 'record2', 'record3']),
                processedSessions: new Set(['session1', 'session2']),
                fallbackSessions: new Map([['fallback1', { data: 'test' }]]),
                timestamp: new Date().toISOString()
            };

            updateDisplay('测试数据已创建');
        }

        async function saveState() {
            if (!testState) {
                alert('请先创建测试数据');
                return;
            }

            try {
                const serialized = StateSerializer.serialize(testState);
                await storage.set('refresh_test_state', serialized);
                updateDisplay('状态已保存到存储');
            } catch (error) {
                updateDisplay('保存失败: ' + error.message, true);
            }
        }

        async function loadState() {
            try {
                const stored = await storage.get('refresh_test_state');
                if (stored) {
                    testState = StateSerializer.deserialize(stored);
                    updateDisplay('状态已从存储加载');
                } else {
                    updateDisplay('未找到存储的状态', true);
                }
            } catch (error) {
                updateDisplay('加载失败: ' + error.message, true);
            }
        }

        function verifyState() {
            if (!testState) {
                updateDisplay('无状态数据可验证', true);
                return;
            }

            const results = [];

            // 验证Set
            const setValid = testState.selectedRecords instanceof Set && testState.selectedRecords.size === 3;
            results.push({
                name: 'selectedRecords Set',
                passed: setValid,
                details: setValid ? '✅ Set正确恢复' : '❌ Set恢复失败'
            });

            // 验证Map
            const mapValid = testState.fallbackSessions instanceof Map && testState.fallbackSessions.size === 1;
            results.push({
                name: 'fallbackSessions Map',
                passed: mapValid,
                details: mapValid ? '✅ Map正确恢复' : '❌ Map恢复失败'
            });

            const allPassed = results.every(r => r.passed);

            let html = '<h4>验证结果:</h4>';
            results.forEach(r => {
                html += `<div class="${r.passed ? 'pass' : 'fail'}">${r.details}</div>`;
            });
            html += `<div><strong>${allPassed ? '✅ 所有测试通过' : '❌ 测试失败'}</strong></div>`;

            document.getElementById('test-results').innerHTML = html;
        }

        async function runFullTest() {
            await test.runAllTests();
        }

        function updateDisplay(message, isError = false) {
            document.getElementById('current-state').textContent =
                JSON.stringify(testState, (key, value) => {
                    if (value instanceof Set) return `Set(${Array.from(value).join(', ')})`;
                    if (value instanceof Map) return `Map(${Array.from(value.entries()).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})`;
                    return value;
                }, 2);

            console.log((isError ? '❌' : '✅') + ' ' + message);
        }

        // 页面加载时尝试恢复状态
        window.addEventListener('load', async () => {
            await loadState();
            if (testState) {
                verifyState();
            }
        });
    </script>
</body>
</html>`;

        return testPage;
    }
}

// 导出供使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StateSerializerTest;
}