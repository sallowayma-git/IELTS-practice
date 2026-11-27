# 调查证据

2026-11-20用户修正：爱听写复盘不接入，统一Atlas现有harness。当前product-bridge白名单没有远端复盘；只适配原题/音频/作答/官方结果。主线程已抽查公共persist_completed_attempt事务、Coach context版本校验和enrichment入口。Coach provider当前硬编码jiufen，listening需provider证据；Agent AttemptReview仅completed reading。后续扩展来源必须保留身份/指纹/答案完整性，不复制九分prepare_coach_context的远端review+analyses前置调用。

第四批最新358unique/377raw/57paths。已有机经Part4结果UI10题正确3、384秒、1条历史，当前记录点击没有请求，初始show未捕获；不得据UI杜撰result响应合同。未交卷/开复盘/生成AI。第三批精听目录合同已用于本地接入；最终78静态/28桌面/6连接通过，SHA401fa85f…，Rust30+1ignored，JS22。真实桌面登录/同步仍待验。

## 项目
- 基线 git 工作区干净，commit 0f735f5542ed25ec49ec36adcab0cda6dfb054a4。
- 已亲读 developer/docs/INDEX.md、jiufen-provider-feasibility-20261118.md、jiufen-api-data-inventory-20261119.md、phase10-release-runbook.md；后续需补齐被工具截断处。
- 九分是编译进 Tauri 的专属适配器；plug/jiufen/host.rs 由 src-tauri/src/lib.rs 引入。
- 数据长期保留本地作答/成绩，云端材料使用运行期缓存；账户在系统 keyring。
- provider_map 探查发现读听路径大量硬编码 jiufen，需按实际爱听写功能决定是否泛化，不能只新增目录假装完成。
- vocab_map 初步证据：现有生词 CRUD、SM-2、回忆/拼写/复测；无 book/unit 模型；UI 单次最多500词；词项没有远端ID、音频、多书关系。

## 网站
- 公开入口 index-119a4b05.js SHA256=51d0c314236baeb59da92c76d2f551b92a7420d15894440e3a24e7d3992823eb。下载193个公开引用脚本；299条路径引用/291不同字面字符串，不是端点总数。
- 登录产品POST /api/study/customer/v1/login，协议已勾选，HTTP200/status1“密码不正确”。body字段phone_number/password/api_key/timestamp/nonce/sign；秘密不保留。
- 普通API大量POST；GET review/v1/clear有写副作用，不能按HTTP方法判只读。
- 词书链：language/list → v1/v1/category/list → scene/list → group/list → v2/chapter/list → lexicon/v1/list。
- 章节response.chapters[].list[]；词表data/total/existing_id/last_key；phonetic-m/y为音频URL，phonetic_transcription才是音标。
- 练习4模式：听写1、听音选义2、默写3、看词选义4；字段sence原拼写不可改。逐词practice/result或review/submit，完成chapter/list带is_chapter_finished/is_generate_stories有写入。
- 收藏按规范化词文本，标熟按lexicon_ids；标熟不是本地SM2 easy；错误记录外层ID不是词条ID。
- 模块：词书/复习/错词/测评/计划、文章听写/精读/收藏/随身听、雅思四科/模拟/PK、打字游戏、真人口语预约、机构教师、管理和交易。静态引用不等于当前账号可达。
- 用户已在内置浏览器登录，但本会话工具未接管；无真实书/音频/练习写入验证。

## 继续调查与公共接入边界
- 九分流程现状已沿代码复核：专属设置/系统keyring/固定站点transport/目录访问集合→公共PracticeAsset→原生页面→官方submit/review→公共Attempt事务。历史聊天仍未读到，仓库证据不等聊天证据。
- 公共缓存此前退出九分会清所有题源；本轮改为显式provider归属与按provider清理，保留16项上限，并补会话续期owner变化清理。定向3项通过，已加入静态门禁。
- 第二题源还有前端分派、远端资产加载、无答案草稿、Coach/历史的九分硬编码；不要冒充jiufen ID，在线材料验证后按实际能力收敛。
- 计划/测评/方案/打字/上传/口语课程/PK/模考静态合同已归档。计划日期Asia/Shanghai；方案合成任务ID不能普通confirm；测评5秒自动提交null；打字退出flush；上传创建/编辑data类型不同；取消预约可能扣课时；PK progress能开局。
- 真实权限、音频、录音评测前段、企业直传/审核、班级结果分析仍是unknown。

## 认证实测更新（优先于上面的静态阶段结论）
- 详见 developer/docs/idictation-live-research-20261120.md；52个真实API路径，不是总接口数。
- 词条id与lexicon_id不同；实例id118803036/lexicon_id0，提交前者后existing_id回读一致。last_key回读为string、提交key为number。
- 普通章compact1，号码/原题答案章compact0；媒体206，mp3后缀也可能audio/wav。保留媒体用途，不能混入音标。
- 四模式偏好保存发送整份配置，lexicon_learn_mode是中文字符串；逐词提交mode为数字。
- 同义替换是独立book/category/chapter/group/pair及version模型，不能硬塞普通词表。
- 自定义词书前端会员门槛会自动建未支付订单；已关闭弹窗、未付款。任何插件权限查看都不能沿用自动下单。
- 当前个人会员未开通、企业Pro不可用、已购书0、review_auth=false、词汇方案open_for_user=false。免费材料仍可达。
- 当前转换器真实fixture4/4通过，但音频、原站恢复会话与来源条目投影仍缺。在线会话/同步与考试评分未实现。

## 桌面传输实施与材料接入定位
- 已实现六命令、固定原站WebView官方POST、入口SHA pin、DTO投影、设置页按章同步；真实同步仍待独立WebView登录。
- 原站tinycolor不能在Object.freeze(Object.prototype)下初始化。支持的修复是关全局freeze配置、在Builder注册document-start纯初始化插件，将原站例外限定到label+origin；其它窗口保留冻结。Tauri2.11.5/runtime-wry2.11.4/wry0.55.1锁定版本无per-window freeze开关。
- 文章/Reader复用studyMaterial与阅读/听力页面，但需显式material学习模式；原生空题目/空answerKey校验不能借造题绕过。article句内切片与整轨时间分离，Reader块内UTF16锚点和lock_version不能塞进当前规范化TextAnchor。
- 读听公共loader、列表排除、practice-client/repository/open/audio仍硬编码jiufen；爱听写必须单独provider分派和owner核验，不能冒充jiufen-native。写作topic metadata目前覆盖来源，Compose只显示dataURL图表，接入时需受控扩展。
- article实测请求1197472、顶层canonical444692/1197472，84句行内归属却全为872200/1949109；不得误当跨书攻击。Reader句子只有偏移无text，使用原块UTF16截取。最小2句+3块材料fixture已写，不含账号/URL/轮次/进度，partialSample明确标注。
# Reader接入追加发现（2026-11-20）

- Reader materials无需写数据库考试索引；经provider payload命令直达现有reading DTO，可避免混入random/suite和空answerKey例外。
- 原阅读页仅隐藏按钮不够：onBeforeUnmount/persistTauriDraft、高亮ensureAttempt、notes迁移、modeFlow迟到响应、timer异步过期都要屏蔽材料。已加早分流、能力门禁及加载代次，测试覆盖迟到响应。
- 原站Reader show发id字符串，catalog发数字book/page；已按样例和客户端消费保持类型。
- 本地真实转换器输出经Vite测试IPC显示12块37句和翻译；打开/退出/重新进入没有考试相关命令。此证据不涵盖原站WebView实际连接。
- 首轮静态75/76仅测试mock缺readerCards；修复后重跑。没有额外release/安装包。



2026-11-20第二批新增事实：真实请求累计56路径/301去重（原始320，19重复）；原旧批次实际277raw/258unique/52paths，原258去重数正确，不能将277误作258。邮编成功仍仅一次。新增听力错误10条、阅读错误空、写作/口语手动提交记录空；当前复习count200,total403。review_auth=false是原站is_admin，非复习授权；复习入口以is_member分流，本账号实际打开Pro介绍并关闭，本批支付0。原站API新结构已存shape，不存用户答案正文。

training新增5命令+四模式现有生词页组件。数字字典9项已实测。提交未知结果在SQLite settings/idictation.pending保留账号书章哈希+bool，禁止关闭后重复提交，无可靠对账前原站继续；默写英文提示遮罩；主进程确认Audio回执前取消始终停播；错误reviewAllowed投影删除。当前静态77/77@13:31:26UTC，Rust27/27+1ignored，JS15/15。四模式UI仅Mock证据，不是远端验收。

桌面已解锁，实际Atlas原站仍/login。主窗设置对话框无未保存输入，正常Alt+F4关闭用于必要增量构建；内置researchTab12保留登录main/book。suite_practice_flow进程7369正在必要构建并准备桌面门禁，无新安装包。QA stale检查原漏plug和capabilities/permissions，主线程补3目录，防后续仅插件修改复用旧binary。

13:38UTC最终门禁：静态77/77@13:31:26→增量release2m24s→桌面28/28@13:36:02→连接6/6均通过，binary SHA=10d89c6c7203794d3a27e527f113a177c2ee9ccf468c6f44cb65e31905111463。最终Rust27/27+1ignored。原Atlas正常关闭后最新程序已重新打开，停设置页准备登录入口；不操作认证表单。内置原站tab12导航about:blank后新tab14恢复main/book并markHandoff，认证保留。全目标active，五轮优化未开始；桌面绿测不能替代真实远端验收。

2026-11-27：真实Q27补证两轮合计8,398 input，一次 read_passage_blocks 取回Part 3第一段，官方B与原文引用一致。当前二进制跨进程恢复回答和点赞，已完成复盘重开7→7调用计数。最新模型调用只获明确试用额度错误，不能将旧成功叫作当前版本成功。旧版输入对比需含失败重试：Q2 13,192→7,354，复盘13,254→6,197。当前版首包3,400为本地估算，不能与供应商实报混为一谈。

2026-11-27 当前公开同义替换客户端补充：入口 index-7417cec6.js，专用 API 模块 index-76955eec.js。只读导出 l/a/g 分别发 book/list、chapter/list、chapter/detail；目录无subject时body为空。激活章节前路由参数被解析为正数，在请求中为数字。practice/result 是每次点两张卡的写入；前端请求含 group_id、group_version、scene、key、request_id、cards[{pair_id,side}]，响应消费 is_correct 和 progress，原站会按组版本比对错题回读。当前未发送写入、未观察非空回执。待续验收应先经正常页面取得一次可区分的真实提交和进度回读，再决定防重、重试与本地训练的边界。无权页面仍不打开。

下一条功能路径定位：当前combined/jianya/list认证响应每个test含listening.test_id；zhenti/v1/test/show/2101正文含parts[4]、content与每段full_audio，不能从file_url推整卷播放。plug/idictation/exam.rs已转换已实测题型和40题，并把官方答案保留在Rust；ListeningExamPage、useListeningAsset和ListeningLibraryPage可复用。上线第一步仍须确认远端音频原样取用和换段进度语义，同时显式禁止回落到内置题库/本地判分/草稿命令，直到普通听力的真实草稿与交卷可对账。此前认证观测只进入了听力题面，不能据此说音频已经播放。

写作认证证据补充：authenticated-observations.json 6796–6858 的combined目录按writing.test_id与写作两子任务paper_id授权；6866–6902、7055–7072的show直接返回values根的test_id/book_id/xiaozuowen/dazuowen。子任务content按来源页面HTML消费，img_url为独立图；旧调查未落盘写作原文、媒体URL与图字节。代码因此严格核对书、卷、任务ID，使用惰性模板输出段落纯文本，且Task1图必须可用。SVG、异源图、重定向和未知/不支持图失败。真实图片不可达时保持明确错误；可见的Task2仍可独立选题。综合目标未完成。

精读收藏后续线索：真实空页见 authenticated-observations.json:11019，subject=reading、kind=all、page/page_size=20。原站 reader 独立 API 包 index-5b8980aa.js@434；render-1ce8074a.js@44849 使用 sentence.document_version_id+sentence.id 标识，@45413 读 sentence.text/translation 和 document.title，@46938 kind允许 note/highlight/bookmark，@49416 查 items，遇当前版本带未解析锚点会打开 document 并只在正文版本相等时合并已解析 anchor_segments。在Atlas未取到非空真实答复前，不能把收藏句映射为已有本地高亮或覆盖用户笔记。

- 2026-11-27 随身听：归档 `walkman-d1934d98.js` 调用 `qt({c_id,pagesize:9999,s_id:isClass?5:null})`，两个版本的公开词表 wrapper 默认 `compact:1`；整词美音及英音由 `phonetic-m/y` 给出。普通模式复用已捕获词条结构。机经当前仅有 combined 目录认证形态，无阅读 show 响应；A 类整套读写约束保留。
- 2026-11-27 口语再核对：普通账号历史认证证据中，空请求体的 Part 1 列表内地 34/非内地 9，Part 2 为 58/14；空请求体 show/11113 的 `topic.detail_text` 返回 6 条 `mktTopicIssuesList` 和 1 条 `tIssuesPart2`，含题干、示例思路、原站题目音频和对齐字段，`practice_results` 为空。当前 Atlas 路由没有口语练习页；能验证的是只读题库合同，录音授权、评分和入库需独立验收。
- 2026-11-27 口语录音静态边界：`speak-evaluation-4a549300.js` 使用 getUserMedia、MediaRecorder 和二进制识别 WebSocket，包含 `evaluation/authorize` 与 `evaluation/volcengine-sts-token`。这里的证据仅证明浏览器端存在授权和转录步骤。未从真实账号执行授权、向外发送录音或核验配额，未采集令牌。口语题库当前实现仅采用真实已见的读操作。
- 2026-11-27 晚间公开资产：原站回退页面引用 `index-dab1aca2.js`，实际 JS SHA-256 为 `7fb63b819e74ca9b6857cd7ba40a7f4eb442ff46fb64244309c9538869b2d8b6`。入口导出 d7/aO/aP/gO 仍对应 xe/AY/IY/kY。新版听写设置子模块 `setting.vue_vue_type_script_setup_true_lang-3d4d67c2.js` 哈希 `3014ffc74657bb97e578c42f681d269cc0015cd9f87358e30638f91c7c96c50f`，同义读取模块 `index-cdf3ce3c.js` 哈希 `c43458722a5f8ab46d9dd9f10526cb45fee075a2a7dcee87798c0d097bed946f`。新版标记精听为 `label-listen-3b95db0f.js`。已下载并核对类型，下一次版本更新应一起覆盖这些依赖，避免仅更新入口后某个功能仍失效。两个旧挖空资产复查返回 HTML，不能据此生成旧版脚本固定值。

- 新版标记精听在 `label-listen-3b95db0f.js` 读取 `history_record_id_jingting` 与 `last_key_jingting`，提交标记包含 `article_id,choice,key`。选 2/3 且未收藏时还调用收藏新增，原站在后续提交前会等标记请求。旧认证列表响应确认 `jingting_state`、`is_collection` 和 `jingting_summary` 字段存在。既有取证未包含标记写入回执或收藏次请求失败后的重试语义，未执行线上标记写入。

- 2026-11-27 写作收尾：归档 `index-890e18f5.js` 的 En/ke 和 `index-fcd3568b.js` 的 ne/ge 均先解包 values 再取 xiaozuowen/dazuowen；补充题源桥原来的 response.test 假设与原站不符，已修正。无新的远端账号读取或写入。用户将本阶段范围收口为写作收尾及提交推送，其他缺口和五轮优化不再自动推进。
