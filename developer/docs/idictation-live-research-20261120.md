# 爱听写认证实测记录

2026-11-20。范围：用户已登录的 Codex 内置浏览器，按产品界面操作观察网络请求。未通过复制浏览器 Cookie、存储或签名密钥建立独立客户端。

## 本轮结论

截至第四批真题历史界面调研，已观察 **57 个不同 API 路径、358 条去重请求记录**。原始观察377条，按请求标识去重移除19条重复；第二批320raw/301unique/56路径、第一批277raw/258unique/52路径的口径仍成立。同一次邮编提交的两条采集记录不能解释成两次作答。路径中的具体资源 ID 未归一化，此数不是网站全部接口数。请求均由原站页面产生，观察到的业务响应为 HTTP 200、`status:0`。数据使用 HTTPS 443，未做端口扫描。

词书的“目录→章节→词条→音频→一次正确提交→退出后续练”已取得闭环证据。其他领域目前主要验证材料读取和当前账号的权限；没有完成全功能写入、评分、错误恢复和 Atlas 在线集成验收。

证据位于 `developer/tests/e2e/reports/idictation-research/`（忽略提交）：

- `authenticated-observations.json`：请求参数白名单、响应字段类型、HTTP/业务状态；不保存原始账户响应、认证头、Cookie 或轮次值。
- `authenticated-endpoints.json`：去重方法/路径与状态。
- `authenticated-facts.json`：计数、账号权限、续练验证及副作用事实。
- `postal-practice-one-word.jpg`：一次提交后的 1/6 进度截图。

第一批记录曾被重新采集为 `return-catalog` 标签，因此不能把该标签解释为每个请求的准确触发动作。后续动作独立命名，按标签页和 requestId 去重。嵌套 shape 保留首项字段；异构数组的其他项不能由首项代表。

## 当前账号权限

| 返回或页面证据 | 观察值 | 接入含义 |
|---|---|---|
| member.status | 未开通 | 不假设个人 Pro 可用 |
| is_enterprise / enterprise_pro.can_use | false / false | 普通账号，不枚举教师/管理端 |
| config.already_buy | 空数组 | 已购词书为 0，按书检查授权 |
| review_auth | false | 原站 `is_admin` getter 使用此字段，与今日复习权限无关 |
| 原站今日复习入口 | Pro功能介绍弹窗 | 当前非会员，列表计数可读；按原站门槛不进入复习训练 |
| vocab-solution/today-plan.open_for_user | false | 词汇方案当前未开放 |
| 自定义词书按钮 | 打开 Pro 购买弹窗 | 当前被前端会员门槛拦截；没有调用上传接口 |

账号接口实际返回 password/session 等敏感字段。调查器仅保留字段类型并在内存观察对象中遮蔽值；生产插件必须使用明确 DTO 允许列表，禁止把整个用户对象交给 Vue 或日志。插件曾将 `review_auth` 投影为 `reviewAllowed`，现已移除该错误映射；不能据这个字段发放或拒绝复习权限。

## 核心词书真实合同

| 请求 | 实测 body | 返回 |
|---|---|---|
| POST lexicon/v1/language/list | `{}` | 5 个语言/入口 |
| POST lexicon/v1/v1/category/list | `l_id:5,check_data:1` | 6 个分类 |
| POST lexicon/v1/scene/list | `l_id:5,c_id:13,check_data:1` | 8 个场景 |
| POST lexicon/v1/group/list | `s_id:158,check_data:1,scene_type:1` | 291 本雅思词书；并非全部已获授权 |
| POST lexicon/v2/chapter/list | `g_id:947263` | `chapters[].list[]`，3 章；章字段确有 id/name/g_id |
| POST lexicon/v1/list | `compact:0,c_id:2102708,pagesize:9999` | 邮编章完整 6 词，分页 total=6 |
| POST lexicon/v1/list | `compact:1,c_id:641567,pagesize:9999` | 普通 DAY9 章完整 30 词，分页 total=30 |

这些路径均以 `/api/study/` 开头。普通样例的章/词请求**没有 s_id**。静态客户端里存在可选场景参数，不能把它变成所有请求必填。

号码与编码：书 947263；电话号码章 2102706（12词）、参考编号与航班号 2102707（9词）、邮编 2102708（6词）。普通英文样例书 171011，DAY9 章 641567。没有更改原有普通词书的作答记录。

词条来源身份是 `id`。实测首词 `id=118803036`、`lexicon_id=0`；实际逐词提交使用前者。`word_id`、来源词条 ID、本地规范化词项 ID 必须分离。

逐词成功提交 `/api/study/lexicon/v1/practice/result` 的业务字段：

```json
{"type":"success","lexicon_id":118803036,"mode":1,"sence":1,"if_learned":1}
```

还带 `key:number`，其值未落盘。本次成功请求没有答案文本或 `error_word`。退出后重新打开同章，返回 `existing_id:[118803036]`、`last_key:string`；页面从第二词继续，进度 16.666…%。章返回 `is_incomplete:true`、`is_practiced:true`、`last_id:118803036`。轮次提交与回读的类型不同，应在专属合同层处理，不以本地 SM-2 替代。

四种基础模式的界面均已打开：听写、听音选义、看词选义、默写。切换调用 `customer/v1/update/config`，发送完整配置（当次108个字段），偏好字段 `lexicon_learn_mode` 值为“听音选义”“看词选义”“默写”“听写”。已恢复原来的“听写”。配置字符串与提交 mode 数字不是同一个枚举。

媒体已由正常播放观察到：

- `idictation-article.oss-cn-beijing.aliyuncs.com`：词音，206，部分 `.mp3` URL 的实际 MIME 为 `audio/wav`。
- `lbxl-audio.oss-cn-beijing.aliyuncs.com`：词音/原题整句，206，`audio/mpeg`。
- 后续精听/听力页面还实际读取 `itx-jingting.oss-cn-beijing.aliyuncs.com` 和 `audio-1-cdn.idictation.cn`，均观察到206、`audio/mpeg`。

不能按扩展名猜格式，也不能把 `phonetic-m/y` 音频当音标。特殊词书还含 `word_audio_url`、`answer_sentence_audio_url` 和结构化 `cloze_details`。

## 其他功能实测矩阵

| 领域 | 非空/空响应证据 | 当前验证边界 |
|---|---|---|
| 同义替换 | synonym/v1/book/list、chapter/list、chapter/detail；1书、39章、890对；章36有1组5对 | 只打开材料，未匹配提交；独立词对模型，含version/client_key/source和左右音频 |
| 文章精听 | 书444692、章1197472；article/v1/list返回84短句，sentence_mode=short | 题文、译文、语法、切片、词对齐可达；未提交听写或精听标记 |
| 精听时间 | 首句 start_time="117526"、end_time="119753" | 本样例为毫秒数值字符串，其他来源仍需保留单位转换策略 |
| 雅思听力 | zhenti/v1/test/show/2101，4Part、full_audio、题组、原文、content_jingting | 材料可达，已暂停；未答题、未交卷 |
| 雅思阅读 | yuedu-zhenti/v1/jianya/test/show/2101，3篇 | 题型样例[8,1]、[3,8,2]、[5,10,1]；正文paragraph数组，order_ary可null；未提交 |
| 雅思写作 | xiezuo-zhenti/v1/test/show/2101，xiaozuowen+dazuowen及图片 | 未输入作文或请求AI评分；raw_payload不应直接作为公共模型 |
| 雅思口语 | part1/list、part2/list；show/11113包含topic，界面问题ID6413 | 题目及示例思路可读；未录音、上传、生成定制答案或评分 |
| Reader精读 | documents/list：subject=reading,track=a,book=21,page=1；show：id="2" | 12块、独立version、sentences；本样例media=[]、progress=null；未标注/写进度 |
| 错词本 | lexicon/v1/error/list/search与error/list，page=1,pagesize=200 | 有实际历史错误；仅保存shape，不复制用户错误全文 |
| 精听收藏 | article/v2/collect/list，page=1,pagesize=50 | 1条既有收藏；未新增或删除 |
| 精读收藏 | reader/v1/sentences/collections/list，kind=all,page_size=20 | 当前为空；与精听收藏为不同身份和接口 |
| 学习统计 | lexicon/v1/data/analysis、review统计、zhenti/v1/daily-accuracy | 今日1词与本次提交相符；时长由原站心跳增加 |
| 学习计划 | calendar、tasks、personal/recent | 42天日历，timezone=Asia/Shanghai，当前任务0；未创建计划 |
| 词汇测评 | vocab-test/v1/get_home_data，type=listening/reading | 首页可用、历史为空；未创建轮次或触发5秒自动作答 |
| 打字 | typing-practice/v1/records/list、materials | 历史为空；写作范文、AI故事素材字段可读，当前无可用范文；未开始游戏 |
| 真人口语 | philippine-speaking/v1/learning-center/summary | 返回余额/预约结构，未预约、购买或探测教师排期 |

精听身份追加核验：请求 `c_id=1197472`，响应顶层 `canonical_g_id=444692/canonical_c_id=1197472`，但84个句子的行内归属全部为 `g_id=872200/c_id=1949109`。这是入口／规范书章与底层句子内容归属的差异，不能按词书转换器的“每行必须等于请求书章”校验。提交身份仍须使用原 `article.id` 并保留三者关联。首句ID902864；普通短句时间及词内alignment为不同时间基准。

新增最小材料fixture `developer/tests/fixtures/idictation/observed-materials.json`：精听2句、Reader3块（含无句子的heading和带UTF-16句子偏移的paragraph），明确标为partialSample。字段来自已观察响应，排除媒体URL、用户批注、进度、轮次、账户和生成服务信息；不把此子集当完整84句章节导入样例。Reader句子没有text字段，正文必须按原块的start_offset/end_offset截取，不能重新分句造ID。

## 已发生的远端副作用

第二批仅查看错误本、复习介绍并关闭，未新增学习提交、支付请求或修改历史。原站正常心跳仍存在。

1. 正常提交1个邮编词，保留这条学习记录。验证时未删除数据。
2. 4次词汇模式配置保存，最终恢复“听写”。
3. 原站正常心跳和analytics写入；统计时长增加，不宣称取证全程只读。
4. **点击“自定义词书”自动创建未付款年度会员订单。** 未选择套餐或点击支付，购买弹窗自行调用 `customer/v1/member/v1/pay`，随后轮询pay/result。返回 `is_pay=0,status=1`；已关闭标签停止轮询，没有付款。没有执行订单取消（未发现已授权的产品取消流程），也不声称订单已删除。订单号/二维码未落盘。

第4点是重要的源产品行为，后续插件不能在查看权限或目录时自动下单。应显示权益缺失，仅在用户明确选择购买后进入原产品购买流程。

## 对当前实现的影响

`plug/idictation/vocabulary.rs` 与两类真实词条结构相容。白名单fixture位于 `developer/tests/fixtures/idictation/observed-vocabulary.json`，共36词，不含账号、音频URL、原站轮次或用户学习历史。新增测试核验全部来源ID、文本、释义和音标，特别覆盖 `lexicon_id=0`。定向 Rust 测试 **4/4通过**；仅编译测试增量27.51秒，没有release或安装包构建。

仍需实现的边界：

- 专属原站WebView、传输和设置页连接/按章同步入口现已实现，仍需桌面真实登录验收。当前浏览器登录成功不等于 Atlas 已有会话。
- 来源词条投影、按用途区分的媒体信息。当前规范化生词查询不能直接用于远端逐词提交。
- 原站练习会话/恢复状态与 Atlas SM-2 分开；本地 UnitImport 保持纯导入。
- 同义替换、精听、Reader、读听写口语的材料转换及各自提交合同，不伪装成九分来源。
- 未验证的失败路径、过期、断网、官方评分、会员/已购资源与复杂题型。

本轮没有修改生产功能，所以未重复运行已通过的74项静态与28项桌面门禁，也未重复构建。后续生产功能改动必须继续遵守静态→桌面验证顺序。

## 浏览器与历史限制

本轮内置浏览器可正常读取和交互，但若干跨页返回/直接导航使标签停在about:blank。使用同一个内置浏览器的新标签恢复后，登录仍有效。没有修改宿主、注册表或浏览器profile。临时空白和暂停练习标签已关闭，保留一个已登录学习中心。

指定的两段历史聊天仍未取得；read_thread发现入口无结果，不能用仓库文档冒充历史。完整目标保持active，尚未完成全功能接入，后续五轮优化目标尚未启动。

## 第二批：错误本与权限纠正

原站错误本正常界面观察（非猜测URL或独立请求）：

| 入口 | 实际POST路径（均在/api/study下） | 当前数据/合同 |
|---|---|---|
| 同义替换错题计数 | synonym/v1/error/list | page1/pagesize1，data空、total0 |
| 今日复习数量 | review/v1/today-count | success=true，count200/completed_count0/total_count403/all_count403 |
| 听力错误 | zhenti/v2/errors-new | page1/pagesize10，10条；Laravel分页+date/test/report_types_filter；blank_id、result_id、test_id、paper_id不可混用 |
| 阅读错误 | yuedu-zhenti/v1/errors-new | page1/pagesize10，data空；可达不代表存在历史样例 |
| 写作记录 | xiezuo-zhenti/v1/results/list | search_dates=[]/search_kinds=[]，list空；日期/题型/标签/试卷过滤数组 |
| 口语记录 | kouyu-zhenti/v1/results/list | search_dates=[]/search_part_types=[]/paper_ids=[]/keyword空，list空 |

当前原站“复习（200词）”显示“艾宾浩斯”标签；点击仅出现“复习为Pro专属功能”的介绍。已保存review-pro-introduction.png并关闭，没有点击订购CTA，本批观察中支付请求0。不得直接导航训练路由绕开此分支。

静态对应（0-based字符偏移）：index-119a4b05.js@477810的is_admin读取review_auth；is_member在普通用户分支检查会员status是否“进行中”，企业分支另走原站函数。render-1ce8074a.js@24024的Le按is_member决定/home?source=review或K.open；@13047的open只打开介绍，@13086的CTA进入会员流程；@32943是同一按钮内非会员才显示的艾宾浩斯标签。先前把review_auth当复习权限的文字解释作废。

## 词汇训练静态合同追加

index-f5cb0b84.js：mode定义@62127；特殊书号码强制听写@79353；判分@52520/52759；逐词提交Ke@62011；轮次Date.now@48478、续练@55774；错词循环@69843；章节完成Et@63698。主包aP/aQ对应yY@632265、bY@633148，使用已加载且哈希固定的官方函数，不复制签名算法。

实际已捕获/api/notice/diy-string/2的9项数字字典：1/2/3/10/50/100/101/123/1000对应英文。词条spelling_combinations长度大于1时覆盖various_words；失败拼写带原始error_word，选择题失败为空串，成功不发送error_word。号码书词音/句音不同；普通词音默认美式、phonetic_type为1时英式。默写/听写答前Go@45790隐藏非词性英文，答后保留全文。

本批没有新增训练提交或章节完成实测；高级纠错偏好、缺音源有道后备、完成章故事生成、服务器未知写入对账仍未验证。不能据静态合同或Mock验证宣称这些线上闭环已通过。

## 第三批：精听目录再次核验

原站文章→精听→剑雅21：分类l_id4/c_id10，scene152，group/list返回25书；书444692实际type="lexicon"且g_id同为444692。点击书实际仍为lexicon/v2/chapter/list{g_id:444692}，1组16章；首章1197472、article_duration="383671"、short_chapter.id1949109/g_id872200/word_total84。不能依书type只收article，也不能因旧article/v1/chapter/list函数存在就替换实际v2链。

本批只打开目录和章弹窗后关闭，没有点击章节进入播放、提交成绩或会员购买。原站从文章入口恢复到上次精读选择后再点击精听，UI状态稳定后才解释请求。新记录已经加入authenticated-observations.json；下方累计清单以该文件最终去重统计为准。

## 第四批：真题历史与本地复盘边界

再次通过真题→剑雅A类→首套Listening观察combined/jianya/list和test/show/2101。关闭全屏建议后原站音频出现加载提示，退出按钮工具超时；没有输入答案、交卷或重试提交，关闭该调研标签后恢复学习中心。不能将这次进入页面当作音频成功或考试闭环。

从错误本中既有机经29 Part4错题的“详情”打开原站结果页。可见Q31–40、正确3/10、用时06:24；“记录”中仅1次历史，选择当前记录没有新请求。此为UI证据，初始show发生在新页网络观察前，未取得该结果响应body；不能据页面推断result_id或完整序列化合同。结果页自行请求一次`zhenti/v1/ai-dialog/message/list`，仅观察到消息列表读取，没有发送助手提示或请求生成。

用户随后明确：**不使用爱听写的复盘，统一使用Atlas自己的复盘harness**。后续仅取原题、音频、用户作答与官方判分/历史结果作为证据，排除原站results/review、AI错因、推荐和AI助手。未点击“复盘”，未保存笔记或调用AI生成。结束后关闭结果页并返回已登录学习中心。

原站页面直接重新导航偶发about:blank；空白页CDP被来源校验拒绝时不继续调用，先正常恢复页面。最新捕获仅保存白名单shape，不落盘原始用户作答、结果ID、账号或轮次值。
