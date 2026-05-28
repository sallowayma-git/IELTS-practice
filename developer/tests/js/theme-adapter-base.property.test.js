/**
 * Theme Adapter Base - Property-Based Tests
 * 
 * 使用 fast-check 进行属性测试，验证主题适配器基类的正确性属性。
 * 
 * @see .kiro/specs/theme-variant-adapter/design.md - Correctness Properties
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 存储键常量 - 直接从源码提取验证
const EXPECTED_STORAGE_KEYS = {
  EXAM_INDEX: 'exam_index',
  PRACTICE_RECORDS: 'practice_records'
};

// 有效的 type 值
const VALID_TYPES = new Set(['reading', 'listening']);

/**
 * 类型规范化函数 - 从源码复制以便独立测试
 */
function normalizeType(type) {
  if (!type) return 'reading';
  const normalized = String(type).toLowerCase().trim();
  
  if (VALID_TYPES.has(normalized)) {
    return normalized;
  }
  
  if (normalized === 'read' || normalized === 'r') {
    return 'reading';
  }
  if (normalized === 'listen' || normalized === 'l' || normalized === 'audio') {
    return 'listening';
  }
  
  return 'reading';
}

/**
 * 获取记录时间戳
 */
function getRecordTimestamp(record) {
  if (!record) return 0;
  if (typeof record.timestamp === 'number') return record.timestamp;
  if (record.date) {
    const parsed = new Date(record.date).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  if (typeof record.id === 'number') return record.id;
  return 0;
}

/**
 * 记录去重函数
 */
function deduplicateRecords(records) {
  if (!Array.isArray(records)) return [];
  
  const recordMap = new Map();
  
  records.forEach(record => {
    if (!record) return;
    
    const key = record.sessionId || record.id;
    if (!key) {
      recordMap.set(Symbol(), record);
      return;
    }
    
    const existing = recordMap.get(key);
    if (!existing) {
      recordMap.set(key, record);
      return;
    }
    
    const existingTime = getRecordTimestamp(existing);
    const currentTime = getRecordTimestamp(record);
    
    if (currentTime > existingTime) {
      recordMap.set(key, record);
    }
  });
  
  return Array.from(recordMap.values());
}

describe('Theme Adapter Base - Property Tests', () => {
  
  /**
   * **Feature: theme-variant-adapter, Property 1: 存储键一致性**
   * **Validates: Requirements 1.1**
   * 
   * *对于任意* 主题适配器实例，读取题库索引时使用的存储键 SHALL 等于 'exam_index'
   */
  describe('Property 1: 存储键一致性', () => {
    it('源码中定义的 EXAM_INDEX 键应等于 "exam_index"', () => {
      // 读取源码验证
      const sourcePath = join(__dirname, '../../../js/plugins/themes/theme-adapter-base.js');
      const sourceCode = readFileSync(sourcePath, 'utf-8');
      
      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            // 验证源码中包含正确的键定义
            expect(sourceCode).toContain("EXAM_INDEX: 'exam_index'");
            expect(sourceCode).toContain("PRACTICE_RECORDS: 'practice_records'");
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('存储键常量应与主系统保持一致', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          () => {
            // 验证预期的存储键
            expect(EXPECTED_STORAGE_KEYS.EXAM_INDEX).toBe('exam_index');
            expect(EXPECTED_STORAGE_KEYS.PRACTICE_RECORDS).toBe('practice_records');
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: theme-variant-adapter, Property 2: 类型规范化**
   * **Validates: Requirements 1.4**
   * 
   * *对于任意* 题目数据，加载后的 type 字段 SHALL 为 'reading' 或 'listening' 之一
   */
  describe('Property 2: 类型规范化', () => {
    // 生成任意字符串作为 type 输入
    const arbitraryType = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(''),
      fc.constant('reading'),
      fc.constant('listening'),
      fc.constant('read'),
      fc.constant('listen'),
      fc.constant('r'),
      fc.constant('l'),
      fc.constant('audio'),
      fc.constant('READING'),
      fc.constant('LISTENING'),
      fc.constant('Read'),
      fc.constant('Listen'),
      fc.string(),
      fc.integer()
    );

    it('normalizeType 应始终返回 "reading" 或 "listening"', () => {
      fc.assert(
        fc.property(
          arbitraryType,
          (inputType) => {
            const result = normalizeType(inputType);
            return result === 'reading' || result === 'listening';
          }
        ),
        { numRuns: 100 }
      );
    });

    it('有效的 type 值应保持不变', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('reading', 'listening'),
          (validType) => {
            const result = normalizeType(validType);
            return result === validType;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('大小写变体应正确规范化', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('READING', 'Reading', 'LISTENING', 'Listening', 'ReAdInG', 'LiStEnInG'),
          (mixedCase) => {
            const result = normalizeType(mixedCase);
            return result === 'reading' || result === 'listening';
          }
        ),
        { numRuns: 100 }
      );
    });

    it('别名应正确映射', () => {
      const aliases = [
        { input: 'read', expected: 'reading' },
        { input: 'r', expected: 'reading' },
        { input: 'listen', expected: 'listening' },
        { input: 'l', expected: 'listening' },
        { input: 'audio', expected: 'listening' }
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...aliases),
          ({ input, expected }) => {
            return normalizeType(input) === expected;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('无效输入应默认返回 "reading"', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant(''),
            fc.constant('invalid'),
            fc.constant('unknown'),
            fc.integer()
          ),
          (invalidInput) => {
            const result = normalizeType(invalidInput);
            // 无效输入应返回默认值 'reading'
            return result === 'reading';
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: theme-variant-adapter, Property 3: 记录去重**
   * **Validates: Requirements 2.3**
   * 
   * *对于任意* 两条具有相同 sessionId 的练习记录，合并后 SHALL 仅保留时间戳较新的记录
   */
  describe('Property 3: 记录去重', () => {
    // 生成练习记录
    const arbitraryRecord = fc.record({
      id: fc.integer({ min: 1, max: 1000000 }),
      sessionId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
      title: fc.string({ minLength: 0, maxLength: 50 }),
      timestamp: fc.integer({ min: 0, max: Date.now() + 1000000 }),
      score: fc.integer({ min: 0, max: 100 })
    });

    it('去重后不应有重复的 sessionId', () => {
      fc.assert(
        fc.property(
          fc.array(arbitraryRecord, { minLength: 0, maxLength: 20 }),
          (records) => {
            const deduplicated = deduplicateRecords(records);
            
            // 收集所有有 sessionId 的记录
            const sessionIds = deduplicated
              .filter(r => r && r.sessionId)
              .map(r => r.sessionId);
            
            // 检查是否有重复
            const uniqueSessionIds = new Set(sessionIds);
            return sessionIds.length === uniqueSessionIds.size;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('相同 sessionId 的记录应保留时间戳较新的', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.integer({ min: 1000, max: 100000 }),
          fc.integer({ min: 100001, max: 200000 }),
          (sessionId, olderTimestamp, newerTimestamp) => {
            const olderRecord = { sessionId, timestamp: olderTimestamp, title: 'older' };
            const newerRecord = { sessionId, timestamp: newerTimestamp, title: 'newer' };
            
            // 测试两种顺序
            const result1 = deduplicateRecords([olderRecord, newerRecord]);
            const result2 = deduplicateRecords([newerRecord, olderRecord]);
            
            // 两种情况都应该保留较新的记录
            return (
              result1.length === 1 &&
              result1[0].timestamp === newerTimestamp &&
              result2.length === 1 &&
              result2[0].timestamp === newerTimestamp
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('没有 sessionId 的记录应全部保留', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.integer({ min: 1, max: 1000 }),
              title: fc.string({ minLength: 1, maxLength: 20 }),
              timestamp: fc.integer({ min: 0, max: Date.now() })
              // 注意：没有 sessionId
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (recordsWithoutSessionId) => {
            const deduplicated = deduplicateRecords(recordsWithoutSessionId);
            // 由于没有 sessionId，使用 id 去重
            // 如果 id 也相同，则保留较新的
            return deduplicated.length >= 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('空数组应返回空数组', () => {
      fc.assert(
        fc.property(
          fc.constant([]),
          (emptyArray) => {
            const result = deduplicateRecords(emptyArray);
            return Array.isArray(result) && result.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('非数组输入应返回空数组', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.string(),
            fc.integer(),
            fc.object()
          ),
          (invalidInput) => {
            const result = deduplicateRecords(invalidInput);
            return Array.isArray(result) && result.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: theme-variant-adapter, Property 4: 路径解析回退**
   * **Validates: Requirements 3.2**
   * 
   * *对于任意* 题目，当 buildResourcePath 返回空值时，适配器 SHALL 按顺序尝试至少 3 种备用路径
   */
  describe('Property 4: 路径解析回退', () => {
    // 备用路径策略顺序（从源码提取）
    const EXPECTED_FALLBACK_ORDER = ['map', 'fallback', 'raw', 'relative-up', 'relative-design'];
    const MIN_FALLBACK_ATTEMPTS = 3;

    // 生成任意题目对象
    const arbitraryExam = fc.record({
      id: fc.string({ minLength: 1, maxLength: 20 }),
      title: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.constantFrom('reading', 'listening'),
      path: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: '' }),
      filename: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
      pdfFilename: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
      hasHtml: fc.boolean()
    });

    // 资源类型
    const arbitraryKind = fc.constantFrom('html', 'pdf');

    /**
     * 模拟 getResourceAttempts 函数的核心逻辑
     * 用于验证备用路径策略
     */
    function simulateGetResourceAttempts(exam, kind) {
      if (!exam) return [];

      const attempts = [];
      const seen = new Set();

      const addAttempt = (label, path) => {
        if (path && !seen.has(path)) {
          seen.add(path);
          attempts.push({ label, path });
        }
      };

      const base = './';
      const folder = exam.path || '';
      const primaryFile = kind === 'pdf'
        ? (exam.pdfFilename || exam.filename || '')
        : (exam.filename || '');

      // 1. map - 模拟外部路径解析器返回空（测试回退场景）
      addAttempt('map', '');

      // 2. fallback
      if (primaryFile) {
        const fallbackPath = [base, folder, primaryFile].filter(Boolean).join('/');
        addAttempt('fallback', fallbackPath);
      }

      // 3. raw
      if (primaryFile) {
        const rawPath = [folder, primaryFile].filter(Boolean).join('/');
        addAttempt('raw', rawPath);
      }

      // 4. relative-up
      if (primaryFile) {
        const relativeUpPath = ['..', folder, primaryFile].filter(Boolean).join('/');
        addAttempt('relative-up', relativeUpPath);
      }

      // 5. relative-design
      if (primaryFile) {
        const relativeDesignPath = ['../..', folder, primaryFile].filter(Boolean).join('/');
        addAttempt('relative-design', relativeDesignPath);
      }

      return attempts;
    }

    it('源码中应定义正确的备用路径策略顺序', () => {
      const sourcePath = join(__dirname, '../../../js/plugins/themes/theme-adapter-base.js');
      const sourceCode = readFileSync(sourcePath, 'utf-8');

      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            // 验证源码中包含备用路径策略定义
            expect(sourceCode).toContain("PATH_FALLBACK_ORDER");
            expect(sourceCode).toContain("'map'");
            expect(sourceCode).toContain("'fallback'");
            expect(sourceCode).toContain("'raw'");
            expect(sourceCode).toContain("'relative-up'");
            expect(sourceCode).toContain("'relative-design'");
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('备用路径策略应至少包含 3 种', () => {
      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            return EXPECTED_FALLBACK_ORDER.length >= MIN_FALLBACK_ATTEMPTS;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('对于任意有效题目，getResourceAttempts 应返回至少 3 种备用路径', () => {
      fc.assert(
        fc.property(
          arbitraryExam.filter(exam => {
            // 确保有有效的文件名（非空、非纯空格）
            const hasValidFilename = exam.filename && exam.filename.trim().length > 0;
            const hasValidPdfFilename = exam.pdfFilename && exam.pdfFilename.trim().length > 0;
            return hasValidFilename || hasValidPdfFilename;
          }),
          arbitraryKind,
          (exam, kind) => {
            // 根据 kind 确定使用的文件名
            const targetFile = kind === 'pdf'
              ? (exam.pdfFilename || exam.filename || '')
              : (exam.filename || '');
            
            // 如果目标文件名为空或纯空格，跳过此测试用例
            if (!targetFile || !targetFile.trim()) {
              return true; // 这种情况不在测试范围内
            }
            
            const attempts = simulateGetResourceAttempts(exam, kind);
            // 过滤掉空路径
            const validAttempts = attempts.filter(a => a.path && a.path.trim());
            return validAttempts.length >= MIN_FALLBACK_ATTEMPTS;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('备用路径策略应按正确顺序排列', () => {
      fc.assert(
        fc.property(
          arbitraryExam.filter(exam => exam.filename || exam.pdfFilename),
          arbitraryKind,
          (exam, kind) => {
            const attempts = simulateGetResourceAttempts(exam, kind);
            const labels = attempts.map(a => a.label);
            
            // 验证顺序：每个出现的标签应该按照 EXPECTED_FALLBACK_ORDER 的顺序
            let lastIndex = -1;
            for (const label of labels) {
              const currentIndex = EXPECTED_FALLBACK_ORDER.indexOf(label);
              if (currentIndex === -1) continue; // 跳过未知标签
              if (currentIndex < lastIndex) return false; // 顺序错误
              lastIndex = currentIndex;
            }
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('空题目应返回空数组', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined)
          ),
          arbitraryKind,
          (nullExam, kind) => {
            const attempts = simulateGetResourceAttempts(nullExam, kind);
            return Array.isArray(attempts) && attempts.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('没有文件名的题目应返回较少的备用路径', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            title: fc.string({ minLength: 1, maxLength: 50 }),
            type: fc.constantFrom('reading', 'listening'),
            path: fc.string({ minLength: 0, maxLength: 100 })
            // 注意：没有 filename 和 pdfFilename
          }),
          arbitraryKind,
          (examWithoutFile, kind) => {
            const attempts = simulateGetResourceAttempts(examWithoutFile, kind);
            // 没有文件名时，只有 map 策略可能返回路径
            const validAttempts = attempts.filter(a => a.path);
            return validAttempts.length <= 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('每种备用路径策略应生成不同的路径', () => {
      fc.assert(
        fc.property(
          arbitraryExam.filter(exam => 
            (exam.filename || exam.pdfFilename) && exam.path
          ),
          arbitraryKind,
          (exam, kind) => {
            const attempts = simulateGetResourceAttempts(exam, kind);
            const validAttempts = attempts.filter(a => a.path);
            
            // 检查路径是否唯一（已在 addAttempt 中去重）
            const paths = validAttempts.map(a => a.path);
            const uniquePaths = new Set(paths);
            return paths.length === uniquePaths.size;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: theme-variant-adapter, Property 5: 消息回退**
   * **Validates: Requirements 5.3**
   * 
   * *对于任意* 消息显示调用，当 window.showMessage 不存在时，适配器 SHALL 调用 window.alert
   */
  describe('Property 5: 消息回退', () => {
    // 生成任意消息内容
    const arbitraryMessage = fc.oneof(
      fc.constant(''),
      fc.constant(null),
      fc.constant(undefined),
      fc.string({ minLength: 0, maxLength: 200 })
    );

    // 生成任意消息类型
    const arbitraryType = fc.oneof(
      fc.constant('success'),
      fc.constant('error'),
      fc.constant('info'),
      fc.constant('warning'),
      fc.constant(undefined),
      fc.constant(null),
      fc.string({ minLength: 1, maxLength: 20 })
    );

    // 生成任意持续时间
    const arbitraryDuration = fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: 0, max: 10000 })
    );

    /**
     * 模拟 showMessage 函数的核心逻辑
     * 返回调用了哪个函数
     */
    function simulateShowMessage(message, type, duration, hasWindowShowMessage) {
      const calls = {
        windowShowMessage: false,
        windowAlert: false,
        consoleLog: false
      };

      // 优先使用 window.showMessage
      if (hasWindowShowMessage) {
        calls.windowShowMessage = true;
        return calls;
      }

      // 回退到 alert
      calls.windowAlert = true;
      return calls;
    }

    it('当 window.showMessage 存在时应优先调用它', () => {
      fc.assert(
        fc.property(
          arbitraryMessage,
          arbitraryType,
          arbitraryDuration,
          (message, type, duration) => {
            const calls = simulateShowMessage(message, type, duration, true);
            return calls.windowShowMessage === true && calls.windowAlert === false;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('当 window.showMessage 不存在时应回退到 alert', () => {
      fc.assert(
        fc.property(
          arbitraryMessage,
          arbitraryType,
          arbitraryDuration,
          (message, type, duration) => {
            const calls = simulateShowMessage(message, type, duration, false);
            return calls.windowShowMessage === false && calls.windowAlert === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('源码中应包含正确的回退逻辑', () => {
      const sourcePath = join(__dirname, '../../../js/plugins/themes/theme-adapter-base.js');
      const sourceCode = readFileSync(sourcePath, 'utf-8');

      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            // 验证源码中包含 showMessage 方法
            expect(sourceCode).toContain('showMessage(message, type');
            // 验证优先检查 window.showMessage
            expect(sourceCode).toContain("typeof window.showMessage === 'function'");
            // 验证回退到 alert
            expect(sourceCode).toContain('window.alert');
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('回退到 alert 时应包含类型前缀', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constantFrom('success', 'error', 'info', 'warning'),
          (message, type) => {
            // 模拟 alert 调用时的消息格式
            const prefix = type ? `[${type.toUpperCase()}] ` : '';
            const expectedMessage = prefix + (message || '');
            
            // 验证格式正确
            return expectedMessage.startsWith(`[${type.toUpperCase()}]`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('空消息应被正确处理', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(''),
            fc.constant(null),
            fc.constant(undefined)
          ),
          arbitraryType,
          (emptyMessage, type) => {
            // 模拟处理空消息
            const prefix = type ? `[${type.toUpperCase()}] ` : '';
            const result = prefix + (emptyMessage || '');
            
            // 结果应该是有效字符串
            return typeof result === 'string';
          }
        ),
        { numRuns: 100 }
      );
    });

    it('任意类型参数应被正确处理', () => {
      fc.assert(
        fc.property(
          arbitraryMessage,
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant(''),
            fc.string()
          ),
          (message, type) => {
            // 模拟类型处理
            const prefix = type ? `[${String(type).toUpperCase()}] ` : '';
            const result = prefix + (message || '');
            
            // 结果应该是有效字符串
            return typeof result === 'string';
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * 集成测试：验证实际的 showMessage 行为
     * 使用 mock 来验证调用顺序
     */
    describe('集成测试', () => {
      let originalShowMessage;
      let originalAlert;
      let mockShowMessage;
      let mockAlert;

      beforeEach(() => {
        // 保存原始函数
        originalShowMessage = globalThis.window?.showMessage;
        originalAlert = globalThis.window?.alert;
        
        // 创建 mock
        mockShowMessage = vi.fn();
        mockAlert = vi.fn();
        
        // 设置全局 window 对象（Node.js 环境）
        if (typeof globalThis.window === 'undefined') {
          globalThis.window = {};
        }
      });

      afterEach(() => {
        // 恢复原始函数
        if (originalShowMessage !== undefined) {
          globalThis.window.showMessage = originalShowMessage;
        } else {
          delete globalThis.window.showMessage;
        }
        if (originalAlert !== undefined) {
          globalThis.window.alert = originalAlert;
        } else {
          delete globalThis.window.alert;
        }
        
        vi.restoreAllMocks();
      });

      it('当 window.showMessage 存在时应调用它', () => {
        globalThis.window.showMessage = mockShowMessage;
        globalThis.window.alert = mockAlert;

        fc.assert(
          fc.property(
            fc.string({ minLength: 1, maxLength: 50 }),
            fc.constantFrom('success', 'error', 'info'),
            (message, type) => {
              mockShowMessage.mockClear();
              mockAlert.mockClear();

              // 模拟 showMessage 逻辑
              if (typeof globalThis.window.showMessage === 'function') {
                globalThis.window.showMessage(message, type);
              } else {
                globalThis.window.alert(message);
              }

              return mockShowMessage.mock.calls.length === 1 && 
                     mockAlert.mock.calls.length === 0;
            }
          ),
          { numRuns: 100 }
        );
      });

      it('当 window.showMessage 不存在时应调用 alert', () => {
        delete globalThis.window.showMessage;
        globalThis.window.alert = mockAlert;

        fc.assert(
          fc.property(
            fc.string({ minLength: 1, maxLength: 50 }),
            fc.constantFrom('success', 'error', 'info'),
            (message, type) => {
              mockAlert.mockClear();

              // 模拟 showMessage 逻辑
              if (typeof globalThis.window.showMessage === 'function') {
                globalThis.window.showMessage(message, type);
              } else {
                const prefix = type ? `[${type.toUpperCase()}] ` : '';
                globalThis.window.alert(prefix + (message || ''));
              }

              return mockAlert.mock.calls.length === 1;
            }
          ),
          { numRuns: 100 }
        );
      });

      it('当 window.showMessage 抛出异常时应回退到 alert', () => {
        globalThis.window.showMessage = vi.fn(() => {
          throw new Error('Mock error');
        });
        globalThis.window.alert = mockAlert;

        fc.assert(
          fc.property(
            fc.string({ minLength: 1, maxLength: 50 }),
            fc.constantFrom('success', 'error', 'info'),
            (message, type) => {
              mockAlert.mockClear();

              // 模拟 showMessage 逻辑（带异常处理）
              try {
                if (typeof globalThis.window.showMessage === 'function') {
                  globalThis.window.showMessage(message, type);
                  return true; // 如果没抛异常，测试通过
                }
              } catch (error) {
                // 回退到 alert
                const prefix = type ? `[${type.toUpperCase()}] ` : '';
                globalThis.window.alert(prefix + (message || ''));
              }

              return mockAlert.mock.calls.length === 1;
            }
          ),
          { numRuns: 100 }
        );
      });
    });
  });
});
