# Tauri 原生化 P0 产品闭环

## 目标
按审计优先级修复真实产品断链：完整数据备份、写作 AI 状态机、阅读资源与服务端判分；随后继续 Phase 7–10 收口。

## 当前批次
- [x] 阶段 1：并发实现数据安全、写作 AI、阅读主链
- [x] 阶段 2：主代理审查并集成三个边界
- [x] 阶段 3：修复集成回归与补充真实行为测试
- [x] 阶段 4：运行 cargo / typecheck / static / packaged gates
- [x] 阶段 5：提交本批产品闭环（`c922351`）

## 后续批次
- [x] Phase 7（完成）：Suite/Endless/Memorize/Timer 唯一归 Rust
- [x] Phase 8（完成）：Coach/Notes/Annotations/Vocab 产品闭环
- [x] Phase 9（完成）：dragdrop 键盘路径、god-page 拆分、视觉与性能
- [ ] Phase 10（进行中）：capability、签名、updater、回滚与跨平台发布
- [ ] Phase 11（进行中）：以 `F:\workspace\IELTS Atlas` 的 `opensource@4c32824` 为布局/玻璃交互参考，但建立唯一的冷色 Liquid Glass token 源，清除黄绿、暖棕与多 CSS 源叠加；保留 Tauri/Rust 数据边界与现有 DOM/E2E 契约。当前子阶段：收回 token 所有权、删除 Reading 深色主题、清理可达状态色、扩展 packaged 截图门禁。
- [ ] Phase 12（进行中）：按 `05dd163` 后的三路审计修复迁移断链。P0 的 annotation attempt isolation、Task prompt isolation、evaluation latest-result/recovery 与 cancel→resume 已落地；写作题库 first-class Rust store、AI default invariant、阅读 endless/memorize 边界、Task 1 图片和 PDF-only 路径均已主审并通过 focused gates。当前先修静态 AI 安全门禁的错误“文件所有者”假设，再按 static → packaged E2E 验证；之后基于 fresh binary 审计剩余粗糙 UI 和业务断链。禁止将中断代理的未审计修改视为完成。

### Phase 12.1 — packaged audit recovery (in progress)

- [x] Correct AI static-gate ownership and verify static suite 13/13 plus the packaged report.
- [ ] Restore fresh-install writing seed, canonical history projection, and explicit freeform/bank mode ownership.
- [ ] Repair Reading action/state ownership and constrained scroll layout.
- [ ] Remove Library's duplicate app shell and unscoped legacy visual owner; retain DOM/E2E contracts.
- [ ] Re-run focused tests, static gate, and packaged E2E; only then schedule the next P0 batch (history task type, backup secret availability, selected AI test, retention).

### Phase 12.2 — history/AI truth and Reading product language (queued)

- [ ] Make writing task type first-class in history without guessing old records as Task 2.
- [ ] Make per-config AI testing actually test that config; make restored backups fail closed when keys are absent.
- [ ] Remove Reading's developer/internal mixed-language residue while keeping the repaired mode and scroll contracts.

### Phase 12.3 — Settings and archive truth (queued)

- [ ] Replace the fake history-retention control with a Rust-owned retention policy and enforce it on completed attempts.
- [ ] Move Reading archive export/import to an atomic Rust boundary and make UI success/failure reflect the true report.
- [ ] Resolve score-filter scale explicitly instead of comparing reading ratios and writing bands as interchangeable numbers.
- [ ] Remove or replace Settings/Library cache/source-refresh controls that do not own any real backend action.

## 数据与兼容约束
- 新热路径只认规范 DTO；legacy 仅允许冷导入/读取 adapter。
- 不删除旧数据；迁移必须幂等且可验证。
- 不重新引入 Electron/Fastify/file:// 双运行时。
- 参考仓只迁移视觉 token、布局和可访问性交互；禁止迁移其浏览器 bundle、localStorage/IndexedDB、window.open/postMessage、Three/WebGL 背景与旧题库。
- 视觉 token 只有一个所有者：`apps/writing-vue/src/styles/opensource-skin.css`（后续可更名但不可多源覆盖）；`ShuiBackground` 只负责结构层，不得自带主题色。
- 子代理单次使用；并发派发后主代理立即等待全部返回。

## 错误记录
| 错误 | 尝试 | 处理 |
|---|---:|---|
| session-catchup 检测到 7 条未同步消息后因 GBK 无法输出 `✅` 崩溃 | 1 | 已人工核对 Git diff、旧 task_plan/progress；建立新 scoped plan，不重复同一编码失败 |
| PowerShell 嵌套 range 数组被扁平化，`Math::Min` 参数类型不匹配 | 1 | 改用每文件显式 Select-Object/索引范围，不复用该循环 |
| `cargo fmt --all -- --check` 发现 6 个文件格式差异 | 1 | 仅修本轮 modified `suite.rs`；history/import/draft/backup command/diagnostics 为未修改既有债，不运行全局 fmt 污染用户代码 |
| Phase 7/8/9 三个并发代理均发生外部 response stream/network disconnect | 1 | 不复用失败代理；先核查共享 worktree 的部分修改，再用新代理或主代理接管 |
| 缩小上下文重派后 Phase 7/9 仍发生同类 stream disconnect | 2 | 停止继续盲目重派；主代理接管 Phase 7/9，保留成功的 Phase 8 修改 |
| 假设 `crates/ielts-db/src/enrichment/` 存在导致 Select-String path error | 1 | 用 Get-ChildItem/现有 module map 定位实际 annotations/coach/vocab 路径，不重复错误路径 |
| 列出 `api.ts` 后仍误读 `api.js` | 1 | 按已发现的精确 `api.ts` 路径读取，不重复扩展名假设 |
| Phase 8 合并后 Vue typecheck 9 errors | 1 | 按 coach/list、annotation DTO、highlight normalize 精确收紧类型；禁止用全局 any/ts-ignore |
| PracticeReadingPage highlight patch 锚定 `<div>`，实际 workspace 标签上下文不符 | 1 | 读取精确行后以稳定 data/class 上下文重打，不重复宽泛标签锚点 |
| suite import 手误加入不存在的 `list_answer_key` | 1 | 在运行编译前立即删除，使用现有 `load_answer_key`；未扩散到其他文件 |
| 删除 endless composable 的多文件 patch 因 `loadReadingAssetPool` 上下文不符整体回滚 | 1 | 分开读取/删除 import、ensure、destructure与文件，避免一个锚点阻断全 patch |
| phase7_modes test compile 仍构造已删除 client pool/forced next 字段 | 1 | 更新 fixture 为真实 answerable assets + policy/seed，删除 forced-next 假契约 |
| 假设 SQLite API 位于 `src/sqlite.rs` 导致并行读取命令失败 | 1 | 已从 `lib.rs` 确认 sqlite 是模块目录；改用递归定位实际文件，不重复错误路径 |
| findings 追加因精确上下文少一个空格未匹配 | 1 | 使用已知原始行的完整文本重试成功；不做宽泛替换 |
| Phase7 故障注入测试假设新建 Suite 首篇是 Pending，实际状态为 Active | 1 | 改为与注入前 session 快照比较，验证“不变”而非硬编码错误状态 |
| mode DTO 修复与测试合并 patch 因测试锚点受 rustfmt 改变而整体拒绝 | 1 | 拆分产品代码与测试 patch；先落产品修复，再按精确测试上下文追加断言 |
| 对 `src-tauri/src/lib.rs` 运行 rustfmt 递归格式化未在本轮范围的 backup/diagnostics | 1 | 核对纯格式 diff 后用 apply_patch 精确撤销；后续 check 使用 `--check`，不再格式化 lib.rs |
| 2026-07-14 三条 Phase9/Phase10/剩余引擎只读代理均被外部模型路由 403 拒绝 | 1 | 代理未修改工作区；不复用、不重派同类路由，主代理接管本地审计与实现 |
| 新 packaged Reading/Notes 门禁首跑失败 | 1 | Reading P95 已通过；截图发现正文竖列/undefined 题，Notes 测试未 focus opener。保留失败证据，分别修产品布局与测试驱动后复跑 |
| 本轮 PowerShell 项目门禁被 Windows 沙箱拒绝创建子进程，受控 typecheck 授权又因审批服务 429 被拒 | 2 | 不换壳绕过同一门禁；先完成独立审计/测试，保留 typecheck 待补证据 |
| `rg -F #divider` 的未引号 `#` 被 PowerShell 当作注释 | 1 | 改用单引号包裹固定字符串；不重复裸 `#` 命令 |
| Phase 10 三个一次性只读审计代理均被外部路由以非 Codex 模型 403 拒绝 | 1 | 代理未读取或修改工作区；不复用，主代理接管本地审计 |
| 删除测试生成的两个 `__pycache__` 被外部审批服务 503 拒绝 | 1 | 不绕过拒绝；生成物保持 untracked，并从显式暂存/提交范围排除 |
| registry 检索曾使用 Windows 不支持的引号内 wildcard/不存在的 Vue lib 路径 | 1 | 改用 `rg --files` 定位精确 crate 与现有 `src/api`；不复用错误路径 |
| 新 bundle verifier 首次对当前 target 报无 artifact | 1 | 当前只存在 `--no-bundle` EXE，失败正确；完成真实 `cargo tauri build` 后再复验，不把裸 EXE 当发布证据 |
| Phase 10 最终 static gate 两次在启动 Python 前被 Windows `CreateProcessAsUserW: 5` 拒绝 | 2 | 未产生测试结果、不绕过门禁；继续源码/UI 审计，执行器恢复后只重试官方 static→packaged 顺序 |
| session-catchup 首次恢复输出遇到 Windows GBK 的 `✅` 编码异常 | 1 | 设置 `PYTHONIOENCODING=utf-8` 后成功恢复；后续该脚本固定使用 UTF-8 |
| PowerShell 下将 wildcard 作为 `rg` 位置参数导致 Windows 路径语法错误 | 2 | 两次分别误用 `*.py/*.js` 与 `Reading*.vue`；后续只用 `rg -g '*.ext' <directory>`，不得再以路径 wildcard 搜索 |
| 在 `apps/writing-vue` 工作目录以仓库根相对路径执行 Vue shell Node 测试失败 | 1 | Node 测试改在仓库根执行，typecheck 继续在 Vue 子目录执行 |
| 直接执行历史 `practiceVueShell.test.js` 读取已删除的 `electron/main.js` 并失败 | 1 | 该脚本本身仍把 Electron 当产品入口，不能作为 Tauri 门禁；不再重复运行，改由官方 static suite 识别实际启用检查 |
| 将可选 `rg` 搜索放入 Promise.all，某个无匹配的 exit 1 使整组只读审计失败 | 1 | 已确认不是产品错误；后续可选定位改用 PowerShell `Select-String` 或单独执行，避免把“无匹配”当失败 |
| 扩展 Compose/Topic 打包视觉门禁后，官方 packaged E2E 在 184 秒超时 | 1 | 不重跑同一命令；先读取报告/截图/进程并按具体 route 收紧等待条件或修复真实页面加载问题 |

## 已完成提交
- `c922351 feat: close backup writing and reading P0 paths`
- `82091c3 feat: close native reading modes and enrichment flows`
