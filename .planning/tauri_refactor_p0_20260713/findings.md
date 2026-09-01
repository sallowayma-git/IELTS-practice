# P0 实施发现

## Phase 12 — AI default invariant subtask (2026-07-15)

- Scope is limited to the Rust AI configuration chain: a persisted default is valid only when its config is enabled and its secret reference resolves to a secret. Disabling or deleting that default must atomically choose another valid configuration or explicitly clear the default/unconfigure the provider.
- The first session-catchup invocation on this Windows host completed its useful report but then raised `UnicodeEncodeError` under the GBK console while printing an emoji. Do not treat it as repository corruption; use UTF-8 output for a later recovery run.

## Phase 12.1 — fresh packaged audit (2026-07-15)

- The static suite now passes 13/13. `check_ai_config_security.py` had been checking runtime mirror literals in `ai.rs`, although `settings/mod.rs` is the single writer. The corrected gate checks both the real writer and the command-layer reconciler/loader boundary.
- The packaged report itself completed with `status: passed` and fresh binary SHA `03e8174da28efceea9e3909525f8d87ce75ad370a6f77f1d70087daba12839d5`; the first outer shell ended at 60 seconds after the report was written, so its exit 124 is an execution-wrapper artifact, not an unobserved product assertion.
- Screenshot audit found a real duplicate shell: `App.vue` excludes Library from `NavBar`, Library recreates a brand/nav, and its 2,658-line unscoped CSS redefines generic `.view`/`.btn`. The intended single visual owner is not effective.
- Fresh DB has no bundled writing seed despite the UI claiming an official catalog. Reading history consumes snake_case records as camelCase and therefore renders valid records as zero/unknown. Compose defaults final freeform evaluation to `bank` through `client.js`.
- Reading layout is functionally broken for long material: pane content exceeds the fixed workspace while overflow is hidden; the bottom exit bypasses endless cancellation; memorize has a separate, incomplete read-only condition; and no-op snapshot actions still show success.

## Phase 12.1 — main review notes (2026-07-15)

- The data candidate has a useful boundary: `history-view-model.js` is now the single camelCase projection for Rust history DTOs, and the Compose toggle maps explicitly to `freeform`/`bank`. The built-in catalog is an app resource read by Rust and written to the canonical topics projection, rather than copied to frontend state.
- The Reading candidate consolidates `readOnlyMode` across interaction paths and makes the bottom exit emit a component event into the existing mode flow. Its layout uses a constrained grid row and pane-local scrolling; cross-layer tests must still prove the runtime DOM retains the intended height/exit behavior.
- The Library candidate deleted a very large legacy style block. Main review must prove the remaining selectors preserve all E2E attributes and that the global skin has not become a new specificity override layer.

## Phase 12.1 — packaged screenshot acceptance (2026-07-15)

- Fresh screenshots confirm the duplicate Library product header is gone. The Library now has one global product nav plus an appropriate reading-workspace tab strip; the catalog screenshot contains 232 seeded topics instead of a false empty state.
- Reading now displays the draft-recovery status in normal document flow and exposes independent pane scrollbars. Its remaining visible quality debt is product language: internal-facing `Vue 原生阅读链路`, `Note`, `Reset`, and `Submit` are still mixed into the Chinese desktop product.
- Writing Compose still uses a denser, more editorial layout than Library, but it shares the global product shell and no longer represents a duplicate app navigation. This is a later visual-normalization task, not a reason to undo the now-working Library boundary.

## Phase 12.2 — main review notes (2026-07-15)

- The v7 migration is conservative: it creates a nullable `attempts.task_type` and only writes it when all explicit sources agree. This preserves historical uncertainty rather than inventing Task 2. The query layer applies Task 1/2 filtering in SQLite.
- AI secret availability is now explicitly host-owned: SQLite can retain an opaque reference, but Tauri's vault adapter determines whether UI/default/runtime see it as usable. The restore command re-reconciles against that adapter and adds a warning without serializing a key.
- Reading language changes preserve the relevant `id` and data hooks and route the formerly direct exit link through the existing guarded leave event. The static shell test remains legacy-structured and must be evaluated through the official static runner rather than in isolation.

## Phase 12.2 — packaged acceptance (2026-07-15)

- Full static is now 14/14 after replacing the broken Electron-bound shell test with a Tauri/Vue contract. Fresh packaged E2E exits 0, passes 12/12, and yields Reading P95 79.6ms; the final screenshot confirms Chinese Reading controls and independent internal pane scrolling.
- Fresh Settings screenshot proves that catalog startup seeding is real (`总题目数: 232`, `Task 2: 232`), but also exposes the next real product debt: cache/refresh/retention controls are visually present before all of them own a Rust action. Do not treat those labels as completed functionality.

## 审计输入
- Backup DTO 仅保存 attempt summary/settings/secret refs，answers/annotations 明确为空。
- 写作 Compose 同步等待 provider；事件在结果页挂载前广播；evaluation DTO 无 id。
- AI settings 使用 `app`，eval policy 读取 `model`；`hasSecret` 被粗糙 secret heuristic 拒绝。
- 阅读 asset payload 被前端重复包裹；submit 携带客户端 answer key，Rust 未拥有判分真相。

## 实施发现
- Backup：schema v2 增加 typed SQLite table snapshots，覆盖当前 22 张规范表；dry-run/restore 同流程回滚/提交；保留 v1 summary 兼容并明确警告。
- Writing：start 立即返回持久 evaluation handle；provider 后台执行，Channel 实时流 + DB events 恢复；V4 增 id；app namespace 为规范、model 只读兼容；hasSecret/tokenBudget 不再误杀。
- Reading：submit DTO 删除 payload/answerKey；Rust 按 asset id + fingerprint/revision 重载本地资源判分；payload 单次解包；marks/timeline 进入 attempt_answers；清理旧 settings draft 镜像。
- 已知剩余：imported asset 外部文件未进入备份；reqwest cancel 只防止状态回写但不强杀请求；suite/endless reading submit 与模式推进仍不是一个 SQLite 事务。
- 合并工作区共 30 个 tracked 文件、2089 insertions/612 deletions，新增完整备份测试与 payload shape 测试；`git diff --check` 通过。
- 三条边界修改文件基本分离；交叉点集中在 domain DTO、reading mode submit 和写作前端生成类型，必须主代理核验序列化/command 参数兼容。
- 初步 API 核验：backup schema v2 使用固定 `CANONICAL_TABLES` + typed rows；writing command 已接受 `Channel<EvaluationEvent>` 并 background spawn；reading single/suite/endless DTO 均 `deny_unknown_fields` 且携带 revision/fingerprint/timeline，不再出现 submit payload。
- 仍需重点审查：backup 清表/插表顺序与未来 migration 兼容；writing Channel 参数的前端 invoke 形状及后台生命周期；reading asset identity 校验与 suite/endless 跨事务窗口。
- Backup 细查：固定父→子表顺序，清理时反序；dry-run 在真实 schema transaction 中执行后 drop 回滚；正式 restore 单 transaction + `foreign_key_check`。v2 目标列严格相等，未来 migration 必须显式升级备份 schema，当前行为 fail closed。
- Backup 已过滤 raw `secret_refs` namespace 并单独恢复 opaque refs；明文启发式只拒绝真实 secret-bearing keys/典型 token prefix，允许 `hasSecret/secretName` 元数据。
- Writing 细查：Tauri command 在 prepare/initial events 后立即 spawn 并返回 handle；background 只通过 AppHandle 重新取 DB/vault，不跨 await 持 SQLite guard。Channel 创建与 invoke 参数 `onEvent` 匹配，DB polling 继续用于晚挂载恢复。
- 前端 `evaluate.start` 现在只 await 快速 handle 后返回并启动 polling；取消按 DB 中 evaluation.id；getSessionState 从规范 V4 id 恢复。仍需核验 Channel + polling 的重复事件去重，以及 retry/结果页最终状态。
- Writing 事件去重由 EvaluatingPage 的 `(evaluationId, sequence)` 过滤完成；晚挂载 hydrate 先从 DB 拉全量事件，Channel 丢失不影响恢复。Retry 取消旧 evaluation 后复用 attempt，传旧 evaluation id 为 retryOf，并清空新序列集合。
- 发现一个非阻断 UI 债：评测页打字速度仍用随机表现层动画；不影响结构化 stage/结果事实，但 Phase 9 应移除这种无意义随机并尊重 reduced motion。
- Reading 细查：draft/submit DTO 均拒绝未知字段；服务端通过 `load_practice_asset_payload` 检查 pdf_only、schema revision、fingerprint、answerKey 后评分。客户端不提供 answer key。
- Draft marks/timeline 先合并成 `attempt_answers`，包括标记但未作答题；旧 settings mirror 在同一 transaction 删除；open draft 从规范答案表恢复全部进度字段。
- Single submit 的 score/upsert/idempotency/旧镜像清理已在单一 transaction；suite/endless 外层推进仍是后续 Phase 7 的跨事务债。
- 本轮 modified Rust files 单独 `rustfmt --check` 全绿；全局 fmt 仅剩未修改既有文件。
- `cargo test --workspace` 全绿：ielts-db unit 17、AI security 3、full backup 4、import 7、phase3 5、phase4 4、phase5 10、phase6 7、phase7 4、phase8 3、Tauri 8，doc tests 亦通过。
- Vue `vue-tsc --noEmit` 通过；新增 reading payload shape 行为测试通过。
- 仓库强制门禁顺序执行：static 6/6、packaged Tauri smoke 5/5 均通过。
- Packaged runner 是否自动重建当前 HEAD 尚需核验；若只复用 target/release，则本次 5/5 只能证明旧 binary smoke，必须先 build 当前 release 再重跑。
- 已确认 runner 只选择现有 `target/release`/debug binary，不自动 build；首次 5/5 使用旧 EXE，已作废该证据。
- `cargo build --release -p ielts-practice-tauri` 重建当前源码成功；随后 packaged Tauri smoke 5/5 再次通过，现为当前 binary 证据。
- 第二批三个代理均在取回响应时网络断开；共享 worktree 无任何 tracked/untracked 产品改动，第一批提交 `c922351` 未受污染。
- 第二次重派：Phase 7/9 再次网络失败；Phase 8 成功修改 coach content 契约、Notes preference→annotation 迁移、highlight revalidate/mismatch 保留。
- 主审查 Phase 8 发现代理结论不完整：practice-client 仍嗅探 question/message/text/query；Notes 清空 preference 后没有从 annotations 回填，且每次 watch 未携带稳定 annotation id，可能每键生成新记录；revalidate 新参数尚未在页面传 document；coach DB message replay 未实现。
- `enrichment-repository.js` 已有 `listCoachMessages`，后端能力不是缺失点；问题在 useReadingCoach/页面仍从 submission 快照 hydrate。
- Annotation upsert 以可选 id 做唯一更新；当前 Notes watch 未传 id，确认会每次生成新 UUID。loadNotes 又只同步旧 preference，清空后无法回放 DB note。
- useReadingCoach 的 transcript 仍是 `computed(submission.readingCoachTranscript)`，错误也继续写回 submission 快照；必须改成本地 ref 由 `coach_list_messages` hydrate，submission 仅保留评分事实。
- `revalidate_annotations` 只返回 mismatch/修正 offset，不持久化；页面需传当前 passage document，并明确过滤/提示 mismatch，不能静默渲染错锚。
- Coach query adapter 已在响应中返回 `{threadId,messages,answer}`，因此无需把 transcript 再塞 submission；缺的是独立 list/hydrate API 与 composable 本地 persisted transcript state。
- ensure_coach_thread 会按 attempt 复用 open thread；可用 `sessionId→ensure→list` 恢复历史，不需新 DB command。
- practice-client 已导入 ensure/list；只需新增 listMessages facade 并在 useReadingCoach 维护 messages ref。Coach provider 本身持久 user/assistant message，网络失败只更新 thread error，不触碰 attempt score。
- Notes 修复方案确定：每 asset 保留一个 global note annotation id；异步 load 合并 legacy preference 与 DB note；watch debounce 使用稳定 id；空文本删除；UI 暴露 notesError。避免每键 UUID 垃圾。
- Highlight revalidate 已接页面实际 passage DOM；mismatch 记录不再尝试错误定位，并通过 role=status 显式提示数量。
- Phase 8 页面接线后 Vue typecheck 再次通过；coach/notes/highlight 不再依赖 submission/settings 双写作为唯一真相。
- Dragdrop 当前事件面只有 drag/drop 和 clear click；workspace 已统一 click handler，适合接入“选项选择→目标放置”而不改 legacy HTML。方案采用纯 JS selection controller + DOM adapter，controller 可在 Node 无浏览器环境做真实状态测试。
- Dragdrop 已实现 click option→click target、legacy div Tab/Enter/Space、Escape 取消、review 只读、reuse 拒绝提示、可见选择 outline 与 aria-live 状态；纯 controller 行为测试通过。
- Result 句错交互改为原生 button + aria-expanded/controls/focus-visible；Coach status 使用 role=status，消息列表 role=log。
- 交互改动后 Vue typecheck 与 drag selection Node behavior test 均通过。
- Static gate 已纳入 Vue typecheck、reading payload contract、drag keyboard behavior；不再只测 build 字符串。
- Packaged runner 现在在默认 binary 缺失/旧于 shipping source 时自动 release build，报告记录 git dirty/commit、binary SHA256/mtime/size、driver versions，并验证 payload 单层 envelope 与 submit 拒绝 client answerKey。
- Phase 7 现状复核：CreateEndlessCommand 仍强制前端 pool；Library 仍 shuffle/Math.random 并镜像完整 state 到 frontend-preferences；Reading 无 Rust 结果时再从 preference 随机。Cancelled 枚举有但无 command。
- Suite/create/submit 及 endless/submit 已有 mode idempotency 表，改造可复用；主要结构刀是让 Rust 查询 answerable asset index、删除 forced next/pool client DTO，并把 submit wrapper纳入外层 transaction。
- Rust Phase 7 已实现 caller-owned reading submit helper；Suite/Endless outer transaction 现在覆盖 attempt评分、mode标记、session推进、mode idempotency。
- Suite auto pool 只含实际可加载且有 answerKey 的资产；custom 规范化并验证唯一、严格 P1/P2/P3；frequency 无候选直接失败；无 seed 时用 session id，避免固定默认套题。
- Endless create DTO 删除 client pool，Rust 按 answerable/category/frequency/seed 构建；advance 删除 forced next；新增 cancel command。workspace cargo check 通过。
- Frontend 已删除 useReadingEndlessState 文件与全部 preference/session fallback；Library 只传 poolPolicy，Reading 只信 query sessionId→Rust session，退出调用 cancel。单篇 random practice 的 Math.random 保留，它不是无尽状态真相。
- Phase7 Rust integration 4/4 与 Vue typecheck 通过；测试使用真实 answerable asset files，不再向 command 注入 pool/forced next。
- Memorize Rust command 仍接受无用 payload 并可为不存在资产造 stub；UI 仍只靠 query flag，未 create/finish。下一刀：DTO 只接 assetId/title，Rust 验证 answerable asset，Library创建 attempt，Reading退出/卸载幂等 finish。
- Memorize 已删除 client payload，Rust 必须加载可答资源；Library create 后把 attemptId 带入 route，Reading 旧 route 可一次性创建，退出/重置/卸载幂等 finish。Phase7 4/4 与 Vue typecheck 继续通过。
- 仍未闭环的 Phase7 项仅剩 suite 草稿/暂停 timer 在提交前重启恢复，以及强制故障注入证明 outer transaction 回滚。
- 首次 Phase 8 typecheck 失败 9 项：JS default 参数推断把 sessionId 锁成 null；agent 的 highlight revalidate 使用 `as any` 导致 item/mismatch/filter 类型崩溃；Notes repository 未声明 annotation result 类型。均属实现类型债，不是环境问题。
- 已补齐 Annotation/Coach d.ts；highlight loader 去掉 `as any` 并只加载 kind=highlight，避免 global note 被误画成高亮；mismatch 规范为 string|null。
- Coach 热路径现在只接受 content，questionContext 显式挑字段；新增 thread message list facade。useReadingCoach 以 DB messages ref 为 transcript，不再写 submission snapshot；自动复盘以持久 assistant answer 判成功。
- Notes 现在稳定 id + 300ms debounce + 空文本 delete + DB 回填 + legacy 合并，错误通过 notesError 显式呈现。第二次 typecheck 通过。
- Suite 草稿当前是半接入：Rust SQL 已把 attempt 标为 suite，但返回 DTO 仍为 Single/None；前端 autosave、卸载保存、hydrate 三条路径都明确排除 active suite，导致答案、marks、timeline、timer 无法恢复。
- `get_open_reading_draft` 只按 asset/status 查询，suite 页面恢复后必须校验 attempt.suite_id 匹配当前 suite；普通单篇必须拒绝带 suite_id 的草稿，避免串会话。
- Suite 的 `persist_suite` 会 DELETE/INSERT `reading_suite_items`；故障注入若拦 item UPDATE 是无效测试。应拦 DELETE 或 `reading_suites` UPSERT 的 UPDATE，并断言 attempt/session/idempotency 同时回滚。
- `modes-repository.js` 与 Tauri `suite_save_passage_draft` facade 已存在，缺口只在页面接线；无需再造 API。Timer composable 的 start/stop/toggle 是同步状态切换，页面可包装 toggle 后立即调用 `persistTauriDraft`，避免给通用 timer 引入业务回调。
- 仅做页面侧 suite_id 拒绝仍会丢恢复：`reading_get_open_draft` 当前先按 asset 取最新记录，若最新属于另一 scope，正确的旧草稿永远拿不到。保留现有 DB API 作为 single wrapper，新增 scoped query 并让 Tauri 接受可选 suiteId，SQL 直接按 mode/suite_id 过滤。
- Phase7 测试可直接断言 `AttemptAnswer` 的 marked/change_count/visit_count/elapsed_ms/answered_at；Suite 持久化先 UPSERT `reading_suites`，再 DELETE/INSERT items，适合用 BEFORE DELETE trigger 证明整笔 outer transaction 回滚。
- 深审发现 Suite/Endless submit 与 draft 同类：SQL 把 attempt 改成 mode/suite_id 后，返回及幂等缓存中的 `submission.attempt` 仍是 Single/None。必须同步内存 DTO，并用测试锁定响应事实。
- 首次 packaged 报告虽 6/6，但 tauri-driver 不支持 `--version`，旧 helper 把 usage error 当版本；应将非零退出记为 null，并保持 blocked checks 与成功 checks 同 schema。
- 2026-07-14 恢复时已有未提交 Phase9 提取：mode/session submit 导航移入 `useReadingModeFlow.ts`，highlight/dictionary DOM 控制移入 `useReadingHighlights.ts`，纯映射拆到两个 JS core 并新增 Node 测试；`PracticeReadingPage.vue` 减少约 660 行。
- 新提取仍需验证：TS composable 导入 JS core 与 tsconfig 变更是否可类型检查；mode flow 是否保留非 Tauri fallback/双真相；高亮异步 generation、删除 set-diff、DOM listener 生命周期是否有回归。
- Phase9 当前 typecheck、mode-flow/highlight Node tests 均通过；但 `useReadingModeFlow.ts` 未被 `PracticeReadingPage.vue` 导入或实例化，页面旧 `submitAnswers` 与所有模式导航仍在。mode-flow 测试只覆盖旁路纯函数，是未接线骨架，不能计为 god-page 拆分。
- Mode flow 与 Coach/Timer 存在回调环：Timer 初始化要引用 submit，Coach 初始化要引用 snapshot，而 mode flow 又需要 Coach 方法。最小接线是提升薄 wrapper，setup 后部实例化单一 controller；不能复制状态机或用 watch 绕环。
- `useReadingModeFlow.ts` 仍含非 Tauri `practiceReadingSuite/practiceSessions` submit fallback，与 packaged-only 目标冲突；接线时应 fail closed，删除第二套提交运行时。
- Highlight listener attach/detach 已正确接入 mounted/unmount，未发现重复 listener；但 `snapshotHighlights` 同时使用前移 cursor 和 occurrence 次数循环，重复文本第二个高亮会错误命中第三处。
- 新 highlight upsert 在 await 期间被移除时，旧 generation 返回后直接退出，服务端新建 annotation id 未进入 snapshot 也未删除，形成确定性孤儿记录；只应清理“本次新建且已过期”的 id，不能误删已有 annotation。
- Notes dialog 目前打开时会 focus textarea，但缺 Escape、Tab trap、关闭后归还 opener；`aria-modal=true` 与真实键盘行为不一致。可由现有 UI preferences composable 统一持有 dialog ref/opener，无需页面再造状态。
- Packaged runner 当前只切换基础 hash 路由并直接调用 Reading IPC，未真正导航到 `PracticeReadingPage`，因此 god-page 拆分后的运行时错误、Notes/高亮 DOM、首屏性能都不在 6/6 证据内。
- Vue 使用 hash route `/reading/:assetId`；现有 Tauri WebDriver 支持 execute/sync 和 screenshot。可在同一 fresh binary gate 中做 5 次 root→reading 挂载，记录 nearest-rank P95，并验证 Notes focus/Tab/Escape/restore，无需另建浏览器 host。
- Fresh packaged 首次真实 Reading 证据：5 次挂载 `[190.5,75.4,63.1,192.8,123.6]ms`，P95 192.8ms；但截图 `reading-practice-current.png` 显示正文被压成单字竖列、大片空白，header 显示 `undefined 题`，视觉门禁揭示真实布局/数据展示 bug。
- Notes 自动化超时发生在打开/归还条件之一；runner 用 DOM `.click()` 未先 focus opener，真实 restore 目标会是 body。测试需先 focus Note 按钮，同时保留产品 focus trap 断言。
- Layout metrics 定位：workspace 1441px、computed tracks `720.571px 10px 670.571px` 正常，但 `#left` 实际 44px/x740、passageHtml 0px，`#right` 720px/x0，divider 被排到 y23218。问题是 grid item 自动放置/直接子元素顺序，不是 track 计算或字体 writing-mode。
- Grid children 证据：`sr-only` live region computed position=static，先占左列；left 被放进 10px divider track，divider 被放进右列，right 掉到第二行。把 live region 移出 workspace 即消除特殊情况，三列只保留 left/divider/right。
- 修复后 fresh screenshot 视觉正常：正文/题目并排、header 为 13 题、底部导航无重叠；packaged 9 checks 全过，P95 200.9ms，left/right 720.6/670.6px，Notes 键盘闭环通过。
- 指标仍暴露 payload HTML 内存在重复 `id="divider"`：direct child divider 为 10px，但全局 `document.querySelector('#divider')` 命中正文内元素。产品 divider 应改为唯一 `reading-divider`，代码/CSS/QA 都避免全局 ID 冲突。
- `reading-divider` 重命名静态核对覆盖模板 id、DOM `getElementById`、全部 CSS 状态和 packaged E2E 的 direct-child selector；还需反向确认旧 `#divider` 产品引用为零并重跑门禁。

## Phase 10 审计（2026-07-14）
- `src-tauri/tauri.conf.json` 的 updater 明确为 `active: false`，endpoints 为空、pubkey 为空；当前产品不可能完成检查/下载/安装/重启闭环。
- bundle icon 列表包含垃圾路径 `icons/henry.w@example.net`；发布校验若未阻断它，说明 bundle 门禁只看文件存在/构建成功，没有验证发布元数据质量。
- 五个 capability 都绑定 `main`，Tauri 会把权限合并；当前不是按业务窗口/命令隔离。尤其 `data-transfer` 直接授予 `$DOWNLOAD/**`、`$DOCUMENT/**` 的 `fs:read/write/mkdir`，任意主窗口 JS 可绕过 Rust 路径校验，和 capability 描述自相矛盾。
- `tauri-ci.yml`/`release.yml` 把签名 secrets 直接传给 build 但不检查非空，unsigned bundle 也能通过；`verify_tauri_bundle.py` 当前调用点只证明 bundle 非空。
- tag release 只上传 Actions artifact，没有生成/发布 Tauri updater manifest、`.sig`/latest JSON，也没有创建 GitHub Release；macOS matrix 只有 arm64，Windows/Linux/macOS 的签名、安装、restart、rollback 均无证据。
- shipping Vue 源码未导入 `@tauri-apps/plugin-fs`；现有 backup import 已由 Rust dialog 返回路径，再由 Rust canonicalize/read。移除 `library/data-transfer/diagnostics` 的前端 fs 权限不会破坏已发现产品热路径。
- updater Rust 依赖与 plugin 已注册，但唯一产品 command 只是 diagnostics 中的 `check()`；没有 download/install、事件进度、restart、失败保留旧版本/rollback 策略，也没有对应前端调用。
- `verify_tauri_bundle.py` schema v1 对任意 `release/bundle/**` 文件都判 pass，不检查平台期望扩展、签名 sidecar、updater artifact、latest JSON、版本一致性或 hash manifest 完整性。
- Tauri updater 2.10.1 的真实 config 不含 `active`/`dialog`；当前字段被 plugin 忽略，只有应用自写 diagnostics 在读取，属于确定性双真相。权威字段是 `endpoints/pubkey/windows`。
- `tauri-plugin-fs`、`tauri-plugin-shell`、`tauri-plugin-process` 均无 shipping Vue 调用；shell/fs 完全未用，restart 可直接由 Rust `AppHandle::request_restart()` 完成，三者可以删除。
- `Update::download_and_install` 在下载完成前验证 release signature；可用 Rust `AtomicBool installed` 管住 restart，只允许当前进程成功安装后触发。
- package repository 是 `https://github.com/sallowayma-git/IELTS-practice.git`，默认 updater endpoint 可规范为该 repo 的 `releases/latest/download/latest.json`；公钥不可伪造，必须由 release secret 注入且缺失时 fail closed。
- 删除 frontend fs capability 后，`import_backup_path(path: String)` 仍允许主窗口伪造任意路径；canonicalize 不是授权。已改为 Rust 内存 `grantId -> canonical PathBuf + 15min expiry`，dialog 与 app-owned backup list 统一发 grant，正式 import 消费。
- updater rollback 采用 forward rollback：稳定代码以更高版本重新签名发布。允许任意降级会让旧签名 artifact 成为 replay attack，不采用。
- shipping version 权威必须一致：`tauri.conf.json`、Tauri Cargo package、shipping Vue package 都为 `0.1.0`；tag release preflight 已强制三者与 `vX.Y.Z` 匹配。
- UI 审计发现 `EvaluatingPage` 每次 progress watch 都用 `Math.random` 改变打字速度，和 Rust evaluation event 无关，造成同一服务端状态的非确定性视觉抖动；已改为固定节奏，`prefers-reduced-motion` 直接同步。

## Phase 11 opensource UI 迁移（2026-07-15）
- 视觉参考的唯一版本为 `F:\workspace\IELTS Atlas` 的 `opensource@4c3282461d7f529fc856618a5fc8fc8653af5b79`。
- 可复用的是紫色品牌 token、胶囊导航、半透明玻璃层级、卡片圆角和轻量动效；不能全量导入 `main.css`/`heroui-bridge.css`，它们与当前 Vue 的 `.container`、`.btn`、`.hero`、`.sr-only` 等选择器冲突，会污染整个产品布局。
- 当前 `opensource-skin.css` 是正确的迁移边界：只在 `.atlas-source-ui` 下定义 visual adapter，避免把 source 浏览器运行时或全局 CSS 带入 Tauri。
- 首页已修复全局 NavBar 与首页 Hero 导航双渲染，并清除了 source GPL 首屏遮罩、外链和 local preference；这些都不属于桌面产品的视觉资产。
- 2026-07-15 打包截图复核：Library 的胶囊导航、玻璃总览和阅读卡片已基本符合参考语言；Settings 视觉密度尚可但卡片与按钮仍混有旧暖棕 token；History 的超大英文标题、筛选条与空状态明显是另一套视觉，属于真实迁移缺口。
- 中断代理在共享工作区只留下 `ComposePage.vue` 与 `EvaluatingPage.vue` 的样式改动；读取时间戳和 diff 后确认 `HistoryPage.vue`、`TopicManagePage.vue`、两张阅读页均未被其修改。后续由主代理接管，不能把中断代理计为完成。
- 用户明确否决黄绿背景和参考仓多 CSS 源叠加。视觉迁移不再把 source theme 当权威，而是只借其 glass 布局与交互原则；唯一权威改为冷色（紫蓝）Liquid Glass token 源。`ShuiBackground` 若含具体黄绿主题必须降级为无业务色的结构层或移除。
- 已定位并清除最坏的污染源：`ShuiBackground.vue` 原本维护三套黄绿/青色主题，迁移 legacy `localStorage`，并以 window event 改全局 CSS 变量；这既违背 packaged-only 边界又造成视觉多真相。现已替换为无状态、无脚本、单一紫蓝 canvas。
- `PracticeLibraryPage.vue` 和 `SettingsPage.vue` 仍暴露并持久化 `background_theme` / `three_bg_theme` 选择器；下一步必须删掉或固定为唯一视觉，不能留下点击后无效的“主题切换”假功能。
- 已删除 Library 与 Settings 的主题选择 modal、三套主题数据、全局 event 发射和 `background_theme` 写入；Settings 用不可点击的“Liquid Glass 视觉已统一”状态替代。遗留的 `.theme-*` CSS 与旧测试断言仍需删除/改为反向门禁。
- 当前门禁证据：static 12/12 与 fresh packaged Tauri 12/12 均通过；打包流程确认 Library/Settings/History 横向 overflow 为零，Reading 仍保持三列 `719.3 / 10 / 669.3px` 且 P95 227ms。视觉是否彻底清掉黄绿仍须以本次截图目检，而不能只以 tokens 搜索或门禁通过代替。
- 目检结果：Library/Settings/History 的背景和导航已转为紫蓝玻璃；Library 的 P1/P2/P3 阅读卡仍含旧黄绿渐变，说明高特异性卡片背景没有被新 token 覆盖。Reading 的 `#left/#right` 仍是旧纯白 pane，ID 选择器压过了全局 glass selector；必须用保留 DOM id 的更高特异性视觉规则覆盖，而非改 ID。
- Settings 仍显示绿色“题库状态”文本；用户要求清除黄绿视觉，Liquid Glass 的 success/warning 也应改为冷色蓝紫，不再把绿色/琥珀色作为产品装饰色。
- 第二轮目检：Library P1/P2/P3 黄绿卡片已经彻底替换为紫蓝玻璃卡。Settings 的主体也统一了，但系统状态文字由页面 hard-code 的绿色压过 semantic token。Reading 分栏的纯白已改为冷色半透明层，但仍过于接近白板；底部“已恢复未提交草稿”提示仍使用旧琥珀色。下一步必须收紧 Reading pane/notice 的透明与冷色层级，且直接覆盖 Settings 的 hard-coded status selector。
- 第三轮目检：Settings 的硬编码绿色已收敛为蓝色；Reading 的两个 pane 已有可见的紫/蓝折射层，草稿提示和标记点均转为紫色，三列布局保持稳定。当前 Library/Settings/History/Reading 的打包截图都不再有黄绿主视觉；下一阶段扩大视觉 E2E 到 Compose/Topic/Suite/Result，避免“未截图的页面只是骨架”的假完成。

## Phase 11 单一视觉源审计（2026-07-15）
- 三个只读审计一致确认：现有空状态截图已是冷色，但唯一视觉源尚未成立。main.js 同时加载 legacy styles/main.css、opensource-skin.css 与其它全局样式；design-system/tokens.css 和 aliases.css 仍持有 teal/amber/bloom/liquid-glass 字面值，不能再被称为兼容 alias。
- PracticeLibraryPage.vue 的非 scoped 样式定义全局 .btn/.card，根节点同时挂 legacy 与 opensource 类；这是 SPA 导航下的实际污染源。TopicManagePage.vue 存在多层历史样式，空状态未覆盖 import preview、success、Task 1 badge 和 difficulty 的绿/暖色路径。
- 阅读仍有真实的 reading_theme_mode preference、主题选择 UI、.dark-mode 整套 CSS，以及 interaction 内联深色分支；它违背一个固定 Liquid Glass 产品视觉，必须整个删除而非再加覆盖。
- 可达状态残留优先级：Reading 拖拽/词典/记忆/mark/coach；Library score/趋势/热力；History score；Settings About logo；Result spelling highlight。语义成功、选中、提示统一映射蓝紫；错误可继续玫红。
- Compose/Evaluating 虽为紫蓝，但页面维护 compose/evaluate 物理 token；后续应把这些替换为 canonical atlas token，页面仅保留结构。
- packaged E2E 当前只截图 Library/Compose/Topics/Settings/History/normal Reading；Suite、Review、Evaluating、Result 未覆盖。测试亦应隔离 APPDATA，避免污染真实用户数据库。
- 主代理目检 compose-current 与 topics-current：两页主视觉均已无黄绿/暖棕；Compose 的空文本区占据大面积白板、两处 placeholder 明显过浅，Topics 的空状态正常但只证明无题路径，不能作为有题/导入成功路径的视觉证据。
- 精确链路核验：styles/main.css 仍声明 design-system 是视觉真相并 import 它；design-system/index.css 再导入含暖色字面值的 tokens/aliases。必须反转链路：main.css 只导 canonical skin，legacy token 文件仅保留无物理色 alias。
- Reading 的 theme 不是死 CSS：useReadingUiPreferences 持久化 THEME_KEY、向 root class 写 dark-mode；PracticeReadingPage 渲染切换按钮；useReadingInteractions 根据主题直接写 #1e293b/#eff6ff 内联色。因此删除必须同步收口三个调用点，而不能只删页面按钮。
- 搜索确认仍有可达的暖色实体：Reading 3911/4180，Suite 337，Library 多段 bloom/teal/yellow gradients，History 1816，Settings 3583/3747/3976。Compose/Evaluating 虽冷色，仍拥有页面局部物理 token。
- design-system/index.css 除 tokens/aliases 外只加载 base.css；因此可以保留 base 作为非品牌 reset，同时让 main.css 直接 import base 与 canonical skin，切断旧 token 两文件。App 根 atlas-source-ui 覆盖所有 shipping route，因此 canonical scoped token 可稳定提供给页面。
- base.css 也并非纯结构：含 hero-body 的 #fbfffd、btn-brand 的 bloom sheen 与多处旧变量。迁移时应将它改名为 foundation.css，并仅使用 canonical variables；不能保留其历史品牌命名作为第二真相。
- Reading 精确接线：页面 template 103-116 是主题按钮；import 434、解构 527/537、factory onThemeChanged 543、interaction option 676 都需删。composable 可保留字号与 suite auto-advance；interaction 的 dropzone 样式应只清历史 inline style，让 canonical CSS 接管，而非写任何颜色。
- 全仓 token 使用清单已提取。删除 legacy tokens 前，canonical skin 必须兼容 color-gray 50-900、font/space/radius/shadow、bg/text/border、bloom/bauhaus/shui/lg 的调用名；这些名称可作为 alias，但物理值只能定义在 canonical skin。
- 已落地第一层：main.css 改为 foundation base + canonical skin，legacy index 不再导 token/alias，旧 token 文件已退化为空标记；canonical skin 增加完整兼容 alias。Reading UI/preference/interaction 深色行为已删除并清空旧 inline 色。
- 剩余 Reading dark-mode CSS 共有大量散落规则（2748 起至约 3910），现已不可达但仍是死代码与物理深色来源；下一步应按 CSS block 删除，不能只留注释屏蔽。
- typecheck 在 token/import 与 Reading 行为删除后通过。dark-mode 的首段含 root palette、review nav、header、floating panel、controls 和 submit 共七个 block；它们可独立移除且不与正常 light rules 交叠。
- 第二段 dark-mode 只覆盖 divider、原生 input/table，均有普通规则在相邻位置提供结构，可安全删除三段 divider 与两段 input/table 覆盖。
- 第三段 dark-mode 覆盖 group/review、dropzone、summary、pool、drag chip 与 selected 状态；所有选择器均已有非 dark 对应规则。普通 summary filled 仍有 #dcfce7 绿底，须在删除 dark block 后单独改成 canonical 蓝紫语义。
- 最后一段 dark-mode 覆盖 practice nav 与 marked button，可安全删除。普通 nav 中仍有 answered 蓝、correct 绿、marked 琥珀等可达状态，必须在本轮收敛为 canonical accent/semantic alias，不能被 dark 删除掩盖。
- dark-mode selector、UI state、interaction option 均已清零；唯一 remaining reading_theme_mode 是启动时主动清除的 legacy key。Reading root 仍自建物理 palette，且 normal states 在 3498-4137 存在蓝/绿/琥珀/teal literal；下一步将 root palette 映射到 atlas alias，并逐个替换状态规则。
- Reading suite mini 仍有 teal literal；Coach FAB/status/chip/send 是完整 teal 子系统，且 panel 自有白板/灰色物理值。它是用户可达路径，必须同 root palette 一起迁到 canonical glass token，而非只修 FAB。
- Reading behavior cleanup passes vue-tsc; obsolete theme symbols are absent. Targeted warm/green/teal search is clean except one #fffbeb notice at current line 3767, which still needs semantic token replacement.
- writing-design.css is only a 701-byte semantic helper layer with no physical token/gradient/root declaration; its import is safe once comment wording is updated. It is not a competing visual source.
- Compose/Evaluating are visually cold but own many literal rgba/gradient/shadow values in scoped CSS. Their top compose/evaluate token blocks are easy immediate fixes; full structural/visual separation requires migrating repeated page surfaces to canonical primitive variables rather than deleting layout CSS blindly.
- Result annotated spelling uses warm brown rgba; Topic reachable success/import/task1/difficulty states use green/olive/amber; Library still returns score colors in JS and retains old Bloom CSS; Settings contains green/teal fallbacks. These are genuine user-visible paths, not dead-code-only debt.
- Settings current green status and brand fallback can be replaced directly; its theme-card ocean/floral CSS is dead after theme UI removal and should be deleted in cleanup. Library getScoreColor returns inline green/yellow/orange hex, so aliases need to be returned from JS until its template is converted to semantic classes.
- Library source confirms separate old and opensource blocks. The exact category-card selector was present but first combined patch failed due an over-broad hunk sequence; all listed bloom gradients/shadows can now be converted in smaller matching hunks without changing DOM behavior.
- Broad yellow/green/teal scan after Library/History cleanup leaves only Topic duplicate success CSS, Suite panel teal, and Settings dead ocean theme CSS. This is a bounded final residue for the current visual pass.
- Topic has a second import-preview definition in the prior global layer; Suite passage index is direct teal; Settings has a large detached theme-modal/card CSS block after its template was removed. Delete the Settings dead range rather than recolor it.
- Targeted warm/green/teal source scan is now clean across apps/writing-vue/src; scoped diff passes whitespace check. This checks the explicit banned palette, not all remaining neutral/blue literals in legacy layout CSS.
- Final packaged screenshot inspection: Topics and Reading are visually cold, glass layered, and free of banned palette. Compose is also cold and placeholder contrast is improved, but its top-right word-count badge lost its pill treatment after legacy token removal and renders as a hard white rectangle; this is a real visual regression to fix before finalizing.
- Compose regression is isolated to the scoped .word-badge surface, not a data or layout issue. It retains its own hard white border/background/shadow values; add a canonical high-specificity glass pill rule in opensource-skin.css rather than reintroducing legacy tokens.

## 提交前迁移状态（2026-07-15）
- 当前 shipping 产品运行时已经是 Tauri 2 + Rust/SQLite；最新 static 12/12、fresh packaged 12/12 通过。但完整 Rust 原生迁移尚未完成：Phase 10 发布/签名/updater 跨平台真验证和若干前端业务适配/遗留视觉结构仍在计划内，不能宣称全量完成。
- 提交范围为 43 个 tracked Phase 10 + UI 文件及 6 个新增 shipping/CI 文档/脚本；.planning、developer/tests/ci/__pycache__ 与 developer/tests/e2e/reports 均为不提交的过程产物。reports 被 gitignore，cache 为 untracked。

## Phase 12 迁移断链审计（提交 05dd163）
- 写作 P0：取消评测后的 SQLite draft 不可通过 Compose 按 attempt 恢复；进程中断只更新索引状态、不更新 result_json，UI 会永久轮询；History 对 retry result 没有顺序保证。题库与 prompt 仍用 frontend settings KV，Task 1 active prompt 可回退污染 Task 2，topic string id 会被 Compose Number() 成 NaN，deleteKv 甚至不存在。
- 阅读 P0：annotation revalidate 没有 attempt_id，跨 attempt 同 asset 高亮会加载、重校验和删除彼此记录。P1：endless draft 被写成 single、submit 不严格 current asset、memorize readonly 仍允许 drag、session 没有 resume 入口；AI review 只是一段 coach 文本却显示结构化复盘成功。
- 发布 P0：updater CI 只校验 key/sig 非空，未证明私钥/公钥/最终 archive 签名匹配。P1 startup diagnostics 不是启动时记录，release Windows panic 后无文件日志/可见错误；CI 漏跑 Tauri tests，E2E 没隔离 AppData。P2 capability 仍为 core:default、grant read 有 TOCTOU。
- 结论：Tauri/Rust engine 基础已存在但不能宣布全迁移或可安全发布；先修 P0 规范数据所有权与 isolation，再扩展真实 packaged regression。

## P1 AI 配置默认项不变量（子任务）
- `list_ai_configs` 直接把 `ai/defaultConfigId` 映射为 `is_default`，不验证 enabled/secret；因此旧/导入数据可显示无密钥或禁用默认项。
- `ai_upsert_config` 编辑已有默认项时无条件再次写 runtime；可以把默认项改为禁用，且没有密钥的导入配置可被 UI 误导为默认/可测。
- `ai_delete_config` 只选第一个 enabled 替代项，未要求 `has_secret`；`ai_test_provider` 没有配置 id，Settings 却传 id，实际测试的是当前 runtime/default，属于明显假按钮。
- 正确收口：DB 负责选择合法默认（enabled + secret ref）或写 `unconfigured`，命令层在同一 SQLite transaction 中更新/删除并调用该逻辑；测试命令按指定 id 构造临时 runtime，不修改默认；导入只保存元数据且显式缺密钥，不能默认/测试成功。

## Phase 12 第一批修复回报（未主审）
- 2026-07-15 当前恢复：`implement_writing_topics_store` 与 `fix_reading_mode_integrity` 未交付结论即中断/失败，但共享 worktree 已出现 topics migration、Rust commands、endless/attempt 等修改；这些只能视为待审计候选，不能按代理名称推断正确性或完成度。
- 主审确认 checkpoint `cc824c4` 已把候选改动提交，不再是未提交 diff。题库的最小正确修复是将备份协议升到 v3、按 package schema 决定必需表（v2 不含 `writing_topics`）、恢复时清空新投影但不插入缺失表；不能用“把空表塞进已校验 package”来篡改旧 checksum。legacy topic 导入需要确定性 fallback ID 和可审计 digest marker，避免旧 marker 重放 UUID 或新备份恢复后永久跳过。
- 阅读模式主审：当前 generic `reading_save_draft`/`reading_submit` 能以既有 attempt id 重写 `mode/suite/asset`，`patch_reading_answer` 无任何 mode 校验；正确的结构修复是先在 Rust 验证既有 attempt 身份不可变、generic hot path 只允许 open standalone single attempt，再让 Vue 在 endless 中完全停止 generic draft/hydrate。无尽重试 key 可由 `sessionId + assetId` 确定性生成，不需要前端随机状态或额外 KV。
- Task 1 图片的现状是硬编码 `topicImageUploadEnabled = false`、repository 强制 `image_url = null`、Compose 不渲染图。最小原生闭环不需要重新引入 Node 文件服务：把受限的 image data URL 作为 `writing_topics.image_path` 的 SQLite 值，Rust 验证 MIME/base64/5MB 上限，备份自然携带；Vue 只负责浏览器 FileReader 与 `<img>` adapter。
- annotation：attemptId 已贯穿 revalidate/delete/list，新增 A/B 高亮隔离和 global note 行为回归；需要主审所有旧调用是否带 scope。
- prompt：resolver 只接受匹配 task 的 active prompt，client canonicalize task_type/is_active 并兼容旧 schema；仍为 settings KV，不满足 first-class store 最终目标。
- evaluation：代理实现 recovery 同步 canonical result_json/event/attempt projection，并让 History/Result/retry 复用最新 evaluation 排序；其声称现有 Compose 可恢复取消草稿与此前固定 draft key 审计矛盾，必须验证，不可据此关闭 cancel→resume 债。
- 主审已确认矛盾属实：useDraft 当前固定将 compose-essay 映射为 compose-compose-essay，而 evaluation.start 始终生成 attempt-*；Compose 未读取 route/query attempt id。因此 cancel→resume 仍是用户可见 P0，必须通过显式 resumeAttemptId 贯穿 Evaluating→Compose→draft persist 修复。
- Agent P0 tests now pass: phase5 writing 13/13, phase8 annotations 4/4, vue-tsc. Source confirms Evaluating cancel routes to Compose without query, so no currently deployed path can reach the persisted attempt draft. The direct fix is an explicit attempt ID, not another fallback search.
- Recovery retry already reuses props.sessionId safely, so Compose should do the same for resume. It must not call discardDraft on the resumed attempt after starting evaluation, because that would overwrite the restored content with an empty draft; only the ordinary compose scratch draft may be cleared after start.
- Main cancel→resume patch now makes useDraft accept an explicit attempt ID, routes cancel/back with resumeAttemptId, reuses that ID on evaluate.start, and skips scratch-clear for the resumed attempt. Focused typecheck/writing/annotation tests pass; a real packaged cancellation path still needs adding to E2E.
- 2026-07-15：P0 写作题库审计确认当前 `topics` facade 直接读写 SQLite `settings` 的 `topics` namespace，分页/筛选/统计全在 Vue 运行时，且 Compose/useDraft/route 把题目 ID 强制转为 Number。这是实际数据所有权断链，必须新增 typed `writing_topics` 表、Rust repository/commands，并把 ID 改为 string end-to-end；旧 settings 仅作幂等冷迁移来源。
