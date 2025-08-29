# 项目文件结构说明

## 📁 整理后的文件结构

```
项目根目录/
├── 📄 improved-working-system.html    # 主系统页面
├── 📄 index.html                      # 首页
├── 📄 README.md                       # 项目说明文档
├── 📄 FILE_STRUCTURE.md              # 文件结构说明（本文件）
│
├── 📁 assets/                         # 资源文件夹
│   ├── 📁 images/                     # 图片资源
│   │   ├── favicon.ico
│   │   ├── favicon.svg
│   │   └── 高低频推荐[ZYZ老师制作].jpg
│   ├── 📁 data/                       # 数据文件
│   │   └── 目录：高频(46)+次高频(16).xlsx
│   └── 📁 scripts/                    # 辅助脚本
│       ├── complete-exam-data.js
│       ├── enhance-practice-pages.cjs
│       ├── fix-communication-issues.cjs
│       └── start-server.bat
│
├── 📁 css/                           # 样式文件
│   ├── components.css
│   └── styles.css
│
├── 📁 js/                            # JavaScript 核心代码
│   ├── 📁 components/                # 组件文件
│   ├── 📁 core/                      # 核心功能
│   ├── 📁 utils/                     # 工具函数
│   ├── app.js                        # 主应用程序
│   └── ...
│
├── 📁 tests/                         # 测试文件
│   ├── cleanup-floating-buttons.js
│   ├── system-validation.js
│   ├── test-system-fixes.js
│   ├── test-console-fixes.js
│   └── ...
│
├── 📁 docs/                          # 文档文件
│   ├── SYSTEM_FIXES_SUMMARY.md
│   ├── faq.md
│   ├── installation-guide.md
│   └── ...
│
├── 📁 templates/                     # 模板文件
│   ├── ielts-exam-template.html
│   └── question-types.js
│
├── 📁 P1（12+8）/                    # P1 考试内容
├── 📁 P2（14+2）/                    # P2 考试内容
├── 📁 P3 （20+6）/                   # P3 考试内容
│
└── 📁 tools/                         # 开发工具
    ├── add_communication_code.js
    └── validate_new_exams.js
```

## 🔄 文件移动记录

### ✅ 已移动的文件

**图片资源 → assets/images/**
- favicon.ico
- favicon.svg  
- 高低频推荐[ZYZ老师制作].jpg

**数据文件 → assets/data/**
- 目录：高频(46)+次高频(16).xlsx

**脚本文件 → assets/scripts/**
- complete-exam-data.js
- enhance-practice-pages.cjs
- fix-communication-issues.cjs
- start-server.bat

**测试文件 → tests/**
- 所有 test-*.js 文件
- cleanup-floating-buttons.js
- system-validation.js
- integration-test.js
- validation-test.js
- validate-html.js

**文档文件 → docs/**
- SYSTEM_FIXES_SUMMARY.md

### ❌ 已删除的文件
- debug-exam-browser.html
- run-all-tests.html
- data/favicon.ico (重复文件)
- data/favicon.svg (重复文件)

## 🔧 更新的引用路径

在 `improved-working-system.html` 中更新了以下路径：
- `favicon.svg` → `assets/images/favicon.svg`
- `complete-exam-data.js` → `assets/scripts/complete-exam-data.js`
- 测试脚本路径 → `tests/` 目录

## 📋 保留的根目录文件

根据要求，以下文件保留在根目录：
- ✅ improved-working-system.html
- ✅ index.html  
- ✅ README.md
- ✅ 高低频推荐[ZYZ老师制作].jpg (已移动到 assets/images/)
- ✅ 目录：高频(46)+次高频(16).xlsx (已移动到 assets/data/)

## 🎯 整理效果

1. **文件分类清晰**: 按功能将文件分类到对应文件夹
2. **根目录简洁**: 只保留必要的主要文件
3. **引用路径正确**: 更新了所有相关的文件引用
4. **功能完整**: 不影响 improved-working-system.html 的正常运行
5. **便于维护**: 文件结构更加规范，便于后续开发和维护