import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 测试文件匹配模式
    include: ['tests/js/**/*.test.js', 'tests/js/**/*.property.test.js'],
    
    // 环境配置
    environment: 'node',
    
    // 全局设置
    globals: true,
    
    // 超时设置
    testTimeout: 30000,
    
    // 属性测试配置
    fakeTimers: {
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    }
  }
});
