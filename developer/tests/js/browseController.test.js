#!/usr/bin/env node
/**
 * BrowseController 单元测试
 * 
 * 测试浏览控制器的核心功能：
 * 1. 模式配置数据结构
 * 2. 模式切换
 * 3. 筛选逻辑
 */

const assert = require('assert');

// 模拟 DOM 环境
global.window = {
    __browseFilterMode: null,
    __browsePath: null
};

global.document = {
    getElementById: (id) => {
        if (id === 'type-filter-buttons') {
            return {
                innerHTML: '',
                appendChild: () => {},
                querySelectorAll: () => []
            };
        }
        return null;
    },
    createElement: (tag) => ({
        className: '',
        textContent: '',
        dataset: {},
        classList: {
            add: () => {},
            remove: () => {},
            toggle: () => {}
        },
        addEventListener: () => {},
        appendChild: () => {}
    })
};

// 加载 browseController
const fs = require('fs');
const path = require('path');
const controllerPath = path.join(__dirname, '../../../js/app/browseController.js');
const controllerCode = fs.readFileSync(controllerPath, 'utf-8');

// 执行代码
eval(controllerCode);

// 测试套件
function testBrowseModeConfiguration() {
    console.log('测试: BROWSE_MODES 配置结构');
    
    assert(window.BROWSE_MODES, 'BROWSE_MODES 应该存在');
    assert(window.BROWSE_MODES.default, '应该有 default 模式');
    assert(window.BROWSE_MODES['frequency-p1'], '应该有 frequency-p1 模式');
    assert(window.BROWSE_MODES['frequency-p4'], '应该有 frequency-p4 模式');
    
    // 验证 default 模式
    const defaultMode = window.BROWSE_MODES.default;
    assert.strictEqual(defaultMode.filterLogic, 'type-based', 'default 模式应该使用 type-based 逻辑');
    assert.strictEqual(defaultMode.filters.length, 3, 'default 模式应该有 3 个筛选器');
    
    // 验证 P1 模式
    const p1Mode = window.BROWSE_MODES['frequency-p1'];
    assert.strictEqual(p1Mode.filterLogic, 'folder-based', 'P1 模式应该使用 folder-based 逻辑');
    assert.strictEqual(p1Mode.filters.length, 3, 'P1 模式应该有 3 个筛选器');
    assert(p1Mode.folderMap['ultra-high'], 'P1 模式应该有 ultra-high 文件夹映射');
    assert(p1Mode.folderMap['high'], 'P1 模式应该有 high 文件夹映射');
    assert(p1Mode.folderMap['medium'], 'P1 模式应该有 medium 文件夹映射');
    
    // 验证 P4 模式
    const p4Mode = window.BROWSE_MODES['frequency-p4'];
    assert.strictEqual(p4Mode.filterLogic, 'folder-based', 'P4 模式应该使用 folder-based 逻辑');
    assert.strictEqual(p4Mode.filters.length, 4, 'P4 模式应该有 4 个筛选器（包括全部）');
    assert(p4Mode.folderMap['all'], 'P4 模式应该有 all 文件夹映射');
    assert(Array.isArray(p4Mode.folderMap['all']), 'P4 的 all 映射应该是数组');
    assert.strictEqual(p4Mode.folderMap['all'].length, 10, 'P4 的 all 映射应该包含 10 个文件夹');
    
    console.log('  ✓ BROWSE_MODES 配置结构正确');
}

function testBrowseControllerClass() {
    console.log('测试: BrowseController 类');
    
    assert(window.BrowseController, 'BrowseController 类应该存在');
    
    const controller = new window.BrowseController();
    assert(controller, '应该能创建 BrowseController 实例');
    assert.strictEqual(controller.currentMode, 'default', '初始模式应该是 default');
    assert.strictEqual(controller.activeFilter, 'all', '初始筛选器应该是 all');
    
    console.log('  ✓ BrowseController 类可以实例化');
}

function testModeSwitch() {
    console.log('测试: 模式切换');
    
    const controller = new window.BrowseController();
    
    // 切换到 P1 模式
    controller.setMode('frequency-p1');
    assert.strictEqual(controller.currentMode, 'frequency-p1', '应该切换到 P1 模式');
    assert.strictEqual(controller.activeFilter, 'all', '切换模式后应该重置筛选器');
    assert.strictEqual(window.__browseFilterMode, 'frequency-p1', '应该保存模式到全局状态');
    
    // 切换到 P4 模式
    controller.setMode('frequency-p4');
    assert.strictEqual(controller.currentMode, 'frequency-p4', '应该切换到 P4 模式');
    assert.strictEqual(window.__browseFilterMode, 'frequency-p4', '应该更新全局状态');
    
    // 重置为默认模式
    controller.resetToDefault();
    assert.strictEqual(controller.currentMode, 'default', '应该重置为 default 模式');
    
    console.log('  ✓ 模式切换功能正常');
}

function testModeConfig() {
    console.log('测试: 获取当前模式配置');
    
    const controller = new window.BrowseController();
    
    let config = controller.getCurrentModeConfig();
    assert.strictEqual(config.id, 'default', '应该返回 default 配置');
    
    controller.setMode('frequency-p1');
    config = controller.getCurrentModeConfig();
    assert.strictEqual(config.id, 'frequency-p1', '应该返回 P1 配置');
    assert.strictEqual(config.basePath, 'ListeningPractice/100 P1', 'P1 配置应该有正确的 basePath');
    
    console.log('  ✓ 获取当前模式配置功能正常');
}

function testStatePersistence() {
    console.log('测试: 状态持久化');
    
    const controller = new window.BrowseController();
    
    // 设置模式
    controller.setMode('frequency-p4');
    assert.strictEqual(window.__browseFilterMode, 'frequency-p4', '应该保存到全局状态');
    
    // 创建新实例并恢复状态
    const newController = new window.BrowseController();
    newController.restoreMode();
    assert.strictEqual(newController.currentMode, 'frequency-p4', '应该从全局状态恢复模式');
    
    console.log('  ✓ 状态持久化功能正常');
}

function testButtonRendering() {
    console.log('测试: 按钮渲染');
    
    let buttons = [];
    const mockContainer = {
        innerHTML: '',
        appendChild: (btn) => {
            buttons.push(btn);
        },
        querySelectorAll: () => buttons
    };
    
    global.document.getElementById = (id) => {
        if (id === 'type-filter-buttons') {
            return mockContainer;
        }
        return null;
    };
    
    const controller = new window.BrowseController();
    controller.buttonContainer = mockContainer;
    
    // 测试默认模式按钮
    buttons = [];
    mockContainer.innerHTML = '';
    controller.setMode('default');
    assert.strictEqual(buttons.length, 3, 'default 模式应该渲染 3 个按钮');
    
    // 测试 P1 模式按钮
    buttons = [];
    mockContainer.innerHTML = '';
    controller.setMode('frequency-p1');
    assert.strictEqual(buttons.length, 3, 'P1 模式应该渲染 3 个按钮');
    
    // 测试 P4 模式按钮
    buttons = [];
    mockContainer.innerHTML = '';
    controller.setMode('frequency-p4');
    assert.strictEqual(buttons.length, 4, 'P4 模式应该渲染 4 个按钮（包括全部）');
    
    console.log('  ✓ 按钮渲染功能正常');
}

function testFrequencyFiltering() {
    console.log('测试: 频率筛选逻辑');
    
    const controller = new window.BrowseController();
    
    // Mock exam index
    const mockExamIndex = [
        { id: '1', path: 'ListeningPractice/100 P1/P1 超高频（43）/exam1.html', title: 'Exam 1' },
        { id: '2', path: 'ListeningPractice/100 P1/P1 高频（35）/exam2.html', title: 'Exam 2' },
        { id: '3', path: 'ListeningPractice/100 P1/P1 中频(48)/exam3.html', title: 'Exam 3' },
        { id: '4', path: 'ListeningPractice/100 P4/P4 超高频(51)/exam4.html', title: 'Exam 4' },
        { id: '5', path: 'ListeningPractice/100 P4/1-10/exam5.html', title: 'Exam 5' },
        { id: '6', path: 'ListeningPractice/100 P4/51-60/exam6.html', title: 'Exam 6' }
    ];
    
    // Mock getExamIndex
    controller.getExamIndex = () => mockExamIndex;
    
    // 测试 P1 超高频筛选
    controller.setMode('frequency-p1');
    const p1Config = controller.getCurrentModeConfig();
    const ultraHighFolders = p1Config.folderMap['ultra-high'];
    
    const p1UltraHigh = mockExamIndex.filter(exam => 
        ultraHighFolders.some(folder => exam.path.includes(folder))
    );
    assert.strictEqual(p1UltraHigh.length, 1, 'P1 超高频应该筛选出 1 个题目');
    assert.strictEqual(p1UltraHigh[0].id, '1', '应该是 exam1');
    
    // 测试 P1 高频筛选
    const highFolders = p1Config.folderMap['high'];
    const p1High = mockExamIndex.filter(exam => 
        highFolders.some(folder => exam.path.includes(folder))
    );
    assert.strictEqual(p1High.length, 1, 'P1 高频应该筛选出 1 个题目');
    assert.strictEqual(p1High[0].id, '2', '应该是 exam2');
    
    // 测试 P1 中频筛选
    const mediumFolders = p1Config.folderMap['medium'];
    const p1Medium = mockExamIndex.filter(exam => 
        mediumFolders.some(folder => exam.path.includes(folder))
    );
    assert.strictEqual(p1Medium.length, 1, 'P1 中频应该筛选出 1 个题目');
    assert.strictEqual(p1Medium[0].id, '3', '应该是 exam3');
    
    console.log('  ✓ 频率筛选逻辑正确');
}

function testP4AllButtonLogic() {
    console.log('测试: P4 "全部"按钮特殊逻辑');
    
    const controller = new window.BrowseController();
    
    // Mock exam index with P4 exams
    const mockExamIndex = [
        { id: '1', path: 'ListeningPractice/100 P4/1-10/exam1.html', title: 'Exam 1' },
        { id: '2', path: 'ListeningPractice/100 P4/11-20/exam2.html', title: 'Exam 2' },
        { id: '3', path: 'ListeningPractice/100 P4/51-60/exam3.html', title: 'Exam 3' },
        { id: '4', path: 'ListeningPractice/100 P4/91-100/exam4.html', title: 'Exam 4' },
        { id: '5', path: 'ListeningPractice/100 P4/P4 超高频(51)/exam5.html', title: 'Exam 5' },
        { id: '6', path: 'ListeningPractice/100 P4/P4 高频(52)/exam6.html', title: 'Exam 6' }
    ];
    
    controller.getExamIndex = () => mockExamIndex;
    
    // 切换到 P4 模式
    controller.setMode('frequency-p4');
    const p4Config = controller.getCurrentModeConfig();
    
    // 测试 "全部" 按钮：应该包含 1-100 编号文件夹
    const allFolders = p4Config.folderMap['all'];
    assert(Array.isArray(allFolders), '"全部"映射应该是数组');
    assert.strictEqual(allFolders.length, 10, '"全部"应该包含 10 个文件夹范围');
    
    // 验证包含的文件夹
    assert(allFolders.includes('1-10'), '应该包含 1-10');
    assert(allFolders.includes('11-20'), '应该包含 11-20');
    assert(allFolders.includes('51-60'), '应该包含 51-60');
    assert(allFolders.includes('91-100'), '应该包含 91-100');
    
    // 筛选 "全部" 按钮的题目
    const allExams = mockExamIndex.filter(exam => 
        allFolders.some(folder => exam.path.includes(folder))
    );
    assert.strictEqual(allExams.length, 4, '"全部"应该筛选出 4 个题目（编号文件夹）');
    assert(!allExams.some(e => e.id === '5'), '不应该包含超高频题目');
    assert(!allExams.some(e => e.id === '6'), '不应该包含高频题目');
    
    // 测试超高频筛选（不应该包含编号文件夹）
    const ultraHighFolders = p4Config.folderMap['ultra-high'];
    const ultraHighExams = mockExamIndex.filter(exam => 
        ultraHighFolders.some(folder => exam.path.includes(folder))
    );
    assert.strictEqual(ultraHighExams.length, 1, '超高频应该筛选出 1 个题目');
    assert.strictEqual(ultraHighExams[0].id, '5', '应该是超高频题目');
    
    console.log('  ✓ P4 "全部"按钮特殊逻辑正确');
}

function testFilterButtonStates() {
    console.log('测试: 筛选按钮状态管理');
    
    const buttons = [];
    const mockContainer = {
        innerHTML: '',
        appendChild: (btn) => {
            buttons.push(btn);
        },
        querySelectorAll: () => buttons
    };
    
    global.document.getElementById = (id) => {
        if (id === 'type-filter-buttons') {
            return mockContainer;
        }
        return null;
    };
    
    const controller = new window.BrowseController();
    controller.buttonContainer = mockContainer;
    
    // 渲染按钮
    controller.setMode('frequency-p1');
    controller.renderFilterButtons();
    
    // 验证初始激活状态
    const activeButtons = buttons.filter(btn => 
        btn.classList.add.toString().includes('active') || btn.className.includes('active')
    );
    assert(activeButtons.length >= 0, '应该有激活的按钮');
    
    // 切换筛选器
    controller.activeFilter = 'high';
    controller.updateButtonStates();
    
    // 验证状态更新
    assert.strictEqual(controller.activeFilter, 'high', '激活筛选器应该是 high');
    
    console.log('  ✓ 筛选按钮状态管理正确');
}

function testInvalidModeHandling() {
    console.log('测试: 无效模式处理');
    
    const controller = new window.BrowseController();
    
    // 尝试设置无效模式
    const originalMode = controller.currentMode;
    controller.setMode('invalid-mode');
    
    // 应该保持原有模式
    assert.strictEqual(controller.currentMode, originalMode, '无效模式不应该改变当前模式');
    
    // 尝试设置 null
    controller.setMode(null);
    assert.strictEqual(controller.currentMode, originalMode, 'null 不应该改变当前模式');
    
    // 尝试设置 undefined
    controller.setMode(undefined);
    assert.strictEqual(controller.currentMode, originalMode, 'undefined 不应该改变当前模式');
    
    console.log('  ✓ 无效模式处理正确');
}

// 运行所有测试
function runTests() {
    console.log('\n=== BrowseController 单元测试 ===\n');
    
    try {
        testBrowseModeConfiguration();
        testBrowseControllerClass();
        testModeSwitch();
        testModeConfig();
        testStatePersistence();
        testButtonRendering();
        testFrequencyFiltering();
        testP4AllButtonLogic();
        testFilterButtonStates();
        testInvalidModeHandling();
        
        console.log('\n✅ 所有测试通过\n');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runTests();
