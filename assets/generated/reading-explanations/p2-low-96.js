(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p2-low-96", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p2-low-96",
  "meta": {
    "examId": "p2-low-96",
    "title": "Why Do We Need Sleep 睡眠的目的",
    "category": "P2",
    "sourceDoc": "185. [Pretest] P2 - Why Do We Need Sleep 睡眠的目的.pdf",
    "noteType": "翻译+解析",
    "matchedTitle": "Why Do We Need Sleep"
  },
  "passageNotes": [
    {
      "label": "Paragraph A",
      "text": "美国疾控中心数据显示，超过 8000 万美国成年人长期睡眠不足（每晚少于建议的 7 小时）。由此导致的疲劳每年关联超过 100 万起车祸和大量医疗失误。即便只是睡眠时长的小幅减少也会造成显著风险，例如夏令时调表后首个周一，心梗和致命交通事故都会明显上升。"
    },
    {
      "label": "Paragraph B",
      "text": "约三分之一美国人一生中会经历至少一种睡眠障碍，包括睡眠呼吸暂停、不宁腿综合征等；也有罕见症状如 exploding head syndrome（入睡时感觉巨响）与 Kleine-Levin syndrome（周期性长时间睡眠）。其中最常见的是失眠（insomnia），也是很多成年人服用安眠药的主要原因。"
    },
    {
      "label": "Paragraph C",
      "text": "从进化角度看，睡眠机制本身具有可中断性，便于在紧急情况下快速清醒。大脑有自动“优先级覆盖”系统，感知到婴儿啼哭等 emergency 时可在任何睡眠阶段唤醒人体。问题在于现代社会中，这套系统经常被并不危及生命的刺激触发（考试焦虑、汽车警报等），而工业革命后固定作息又降低了补觉空间。"
    },
    {
      "label": "Paragraph D",
      "text": "睡眠不足最先受损的是前额叶皮层（决策与问题解决中心），并会广泛影响认知、情绪和判断。文中给出极端例子：被剥夺睡眠的嫌疑人可能为换取休息而承认任何事情。长期每晚少于 6 小时还与抑郁、其他身心疾病及肥胖风险上升相关。机制之一是 ghrelin（饥饿激素）过量分泌导致摄食增加。"
    },
    {
      "label": "Paragraph E",
      "text": "NREM 是夜间循环睡眠中的第一大阶段。该阶段大脑并非静止，而是在“编辑”记忆：保留什么、丢弃什么。NREM 分四期，各阶段 EEG 图谱不同：浅睡阶段出现规律模式；第二阶段可见半秒节律电活动，可能有助于信息存储；第三和第四阶段是深睡状态，脑电慢波比例持续增加，并伴随大量生长激素分泌，对骨骼肌肉修复和脑功能维持都关键。"
    },
    {
      "label": "Paragraph F",
      "text": "REM 曾被误认为只是 NREM 的变体，后来因快速眼动特征和“梦主要发生于此”而被确认是独立主要阶段。当前观点认为 REM 中约两小时梦境内容与新记忆处理高度相关。部分理论家还认为 REM 是创造力、洞察力和人类独特心智体验的重要来源。"
    },
    {
      "label": "Paragraph G",
      "text": "作者最后强调，睡眠缺失并不存在简单补救方案，无论小睡还是药物都难替代完整睡眠。多位专家反对“通过设备或药物强行操控睡眠结构”的捷径，也反对“人可以基本不睡”的观点，甚至提出睡眠对人的必要性可能高于食物。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 段落信息匹配（Questions 17–23）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 17,
          "text": "题目：an example of how sleeplessness can influence a person accused of a crime\n题目翻译：一个关于睡眠不足如何影响被指控犯罪者的例子。\n答案：D\n解析：D 段写到睡眠剥夺的嫌疑人可能“为了换取休息而承认任何事”，直接对应该描述。",
          "questionId": "q1"
        },
        {
          "questionNumber": 18,
          "text": "题目：a description of recordings of different types of brain activity during sleep\n题目翻译：对睡眠中不同脑活动记录的描述。\n答案：E\n解析：E 段详细介绍 NREM 各阶段 EEG 记录特征，正是对脑活动类型及记录结果的描述。",
          "questionId": "q2"
        },
        {
          "questionNumber": 19,
          "text": "题目：a description of how present-day society interrupts sleep\n题目翻译：对现代社会如何打断睡眠的描述。\n答案：C\n解析：C 段指出现代生活中的非致命刺激频繁触发警觉系统，并受固定作息限制，导致睡眠被打断。",
          "questionId": "q3"
        },
        {
          "questionNumber": 20,
          "text": "题目：information about the relationship between being overweight and sleep\n题目翻译：关于超重与睡眠关系的信息。\n答案：D\n解析：D 段明确提到睡眠不足与肥胖相关，并解释 ghrelin 增加导致吃得更多。",
          "questionId": "q4"
        },
        {
          "questionNumber": 21,
          "text": "题目：a suggestion that medication is an ineffective solution for sleeping problems\n题目翻译：认为药物并非解决睡眠问题有效方案的观点。\n答案：G\n解析：G 段多位专家反对依赖药物或设备作为捷径，强调我们尚不足够理解睡眠机制，不宜人工操控。",
          "questionId": "q5"
        },
        {
          "questionNumber": 22,
          "text": "题目：a discovery that changed ideas about how sleep is understood\n题目翻译：一项改变人们对睡眠理解方式的发现。\n答案：F\n解析：F 段说明 REM 从“非重要变体”被重新认识为主要睡眠阶段，这是典型范式转变。",
          "questionId": "q6"
        },
        {
          "questionNumber": 23,
          "text": "题目：examples of the life-threatening consequences of inadequate sleep\n题目翻译：睡眠不足导致危及生命后果的例子。\n答案：A\n解析：A 段列出致命交通事故上升、心梗增加等严重后果，最符合该题要求。",
          "questionId": "q7"
        }
      ],
      "questionRange": {
        "start": 17,
        "end": 23
      },
      "text": "题目 17-23 答案依次为 D、E、C、D、G、F、A。"
    },
    {
      "sectionTitle": "2. 多选题（Questions 24–25）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 24,
          "text": "题目：Which TWO statements describe characteristics of NREM sleep?（第一项）\n题目翻译：以下哪两项描述了 NREM 睡眠特征？（第一项）\n答案：A\n解析：E 段明确指出深层 NREM 对大脑至关重要（as essential to our brain as food is to our body），对应 A。",
          "questionId": "q8"
        },
        {
          "questionNumber": 25,
          "text": "题目：Which TWO statements describe characteristics of NREM sleep?（第二项）\n题目翻译：以下哪两项描述了 NREM 睡眠特征？（第二项）\n答案：D\n解析：E 段逐阶段描述 EEG 图样差异，说明不同阶段具有可区分的电生理模式，对应 D。",
          "questionId": "q9"
        }
      ],
      "questionRange": {
        "start": 24,
        "end": 25
      },
      "text": "题目 24-25 的两项正确选项为 A、D。"
    },
    {
      "sectionTitle": "3. 多选题（Questions 26–27）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 26,
          "text": "题目：Which TWO statements describe the characteristics of REM sleep?（第一项）\n题目翻译：以下哪两项描述了 REM 睡眠特征？（第一项）\n答案：B\n解析：F 段写到 scientists documented distinctive eye movements in REM，正对应 B。",
          "questionId": "q10"
        },
        {
          "questionNumber": 27,
          "text": "题目：Which TWO statements describe the characteristics of REM sleep?（第二项）\n题目翻译：以下哪两项描述了 REM 睡眠特征？（第二项）\n答案：E\n解析：F 段指出有理论认为 REM 与创造力、洞察力有关，符合 E 对“创新源泉”的表述。",
          "questionId": "q11"
        }
      ],
      "questionRange": {
        "start": 26,
        "end": 27
      },
      "text": "题目 26-27 的两项正确选项为 B、E。"
    },
    {
      "sectionTitle": "4. 句子填空（Questions 28–32）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 28,
          "text": "题目：According to the CDC, lack of sleep leads to ______, which is often a factor in car crashes.\n题目翻译：根据 CDC，缺觉会导致 ______，而这常是车祸诱因。\n答案：fatigue\n解析：A 段写 resulting fatigue contributes to more than a million auto accidents each year，答案是 fatigue。",
          "questionId": "q12"
        },
        {
          "questionNumber": 29,
          "text": "题目：The most common sleep disorder in the U.S. is ______.\n题目翻译：美国最常见的睡眠障碍是 ______。\n答案：insomnia\n解析：B 段明确说明 insomnia is by far the most prevalent，因此填 insomnia。",
          "questionId": "q13"
        },
        {
          "questionNumber": 30,
          "text": "题目：The brain responds to any type of ______ by activating a built-in alarm.\n题目翻译：大脑会对任何类型的 ______ 启动内置警报机制。\n答案：emergency\n解析：C 段提到自动唤醒系统在感知 emergency 时会触发，故答案为 emergency。",
          "questionId": "q14"
        },
        {
          "questionNumber": 31,
          "text": "题目：Researchers claim that routinely sleep-deprived people are more likely to be obese and suffer from illnesses like ______.\n题目翻译：研究者称长期缺觉者更易肥胖并患上如 ______ 等疾病。\n答案：depression\n解析：D 段说长期睡眠不足者抑郁风险升高，并与肥胖相关，故填 depression。",
          "questionId": "q15"
        },
        {
          "questionNumber": 32,
          "text": "题目：The processing of new memories is crucially linked to our ______ during sleep.\n题目翻译：新记忆加工与睡眠中的 ______ 密切相关。\n答案：dreams\n解析：F 段指出 REM 期间约两小时 dreams 的内容对新记忆处理重要，因此填 dreams。",
          "questionId": "q16"
        }
      ],
      "questionRange": {
        "start": 28,
        "end": 32
      },
      "text": "题目 28-32 答案依次为 fatigue、insomnia、emergency、depression、dreams。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
