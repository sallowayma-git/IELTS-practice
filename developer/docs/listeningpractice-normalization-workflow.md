# ListeningPractice 题源收敛工作流（HTML 直改）

> 目标：统一题源标题与正确答案格式，消除“整句当答案”。

## 入口
- 技能：`~/.codex/skills/listeningpractice-normalizer/SKILL.md`
- 脚本：`developer/tests/tools/listeningpractice/`

## 快速步骤
1. 扫描：
```
python3 developer/tests/tools/listeningpractice/scan_listeningpractice_html.py \
  --root ListeningPractice
```
2. 记录 findings：
- 读 `developer/tests/reports/listeningpractice-scan.md`
- 把问题摘要与样本追加到 `findings.md`
3. 规范化（dry-run）：
```
python3 developer/tests/tools/listeningpractice/normalize_listeningpractice_html.py \
  --root ListeningPractice \
  --title-mode topic \
  --h1-mode keep
```
4. 复核后写入：
```
python3 developer/tests/tools/listeningpractice/normalize_listeningpractice_html.py \
  --root ListeningPractice \
  --title-mode topic \
  --h1-mode keep \
  --write \
  --backup-dir developer/tests/reports/backup-listeningpractice
```
5. 回归验证：
```
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
```

## 验收标准
- `correctAnswers_not_global` 与 `transcript_only_answers` 计数为 0
- 标题无 `IELTS Listening Practice` 前缀
- 结果区答案为单字符
