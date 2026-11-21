# 爱听写转换插件（接入中）

已实现设置页连接入口、独立原站窗口和按章同步命令，转换为 Atlas 公共词书模型。当前线上链路仍待桌面原站登录实测；不能把内置浏览器的成功调研或模拟测试当作桌面同步验收。

复盘边界（2026-11-20用户指定）：统一使用Atlas现有复盘harness。爱听写只提供题源、音频、用户作答和官方结果证据；不接其复盘分析、AI错因、复盘推荐或AI助手，也不新增原站复盘入口。原始成绩/历史回读与生成式复盘是不同操作；后续适配必须将已核验的结果交给本地harness。当前传输白名单没有远端复盘操作。

剑雅 A 类阅读整卷：在现有阅读题库选择「爱听写真题」，点「加载剑雅 A 类阅读」。原生答题页提供 Part 导航、草稿恢复和累计计时。正式交卷按账号与套卷记录待核对请求，后续仅查询官方回执。核对账号、套卷、轮次、时长、题目版本、官方正确题数和逐题结果后，用公共事务写入 Atlas 历史。复盘从本机题目版本和已保存成绩取证。开发端真实验收通过剑雅 21 Test 1 的打开、跨重启本机续练、一次正式交卷、官方判分入库、历史回看和 Atlas 复盘取证。原站草稿同步回执待确认，模型生成功能需设置可用的 API Key 才能验收。遇到未适配题图、重复填空或题型时显示打开失败原因。

- `host.rs`：Tauri 编译入口。
- `transport.rs` / `product-bridge.js`：在独立原站 WebView 复用当前版本官方 POST 函数；入口 URL/SHA 固定，按用途限定读取、词汇提交、章节完成与音频操作及响应字段白名单，55秒超时不自动重试，退出时取消结果槽。原站窗口无本地 IPC 权限。音频只有主进程接收成功回执后才保留播放，否则清理停播。
- `service.rs`：六个连接/目录/同步命令；读取前后核验账号，目录授予与章节归属检查；纯转换成功后事务写入。断开只关闭窗口和清理同步状态，不宣称退出原站账号。
- `IdictationAccountPanel.vue`：现有设置页中的连接与按章同步对话框；不新增导航页。
- `vocabulary.rs`：静态前端合同类型、目录路径和词条转换；校验章节归属、重复 ID、数量完整性和付费门槛。
- `material.rs` / `material_timing.rs`：精听与Reader纯转换，输出既有 `studyMaterial` 与正文块；区分整句播放与词对齐时间，保留共享内容归属、版本和UTF-16锚点。当前Reader只接受已实测的heading/paragraph，图片等块明确拒绝。
- `reader.rs`：Reader目录、打开和正文三个命令；校验当前账号授予的文档、版本、类别、书册与篇次。只保存有界进程缓存，不写考试索引，不进入随机/套题/评分。目录请求与详情请求分别沿用原站字段类型。
- `readerLibrary.js` / `ReaderFilters.vue`：现有阅读题库增加爱听写精读筛选、A/G类、剑4–21和分页；显式加载，无后台批量爬取。复用现有阅读页展示正文和逐句翻译，保留字号/主题/返回，屏蔽考试草稿/计时/交卷/批注。尚未实现原站阅读进度、收藏和注释写回。
- `training.rs` / `VocabularyTraining.vue`：现有生词页按章启动四种原站练习，复用官方数字/拼写归一化函数和数字字典；词条提交用来源 `id`，续练保持 `last_key` 类型。号码书仅听写；原站音频在专属窗口播放。缺少选项时显式说明原站跳过即记正确；默写答前隐藏释义中的英文。结束章节需要显式点击，沿用原站可能生成故事的流程。原站写入与本地 SM-2 独立。
- 提交结果未确认时，SQLite `idictation.pending` 保存账号/书/章组合哈希与布尔标志，不保存答案、凭据或原站轮次。关闭、断开、重启不会解除阻止；确认回执才清除。当前没有可靠的服务端对账接口，未确认章节必须到原站继续，不能用一次可能陈旧的词表读取擅自解除。该恢复限制仍需后续完善。
- `article.rs` / `ArticleFilters.vue` / `articleLibrary.js`：现有听力题库的雅思精听入口，scope152目录→通用v2章节→完整长/短句。目录book.type可能仍为lexicon；按入口合同授权，校验canonical书章和短句数量，保留底层共享句子归属。材料与媒体仅在进程缓存，不登记考试资产。
- `ArticleMaterial.vue` / `useArticlePlayback.js` / `article-audio.js`：沿既有听力路由使用共享页头、样式和studyMaterial模型。原考试实现移至ListeningExamPage.vue保持内容不变，材料分支不初始化考试草稿/时间线/交卷。原站窗口播放音频，主窗只发送已授权mediaId；clip播放自身完整时长、track按原毫秒/1000截取，支持暂停/续播/seek/0.6–2倍速。状态轮询只读本地Audio、不产生远端API请求；媒体URL不交主窗。当前仅材料播放，不伪造听写成绩、标记、收藏或学习时长。
- 精听播放边界：15秒加载超时、40ms句尾检测、主窗8秒无状态读取自动停播；取消和丢失回执停播；隐藏/卸载停播，旧状态不能覆盖新句。原站提交、自动收藏、词对齐跳播、连续播放和远端速度偏好仍待接入。
- 精听验证：developer/tests/rust/idictation_article.rs、JS audio/lifecycle测试、idictation_article_preview.mjs；视觉使用真实转换的84句、模拟播放状态，不等于真实WebView播放成功。
- 公共持久化：`crates/ielts-db/src/vocab/books.rs`，保留现有单词/SM-2 状态。
- 合成合同测试：`developer/tests/rust/idictation_vocabulary.rs`。
- 材料合同测试：`developer/tests/rust/idictation_material.rs`；最小真实样例及合成边界。额外完整实测输入测试默认ignored，须本地脱敏capture存在后显式执行，不将缺少capture报告为通过。
- Reader权限/版本及生命周期测试：`developer/tests/rust/idictation_reader.rs`、`developer/tests/js/idictationReader.test.mjs`；本地视觉harness为`developer/tests/e2e/idictation_reader_preview.mjs`，只使用测试IPC，不替代桌面原站连接验收。
- 词汇训练合同与生命周期：`developer/tests/rust/idictation_training.rs`、`developer/tests/js/idictationTraining.test.mjs`；`developer/tests/e2e/idictation_training_preview.mjs` 为四模式本地视觉harness，不宣称实际远端作答或发声已验证。
- 调查、证据与未完事项：[工程记录](../../developer/docs/idictation-integration-20261120.md)。

原站登录保存在专用 WebView 数据目录，独立于 Codex 内置浏览器。关闭原站窗口后，点击「已登录，连接账号」会打开同一配置的窗口并验证已有会话。兼容已核验的 `index-119a4b05.js` 与 `index-64364bef.js`，各自固定脚本哈希以及 POST 导出。未识别的版本显示适配提示，网页仍在加载时会等待。插件不复制 Cookie 或密码，不接受任意 URL 或写入操作，不自动重放失败的学习提交。
