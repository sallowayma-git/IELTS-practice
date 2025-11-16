# Practice Answer Data Gap Report (Generated 2025-11-16)

## 方法
- 使用 Python 脚本遍历当前仓库内的所有 `.html` 文件。
- 若文件中未发现 `data-answer`、`data-correct`、`data-solution`、`correctAnswers`、`answerKey`、`window.answers`、`window.examAnswers` 等关键字，则视为“缺少答案元数据”。
- 命令示例：
  ```bash
  python3 scripts/list-missing-answer-metadata.py
  ```
  > 临时脚本核心逻辑：
  > ```python
  > import os
  > KEYWORDS = [
  >     'data-answer', 'data-correct', 'data-solution',
  >     'correctAnswers', 'answerKey', 'window.answers', 'window.examAnswers'
  > ]
  > missing = []
  > for root, _, files in os.walk('.'):
  >     if '.git' in root.split(os.sep):
  >         continue
  >     for fn in files:
  >         if not fn.lower().endswith('.html'):
  >             continue
  >         path = os.path.join(root, fn)
  >         with open(path, 'r', encoding='utf-8', errors='ignore') as f:
  >             content = f.read()
  >         if not any(k in content for k in KEYWORDS):
  >             missing.append(path)
  > print('\n'.join(sorted(missing)))
  > ```

## 统计
- 检测到 **323** 个 HTML 页面缺少答案元数据。
- 这些页面在当前统一 UI 下无法展示正确答案，需要补充 `data-answer`/`correctAnswers` 或提供外部答案库。

## 缺失列表
> 完整列表如下，如需精简可按题库或路径过滤。

```
./.superdesign/design_iterations/HP/Welcome.html
./.superdesign/design_iterations/HarryPoter.html
./.superdesign/design_iterations/xiaodaidai_dashboard_1.html
./ListeningPractice/P3/1. PART3 Julia and Bob’s science project is due/1. PART3 Julia and Bob’s science project is due.html
./ListeningPractice/P3/10. PART3  Research for assignment of children playing outdoors/10. PART3  Research for assignment of children playing outdoors.html
./ListeningPractice/P3/13. PART3 Aerial Reforestation Process/Aerial Reforestation Process.html
./ListeningPractice/P3/14. PART3 Choosing a University Course/Choosing a University Course.html
./ListeningPractice/P3/15. PART3 Farmers' attitudes to new developments in agriculture/PART3 Farmers' attitudes to new developments in agriculture.html
./ListeningPractice/P3/16. PART3 Gallery Marketing/PART 3 Gallery Marketing.html
./ListeningPractice/P3/17. PART3 Kathy's dissertation on water pumps/PART3 Kathy's dissertation on water pumps.html
./ListeningPractice/P3/18. PART3 Maori Greenstone Tiki Carvings/Maori Greenstone Tiki Carvings.html
./ListeningPractice/P3/2. PART3 P3 Climate change and allergies/2. PART3 P3 Climate change and allergies.html
./ListeningPractice/P3/3. PART 3 Applying the different theoretical business tools for the report/3. PART 3 Applying the different theoretical business tools for the report.html
./ListeningPractice/P3/30. PART 3 Study Skills Tutorial - Caroline Benning/30. PART 3 Study Skills Tutorial - Caroline Benning.html
./ListeningPractice/P3/31. PART3 An IT Project for Tuners/31. PART3 An IT Project for Tuners.html
./ListeningPractice/P3/35. PART3  Planning a presentation on nanotechnology/35. PART3  Planning a presentation on nanotechnology.html
./ListeningPractice/P3/36. PART3 Research into how babies learn/36. PART3 Research into how babies learn.html
./ListeningPractice/P3/37. PART3 Forensic Linguistics/37. PART3 Forensic Linguistics.html
./ListeningPractice/P3/38. PART3  Research on absence from work/38. PART3  Research on absence from work.html
./ListeningPractice/P3/39. PART3 Dolphin presentation/39. PART3 Dolphin presentation.html
./ListeningPractice/P3/40. PART 3 Peer Assessment/40. PART 3 Peer Assessment.html
./ListeningPractice/P3/5. PART3 The Role of Health Visitors/5. PART3 The Role of Health Visitors.html
./ListeningPractice/P3/52.PART3 Selective courses/52.PART3 Selective courses.html
./ListeningPractice/P3/56. PART3 Stone Point a New Zealand Historical Site/56. PART3 Stone Point a New Zealand Historical Site.html
./ListeningPractice/P3/6. PART3 Eyewitness reliability/6. PART3 Eyewitness reliability.html
./ListeningPractice/P3/60. PART3 Research on the effect of walking on creativity/60. PART3 Research on the effect of walking on creativity.html
./ListeningPractice/P3/7. PART3 Product development presentation mosquito net/7. PART3 Product development presentation mosquito net.html
./ListeningPractice/P3/8. PART 3 Personal Support Workers (PSWs)/8. PART 3 Personal Support Workers (PSWs).html
./ListeningPractice/P4/1. PART4  Participants in the learner Persistence study/1. PART4  Participants in the learner Persistence study.html
./ListeningPractice/P4/11. PART4 The preservation of organisms and fossils/11. PART4 The preservation of organisms and fossils.html
./ListeningPractice/P4/12. PART4  After Action Review Process/12. PART4  After Action Review Process.html
./ListeningPractice/P4/13. PART4  Leatherback Turtles/13. PART4  Leatherback Turtles.html
./ListeningPractice/P4/17. PART4 American Salt Marshes/17. PART4 American Salt Marshes.html
./ListeningPractice/P4/18. PART4 Adwaita turtles/18. PART4 Adwaita turtles.html
./ListeningPractice/P4/19. PART 4 Bislama – The Pidgin English Language of Vanuatu/19. PART 4 Bislama – The Pidgin English Language of Vanuatu.html
./ListeningPractice/P4/2. PART4 City Development/2. PART4 City Development.html
./ListeningPractice/P4/21. PART4  Aboriginal Textile Design/21. PART4  Aboriginal Textile Design.html
./ListeningPractice/P4/23. PART4 Elephant research in Amboseli/23. PART4 Elephant research in Amboseli.html
./ListeningPractice/P4/25. PART4 Study on dolphins' behavior/25. PART4 Study on dolphins' behavior.html
./ListeningPractice/P4/28. PART4 Reintroducing the Beaver Population to Britain/28. PART4 Reintroducing the Beaver Population to Britain.html
./ListeningPractice/P4/3. PART4 The Early History of Salt/3. PART4 The Early History of Salt.html
./ListeningPractice/P4/32. PART4 Gastropods (snails and slugs)/32. PART4 Gastropods (snails and slugs).html
./ListeningPractice/P4/33. PART4  Vertical farming a new approach to growing crops/33. PART4  Vertical farming a new approach to growing crops.html
./ListeningPractice/P4/34. PART 4 The Vikings/The Vikings.html
./ListeningPractice/P4/35. PART4 Tourism in Antarctica/Tourism in Antarctica.html
./ListeningPractice/P4/36. PART4 Underwater Archaeological Sites/Part 4 Underwater Archaeological Sites.html
./ListeningPractice/P4/37. PART4 How To Unleash Your Creativity/How To Unleash Your Creativity.html
./ListeningPractice/P4/38. PART4 Supplementary feeding of wild animals/PART4  Supplementary feeding of wild animals.html
./ListeningPractice/P4/39. PART4 Survival Strategies of Male Lizards/PART 4 Survival Strategies of Male Lizards.html
./ListeningPractice/P4/4. PART4 Field Trial – Heat Pump/4. PART4 Field Trial – Heat Pump.html
./ListeningPractice/P4/40. PART 4  Benefits of using drama activities in the classroom/PART4  Benefits of using drama activities in the c.html
./ListeningPractice/P4/41. PART4 Max Dupain/41. PART4 Max Dupain.html
./ListeningPractice/P4/42. PART 4 Photic sneezing/42. PART 4 Photic sneezing.html
./ListeningPractice/P4/43. PART4 Development of tunnel linking Franch and England/43. PART4 Development of tunnel linking Franch and England.html
./ListeningPractice/P4/44. PART4 Kakapo, the endangered bird/44. PART4 Kakapo, the endangered bird.html
./ListeningPractice/P4/45. PART 4 Volcanic Activity on Mount Pinatub/45. PART 4 Volcanic Activity on Mount Pinatub.html
./ListeningPractice/P4/48. PART4 Extinction of Australian species/48. PART4 Extinction of Australian species.html
./ListeningPractice/P4/50. PART4 Stone Age Man in Japan/50. PART4 Stone Age Man in Japan.html
./ListeningPractice/P4/51. PART4 Early gold mining in the Otago region, New Zealand/51. PART4 Early gold mining in the Otago region, New Zealand.html
./ListeningPractice/P4/55. PART4 Providing IT support for University Teachers/55. PART4 Providing IT support for University Teachers.html
./ListeningPractice/P4/57. PART4  Architecture in New Zealand in 1960s/57. PART4  Architecture in New Zealand in 1960s.html
./ListeningPractice/P4/6.  Part 4 The development and production of the pencil/6.  Part 4 The development and production of the pencil.html
./ListeningPractice/P4/61. PART4 The Underground House/61. PART4 The Underground House.html
./ListeningPractice/P4/62. PART4  Oxytocin and trust/62. PART4  Oxytocin and trust.html
./ListeningPractice/P4/66. PART4 Different Types of Supermarket Layout/66. PART4 Different Types of Supermarket Layout.html
./ListeningPractice/P4/67. PART4 Working as a Patent Attorney/67. PART4 Working as a Patent Attorney.html
./ListeningPractice/P4/7.  Part 4 The Salamander/7.  Part 4 The Salamander.html
./ListeningPractice/P4/72. PART4 New engineering designs Scottish case study/72. PART4 New engineering designs Scottish case study.html
./ListeningPractice/P4/76. PART4 Soundspace/76. PART4 Soundspace.html
./ListeningPractice/P4/78. PART 4 Education about research in the humor of young children/78. PART 4 Education about research in the humor of young children.html
./ListeningPractice/P4/81. PART4 A museum in Japan/81. PART4 A museum in Japan.html
./ListeningPractice/P4/82. PART4 Textiles with Business Studies/82. PART4 Textiles with Business Studies.html
./ListeningPractice/P4/83. PART4 Expertise in creative writing/83. PART4 Expertise in creative writing.html
./ListeningPractice/P4/84. PART4 Human Memory/84. PART4 Human Memory.html
./ListeningPractice/P4/85. PART4 Crisis Communication Theory/85. Crisis Communication Theory.html
./ListeningPractice/P4/86. PART4 The Lontar Palm/86. PART4 The Lontar Palm.html
./ListeningPractice/P4/91. PART4 The Restoration of Paintings/91. PART4 The Restoration of Paintings.html
./ListeningPractice/P4/92. PART4 Cloud Science/92. PART4 Cloud Science.html
./developer/tests/e2e/app-e2e-runner.html
./developer/tests/e2e/fixtures/index.html
./developer/tests/e2e/fixtures/睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/placeholder.html
./developer/tests/e2e/fixtures/睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/placeholder.html
./developer/tests/performance-test.html
./developer/tests/refresh-test.html
./developer/tests/regression-test.html
./index.html
./templates/exam-placeholder.html
./templates/template_base.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/1. P1 - A Brief History of Tea 茶叶简史【高】/1. P1 - A Brief History of Tea 茶叶简史【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/17. P1 - The Development of The Silk Industry 丝绸产业发展【高】/17. P1 - The Development of The Silk Industry 丝绸产业发展【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/18. P1 - The History of Tea 茶叶的历史【高】/18. P1 - The History of Tea 茶叶的历史【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/19. P1 - The Impact of the Potato 土豆的影响【高】/19. P1 - The Impact of the Potato 土豆的影响【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/2. P1 - A survivor’s story 新西兰猫头鹰【高】/2. P1 - A survivor’s story 新西兰猫头鹰【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/24. P1 - The Pearls 珍珠【高】/24. P1 - The Pearls 珍珠【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/31. P1 - William Gilbert and Magnetism 电磁学之父【高】/31. P1 - William Gilbert and Magnetism 电磁学之父【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/8. P1 - Fishbourne Roman Palace 罗马宫殿【高】/8. P1 - Fishbourne Roman Palace 罗马宫殿【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/2. P1（次高频）[8篇]/116. P1 - The Development of Plastics 塑料的发展史【次】/116. P1 - The Development of Plastics 塑料的发展史【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/2. P1（次高频）[8篇]/124. P1 - The extinction of the cave bear 洞熊的灭绝【次】/124. P1 - The extinction of the cave bear 洞熊的灭绝【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/2. P1（次高频）[8篇]/15. P1 - The Blockbuster Phenomenon 博物馆爆款现象【次】/15. P1 - The Blockbuster Phenomenon 博物馆爆款现象【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/2. P1（次高频）[8篇]/29. P1 - Tunnelling under the Thames 泰晤士河隧道【次】/29. P1 - Tunnelling under the Thames 泰晤士河隧道【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/2. P1（次高频）[8篇]/30. P1 - What Lucy Taught Us 露西化石【次】/30. P1 - What Lucy Taught Us 露西化石【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/2. P1（次高频）[8篇]/32. P1 - Wood 新西兰木材产业【次】/32. P1 - Wood 新西兰木材产业【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/2. P1（次高频）[8篇]/9. P1 - Listening to the Ocean 海洋探测【次】/9. P1 - Listening to the Ocean 海洋探测【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/106. P2 - Early Approaches to Organisational Design 组织设计【高】/106. P2 - Early Approaches to Organisational Design 组织设计【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/110. P2 - Should space be explored by robots or by humans 人机太空探索【高】/110. P2 - Should space be explored by robots or by humans 人机太空探索【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/112. P2 - The Importance of Law 法律的意义【高】/112. P2 - The Importance of Law 法律的意义【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/113. P2 - Herbal Medicines 新西兰草药【高】/113. P2 - Herbal Medicines 新西兰草药【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/115. P2 - Mind Music 脑海中的音乐(心灵音乐)【高】/115. P2 - Mind Music 脑海中的音乐(心灵音乐)【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/117. P2 - Stress Less 工作压力【高】/117. P2 - Stress Less 工作压力【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/119. P2 - The Constant Evolution of the Humble Tomato 番茄的演化【高】/119. P2 - The Constant Evolution of the Humble Tomato 番茄的演化【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/120. P2 - Will Eating Less Make You Live Longer 节食与长寿【高】/120. P2 - Will Eating Less Make You Live Longer 节食与长寿【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/33. P2 - A new look for Talbot Park 奥克兰社区改造【高】/ai_studio_code (9).html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/36. P2 - Bird Migration 鸟类迁徙【高】/36. P2 - Bird Migration 鸟类迁徙【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/37. P2 - Corporate Social Responsibility  企业社会责任【高】/37. P2 - Corporate Social Responsibility  企业社会责任【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/40. P2 - How Well Do We Concentrate_  多任务处理【高】/40. P2 - How Well Do We Concentrate_  多任务处理【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/42. P2 - Investment in shares versus investment in other assets 回报数据分析【高】/42. P2 - Investment in shares versus investment in other assets 回报数据分析【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/43. P2 - Learning from the Romans 罗马混凝土【高】/43. P2 - Learning from the Romans 罗马混凝土【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/45. P2 - Playing soccer 街头足球【高】/45. P2 - Playing soccer 街头足球【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/46. P2 - Roller coaster 过山车【高】/46. P2 - Roller coaster 过山车【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/48. P2 - Solving the problem of waste disposal 垃圾处理【高】/48. P2 - Solving the problem of waste disposal 垃圾处理【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/49. P2 - Surviving city life 动物适应城市【高】/49. P2 - Surviving city life 动物适应城市【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/50. P2 - The conquest of malaria in Italy 意大利疟疾防治【高】/50. P2 - The conquest of malaria in Italy 意大利疟疾防治【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/52. P2 - The fascinating world of attine ants 切叶蚁【高】/52. P2 - The fascinating world of attine ants 切叶蚁【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/3. P2（高频）[22篇]/56. P2 - The return of monkey life 猴群回归【高】/56. P2 - The return of monkey life 猴群回归【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/4. P2（次高频）[6篇]/107. P2 - A study of western celebrity 西方名人【次】/107. P2 - A study of western celebrity 西方名人【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/4. P2（次高频）[6篇]/34. P2 - A unique golden textile 蜘蛛丝【次】/34. P2 - A unique golden textile 蜘蛛丝【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/4. P2（次高频）[6篇]/39. P2 - How are deserts formed 沙漠成因【次】/39. P2 - How are deserts formed 沙漠成因【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/4. P2（次高频）[6篇]/41. P2 - Intelligent behaviour in birds 鸟类智慧行为【次】/41. P2 - Intelligent behaviour in birds 鸟类智慧行为【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/4. P2（次高频）[6篇]/55. P2 - The plan to bring an asteroid to Earth 捕获小行星【次】/55. P2 - The plan to bring an asteroid to Earth 捕获小行星【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/4. P2（次高频）[6篇]/57. P2 - The Tasmanian Tiger 袋狼【次】/57. P2 - The Tasmanian Tiger 袋狼【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/100. P3 - What makes a musical expert_ 音乐天赋【高】/100. P3 - What makes a musical expert_ 音乐天赋【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/101. P3 - Yawning 打呵欠【高】/101. P3 - Yawning 打呵欠【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/111. P3 - Whale Culture 鲸鱼文化【高】/111. P3 - Whale Culture 鲸鱼文化【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/127. P3 - Science and Filmmaking 电影科学(CGI)【高】/127. P3 - Science and Filmmaking 电影科学(CGI)【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/60. P3 - A closer examination of a study on verbal and non-verbal messages 语言表达研究【高】/60. P3 - A closer examination of a study on verbal and non-verbal messages 语言表达研究【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/66. P3 - Elephant Communication 大象交流【高】/66. P3 - Elephant Communication 大象交流【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/67. P3 - Flower Power 鲜花的力量(花之力)【高】/67. P3 - Flower Power 鲜花的力量(花之力)【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/69. P3 - Grimm’s Fairy Tales 格林童话【高】/69. P3 - Grimm’s Fairy Tales 格林童话【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/70. P3 - Insect-inspired robots 昆虫机器人【高】/70. P3 - Insect-inspired robots 昆虫机器人【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/73. P3 - Language Strategy in Multinational Companies 跨国公司语言策略【高】/73. P3 - Language Strategy in Multinational Companies 跨国公司语言策略【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/76. P3 - Living dunes 流动沙丘【高】/76. P3 - Living dunes 流动沙丘【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/79. P3 - Pacific Navigation and Voyaging 太平洋航海【高】/79. P3 - Pacific Navigation and Voyaging 太平洋航海【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/81. P3 - Robert Louis Stevenson 苏格兰作家【高】/81. P3 - Robert Louis Stevenson 苏格兰作家【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/82. P3 - Some views on the use of headphones 耳机使用【高】/82. P3 - Some views on the use of headphones 耳机使用【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/86. P3 - The benefits of learning an instrument 学乐器的好处【高】/86. P3 - The benefits of learning an instrument 学乐器的好处【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/88. P3 - The fluoridation controversy 氟化水争议【高】/88. P3 - The fluoridation controversy 氟化水争议【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/89. P3 - The Fruit Book 果实之书【高】/89. P3 - The Fruit Book 果实之书【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/91. P3 - The New Zealand writer Margaret Mahy 新西兰女作家【高】/91. P3 - The New Zealand writer Margaret Mahy 新西兰女作家【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/96. P3 - The tuatara – past and future 新西兰蜥蜴【高】/96. P3 - The tuatara – past and future 新西兰蜥蜴【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/5. P3（高频）[20篇]/99. P3 - Voynich Manuscript 伏尼契手稿【高】/99. P3 - Voynich Manuscript 伏尼契手稿【高】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/114. P3 - Unlocking the mystery of dreams 梦的解析【次】/114. P3 - Unlocking the mystery of dreams 梦的解析【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/118. P3 - Neanderthal Technology 尼安德特人的生存技艺【次】/118. P3 - Neanderthal Technology 尼安德特人的生存技艺【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/62. P3 - Charles Darwin and Evolutionary Psychology 进化心理学【次】/62. P3 - Charles Darwin and Evolutionary Psychology 进化心理学【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/64. P3 - Decisions, Decisions 决策之间【次】/64. P3 - Decisions, Decisions 决策之间【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/65. P3 - Does class size matter_ 课堂规模【次】/65. P3 - Does class size matter_ 课堂规模【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/71. P3 - Jean Piaget (1896–1980) 让·皮亚杰【次】/71. P3 - Jean Piaget (1896–1980) 让·皮亚杰【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/77. P3 - Marketing and the information age 信息时代营销【次】/77. P3 - Marketing and the information age 信息时代营销【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/84. P3 - The Analysis of Fear 猴子恐惧实验【次】/84. P3 - The Analysis of Fear 猴子恐惧实验【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/85. P3 - The Art of Deception 欺骗的艺术【次】/85. P3 - The Art of Deception 欺骗的艺术【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/87. P3 - The Exploration of Mars 火星探索【次】/87. P3 - The Exploration of Mars 火星探索【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/90. P3 - The hazards of multitasking 多任务处理【次】/90. P3 - The hazards of multitasking 多任务处理【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/92. P3 - The Pirahã people of Brazil  巴西皮拉罕部落语言【次】/92. P3 - The Pirahã people of Brazil  巴西皮拉罕部落语言【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/95. P3 - The Significant Role of Mother Tongue in Education 母语教育【次】/95. P3 - The Significant Role of Mother Tongue in Education 母语教育【次】.html
./睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/6. P3（次高频）[15篇]/98. P3 - Video Games’ Unexpected Benefits to the Human Brain 电子游戏的好处【次】/98. P3 - Video Games’ Unexpected Benefits to the Human Brain 电子游戏的好处【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/1. P1 - A Brief History of Tea 茶叶简史【高】/1. P1 - A Brief History of Tea 茶叶简史【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/10. P1 - Maori Fish Hooks 毛利鱼钩/10. P1 - Maori Fish Hooks 毛利鱼钩.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/100. P3 - What makes a musical expert_ 音乐天赋【高】/100. P3 - What makes a musical expert_ 音乐天赋【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/101. P3 - Yawning 打呵欠【高】/101. P3 - Yawning 打呵欠【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/103. P2 - Biomimicry 仿生学/103. P2 - Biomimicry 仿生学.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/104. P3 - Star Performers 明星员工/104. P3 - Star Performers 明星员工.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/105. P2 - How the Petri dish supports scientific advances 培养皿/105. P2 - How the Petri dish supports scientific advances 培养皿.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/106. P2 - Early Approaches to Organisational Design 组织设计【高】/106. P2 - Early Approaches to Organisational Design 组织设计【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/107. P2 - A study of western celebrity 西方名人【次】/107. P2 - A study of western celebrity 西方名人【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/108. P1 - Bovids 牛科动物/108. P1 - Bovids 牛科动物.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/109. P3 - Humanities and the health professional 人文医学/109. P3 - Humanities and the health professional 人文医学.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/11. P1 - Report on a university drama project 大学戏剧项目报告/11. P1 - Report on a university drama project 大学戏剧项目报告.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/110. P2 - Should space be explored by robots or by humans 人机太空探索【高】/110. P2 - Should space be explored by robots or by humans 人机太空探索【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/111. P3 - Whale Culture 鲸鱼文化【高】/111. P3 - Whale Culture 鲸鱼文化【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/112. P2 - The Importance of Law 法律的意义【高】/112. P2 - The Importance of Law 法律的意义【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/113. P2 - Herbal Medicines 新西兰草药【高】/113. P2 - Herbal Medicines 新西兰草药【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/114. P3 - Unlocking the mystery of dreams 梦的解析【次】/114. P3 - Unlocking the mystery of dreams 梦的解析【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/115. P2 - Mind Music 脑海中的音乐(心灵音乐)【高】/115. P2 - Mind Music 脑海中的音乐(心灵音乐)【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/116. P1 - The Development of Plastics 塑料的发展史【次】/116. P1 - The Development of Plastics 塑料的发展史【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/117. P2 - Stress Less 工作压力【高】/117. P2 - Stress Less 工作压力【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/118. P3 - Neanderthal Technology 尼安德特人的生存技艺【次】/118. P3 - Neanderthal Technology 尼安德特人的生存技艺【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/119. P2 - The Constant Evolution of the Humble Tomato 番茄的演化【高】/119. P2 - The Constant Evolution of the Humble Tomato 番茄的演化【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/120. P2 - Will Eating Less Make You Live Longer 节食与长寿【高】/120. P2 - Will Eating Less Make You Live Longer 节食与长寿【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/123. P3 - Images and Places 风景与印记/123. P3 - Images and Places 风景与印记.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/124. P1 - The extinction of the cave bear 洞熊的灭绝【次】/124. P1 - The extinction of the cave bear 洞熊的灭绝【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/125. P1 - Investing in the Future 投资未来/125. P1 - Investing in the Future 投资未来.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/127. P3 - Science and Filmmaking 电影科学(CGI)【高】/127. P3 - Science and Filmmaking 电影科学(CGI)【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/129. P1 - The Slow Food Organization 慢食运动组织/129. P1 - The Slow Food Organization 慢食运动组织.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/13. P1 - Sweet Trouble 澳洲制糖产业/13. P1 - Sweet Trouble 澳洲制糖产业.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/130. P3 - Tasmania’s Museum of Old and New Art 塔斯马尼亚古今艺术博物馆 MONA/130. P3 - Tasmania’s Museum of Old and New Art 塔斯马尼亚古今艺术博物馆 MONA.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/131. P2 - Keeping the water away 洪水防控/131. P2 - Keeping the water away 洪水防控.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/132. P3 - Research into the effects of different teaching styles 教学风格研究/132. P3 - Research into the effects of different teaching styles 教学风格研究.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/133. P2 - How to be Happy 如何获得幸福/133. P2 - How to be Happy 如何获得幸福.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/134. P1 - Dyes and fabric dyeing 染料的历史/134. P1 - Dyes and fabric dyeing 染料的历史.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/135. P2 - The Myth of the Eight-hour Sleep 八小时睡眠/135. P2 - The Myth of the Eight-hour Sleep 八小时睡眠.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/136. P3 - The peopling of Patagonia 巴塔哥尼亚的人类迁徙/136. P3 - The peopling of Patagonia 巴塔哥尼亚的人类迁徙.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/137. P3 - What is social history 社会史/137. P3 - What is social history 社会史.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/138. P3 - Conformity 从众心理/138. P3 - Conformity 从众心理.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/139. P1 - Sleep Study on Modern-Day Hunter-Gatherers Dispels Popular Notions 部落睡眠研究/139. P1 - Sleep Study on Modern-Day Hunter-Gatherers Dispels Popular Notions 部落睡眠研究.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/14. P1 - Sydney Opera House 悉尼歌剧院/14. P1 - Sydney Opera House 悉尼歌剧院.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/140. P1 - The Burgess Shale fossils 伯吉斯页岩/140. P1 - The Burgess Shale fossils 伯吉斯页岩.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/141. P1 - The history of the guitar 吉他的历史/141. P1 - The history of the guitar 吉他的历史.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/142. P2 - Born to Trade 交易的本能/142. P2 - Born to Trade 交易的本能.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/143. P2 - Jellyfish – The Dominant Species 水母·海洋中的优势物种/143. P2 - Jellyfish – The Dominant Species 水母·海洋中的优势物种.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/144. P2 - The gender gap in New Zealand’s high school examination results 新西兰考试成绩的性别差异/144. P2 - The gender gap in New Zealand’s high school examination results 新西兰考试成绩的性别差异.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/145. P1 - Caral an ancient South American city 卡拉尔古城/145. P1 - Caral an ancient South American city 卡拉尔古城.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/146. P1 - The Early History of Olive Oil 橄榄油的历史/146. P1 - The Early History of Olive Oil 橄榄油的历史.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/147. P3 - Movement Underwater 水下运动/147. P3 - Movement Underwater 水下运动.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/148. P3 - Improving Patient Safety 药品包装设计/148. P3 - Improving Patient Safety 药品包装设计.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/149. P3 - Learning to be bilingual 双语学习/149. P3 - Learning to be bilingual 双语学习.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/15. P1 - The Blockbuster Phenomenon 博物馆爆款现象【次】/15. P1 - The Blockbuster Phenomenon 博物馆爆款现象【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/150. P2 - Insect Decision-Making 昆虫决策【次】/150. P2 - Insect Decision-Making 昆虫决策【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/151. P3 - Inside the mind of a fan 观赛心境/151. P3 - Inside the mind of a fan 观赛心境.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/152. P1 - Sorry—who are you 脸盲症【次】/152. P1 - Sorry—who are you 脸盲症【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/153. P1 - Carnivorous plants 食虫植物/153. P1 - Carnivorous plants 食虫植物.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/154. P2 - The purpose of facial expressions 面部表情/154. P2 - The purpose of facial expressions 面部表情.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/155. P1 - A Brief History of Humans and Food 人类食物的历史【次】/155. P1 - A Brief History of Humans and Food 人类食物的历史【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/156. P2 - New filter promises clean water for millions 新型泥土净水器/156. P2 - New filter promises clean water for millions 新型泥土净水器.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/157. P2 - Boring Buildings 无聊建筑/157. P2 - Boring Buildings 无聊建筑.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/158. P3 - Mercator - The Map Maker 地理制图师【次】/158. P3 - Mercator - The Map Maker 地理制图师【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/159. P1 - Scented Plants 植物的味道/159. P1 - Scented Plants 植物的味道.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/16. P1 - The Clipper Races 帆船竞速/16. P1 - The Clipper Races 帆船竞速.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/160. P1 - An important language development 楔形文字/160. P1 - An important language development 楔形文字.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/161. P1 - Fluorescence Deep sea discovery深海发光生物研究/161. P1 - Fluorescence Deep sea discovery深海发光生物研究.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/162. P3 - Sea Change for Salinity 土地盐碱化/162. P3 - Sea Change for Salinity 土地盐碱化.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/163. P1 - How to find your way out of a food desert 城市食物荒漠/163. P1 - How to find your way out of a food desert 城市食物荒漠.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/164. P2 - The Power of Smell 嗅觉的力量/164. P2 - The Power of Smell 嗅觉的力量.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/165. P3 - The Placebo Effect5 安慰剂效应/165. P3 - The Placebo Effect5 安慰剂效应.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/166. P2 - Lean Production Innovation 精益生产/166. P2 - Lean Production Innovation 精益生产.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/167. P3 - Sign, Baby, Sign! 美国手语/167. P3 - Sign, Baby, Sign! 美国手语.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/168. P2 - Mammoth Kill 猛犸象的灭绝/168. P2 - Mammoth Kill 猛犸象的灭绝.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/169. P3 - The Costs of Brand Loyalty 品牌忠诚的代价/169. P3 - The Costs of Brand Loyalty 品牌忠诚的代价.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/17. P1 - The Development of The Silk Industry 丝绸产业发展【高】/17. P1 - The Development of The Silk Industry 丝绸产业发展【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/170. P1 - The unsung sense 被低估的嗅觉/170. P1 - The unsung sense 被低估的嗅觉.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/171. P1 - Salt  盐的历史/171. P1 - Salt  盐的历史.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/172. P1 - Think Small 微观科学/172. P1 - Think Small 微观科学.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/173. 1018纸笔 P3 - Looking for inspiration 寻找灵感/173. 1018纸笔 P3 - Looking for inspiration 寻找灵感.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/174. P1 - Why good ideas fail TF公司/174. P1 - Why good ideas fail TF公司.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/175. P3 - Music soothes and awes 音乐疗愈/175. P3 - Music soothes and awes 音乐疗愈.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/176. P2 - Urban Regeneration 柏林公园改造/176. P2 - Urban Regeneration 柏林公园改造.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/177. 1025纸笔P2 - Speaking of Nothing [Pretest] 闲聊的意义/177. 1025纸笔P2 - Speaking of Nothing [Pretest] 闲聊的意义.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/178. 1025纸笔P3 - Translating a key to international understanding 翻译的艺术/178. 1025纸笔P3 - Translating a key to international understanding 翻译的艺术.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/179. P3 - Looking at daily life in ancient Rome  古罗马的日常/179. P3 - Looking at daily life in ancient Rome  古罗马的日常.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/18. P1 - The History of Tea 茶叶的历史【高】/18. P1 - The History of Tea 茶叶的历史【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/180. P2 - Australia’s camouflaged creatures 澳洲伪装生物/180. P2 - Australia’s camouflaged creatures 澳洲伪装生物.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/19. P1 - The Impact of the Potato 土豆的影响【高】/19. P1 - The Impact of the Potato 土豆的影响【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/2. P1 - A survivor’s story 新西兰猫头鹰【高】/2. P1 - A survivor’s story 新西兰猫头鹰【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/20. P1 - The Importance of Business Cards 名片的重要性/20. P1 - The Importance of Business Cards 名片的重要性.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/21. P1 - The life of Beatrix Potter 彼得兔作家/21. P1 - The life of Beatrix Potter 彼得兔作家.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/22. P1 - The nature of Yawning 打哈欠的本质/22. P1 - The nature of Yawning 打哈欠的本质.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/23. P1 - The Origin of Paper 造纸术起源/23. P1 - The Origin of Paper 造纸术起源.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/24. P1 - The Pearls 珍珠【高】/24. P1 - The Pearls 珍珠【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/25. P1 - The Rise and Fall of Detective Stories 侦探小说的兴衰/25. P1 - The Rise and Fall of Detective Stories 侦探小说的兴衰.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/26. P1 - The Tuatara of New Zealand 新西兰蜥蜴/26. P1 - The Tuatara of New Zealand 新西兰蜥蜴.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/27. P1 - Thomas Young The last man who knew everything 托马斯·杨/27. P1 - Thomas Young The last man who knew everything 托马斯·杨.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/28. P1 - Triumph of the City 城市的胜利/28. P1 - Triumph of the City 城市的胜利.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/29. P1 - Tunnelling under the Thames 泰晤士河隧道【次】/29. P1 - Tunnelling under the Thames 泰晤士河隧道【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/3. P1 - Advertising Needs Attention 广告的吸引力/3. P1 - Advertising Needs Attention 广告的吸引力.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/30. P1 - What Lucy Taught Us 露西化石【次】/30. P1 - What Lucy Taught Us 露西化石【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/31. P1 - William Gilbert and Magnetism 电磁学之父【高】/31. P1 - William Gilbert and Magnetism 电磁学之父【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/32. P1 - Wood 新西兰木材产业【次】/32. P1 - Wood 新西兰木材产业【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/33. P2 - A new look for Talbot Park 奥克兰社区改造【高】/ai_studio_code (9).html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/34. P2 - A unique golden textile 蜘蛛丝【次】/34. P2 - A unique golden textile 蜘蛛丝【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/35. P2 - Biophilic Design 亲自然设计/35. P2 - Biophilic Design 亲自然设计.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/36. P2 - Bird Migration 鸟类迁徙【高】/36. P2 - Bird Migration 鸟类迁徙【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/37. P2 - Corporate Social Responsibility  企业社会责任【高】/37. P2 - Corporate Social Responsibility  企业社会责任【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/38. P2 - Egypt’s ancient boat-builders 古埃及造船/38. P2 - Egypt’s ancient boat-builders 古埃及造船.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/39. P2 - How are deserts formed 沙漠成因【次】/39. P2 - How are deserts formed 沙漠成因【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/4. P1 - Ambergris 龙涎香/4. P1 - Ambergris 龙涎香.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/40. P2 - How Well Do We Concentrate_  多任务处理【高】/40. P2 - How Well Do We Concentrate_  多任务处理【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/41. P2 - Intelligent behaviour in birds 鸟类智慧行为【次】/41. P2 - Intelligent behaviour in birds 鸟类智慧行为【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/42. P2 - Investment in shares versus investment in other assets 回报数据分析【高】/42. P2 - Investment in shares versus investment in other assets 回报数据分析【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/43. P2 - Learning from the Romans 罗马混凝土【高】/43. P2 - Learning from the Romans 罗马混凝土【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/44. P2 - Orientation of Birds 鸟类的定位能力/44. P2 - Orientation of Birds 鸟类的定位能力.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/45. P2 - Playing soccer 街头足球【高】/45. P2 - Playing soccer 街头足球【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/46. P2 - Roller coaster 过山车【高】/46. P2 - Roller coaster 过山车【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/47. P2 - Skyscraper Farming 摩天大楼种植/47. P2 - Skyscraper Farming 摩天大楼种植.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/48. P2 - Solving the problem of waste disposal 垃圾处理【高】/48. P2 - Solving the problem of waste disposal 垃圾处理【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/49. P2 - Surviving city life 动物适应城市【高】/49. P2 - Surviving city life 动物适应城市【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/5. P1 - Australian artist Margaret Preston 澳大利亚艺术家/5. P1 - Australian artist Margaret Preston 澳大利亚艺术家.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/50. P2 - The conquest of malaria in Italy 意大利疟疾防治【高】/50. P2 - The conquest of malaria in Italy 意大利疟疾防治【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/51. P2 - The dingo debate 澳洲野犬/51. P2 - The dingo debate 澳洲野犬.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/52. P2 - The fascinating world of attine ants 切叶蚁【高】/52. P2 - The fascinating world of attine ants 切叶蚁【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/53. P2 - The fashion industry 时尚产业/53. P2 - The fashion industry 时尚产业.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/54. P2 - The impact of invasive species 入侵物种的影响/54. P2 - The impact of invasive species 入侵物种的影响.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/55. P2 - The plan to bring an asteroid to Earth 捕获小行星【次】/55. P2 - The plan to bring an asteroid to Earth 捕获小行星【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/56. P2 - The return of monkey life 猴群回归【高】/56. P2 - The return of monkey life 猴群回归【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/57. P2 - The Tasmanian Tiger 袋狼【次】/57. P2 - The Tasmanian Tiger 袋狼【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/58. P2 - Who wrote Shakespeare's plays 莎士比亚/58. P2 - Who wrote Shakespeare's plays 莎士比亚.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/59. P2 - Why do we need the arts_ 艺术的意义/59. P2 - Why do we need the arts_ 艺术的意义.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/6. P1 - Categorizing societies 社会分类/6. P1 - Categorizing societies 社会分类html.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/60. P3 - A closer examination of a study on verbal and non-verbal messages 语言表达研究【高】/60. P3 - A closer examination of a study on verbal and non-verbal messages 语言表达研究【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/61. P3 - Book Review The Discovery of Slowness 富兰克林(慢的发现)/61. P3 - Book Review The Discovery of Slowness 富兰克林(慢的发现).html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/62. P3 - Charles Darwin and Evolutionary Psychology 进化心理学【次】/62. P3 - Charles Darwin and Evolutionary Psychology 进化心理学【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/63. P3 - Crossing the Threshold 奥克兰美术馆/63. P3 - Crossing the Threshold 奥克兰美术馆.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/64. P3 - Decisions, Decisions 决策之间【次】/64. P3 - Decisions, Decisions 决策之间【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/65. P3 - Does class size matter_ 课堂规模【次】/65. P3 - Does class size matter_ 课堂规模【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/66. P3 - Elephant Communication 大象交流【高】/66. P3 - Elephant Communication 大象交流【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/67. P3 - Flower Power 鲜花的力量(花之力)【高】/67. P3 - Flower Power 鲜花的力量(花之力)【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/68. P3 - Game theory 博弈论/68. P3 - Game theory 博弈论.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/69. P3 - Grimm’s Fairy Tales 格林童话【高】/69. P3 - Grimm’s Fairy Tales 格林童话【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/7. P1 - Chili peppers 辣椒的历史/7. P1 - Chili peppers 辣椒的历史.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/70. P3 - Insect-inspired robots 昆虫机器人【高】/70. P3 - Insect-inspired robots 昆虫机器人【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/71. P3 - Jean Piaget (1896–1980) 让·皮亚杰【次】/71. P3 - Jean Piaget (1896–1980) 让·皮亚杰【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/72. P3 - Keeping the Fun in Funfairs 游乐场设计科学/72. P3 - Keeping the Fun in Funfairs 游乐场设计科学.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/73. P3 - Language Strategy in Multinational Companies 跨国公司语言策略【高】/73. P3 - Language Strategy in Multinational Companies 跨国公司语言策略【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/74. P3 - Let’s teach them how to teach 教他们如何教学/74. P3 - Let’s teach them how to teach 教他们如何教学.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/75. P3 - Life on Mars_ 火星地球化改造/75. P3 - Life on Mars_ 火星地球化改造.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/76. P3 - Living dunes 流动沙丘【高】/76. P3 - Living dunes 流动沙丘【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/77. P3 - Marketing and the information age 信息时代营销【次】/77. P3 - Marketing and the information age 信息时代营销【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/79. P3 - Pacific Navigation and Voyaging 太平洋航海【高】/79. P3 - Pacific Navigation and Voyaging 太平洋航海【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/8. P1 - Fishbourne Roman Palace 罗马宫殿【高】/8. P1 - Fishbourne Roman Palace 罗马宫殿【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/80. P3 - Rebranding art museums 博物馆品牌重塑/80. P3 - Rebranding art museums 博物馆品牌重塑.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/81. P3 - Robert Louis Stevenson 苏格兰作家【高】/81. P3 - Robert Louis Stevenson 苏格兰作家【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/82. P3 - Some views on the use of headphones 耳机使用【高】/82. P3 - Some views on the use of headphones 耳机使用【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/83. P3 - Termite Mounds 白蚁丘/83. P3 - Termite Mounds 白蚁丘.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/84. P3 - The Analysis of Fear 猴子恐惧实验【次】/84. P3 - The Analysis of Fear 猴子恐惧实验【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/85. P3 - The Art of Deception 欺骗的艺术【次】/85. P3 - The Art of Deception 欺骗的艺术【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/86. P3 - The benefits of learning an instrument 学乐器的好处【高】/86. P3 - The benefits of learning an instrument 学乐器的好处【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/87. P3 - The Exploration of Mars 火星探索【次】/87. P3 - The Exploration of Mars 火星探索【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/88. P3 - The fluoridation controversy 氟化水争议【高】/88. P3 - The fluoridation controversy 氟化水争议【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/89. P3 - The Fruit Book 果实之书【高】/89. P3 - The Fruit Book 果实之书【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/9. P1 - Listening to the Ocean 海洋探测【次】/9. P1 - Listening to the Ocean 海洋探测【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/90. P3 - The hazards of multitasking 多任务处理【次】/90. P3 - The hazards of multitasking 多任务处理【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/91. P3 - The New Zealand writer Margaret Mahy 新西兰女作家【高】/91. P3 - The New Zealand writer Margaret Mahy 新西兰女作家【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/92. P3 - The Pirahã people of Brazil  巴西皮拉罕部落语言【次】/92. P3 - The Pirahã people of Brazil  巴西皮拉罕部落语言【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/93. P3 - The Robbers Cave Study (山洞)群体行为实验/93. P3 - The Robbers Cave Study (山洞)群体行为实验.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/94. P3 - The science of sleep 睡眠的科学/94. P3 - The science of sleep 睡眠的科学.pdf.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/95. P3 - The Significant Role of Mother Tongue in Education 母语教育【次】/95. P3 - The Significant Role of Mother Tongue in Education 母语教育【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/96. P3 - The tuatara – past and future 新西兰蜥蜴【高】/96. P3 - The tuatara – past and future 新西兰蜥蜴【高】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/97. P3 - The value of literary prizes 文学奖项的价值/97. P3 - The value of literary prizes 文学奖项的价值.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/98. P3 - Video Games’ Unexpected Benefits to the Human Brain 电子游戏的好处【次】/98. P3 - Video Games’ Unexpected Benefits to the Human Brain 电子游戏的好处【次】.html
./睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/99. P3 - Voynich Manuscript 伏尼契手稿【高】/99. P3 - Voynich Manuscript 伏尼契手稿【高】.html
TOTAL 337 files without answer hints
```

## 本轮工作总结
1. 统一实践页 UI/增强器，实现拖拽题采集、听力 transcript 控制、Storage 命名空间对齐。
2. 扩展答案提取策略，保障存在答案元数据的页面能展示正确答案，避免重复与顺序错误。
3. 通过脚本扫描，得到“缺少答案元数据”页面清单，为后续补数提供依据。

## 后续工作
1. **补齐答案数据**：对照清单优先补充 ListeningPractice 与 P1 高频阅读题的 `data-answer`/`correctAnswers`，或构建集中答案库供 enhancer 读取。
2. **脚本正式化**：把扫描脚本收录到 `scripts/list-missing-answer-metadata.py` 并纳入 CI，避免新的页面缺答案而不自知。
3. **元数据治理**：为题目定义统一的 `examId` → `answers` 映射（JSON/JS），practice 页面仅需引用统一入口即可。
