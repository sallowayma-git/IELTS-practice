# 爱听写材料与练习静态合同

日期：2026-11-20。关联 [总调查与实施记录](idictation-integration-20261120.md)。

这些结论来自公开客户端 JS 的调用与消费逻辑，不是当前账号的真实响应。没有执行下列远端写入、录音上传、付费、删除或预约。下文路径均在 `https://www.idictation.cn` 产品同源范围；方法及请求预处理以总记录所述产品 wrapper 为准。

后续认证实测以[实测记录](idictation-live-research-20261120.md)为准。它补齐了主要材料样例和词汇续练闭环，并发现打开自定义词书的会员弹窗会自动创建未支付订单；上面的“未执行”仅描述静态调查阶段。

证据目录：`developer/tests/e2e/reports/idictation-research/`。`文件@数字` 表示 UTF-8 解码后从 0 起算的 Unicode 字符偏移，不是行号或字节偏移。哈希与下载记录见目录中的 `public-inventory.json`。主线程已抽查文章时间转换、收藏 ID、Reader API/锚点/锁及读听写提交包装器；其余定位来自独立静态探查，在线接入前仍需抽验实际样例。

## 数据模型边界

| 领域 | 必须独立保留的身份 | 不能合并的状态 |
|---|---|---|
| 词汇 | 来源账号、书、章、词条 | 原站练习轮次/标熟与 Atlas SM-2 |
| 文章听写/精听 | g_id、c_id、article_id、key、sentence_mode | 输入判分、听懂程度、收藏、发音评测 |
| Reader | document_id、version_id、sentence_id、block_key、client_key | 版本锚点、注释锁、阅读进度锁 |
| 雅思读听 | 套卷/part 源 ID、group_id、item.id、result_id、key | 自动保存、手动提交、官方判分、本地展示号 |
| 写作 | paper_id、test_id、essay_type、result_id、key | 草稿、提交、异步评分及配额 |
| 口语 | oral_materials_id、topic_issues_id、result_id | 音频上传、语音识别、评测、结果持久化 |

应先通过专属转换层保留来源身份和语义，再复用公共材料、播放、练习、笔记与历史能力。不能把所有来源结果压成一个通用正确率字段。

## 文章目录和材料

API 集中在 `index-119a4b05.js@613100` 起：

| 路径 | 页面参数/消费结构 |
|---|---|
| `/api/study/article/v1/chapter/list` | `{g_id,s_id}`；章节平铺数组 |
| `/api/study/article/v1/list` | `{c_id,pagesize:9999,sentence_mode,...轮次参数}`；data、sentence_mode、last_key、existing_id、collect_word |
| `/api/study/article/v1/practice/result` | `{key,article_id,type,error_word}` |
| `api/study/article/v1/practice/biaoji/result` | 源码无前导 `/`；`{article_id,choice,key}` |
| `/api/study/article/v1/pronunciation/evaluation/submit` | `{article_id,score_result,audio_url,audio_text}` |
| `/api/study/article/v2/history/records` | 当前页面无参数调用；响应 records |
| `/api/study/article/v1/history/records/delete` | `{key:record.key}`；有删除副作用 |
| `/api/study/article/v2/collect/list` | collect_date、error_tags、jingting_choices、可选 test_ids、page、pagesize |
| `/api/study/article/v1/collect/add/{articleId}` | 收藏；带笔记时 body `{id,notes:[{note,tags,content}]}` |
| `/api/study/article/v1/collect/delete/{articleId}` | 取消收藏 |
| `/api/study/article/v1/collect/bulk-delete` | `{ids:[原句 ID]}` |
| `/api/study/article/v1/temp/group/create` | `{ac_ids:[收藏项 ac_id]}` → `{c_id}` |
| `/api/study/article/v1/word/search` | `{word}` |
| `/api/study/article/v1/update/{articleId}` | `{content,translate,start_time,end_time}`；修改远端句子 |

目录 `index-6d97db15.js@1896`：班级 s_id 为 5，普通分支为 null。自定义文章 status===4 才可练习；处理中状态不可假装有材料。自定义条目也可能直接携带 chapter，不能强制所有来源先走章节查询。

新版听写 `index-fabf838e.js@23733` 发送 sentence_mode=long|short，可带 `history_record_id` 与 `is_only_listen_answer_collect_sentences`。只有响应明确返回 long|short 才认定支持切句；模式不一致必须报错。继续使用 last_key，重开生成 Date.now() 轮次。经典听写 `index-v2-868f402f.js@13006` 没有 sentence_mode。

句子字段至少包括 id/content/translate/phonetic/start_time/end_time/split_audio_url_new/split_audio_url/subtitle_alignment_details/is_submit/accuracy/is_collection/article_content_collect/grammar_analysis。userInput、adjust 等是本地派生字段；结果中的服务端原输入是 error_article。

learning_task_id 仅由合法路由与正整数查询参数追加；主包 `@612743` 的任务 wrapper 不是所有请求的通用身份字段。

## 时间、音频与评分

新版播放器优先 split_audio_url_new，再 split_audio_url，无切片回退 phonetic 完整音频（`index-fabf838e.js@6947、25190`）。

该文件 `@11140` 明确兼容秒/毫秒：若 0<abs(end-start)<=120 且 max(abs(start),abs(end))<=7200，则起止乘 1000，否则保留原值。内部使用毫秒，不能把原始服务端时间一律当毫秒。词级 subtitle_alignment_details 可为 JSON、数组或 words/details/alignment_details；时间字段还有多种别名，前端据句长判断秒/毫秒和绝对/相对，再归一到句内毫秒（`@11413–13354`）。应保留原始时间和归一结果，以便核验，不凭字段名猜测。

消费路径追加核验：上述 `Zt` 启发式仅用于词对齐/高亮/词级跳播。整句 `Lt`（`@32401`）把原 `start_time/end_time` 直接传给 `fn`，后者（`@30481`）除1000后seek；有切片时从0播放到媒体结束。因此转换层的整句播放和对齐范围必须分开。全体公开JS没有 `end_time_new` 消费，不得凭字段名优先替换 `end_time`。源启发式边界要直接计算原数值，先除1000再乘1000会因浮点误差把1001..1121的120秒误判。

文章普通提交 type=success|fail，error_word 为当前输入（`@26330、26924`）。待提交项按句 ID 跟踪，换材料和进入结果前等待提交；失败重送的幂等条件尚需在线验证。

主包 `@627785–631658` 判分包含引号/大小写/标点规范化、缩写等价与词级编辑距离。accuracy 是保留两位小数的字符串。简单字符串相等会改变产品判分。

结果页 `index-b585961c.js@1635` 仍读 article/list，带 history_record_id 与 sentence_mode。优先 practice_summary.progress/accuracy/cumulative_time；accuracy 乘 100 展示，cumulative_time 以秒计（`@5009`）。历史 `index-ae2929f2.js@1939、2030` 删除用 record.key，打开结果却取 record.id 为轮次参数，二者不能合并。

## 标记精听与收藏副作用

choice 为 1=听懂、2=模糊、3=茫然（`index-1e641901.js@12476`）。精听加载使用 history_record_id_jingting，消费 last_key_jingting/existing_id_jingting/all_tags/remaining_pronunciation_evaluation_count（`label-listen-d2e3b112.js@75611、76200`）。

选择 2/3 且尚未收藏时会额外收藏句子（`label-listen-d2e3b112.js@82804`）；只提交标记不等于复现完整原站操作。结果 `sign_index-7d4cf237.js@4396` 同时传 history_record_id_jingting 和 history_record_id，消费 jingting_summary。accuracy_jingting 是中文标签键的百分比对象，累计时间仍为秒。

收藏列表响应 data/total/last_page/date_filter/jingting_tag_filter/test_filter；notes 可能是 JSON 字符串。私人句库传 ac_ids（`index-1e641901.js@17247`），批量取消则传 a_id 或 article_content.id（`@19000、19444`）。不应拿收藏记录 id 代替原句 ID。

发音评测最终提交消费 result/result_id/remaining_pronunciation_evaluation_count；其授权、录音 SDK、上传前段和配额尚未穷尽，不应标成完整可用。

## Reader 精读

`index-5b8980aa.js` 的 API 前缀为 `/api/study/reader/v1/`：

| suffix | body |
|---|---|
| documents/list | `{subject:"reading",track,book,page}` |
| documents/show | `{id}` |
| annotations/save | document_id、version_id、client_key、kind、anchor_segments、quote、note、lock_version、sentence_ids |
| annotations/delete | `{id,lock_version}` |
| progress/save | `{document_id,block_key,text_offset,lock_version}` |
| translate | `{document_id,version_id,anchor_segments}` |
| sentences/collections/list | `{subject:"reading",kind,page,page_size:20}` |
| sentences/bookmarks/set | `{document_id,version_id,sentence_id,collected}` |
| sentences/collections/delete | `{kind,sentences:[{document_id,version_id,sentence_id}]}` |
| progress/completion/set | `{document_id,completed:true}` |

目录 track 为 a|g，book=4..21，返回 items/total；详情返回 document/version/blocks/annotations/progress/media（`index-450bfa7a.js@23721`）。block 含 block_key/text/sentences；句子含 id/start_offset/end_offset/translation/grammar_analysis/cues；媒体含 id/kind/url。cues.start_ms/end_ms 明确为毫秒（`model-61cd8640.js@2920`）。

锚点 `{block_key,start,end,quote}` 的 start/end 与 text_offset 是 JS 字符串 UTF-16 单元偏移。前端使用 Range.toString().length 与 text.slice 校验（`model-61cd8640.js@1930` 起），Rust 字节索引或 Unicode 字符索引均不可直接替换。最多 32 个跨块 anchor；无法可靠重建的锚点保留 unresolved/uncertain。

Reader按响应块顺序渲染，不按 `block.sort` 重排。句子材料提取在 `sentences-ee877af6.js@199` 对每块句子按start_offset排序。图片块由 `index-450bfa7a.js@37423` 读取payload.url/alt；当前账号样例没有图片，转换层暂明确拒绝image等未适配类型，不能静默把它们当空段落。label在data-reader-text之外显示，避免改变块内偏移。

新增注释使用 crypto.randomUUID() 为 client_key、lock_version=0（`index-450bfa7a.js@27400`）；后续保存携带现有锁。progress/save 返回新锁，CONFLICT 时停止自动保存并要求重新打开（`@24946`），不能默默覆盖其他设备进度。

收藏 kind=bookmark；精读收藏页面 kind 可为 all/note/highlight/bookmark。删除 kind=all 会删除同句笔记、高亮与收藏（`render-1ce8074a.js@48671–48845`）。这是与文章听写收藏不同的数据合同。

## 随身听

`walkman-d1934d98.js@13631`：review 来源读 `/api/study/review/v1/words` 的 completed_words/pending_words；普通来源读 lexicon/v1/list，c_id、pagesize=9999、班级 s_id=5，wrapper 默认 compact=1。

该 chunk 未发现独立 practice/result 上报，不能由此断言服务端不记录播放。phonetic_type==2 取 phonetic-m，否则 phonetic-y；支持字母拼读、整词和中文释义，play_interval 为秒，repetitions==0 无限循环。设置通过 handleConfig 写远端；发音和中文释义不能同时关闭（`@15000、18229`）。

## 雅思听力与阅读

接入范围修正（2026-11-20）：用户要求统一使用Atlas自己的复盘harness。下列原站结果、答案、历史等合同仅用于获取源证据；不接原站复盘分析、AI错因、推荐和助手。不将静态源码里的复盘功能列为后续实施目标。

API 证据 `index-c3a5ad61.js`：听力 test/list、jj/list、question/list（`@593、466、134`），详情 test/show/{id}、jj/test/show/{id}、jj/part/show/{id}、xyy/part/show/{id}、question/show/{id}、part/show/{id}（`@656、527、722、791、198、258`）。阅读目录含 jianya/list、g-jianya/list、jijing/list；按 A/G/JJ 与整套/单 part 分流（`@2683–3291`）。combined 目录存在独立 wrapper（`@3443–3587`）。

目录 helper `index-890e18f5.js@5181` scene 1=A、2=JJ、3=G。通常 books[].children[].children[]，机经听力为 books[].parts[]，机经阅读为 tests[].children[]。combined 中按 subject 取 test_id。不要把不同目录强制解释成相同深度。

核心模型：suite 含 parts、practice_result、practice_result_shoudong、practice_result_history_grouped、reports；part 含 question/content/file_url；group 含 type/group_id/desc/title/list/collect/collect_option/options/img_url/table；item 含 id/number/title/option/options/display_answer。number 仅展示号。collect 的 `$item.id$` 可重复出现并带 and/or，须保留 occurrence。

阅读正文支持 content.order_ary 顺序与 content.paragraph 数组，另有 title/sub_title/image/pre-A/notes（`read-suite-a7206a83.js@35106`）。听力剑雅整套只选 full_audio，未发现时不盲回退 part 音频（`suite-8948a174.js@78225、78516`）。复盘 transcript 含 en_text/cn_text/start_time/end_time/topic；content_jingting 含切片和词级对齐，结果播放会把时间除 1000（`suite-result-547b8698.js@70486`）。

| 科目 | 前端题型值及消费方式 |
|---|---|
| 听力 | 1 单选；2 组多选；3 表填；4 item 文本填；5 collect 填；6 图填；7 矩阵；8 拖拽；9 item 多选最多 2；10 表拖拽 |
| 阅读 | 1 判断；2 拖拽；3 段字母矩阵；4 collect 填；5 单选；6 标题匹配；7 组多选；8 collect 填；9 拖拽；10 collect 拖拽；11 item 填；12 图填；13 合并表填；14 item 多选 |

题型消费定位：听力 `suite-8948a174.js@44412–56194`，阅读 `read-suite-a7206a83.js@37750–51784`。这些前端枚举不能直接当 Atlas 题型枚举，需按结构转换。

听力提交 `/api/study/zhenti/v1/question/submit`，阅读 `/api/study/yuedu-zhenti/v1/submit`（API `@314、3367`）。共同字段 key、answer[{type,id,group_id,answer,mark}]、duration 秒、highlights、notes、源卷身份；mark为boolean，answer 可字符串、数组或 null。听 type2/读 type7 的组多选用 id=0+group_id；听type9为group_id=0。key在本次挂载以Date.now()生成，续练恢复答案/时长但静态未见恢复旧key；跨挂载归并与幂等尚需实测。填空通常失焦、选择题change、拖拽结束才自动保存，不是统一逐字符保存。自动保存省略action；手动提交为action="手动提交"，并重新收集尚未失焦的输入。

来源参数：听力整套剑雅 dyy_jianya_test_id、机经 zzz_dyy_test_id、普通 part 的 paper_id、xyy part 的 dyy_jianya_part_id；阅读整套 jianya_test_id/g_jianya_test_id/jijing_test_id，单 part 为对应 *_part_id。learning_task_id 只在读听写手动提交条件下追加；模考 extra.from 和 class_exam_id 不得默认注入。

结果仍走show，body `{result:{id:resultId}}`。普通结果的字段类型仍需真实返回核验，不能将机构分支的JSON字符串兼容推广到全部普通字段。官方result_blanks.blank_id/is_correct作为源证据；不把原站前端展示修正直接当本地评分。当前suite结果页注释保存实际为`zhenti/v1/results/annotations/update/{resultId}`或`yuedu-zhenti/v1/results/annotations/update/{resultId}`，body `{highlights,notes}`；不是submit/update。注释包含原站DOM位置语义，不能发送Atlas DOM偏移。错误记录删除是独立写操作。原站结果页在满足推荐条件时自动发listening-word-book-recommendation/notice，不是每次必发；插件不得为查看结果复现无关推荐副作用。

追加静态定位：suite-8948a174.js@77070/87006，read-suite-a7206a83.js@68491/77892。历史按scope_type/history_group_key与result ID共同定位，跨test/part要换show路径；仅点击当前唯一记录可能不发请求。解析弹窗读取已有报告后关闭可能重发`errors/blank/report`，即使没有编辑；当前不复用该弹窗。`result-review-analytics-8f31aeb2.js@44086`的远端复盘在quota_status=exhausted时显示demo，此信息仅解释源行为，不进入插件实现。

## 写作与口语

写作 API 前缀为 xiezuo-zhenti、xiezuo-jijing、xiezuo-g-zhenti/v1；含 xiaozuowen/list、dazuowen/list、test/show/{id}、submit、results/show、collect/add/{id}、errors/all-types，A 类统一 results/list（`index-c3a5ad61.js@4032–5624`）。

目录 A 请求 category=1,type=0，JJ 请求 type=0，G 为 {}。show.test 分 small/large，保留 paperId/testId/essayType/title/content/imgUrl/writingApiType。写作页提交 key/action/duration/highlights/notes、essay_type/paper_id/word_counts、test_id 或小大作文 paper_id/contents；常规手动提交每篇 >50 词，响应 result_id。历史 search_dates/search_kinds；AI 计费与异步评分队列未穷尽（`suite-write-b7a421c1.js@21113`）。

口语 `/api/study/kouyu-zhenti/v1/`：part1/list、part2/list、show/{id}、issue-results/list、issue-results/show、submit、note/save/{id}、results/list、reference-answer/send|status|list|audio-status（`index-c3a5ad61.js@5701–6295` 起）。

issue-results/list 传 oral_materials_id/topic_issues_id；show 传 result_id；submit 传 oral_materials_id/topic_issues_id/audio_url/audio_text/score_result。topic.detail_text 可能是 JSON，消费 mktTopicIssuesList/tIssuesPart2 或 topic_issues。音频 FormData.file 上传 upload/file，取 data.values.file_url。**上传加 submit 不等于完整评测链**：score_result 依赖前置评测。参考答案异步任务、录音授权、识别/评分配额均须真实界面验证。

## 个人学习计划

定义集中在 `RecentTasks-b4eab684.js@7556`，前缀 `/api/study/learning-plan/v1`。页面主要为 `PlanBoard-a49bbd52.js`。

| suffix | 页面请求 | 消费结构/副作用 |
|---|---|---|
| calendar | start_date/end_date，42 天月历范围 | days[]：date/tasks/task_count/completed_count |
| tasks | date/page/pagesize，默认20 | list/total/class_completion |
| personal/recent | {} | list |
| task/show | task_id | task、can_*、resource_details、completions、attachments |
| personal/create | request_key/start_date/task | 创建；成功后用 focus_date/start_date 定位 |
| personal/update | 创建字段+task_id/scope | single/following 更新 |
| personal/delete | task_id/scope | 删除 single/following |
| task/confirm | task_id | 标记完成后刷新详情 |
| task/restore | task_id | 恢复完成状态，消费 status |
| task/proof/upload | multipart task_id/file | 返回 file，含 object_key |
| task/proof | task_id/request_key/files | 写入证明材料 |
| task/file/download | task_id/file | 返回 url，随后可能访问文件或 Office 预览服务 |
| class/task-status | class_id/date | 班级完成明细，完整学生行结构未展开 |

任务 builder `RecentTasks-b4eab684.js@9600`：task 含 name/description/type/allow_early_completion/resources/repeat_rule。type 为 vocabulary/article/exam/other，other 的 resources 固定为空。repeat_rule 是 `{frequency:"none"}` 或 `{frequency:"daily",until:"date",date:endDate}`；编辑 single 时强制 none。request_key 为 UUID，前端保留未决请求用于重试，服务器幂等语义仍需真实验证。

资源身份：词书 `{book_id,chapter_ids}`（空数组为整书）；精听 `{group_id,passage_id}`（自定义 group_id=0）；读听 `{subject,bank,scope:test|part,content_id}`；写作加 component=small|large；口语 `{subject:speaking,bank:tongzhuo,scope:topic,content_id}`。随机资源另有 minimum_count 1–100，不等同固定题目列表。证据 `RecentTasks@11695–15959`、`PlanBoard@5992`。

权限由 can_practice/can_edit/can_delete/can_manual_complete/can_restore/can_submit_proof、edit_scopes/delete_scopes 控制。开始关联练习验证资源 available，再附 learning_task_id；课堂考试还查 can_enter（`PlanBoard@12997`）。不能把所有任务实现成手动 checkbox。

个人计划日期按 Asia/Shanghai 计算（`RecentTasks@1080`），不能按桌面当前时区生成。按日分配最多366天，前端顺序发多次 create；上传证明最多10个，每个20MiB，PDF/TXT/图片/Office 文件类型受限。窗口 focus、日期切换和操作完成会刷新；PlanBoard 本体没有定时轮询。企业上传组件另有8秒状态检查，status=9 或网络错误停止，不属于所有个人任务的必经步骤。

**词汇方案合成任务另属一套状态**：仅当所选日期为今天且 open_for_user && has_plan && today_plan 时，把 fuxiWords/xinxueWords 合入任务列表（`PlanBoard@1447`）。task_id 分别为 `vocab-solution-fuxiWords`、`vocab-solution-xinxueWords`，按 today_learned 计算完成。不能将这两个字符串送普通 task/confirm。

## 词汇测评、方案与掌握

接口定义 `index-8e045a01.js@61–682`。

| 前缀及 suffix | 请求/响应 |
|---|---|
| `/api/study/vocab-test/v1/get_home_data` | type=listening|reading；current_vocab/latest_test.has_unfinished/history |
| create_test_session | type → key；创建远端轮次 |
| get_latest_test | type → has_unfinished/key |
| get_question | key → word/opts/correct_opt/严谨度/预估词汇量/预测概率/stats |
| submit_answer | key/word/opt/elapsed_ms → finished/result 或 next_question/stats |
| get_result | key → vocab/mape/ci/rigor |
| `/api/study/vocab-solution/v1/prepare-plan` | 参数预览，返回 detail/historical_data/summary/plan_summary/chapter_details |
| start-plan | 保存参数，返回 plan_id；创建或更新方案 |
| today-plan | has_plan/open_for_user/today_plan/today_learned/plan_detail/历史及目标 |
| `/api/study/lexicon/v1/mastery/list` | type/page/pagesize/category? → list/total/long_term_total/short_term_total/total_mastery |

测评 opt 必须是 opts 的完整原始字符串，不认识为 null；不是另取 A/B/C。correct_opt 用于即时反馈，仍须服务端 submit。elapsed_ms 为 performance.now() 差值的整数毫秒。每题5秒计时；配置 vocab_test_auto_submit_after_5s 开启时到期提交 opt:null，否则仅显示超时（`index-new-a1e69b39.js@4139、4537、6379`）。偏好变更写 customer/v1/update/config。submit 后800ms切题；无自动重发答案或持续取题轮询。31题/60题只是页面提示，不是服务器固定结束条件。

方案参数为 target_ielts_listening_score/exam_date/target_new_word_done_date/target_vocabulary_size/newCorrectTime/newWrongTime/fuxiTime，更新保留 start_date；默认时间10/45/30。日项 xinxueWords/fuxiWords/jianceWords 与对应 TotalTime/deadline；summary 含 new_word_done_date/estimated_total_time/estimated_daily_average_time。参数变化串行调用 prepare，UI 将其视为预览，但服务端是否持久化未证；start 为明确写入。页面日均>3小时警告、>6小时阻止保存，仅为前端规则证据（`index-1a69487f.js@9560–11644`）。

掌握列表 type=short_term|long_term；长效分类字符串 2=proficient、3=practice、4=test。行 lexicon_id/word/translate/mastery_time/next_review_date，页大小20/50/100（`mastery-list-d8a69952.js@2029、4500`）。与本地 SM-2 不应共用同一“熟练度”字段。

## 打字练习和游戏

定义 `index-c2e092ba.js@61–365`，前缀 `/api/study/typing-practice/v1`：materials、records/list、records/start、records/{id}/progress、records/{id}/complete。

materials 返回 writing_sample_essays/ai_stories；list 按 content_type=word|article 返回 in_progress/completed。start 请求 `{content_type,module,mode:timed|standard,config,restart?}`，返回 record/is_continue；可能继续已有不同内容的记录，只有明确重开才加 restart:1（`game-e18b4c03.js@18162`）。

config 按 module 区分：error_book/custom_word 为 title/words[{word,translate}]；word_book 追加 book_id/book_name/chapter_id/chapter_name；custom_article 为 title/text；ai_story 为 story_id/title/title_translate/text；writing_sample_essay 为 result_id/writing_source/kind/title/text。自定义文章最多10000字符且前端拒绝中文；单词规范化NFKC、小写、去重，每项<=48字符。

| 模式 | 进度 body | 原产品触发条件 |
|---|---|---|
| 单词 | `{practiced_items:[完成词...]}` | 达到5词或首个待发词后10秒；失败把词放回队列 |
| 文章 | `{progress:{total_length,current_position}}` | 输入后10秒延迟保存；位置为已输入长度，不是正确字符数 |

complete 之前先 flush；隐藏/退出/unmount 同样 flush。单词 gameover 不等于 complete；词全部打完才 complete。打开一条实际已输入末尾而 status仍为0的记录，页面 mount 就会补 complete（`game@32300–33197、34516、44850`；`index-e187b1b6.js@11372、12192、17613`）。因此“打开记录看看”也可能写入。

词书素材复用 lexicon 目录与章节，错词素材 error/list 请求 page=1,pagesize=300。付费书受 need_buy/already_buy 检查。音频优先词条URL，可回退 `https://dict.youdao.com/dictvoice`；不应只根据主站域设置媒体权限。

鱿鱼模式 `squid-game-a6b72234.js` 未导入 typing records API；当前观察到 pageView/start/continue/eliminated/completed/switchNormal 统计，走 `/api/study/analytics/v1/events/track`（主包@582960）。模拟挑战完成不能当作原打字记录完成。公共 learning-duration/v1/heartbeat 链尚未展开；不能断言游戏不产生其他服务端学习统计。

## 自定义词书与精听上传

主书库入口 `index-fcd3568b.js@134612` 通过 checkUserMemberInfo：type1自定义词书，type4自定义资源；当前函数要求 is_member，游客先绑定（主包@640785）。前端门槛不证明服务器权限。

精听上传组件 `Import-dialog-9788e3c1.js@3680`：name最多40 Unicode codepoint；import_type=1 为 FormData(name/import_type/audio_file)，允许wav/mp3/mp4/m4a/aac/ogg/flac、<=20MiB；type2为audio_url；type3为content<=2000 codepoint，文本一致的试听URL可随附。普通用户路径 `/api/study/customize/v1/add`，企业/班级另走 enterprise/v1/upload/audio 或 class/upload/audio。请求超时180秒。

成功只表示已提交转换；status===4 且 c_id或chapter.id>0 才可练习，status===9为失败。管理接口 customize/v1/list、update/{id}（name）、delete/{id}。不能把 add 成功直接写成本地材料就绪。

词书主包@620315–621147：lexicon/v1/upload/book、lexicon/v2/upload/book/update/{id}、lexicon/v2/upload/book/detail、`api/study/lexicon/v1/upload/book/draft`（草稿路径无前导斜杠）。详情请求g_id，消费 if_share/customize_type/IELTS_category/name或title/c_id/s_id/data/word_count。

新版创建 body `{customize_type:2,title,data:[章节...],if_share,s_id?,id:0,word_count,IELTS_category}`；data 为数组、words为字符串。编辑时 data 是 **JSON字符串**，章节保留c_id，words保留`{word,id}`，新章/词ID为0（`import-dialog-v3-c4ca4ae5.js@46500–47450`）。草稿data仍为数组（@47866）。保存返回g_id；if_share=true会申请社区共享。新建默认开启共享，插件不能无意沿用这一默认值。

## 真人口语课程

入口 purchase/booking/schedule/orders；全部接口在 `index-37f40de4.js`，前缀 `/api/study/philippine-speaking/v1`。

| suffix | 请求/消费 |
|---|---|
| purchase/context | products/is_new_user/credits.available_lessons |
| purchase/quote、purchase/create | product_id/quantity → quote或order、金额、out_trade_no/code_url/status/failure_reason |
| purchase/show | out_trade_no，支付状态 |
| purchase/orders | page/pagesize/status? |
| profile/show、profile/save | english_name/current_base_score/target_score/estimated_exam_date |
| teachers/list | teachers或list/items/data；fully_booked_teachers/availability_tree |
| teachers/{id}/availability | dates/times/available_times；排除available=false |
| appointments/book | teacher_id/course_date/course_time |
| appointments/show | appointment_id → appointment/status/failure_reason |
| appointments/list | page=1/pagesize=100，evaluation_prompt |
| appointments/cancel | appointment_id，可能追加确认扣课时字段 |
| appointments/evaluate | appointment_id/overall_rating/is_anonymous/content |
| practice-questions/options | part_type/keyword/page/pagesize=12/appointment_id? |
| appointments/questions/save | appointment_id/selected_questions，最多5题 |
| learning-center/summary | 已定位，消费端未展开 |

purchase/create 创建真实订单，show每2500ms检查支付；价格按服务端原值显示¥，没有“分”单位证据。余额不足可能转购买后继续预约。profile资料不全先弹窗；英文名校验、分数0–9步长0.5、日期YYYY-MM-DD。

预约状态 pending/processing/succeeded/failed/unknown；pending/processing每2200ms读show。unknown保持课时预占，不能直接重发book（`booking-73dc13e7.js@9715、19761、20411`）。课表 can_cancel 控制取消；课程含 meeting_info、replay_url(s)、lesson_note及附件，实际媒体可达性未证。

取消可能返回 error.values.requires_confirmation/deduct_lessons；用户确认后第二次发送 `{appointment_id,confirmed:1,confirmed_deduct_lessons:服务端当前值}`（`schedule-8c6b95a0.js@29890`）。不得静默确认扣课时。预选题自营用 oral_materials_id，供应商用 supplier_ielts_id，清空数组会远端清空选择（@30300–30620）。

## PK 与模考

PK 路由 `/ielts/king`，API前缀 `/api/study/ielts-king/v1`，定义 `audio-924182e8.js@16020–19280`。mode为listening_part/reading_passage/writing_task1/writing_task2。

API族：friends/search/requests/create/handle/delete；rankings；matches/history；ranked/start/status/cancel；rooms/current/detail/join/leave；invitations/create/accept/reject/cancel/status；matches/detail/opponent-progress/progress/submit。friends/list、rooms/refresh、ranked/matches/detail 只定位到声明，当前调用链未闭合。

题目范围 `{mode,book_id,range_type:part|passage|task,range_no}` 按四元组去重，UI自选至少10套；ranked/start传mode/question_ranges。房间room_no为6位字符串。queue保留queue_id/status/remaining_seconds/match_id/can_cancel等；match保留match_id/room_id/match_type/affects_stars/status/mode/question/participants/current_user_side/can_report_progress/can_submit。opponent_type real|simulated必须准确显示。

**matches/progress 是写操作且可开局**：房主传全零计数和 `progress_payload.event=room_owner_started|invitation_owner_started`（`index-919d4bdb.js@57900、58400`）。正常进度为match_id/answered_count/correct_count/total_count/duration_seconds/progress_payload，可附force_submit_remaining_seconds。对手进度每3秒、己方上报每5秒、提交后状态每4秒，终态停止（`useIeltsKingMatch-ab908a8a.js@5550、11000`）。

先保存原练习，再POST matches/submit，传practice_result_type/practice_result_id/result_payload.source_result_id与计数/时长。写作score_value为band，correct_count=round(band*10)、total_count=90是结算编码，不能按真实题数展示（@2070）。原练习保存成功与PK结算成功是两个状态。

口语模考从现有part1/part2目录选题并show，三个Part都需非空；时限verification4/part1每题30/preparation60/part2 120/part3每题60/minFinish5秒。逐题走原kouyu submit，失败可保留本地录音/文本并标local；没有发现独立整场云端submit/history，整场摘要在sessionStorage（`speaking-mock-98081e9d.js@12145、15400`、`speaking-mock-session-15339205.js@3150`）。录音供应商授权链仍未展开。

三科联考按分科 practice_result_shoudong.action 或 practice_result.action 判断c/p/n，依次进入现有听读写练习；没有证据支持发明独立联考提交接口（`index-fcd3568b.js@52381、58800–59800`；`process-5692b6af.js@4700`）。模拟机考登录页是本地演示输入校验，不是用户账号认证协议。

班级模考另有 `/api/study/enterprise/v1/class/exam/{add,update,list,show,status/update,result/list,result/show}`。创建/更新含title/subject/source/scope_type/content_id/writing_scope/auto_submit_on_timeout/start_at/stop_enter_at/status及class_id或id；part考试关闭超时自动交卷。学生进场受can_enter/enter_message控制并携带classExamId/class_exam_id。管理写操作及完整结果分析尚未验证（`index-9dbadf8f.js@2500`、`detail-8419046d.js@126000`）。

## 账户、权益、反馈和角色

个人设置入口 `index-a1fe1f0c.js@9716`，当前账号与配置读 `/api/study/customer/v1/login/msg`。主包@479033 的 handleConfig 更新状态并提交 `/api/study/customer/v1/update/config`，删除recent_collection_book_id/recent_chapter_id/is_new_user/member等非提交字段；通常发送清理后的配置对象，不是任意单字段patch。另有 `/user/saveConfig` wrapper，不能无样例就认定二者等价。

个人资料路径 `customer/v1/update/{nickname,avatar,yasi-score,target-ielts-writing-score,target-ielts-listening-score,target-ielts-reading-score}`；提醒状态 update/{pro-notice-not-today,fuxi-notice-not-today,vip-last-notice-not-today}。logout是退出，cancel是注销；phone/send/sms与signup有短信/注册副作用（主包@521226–522440）。

权益分个人会员、enterprise_pro、personal_member、已购书，不能压成一个boolean。个人会员状态通常为“进行中”；租户企业Pro还判断source=enterprise_pro、!read_only及进行中/active/valid/1/true。教师/管理员有独立分支，角色名接受teacher/教师/老师、admin/管理员（主包@473000–474590）。购书权限按g_id→already_buy映射（@482519）。

权益读取：`customer/v1/member/detail`、`customer/v1/member/v1/product/list`、`customer/v1/member/v1/buy-book/book-list`。支付/领取/激活路径为同一member/v1前缀下pay/receive/buy-book/prepare/buy-book/active-by-code；pay/result需已有订单上下文。补偿会员路径get-30day-vip-202603-fault使用POST wrapper且改变权益，不能按名称get归类只读（@472525–472959）。

反馈 `/api/study/customer/v1/{wish,bug-report,zhenti-report}/submit` 为FormData，最多4000字、一张5MiB图片，真题反馈附feedback_type及题目上下文。feedback-reply/unread读取回复，feedback-reply/read传reply_id改变已读状态（`index-3bcab2c2.js@1727–2460`、主包@764604）。打开反馈dialog可观察，提交内容属于向站方发送消息，不纳入静默取证。客服中心为外部飞书帮助文档链接。

学生的班级入口来自school_class/classInfo；无班级时隐藏班级学习分类。class资源按class_id/resource_id关联，studentView禁止移除（`ClassResourceCard-bc69cf2b.js@1538、2050`）。已有邀请可读enterprise/v1/get/invite/info；加入/退出班级为写操作。enterprise前缀并非全为教师API：学生可读其已有班级考试和任务。

教师入口is_enterprise控制，申请教师版的enterprise/v1/add会创建机构。教师只看自己班级，机构管理员可看全班和账户/品牌管理；Pro席位功能还要求企业Pro。API定义 `index-9dbadf8f.js@69–3138`：

- 读取：enterprise/v1/get/role、manager/list、class/list、class/student/list、class/student/daily-task-report、class/student/study-duration、class/student/error/list、settings/show、pro/member/list。
- 人员与班级写入：manager/{role/update,delete,class-permission/update}、class/{add,update,delete/{id},update/student/info,delete/student,student/add-by-phone}。
- 资源与权益写入：upload/book、upload/book/update/{id}、class/upload/book、class/book/remove、resource/book/unlink、pro/member/{open,remove,batch/check,batch/add}。
- 教学发布：class/exam/{add,update,status/update}、class/student/zhenti/note/save、enterprise/v1/learning-plan下模板和分配/替换/取消。会影响学生，不能用普通账号枚举执行。

站点admin为另一权限：路由admin:true且is_admin/getIsAdmin门禁（主包@798146、851545、854820）。当前账号未验证，管理端只登记存在，不纳入普通学习同步。

## 设置弹窗补充合同

原公开脚本采集正则漏掉文件名中的点，修正后从原哈希快照补下载5个模块，现为198个。三套设置模块是 `setting.vue_vue_type_script_setup_true_lang-{b54dd3df,d114593f,ebd11ef8}.js`，分别对应词汇、雅思、文章；下面简称词汇设置、雅思设置、文章设置。

| 设置 | 可见配置组与条件 | 写入触发 |
|---|---|---|
| 词汇 | 答题/声音/显示/复习/快捷键/其他；errSource区分章节与错词开关，fromUser且非游客才显示其他 | 普通change emit setting，父页立即handleConfig；音量input只预览、change才保存 |
| 雅思 | listening-result有语速/次数/句首或单词起播/答案自动播/answer或location播放；两科复盘有划词与高亮；阅读隐藏听力快捷键 | change串行await handleConfig，成功才通知播放器；失败回滚；关闭不取消已排队保存 |
| 文章 | 按article_playback_type显示听写/连续播放/标记精听配置；短句需sentenceModeSupported；无shortcutGroupIds隐藏快捷键 | 普通change立即保存；当前模式短句先切材料成功再保存偏好，失败回滚模式和偏好 |

词汇键：word_wrong_word_cycle/wrong_wrong_word_cycle、is_error_study/is_general_error_study、wrong_word_animation_type、play_speed、repetitions、lianxutingxie、play_interval；phonetic_type、error_sound、is_error_ok_sound/is_error_ok_sound_volume、is_sound_effects；is_show_correct_word/is_show_en_example/is_show_symbol/is_show_yinbiao/is_show_hanyushiyi/mnemonic_split_enabled；review_total/is_auto_review_collect；keyboard_shortcuts、task_center_enabled。词汇设置@2130–4440定义菜单、@8198写入出口。task_center_enabled@8326单独等待配置后提交该字段。

打开词汇设置会读review/v1/today-count（@7633），不只是本地弹窗。清空复习使用GET review/v1/clear且确认框**onCancel绑定“清空”，confirm反而“不清空”**（@9868、12902）；注销customer/v1/cancel有10秒倒计时（@10173、16096）。自动测试必须以可见操作语义定位，不能按通用confirm/cancel名称点击。

雅思设置@3556打开前等待保存队列并加载配置，@4031串行提交。恢复快捷键默认值还可能把ielts_shortcut_playback_speed重设0.6，产生两次请求。文章设置@1873负责短句切换回滚；@4814句子抽屉的“仅听答案/收藏句”直接保存is_only_listen_answer_collect_sentences。

本地例外：主题更新DOM/localStorage；全屏调用浏览器API；article_cloze_types仅localStorage（`index-fabf838e.js@21250–21970`），值answer_expression/logic_signal/question_paraphrase/key_constraint。不能统一同步为远端配置。快捷键录入仅点击“确定”才保存；取消不保存，单条重置或恢复默认立即保存（`shortcutSetting-552b630c.js@4424–4880`）。

源产品异常：词汇设置@5965的mnemonic_split_enabled初始化使用is_show_correct_word并`||1`；不要将此初始化误当字段定义，真实配置与行为待抽验。

## 尚未闭合的证据

- 当前账号的目录、书章内容、媒体权限、付费边界及所有写操作仍未实测。
- 文章填空类型选择helper已补齐，但类型到具体词位的生成仍需真实材料；录音SDK/授权/上传前段、企业文件/视频直传审核仍有静态缺口。
- 雅思复杂题型、段落图片、模考/PK/教师任务仍需实际材料与完整交互样例。
- Reader 文档更新后的锚点迁移与锁冲突须以真实错误响应确认。
- 请求由原产品流程产生、会话隔离、限频/过期停止及回读验证仍未实施；本文件不能作为直接上线依据。
