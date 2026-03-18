(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p3-medium-183", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p3-medium-183",
  "meta": {
    "examId": "p3-medium-183",
    "title": "The hazards of multitasking 多任务处理",
    "category": "P3",
    "sourceDoc": "P3 解析+1202高频_副本.md",
    "noteType": "总结",
    "matchedTitle": "The hazards of multitasking 多任务处理"
  },
  "passageNotes": [
    {
      "label": "Paragraph 1",
      "text": "描述典型多任务场景 —— 办公室职员同时处理回电话、整理邮件、制作演示文稿、回应经理需求、接待客户等任务，凸显日常工作中的多任务常态。"
    },
    {
      "label": "Paragraph 2",
      "text": "多数人认为 “掌握多任务是成功关键”，但纽约家庭与工作研究所研究显示，45% 美国员工认为 “被要求同时处理过多任务”。管理者可能惊讶于 “多任务实际浪费时间”—— 人类大脑无法像计算机一样 “后台处理数据并切换窗口”，越来越多研究表明 “同时处理任务而非依次完成” 会耗时更长、降低任务表现，还可能导致短期记忆困难，最终造成低效、思维草率和错误，对驾驶员、空中交通管制员等需集中注意力的职业更具危险。"
    },
    {
      "label": "Paragraph 3",
      "text": "为何 “多任务提升效率” 这一常识性时间管理策略实际错误？需结合 “大脑注意力聚焦” 的意识研究 ——1935 年美国心理学家约翰・里德利・斯特鲁普（John Ridley Stroop）发现 “一项任务的信息处理会干扰另一项任务”，即 “斯特鲁普效应”：当要求受试者说出 “绿色” 等颜色词的印刷颜色（如红色印刷的 “绿色”）时，他们会遇到困难，原因是 “大脑需抑制已自动化的阅读任务，专注于需集中注意力的颜色命名任务”。"
    },
    {
      "label": "Paragraph 4",
      "text": "近几十年，心理学家深入研究多任务的本质与局限 —— 慕尼黑路德维希 - 马克西米利安大学的恩斯特・珀佩尔（Ernst Pöppel）认为 “大脑无法同时高度专注于两项或三项任务”，看似同时的信息感知与处理实际在 “三秒窗口” 内进行。"
    },
    {
      "label": "Paragraph 5",
      "text": "在每个三秒片段中，大脑将感官系统接收的环境数据作为一个整体处理，后续事件在下一个窗口处理 —— 例如，人可三秒专注对话、三秒关注哭泣的孩子、三秒看电脑屏幕，每次仅一项任务处于意识前台，其他任务在后台等待调用。"
    },
    {
      "label": "Paragraph 6",
      "text": "密歇根大学的戴维・E・迈耶（David E. Meyer）通过实验量化 “任务切换的时间损耗”—— 受试者同时写报告和查邮件，频繁切换者耗时是依次完成者的 1.5 倍，每次切换需 “重新思考”，消耗额外神经资源（大脑需时间关闭一项任务规则、启动另一项）。迈耶指出 “仅轻松常规任务的多任务能节省时间”，且 “快速返回中断任务比延迟返回更难适应”。"
    },
    {
      "label": "Paragraph 7",
      "text": "多任务本质上具有压力，且大脑中参与多任务的区域（前额叶皮层，位于额头后方，被称为 “大脑执行区”）受压力影响最大 —— 该区域帮助评估任务、排序、分配心理资源，标记任务中断点以便后续恢复。压力还影响 “海马体”（形成新记忆的关键区域），该区域受损会导致新技能学习困难。"
    },
    {
      "label": "Paragraph 8",
      "text": "哈佛大学精神病学家爱德华・哈洛威尔（Edward Hallowell）和约翰・拉蒂（John Ratey）提出 “多任务可能导致大脑状况异常”—— 患者持续寻求新信息但难以专注内容。综上，“先完成演示文稿再处理邮件” 更明智，既能节省时间，又能提升任务表现。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 人物 - 理论匹配（Questions 27–31：A=Stroop / B=Pöppel / C=Meyer / D=Hallowell & Ratey）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 27,
          "text": "（1）题目 27：Less attention will be paid to each task when more than one task is attempted at the same time.（同时尝试多项任务时，每项任务获得的注意力会减少）\n答案：B（Ernst Pöppel，恩斯特・珀佩尔）\n解析：定位 Paragraph 4 中 “Ernst Pöppel... believes that it is impossible to carry out two or three different tasks simultaneously with the same degree of concentration”，“无法同时高度专注多项任务” 对应 “每项任务注意力减少”，因此选 B。",
          "questionId": "q27"
        },
        {
          "questionNumber": 28,
          "text": "（2）题目 28：Repeated changes of task mean that the brain will take a while to adjust.（频繁切换任务意味着大脑需时间适应）\n答案：C（David E. Meyer，戴维・E・迈耶）\n解析：定位 Paragraph 6 中 “David E. Meyer... Each switchover from one task to another meant re-thinking and thus involved additional neural resources... it takes the brain longer to adapt when switching rapidly back to an interrupted task”，“切换需重新思考、适应时间长” 对应 “需时间调整”，因此选 C。",
          "questionId": "q28"
        },
        {
          "questionNumber": 29,
          "text": "（3）题目 29：Using the skills required for one task may make performing another one more difficult.（使用一项任务所需的技能可能使另一项任务更难完成）\n答案：A（John Ridley Stroop，约翰・里德利・斯特鲁普）\n解析：定位 Paragraph 3 中 “John Ridley Stroop reported that processing information from one task could cause interference with another... when study participants were asked to name the colour of a word... printed in a different colour – they experienced difficulty”，“一项任务（阅读）干扰另一项任务（颜色命名）” 对应 “技能使用导致另一任务困难”，因此选 A。",
          "questionId": "q29"
        },
        {
          "questionNumber": 30,
          "text": "（4）题目 30：When multitasking, the brain can only focus on single tasks for very short periods.（多任务时，大脑仅能短时间专注单项任务）\n答案：B（Ernst Pöppel，恩斯特・珀佩尔）\n解析：定位 Paragraph 5 中 “Ernst Pöppel... processing... actually take place in ‘three-second windows’... a person can concentrate on a conversation for three seconds, then for three seconds on a crying child, and three seconds on a computer screen”，“三秒窗口内专注单项任务” 对应 “短时间专注”，因此选 B。",
          "questionId": "q30"
        },
        {
          "questionNumber": 31,
          "text": "（5）题目 31：Multitasking can lead to a medical problem.（多任务可能导致健康问题）\n答案：D（Edward Hallowell & John Ratey，爱德华・哈洛威尔与约翰・拉蒂）\n解析：定位 Paragraph 8 中 “Edward Hallowell and John Ratey... say that multitasking can bring about a brain condition that causes sufferers to constantly seek new information while having difficulties concentrating on its content”，“导致大脑状况异常” 对应 “medical problem”，因此选 D。",
          "questionId": "q31"
        }
      ],
      "questionRange": {
        "start": 27,
        "end": 31
      },
      "text": "答案：B（Ernst Pöppel，恩斯特・珀佩尔）\n解析：定位 Paragraph 4 中 “Ernst Pöppel... believes that it is impossible to carry out two or three different tasks simultaneously with the same degree of concentration”，“无法同时高度专注多项任务” 对应 “每项任务注意力减少”，因此选 B。\n答案：C（David E. Meyer，戴维・E・迈耶）\n解析：定位 Paragraph 6 中 “David E. Meyer... Each switchover from one task to another meant re-thinking and thus involved additional neural resources... it takes the brain longer to adapt when switching rapidly back to an interrupted task”，“切换需重新思考、适应时间长” 对应 “需时间调整”，因此选 C。\n答案：A（John Ridley Stroop，约翰・里德利・斯特鲁普）\n解析：定位 Paragraph 3 中 “John Ridley Stroop reported that processing information from one task could cause interference with another... when study participants were asked to name the colour of a word... printed in a different colour – they experienced difficulty”，“一项任务（阅读）干扰另一项任务（颜色命名）” 对应 “技能使用导致另一任务困难”，因此选 A。\n答案：B（Ernst Pöppel，恩斯特・珀佩尔）\n解析：定位 Paragraph 5 中 “Ernst Pöppel... processing... actually take place in ‘three-second windows’... a person can concentrate on a conversation for three seconds, then for three seconds on a crying child, and three seconds on a computer screen”，“三秒窗口内专注单项任务” 对应 “短时间专注”，因此选 B。\n答案：D（Edward Hallowell & John Ratey，爱德华・哈洛威尔与约翰・拉蒂）\n解析：定位 Paragraph 8 中 “Edward Hallowell and John Ratey... say that multitasking can bring about a brain condition that causes sufferers to constantly seek new information while having difficulties concentrating on its content”，“导致大脑状况异常” 对应 “medical problem”，因此选 D。"
    },
    {
      "sectionTitle": "2. 单选题（Questions 32–34：Choose A–D）",
      "mode": "per_question",
      "items": [
        {
          "questionNumber": 32,
          "text": "（1）题目 32：What is suggested about the worker in the opening paragraph?（开篇段落暗示该员工如何？）\n答案：B（He feels overwhelmed by his workload. 他因工作负荷感到不堪重负）\n解析：定位 Paragraph 1 中 “You arrive at the office, review your to-do list and start to feel a headache coming on. You resolve to tackle the items as quickly as possible”，“看到待办清单头痛” 暗示 “工作负荷压垮人”，因此选 B。A（焦虑导致前一晚失眠）、C（经理表达不满）、D（认为工作枯燥）均未提及。",
          "questionId": "q32"
        },
        {
          "questionNumber": 33,
          "text": "（2）题目 33：Drivers and air-traffic controllers are mentioned in the passage because they（文中提及驾驶员和空中交通管制员的原因是？）\n答案：D（cannot afford to make mistakes. 不能犯错）\n解析：定位 Paragraph 2 中 “the possible dangers of divided attention for drivers, air-traffic controllers and others who handle machinery”，“注意力分散的危险” 暗示 “他们犯错代价高，不能犯错”，因此选 D。A（需同时完成多项任务）、B（无法保持专注）、C（高效利用时间）均未提及。",
          "questionId": "q33"
        },
        {
          "questionNumber": 34,
          "text": "（3）题目 34：In John Ridley Stroop’s experiment, participants found it difficult to（在约翰・里德利・斯特鲁普的实验中，受试者发现什么困难？）\n答案：C（read out the name of one colour printed in another colour. 读出用另一种颜色印刷的颜色词的名称）\n解析：定位 Paragraph 3 中 “when study participants were asked to name the colour of a word – such as ‘green’ – printed in a different colour – red, for example – they experienced difficulty saying the name of the colour”，“说出颜色词的印刷颜色困难” 对应选项 C，因此选 C。",
          "questionId": "q34"
        }
      ],
      "questionRange": {
        "start": 32,
        "end": 34
      },
      "text": "答案：B（He feels overwhelmed by his workload. 他因工作负荷感到不堪重负）\n解析：定位 Paragraph 1 中 “You arrive at the office, review your to-do list and start to feel a headache coming on. You resolve to tackle the items as quickly as possible”，“看到待办清单头痛” 暗示 “工作负荷压垮人”，因此选 B。A（焦虑导致前一晚失眠）、C（经理表达不满）、D（认为工作枯燥）均未提及。\n答案：D（cannot afford to make mistakes. 不能犯错）\n解析：定位 Paragraph 2 中 “the possible dangers of divided attention for drivers, air-traffic controllers and others who handle machinery”，“注意力分散的危险” 暗示 “他们犯错代价高，不能犯错”，因此选 D。A（需同时完成多项任务）、B（无法保持专注）、C（高效利用时间）均未提及。\n答案：C（read out the name of one colour printed in another colour. 读出用另一种颜色印刷的颜色词的名称）\n解析：定位 Paragraph 3 中 “when study participants were asked to name the colour of a word – such as ‘green’ – printed in a different colour – red, for example – they experienced difficulty saying the name of the colour”，“说出颜色词的印刷颜色困难” 对应选项 C，因此选 C。"
    },
    {
      "sectionTitle": "3. 摘要填空（Questions 35–39：NO MORE THAN TWO WORDS）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 35,
          "text": "（1）题目 35：The area most affected is the prefrontal cortex, which is found to the rear of the \\___\\___（受影响最大的区域是前额叶皮层，位于_\\___\\__后方）\n答案：forehead（额头）\n解析：定位 Paragraph 7 中 “Located behind the forehead, the prefrontal cortex – which neuroscientists call the ‘executive’ part of the brain”，“位于额头后方”，因此答案为 “forehead”。",
          "questionId": "q35"
        },
        {
          "questionNumber": 36,
          "text": "（2）题目 36：the part of the brain which judges tasks, then puts them in order of importance and allocates \\___\\___（大脑中评估任务、排序并分配_\\___\\__的部分）\n答案：mental resources（心理资源）\n解析：定位 Paragraph 7 中 “assess tasks, prioritise them and assign mental resources”，“分配心理资源”，因此答案为 “mental resources”。",
          "questionId": "q36"
        },
        {
          "questionNumber": 37,
          "text": "（3）题目 37：If any \\___\\___ in the hippocampus are affected, people may have problems with storing \\___\\___（若海马体中的任何_\\___\\__受影响，人们可能在储存_\\___\\__方面有困难）\n答案：cells（细胞）；new memories（新记忆）\n解析：定位 Paragraph 7 中 “this stress can also affect brain cells in another region, the hippocampus, which is important for forming new memories”，“海马体细胞受影响，影响新记忆形成”，因此依次填 “cells”“new memories”。",
          "questionId": "q37"
        },
        {
          "questionNumber": 38,
          "text": "（4）题目 38：as well as learning \\___\\___（以及学习_\\___\\__方面有困难）\n答案：new skills（新技能）\n解析：定位 Paragraph 7 中 “damage in that area also makes it difficult for a person to acquire new skills”，“学习新技能困难”，因此答案为 “new skills”。",
          "questionId": "q38"
        }
      ],
      "questionRange": {
        "start": 35,
        "end": 39
      },
      "text": "答案：forehead（额头）\n解析：定位 Paragraph 7 中 “Located behind the forehead, the prefrontal cortex – which neuroscientists call the ‘executive’ part of the brain”，“位于额头后方”，因此答案为 “forehead”。\n答案：mental resources（心理资源）\n解析：定位 Paragraph 7 中 “assess tasks, prioritise them and assign mental resources”，“分配心理资源”，因此答案为 “mental resources”。\n答案：cells（细胞）；new memories（新记忆）\n解析：定位 Paragraph 7 中 “this stress can also affect brain cells in another region, the hippocampus, which is important for forming new memories”，“海马体细胞受影响，影响新记忆形成”，因此依次填 “cells”“new memories”。\n答案：new skills（新技能）\n解析：定位 Paragraph 7 中 “damage in that area also makes it difficult for a person to acquire new skills”，“学习新技能困难”，因此答案为 “new skills”。"
    },
    {
      "sectionTitle": "4. 主旨题（Question 40：Choose A–D）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 40,
          "text": "题目 40：The main aim of this passage is to（本文主要目的是？）\n答案：B（challenge widely held opinions on multitasking. 挑战关于多任务的普遍观点）\n解析：全文先描述 “多任务是成功关键” 的普遍认知，再通过多项研究（斯特鲁普、珀佩尔、迈耶等）证明 “多任务低效且有害”，核心是 “挑战普遍观点”，因此选 B。A（描述多任务有用的领域）、C（展示多任务造成的身体损伤）、D（呼吁开展更多多任务心理学实验）均偏离主旨。",
          "questionId": "q40"
        }
      ],
      "questionRange": {
        "start": 40,
        "end": 40
      },
      "text": "答案：B（challenge widely held opinions on multitasking. 挑战关于多任务的普遍观点）\n解析：全文先描述 “多任务是成功关键” 的普遍认知，再通过多项研究（斯特鲁普、珀佩尔、迈耶等）证明 “多任务低效且有害”，核心是 “挑战普遍观点”，因此选 B。A（描述多任务有用的领域）、C（展示多任务造成的身体损伤）、D（呼吁开展更多多任务心理学实验）均偏离主旨。"
    }
  ]
}
  );
})(typeof window !== "undefined" ? window : globalThis);
