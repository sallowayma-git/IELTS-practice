# develop-test

用于本地/沙箱环境的临时脚本与自动化测试资产，可在投产时整体移除。

- `test-streaming-e2e.py` / `test-e2e-simple.sh`：端到端流程演示脚本
- `verify-db-api-consistency.py`：后端接口与数据库一致性检查
- `test-fixes.js`：快速修复与调试脚本
- `quick-synt-check.py`：语法快速检查工具

> 正式构建时如果不需要这些脚本，可直接删除整个目录。
