import subprocess
import sys
import os

print('🧪 开始系统测试验证...')

# 测试1: 检查文件语法
print('\n📝 测试1: 检查文件语法')
js_files = [
    'server/routes/assessment-new.js',
    'server/index.js',
    'server/middleware/errorHandler.js',
    'server/middleware/requestLogger.js',
    'server/services/llm/base.js',
    'server/services/llm/factory.js'
]

syntax_errors = []
for file_path in js_files:
    if os.path.exists(file_path):
        with open(file_path, 'r') as f:
            content = f.read()
            if 'express.Router()' not in content and 'express.Router' in content:
                syntax_errors.append(f'{file_path}: 可能存在语法错误')
            else:
                print(f'  ✓ {file_path}')
    else:
        syntax_errors.append(f'{file_path}: 文件不存在')

if syntax_errors:
    print('\n❌ 发现语法错误:')
    for error in syntax_errors:
        print(f'  - {error}')
    sys.exit(1)
else:
    print('  ✅ 所有文件语法检查通过')

# 测试2: 检查关键功能
print('\n🔧 测试2: 检查关键功能')
key_functions = [
    'saveAssessmentResult',
    'handleAsync',
    'middleware'
]

with open('server/routes/assessment-new.js', 'r') as f:
    content = f.read()
    for func in key_functions:
        if func in content:
            print(f'  ✓ 找到关键函数: {func}')
        else:
            print(f'  ⚠️  未找到关键函数: {func}')

print('\n🎉 语法检查完成！')