# IELTS Practice v0.6.3.2 Release Notes

本次说明汇总已发布的 v0.6.3.1 至 v0.6.3.2 的主要变化，重点是阅读题库的篇目与标识修正、文章级复习计划，以及跨题库完成状态与 PDF 可用性的一致性。v0.6.3.2 已于 2026-11-05 发布；本文包含 [#269](https://github.com/sallowayma-git/IELTS-practice/issues/269) 的后续文档更正，已发布标签内的原始文档和下载资产保持不变。

## 主要更新

- **文章级复习计划**：新完成且有可靠评分的阅读练习可按 SM-2 间隔重复安排复习，并根据正确率自动评级。首次满分不建立计划，已有计划在满分重做后仍会推进；升级或仅导入旧练习记录不会自动把全部历史加入复习队列。计划按篇目和题库来源区分，套题按阅读子篇安排。
- **题库回放**：有可用复习任务的文章卡片可直接发起“回放（Replay）”；完成提交后先刷新复习任务索引，再重绘完成状态，避免漏显示新任务入口。
- **回放批注与并发复习**：回放更新按规范篇目标识校验，同时保留原记录的批注键。备份合并保留所依据的复习计划修订号，并在并发修改导致冲突时拒绝过期写入；用户需重新读取或预览后重试。
- **跨题库完成状态**：题库浏览按篇目 ID 判断完成状态，迁移后的旧记录和导入其他题库之前产生的记录可在匹配的篇目上显示为已完成；冷启动会先加载已保存的练习投影。旧记录的标题、路径或文件名回退匹配要求唯一，无法识别的记录不会被猜测归入某篇文章。完成状态跨题库共享不等于合并各题库的复习计划。
- **PDF 可用性**：已确认缺失的阅读 PDF 标记为不可用，保留定位信息；有 HTML 练习的篇目仍可练习。浏览、计数、书架操作和启动流程使用统一判定。此更新不补齐缺失的 PDF，实际打开仍需要本地提供对应文件。
- **十一月阅读频率**：更新高、中、低频标签及月份。篇目 ID 中的 `high` / `medium` / `low` 是既有标识的一部分，筛选和排序以频率字段为准。

## 修复与优化

- 活动阅读目录中每篇文章使用一个规范 ID：`p2-high-192`、`p2-low-051`、`p2-medium-058` 分别作为旧 ID 解析到 `p2-low-104`、`p2-low-140`、`p2-low-147`，保留已保存记录、收藏和生词来源的兼容性。标签树中保留的六个旧阅读／解析文件不重新加入活动目录。
- 复习登记优先采用明确的阅读／听力类型，再回退到 ID 和标题推断，避免文章被归入错误类型。
- 题库浏览：修复排队中的选择意图、弹窗复用和过期激活意图等竞态问题。
- 阅读内容：为未标注的导语块补充 Intro 标签，为 `p2-medium-243` 补充 A–H 段落标签，恢复白蚁丘图示标注。
- 内嵌版本号和诊断构建元数据更新为 `0.6.3.2`。诊断导出支持有界的四段版本号，修复此前将这类版本显示为 `unknown` 的问题；三段版本号仍受支持。

## 下载与文件范围

- 从 [v0.6.3.2 Release](https://github.com/sallowayma-git/IELTS-practice/releases/tag/v0.6.3.2) 下载 [ielts-practice-0.6.3.2.zip](https://github.com/sallowayma-git/IELTS-practice/releases/download/v0.6.3.2/ielts-practice-0.6.3.2.zip)，完整解压后打开 `index.html`，无需 Node.js 或构建环境；也可在解压目录运行本地 HTTP 服务或使用静态 HTTPS 托管。
- **下载的运行 ZIP：527 个文件。** 包含 `index.html`、`css/`、`js/bundles/` 和所需 `assets/`；不包含 README、演示 GIF、开发源码、开发文档、测试或构建工具，也不包含 `ReadingPractice/` PDF 题源目录。
- **`v0.6.3.2` 标签树：543 个文件。** 包含上述运行文件及 16 个已批准的附加文件：许可证／Git 分发元数据、两份 README、两份 release note、三个 README GIF，以及六个保留的旧阅读／解析文件。GitHub 自动生成的标签源码归档与单独上传的运行 ZIP 对应不同文件范围。
- **`opensource` / `main` 源码树**还包含开发源码、`developer/`、`scripts/` 等。构建和测试说明应在源码检出中使用；标签树及运行 ZIP 不提供这些开发工具。v0.6.3.2 的开发说明可在[已验收源码](https://github.com/sallowayma-git/IELTS-practice/tree/eb233ac75a38779ed1e01b6116aeb24837ab24cc)中查阅，包括[诊断验收](https://github.com/sallowayma-git/IELTS-practice/blob/eb233ac75a38779ed1e01b6116aeb24837ab24cc/developer/docs/diagnostic-acceptance.md)、[阅读统计](https://github.com/sallowayma-git/IELTS-practice/blob/eb233ac75a38779ed1e01b6116aeb24837ab24cc/developer/doc/Reading-Analytics-Contract.md)和[阅读计时](https://github.com/sallowayma-git/IELTS-practice/blob/eb233ac75a38779ed1e01b6116aeb24837ab24cc/developer/doc/Reading-Timing-Contract.md)。
- 默认分发采用 `INCLUDE_LOCAL_LISTENING=0`，保留应用听力包装页 `assets/generated/listening-exams/listening-practice-unified.html`，不包含可选的本地听力索引、音频或私有题库。需要听力题源时须自行准备本地扩展资源。

## 发布依据与验证范围

- 已发布标签指向 `5aa6f1e0e47fe9ee524ac5fc2ef2450ab53f4e80`；对应的已验收源码为 `eb233ac75a38779ed1e01b6116aeb24837ab24cc`。该源码的 [CI 41927052292](https://github.com/sallowayma-git/IELTS-practice/actions/runs/41927052292) 通过回归及 Windows／Ubuntu 运行包验收。
- [#267 发布验收记录](https://github.com/sallowayma-git/IELTS-practice/issues/267#issuecomment-6655552308)与[验证报告](https://github.com/sallowayma-git/IELTS-practice/releases/download/v0.6.3.2/release-verification-v0.6.3.2.json)记录文件清单、哈希和最终标签树检查。最终候选浏览器验证使用 Windows 上的 Chromium 151.0.7922.34；HTTPS 使用本地测试证书，未进行公开部署，也不代表其他浏览器均已验收。Windows CI 的五个文本文件换行差异已在报告中说明。
- 本文及 README 的后续更正属于文档修订，检查结果单独记录在 [#269](https://github.com/sallowayma-git/IELTS-practice/issues/269)。上述历史源码和运行包证据仍归属于原始 SHA，不作为后续文档提交已通过检查的证明。
