(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p3-high-150", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p3-high-150",
  "meta": {
    "examId": "p3-high-150",
    "title": "A closer examination of a study on verbal and non-verbal messages 语言表达研究",
    "category": "P3",
    "sourceDoc": "P3 解析+1202高频_副本.md",
    "noteType": "总结",
    "matchedTitle": "A closer examination of a study on verbal and non-verbal messages 语言表达研究"
  },
  "passageNotes": [
    {
      "label": "Paragraph 1（Description of the Study）",
      "text": "1967 年阿尔伯特・梅拉比安（Albert Mehrabian）及其加州大学洛杉矶分校团队关于语言与非语言信息的研究，因频繁引用被视为 “不言自明的真理”。两项实验中，受试者需识别录音中 “maybe” 的语调情绪（喜爱、中立、厌恶）和照片中的面部情绪（实验一），及 9 个不同语调单词的情绪（实验二，含积极、中性、消极词）。结果显示：照片识别准确率高于语调；语调比单词本身传递更多含义。研究者据此得出结论：对说话者的感受中，7% 来自词汇，38% 来自语调，55% 来自肢体语言（如面部表情）。"
    },
    {
      "label": "Paragraph 2-3（Methodological Issues）",
      "text": "该研究存在明显局限：样本量仅 62 人（25 人用于筛选实验一词汇，37 人用于核心对比，且均为女性本科生，年龄和学历单一，结果可能受样本性质影响）；7-38-55 公式源于两项独立实验（均未同时包含语言、语调、面部表情三渠道），实验一仅用 “maybe” 这一中性词，无法评估语言输入变化的影响，方法论缺乏有效性；现实中人们在特定语境下用完整句子交流，语言功能复杂，与实验场景差异巨大。此外，该公式被广泛用于公共演讲、人际沟通等教学领域，但其局限性未被充分重视。"
    },
    {
      "label": "Paragraph 4-6（Lessons to consider）",
      "text": "梅拉比安研究的吸引力在于 “数值精确性”—— 复杂的沟通现象因三个数字变得简单，且数字的确定性比语言歧义更易被接受。这种流行使公式获得极高可信度，强化了 “非语言信息远比语言重要” 的误解，但实际中 “一句不当的话可能破坏沟通”，语言至关重要。布拉德利（Bradley，1991）批评该研究时指出：“若 93% 信息可通过语调与面部线索传递，学习语言便无必要”。梅拉比安本人也强调：其研究仅针对 “情感与态度沟通”，将所有沟通中语言占比归为 7% 是荒谬的，如传递抽象关系（如数学公式）时，100% 信息依赖语言。部分教材作者会注明研究语境（如斯图尔特与迪安杰洛（1988）指出 “仅当不确定对方感受时，7% 依赖词汇”），或弱化具体百分比，但仍有作者不加限定地使用该公式。"
    },
    {
      "label": "Paragraph 7（Conclusion）",
      "text": "这项小规模研究的影响力远超预期，需客观看待其价值，从社会科学研究、沟通教学及 “沟通误解成因” 中吸取教训。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 摘要选词填空（Questions 27–30：Choose A–H）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 27,
          "text": "（1）题目 27：Albert Mehrabian and his colleagues carried out an influential study comparing the \\___\\___ of verbal and non-verbal communication.\n题目翻译：阿尔伯特・梅拉比安及其同事开展了一项有影响力的研究，比较语言与非语言沟通的_\\___\\__。\n答案：D（effects，影响）\n解析：定位 Paragraph 1 中 “a study of verbal and non-verbal messages in communication... comparing verbal and non-verbal communication”，研究核心是比较两者对沟通的 “影响”（而非特征、目的等），因此选 D。",
          "questionId": "q1"
        },
        {
          "questionNumber": 28,
          "text": "（2）题目 28：In both experiments, subjects had to identify the \\___\\___ being communicated by other people.\n题目翻译：两项实验中，受试者均需识别他人传递的_\\___\\__。\n答案：G（feelings，感受）\n解析：定位 Paragraph 1 中 “guess the emotions in the recorded voice and the photos”“guess the speaker’s emotions”，“emotions” 对应 “feelings”，因此选 G。",
          "questionId": "q2"
        },
        {
          "questionNumber": 29,
          "text": "（3）题目 29：The two main areas focused on in the first experiment were voice tones and \\___\\___.\n题目翻译：实验一聚焦的两个主要领域是语调和_\\___\\__。\n答案：A（facial expressions，面部表情）\n解析：定位 Paragraph 1 中 “listen to a recording... in three tones of voice... shown photos of female faces expressing the same three emotions”，明确提到 “语调” 和 “面部表情”，因此选 A。",
          "questionId": "q3"
        },
        {
          "questionNumber": 30,
          "text": "（4）题目 30：while the second focused mainly on voice tones and \\___\\___.\n题目翻译：而实验二主要聚焦语调和_\\___\\__。\n答案：E（word meanings，词汇含义）\n解析：定位 Paragraph 1 中 “nine recorded words... three had positive meanings... three were neutral... three were negative”，明确提到 “语调” 和 “词汇含义”，因此选 E。",
          "questionId": "q4"
        }
      ],
      "questionRange": {
        "start": 27,
        "end": 30
      },
      "text": "题目翻译：阿尔伯特・梅拉比安及其同事开展了一项有影响力的研究，比较语言与非语言沟通的_\\___\\__。\n答案：D（effects，影响）\n解析：定位 Paragraph 1 中 “a study of verbal and non-verbal messages in communication... comparing verbal and non-verbal communication”，研究核心是比较两者对沟通的 “影响”（而非特征、目的等），因此选 D。\n题目翻译：两项实验中，受试者均需识别他人传递的_\\___\\__。\n答案：G（feelings，感受）\n解析：定位 Paragraph 1 中 “guess the emotions in the recorded voice and the photos”“guess the speaker’s emotions”，“emotions” 对应 “feelings”，因此选 G。\n题目翻译：实验一聚焦的两个主要领域是语调和_\\___\\__。\n答案：A（facial expressions，面部表情）\n解析：定位 Paragraph 1 中 “listen to a recording... in three tones of voice... shown photos of female faces expressing the same three emotions”，明确提到 “语调” 和 “面部表情”，因此选 A。\n题目翻译：而实验二主要聚焦语调和_\\___\\__。\n答案：E（word meanings，词汇含义）\n解析：定位 Paragraph 1 中 “nine recorded words... three had positive meanings... three were neutral... three were negative”，明确提到 “语调” 和 “词汇含义”，因此选 E。"
    },
    {
      "sectionTitle": "2. 判断题（Questions 31–35：YES/NO/NOT GIVEN）",
      "mode": "per_question",
      "items": [
        {
          "questionNumber": 31,
          "text": "（1）题目 31：One limitation of the study was that there were too few subjects involved.（该研究的局限之一是样本量过少）\n答案：YES（正确）\n解析：定位 Paragraph 2 中 “the entire study involved only 62 subjects... the key issue... was determined by only the 37 remaining subjects”，明确提到样本量少是局限，与题干描述一致，因此判定为 YES。",
          "questionId": "q5"
        },
        {
          "questionNumber": 32,
          "text": "（2）题目 32：The fact that the subjects in the study came from a similar background was an advantage.（受试者背景相似是优势）\n答案：NO（错误）\n解析：定位 Paragraph 2 中 “All were female undergraduates... their ages and academic qualifications seem remarkably uniform. Thus, the findings may simply be a product of the nature of the sample”，明确提到背景相似 “可能导致结果偏差，是劣势”，与题干 “优势” 描述矛盾，因此判定为 NO。",
          "questionId": "q6"
        },
        {
          "questionNumber": 33,
          "text": "（3）题目 33：The two experiments should have been carried out in a different order.（两项实验应调整进行顺序）\n答案：NOT GIVEN（未提及）\n解析：全文未讨论 “实验顺序” 的合理性，无相关信息，因此判定为 NOT GIVEN。",
          "questionId": "q7"
        },
        {
          "questionNumber": 34,
          "text": "（4）题目 34：The researchers’ choice of a neutral word was helpful in the context of the study.（研究者选择中性词对研究有帮助）\n答案：NO（错误）\n解析：定位 Paragraph 3 中 “The researchers intentionally used a ‘neutral’ word so naturally the subjects found little meaning there. Clearly, such a methodology lacks validity”，明确提到 “选择中性词导致方法论无效，无帮助”，与题干 “有帮助” 描述矛盾，因此判定为 NO。",
          "questionId": "q8"
        },
        {
          "questionNumber": 35,
          "text": "（5）题目 35：The study would have been more valid if it had included a range of languages.（若包含多种语言，研究有效性会更高）\n答案：NOT GIVEN（未提及）\n解析：全文未讨论 “语言种类” 对研究有效性的影响，无相关信息，因此判定为 NOT GIVEN。",
          "questionId": "q9"
        }
      ],
      "questionRange": {
        "start": 31,
        "end": 35
      },
      "text": "答案：YES（正确）\n解析：定位 Paragraph 2 中 “the entire study involved only 62 subjects... the key issue... was determined by only the 37 remaining subjects”，明确提到样本量少是局限，与题干描述一致，因此判定为 YES。\n答案：NO（错误）\n解析：定位 Paragraph 2 中 “All were female undergraduates... their ages and academic qualifications seem remarkably uniform. Thus, the findings may simply be a product of the nature of the sample”，明确提到背景相似 “可能导致结果偏差，是劣势”，与题干 “优势” 描述矛盾，因此判定为 NO。\n答案：NOT GIVEN（未提及）\n解析：全文未讨论 “实验顺序” 的合理性，无相关信息，因此判定为 NOT GIVEN。\n答案：NO（错误）\n解析：定位 Paragraph 3 中 “The researchers intentionally used a ‘neutral’ word so naturally the subjects found little meaning there. Clearly, such a methodology lacks validity”，明确提到 “选择中性词导致方法论无效，无帮助”，与题干 “有帮助” 描述矛盾，因此判定为 NO。\n答案：NOT GIVEN（未提及）\n解析：全文未讨论 “语言种类” 对研究有效性的影响，无相关信息，因此判定为 NOT GIVEN。"
    },
    {
      "sectionTitle": "3. 单选题（Questions 36–40：Choose A–D）",
      "mode": "per_question",
      "items": [
        {
          "questionNumber": 36,
          "text": "（1）题目 36：What does the writer say about the “numerical precision” of Mehrabian’s study?（作者如何评价梅拉比安研究的 “数值精确性”？）\n答案：A（It makes the claims more attractive. 数值精确性使研究结论更具吸引力）\n解析：定位 Paragraph 4 中 “one appealing aspect of the Mehrabian study is its numerical precision... Communication is a complex phenomenon, but it seems less so when we can rely on these three magical numbers”，明确提到 “数值精确性是研究的吸引力所在”，因此选 A。",
          "questionId": "q10"
        },
        {
          "questionNumber": 37,
          "text": "（2）题目 37：What does the writer say about the popularity of the 7–38–55 formula?（作者如何评价 7-38-55 公式的流行？）\n答案：B（It is leading to an undervaluing of words. 其流行导致人们低估词汇的重要性）\n解析：定位 Paragraph 4 中 “the continued references to this research sustain it, encouraging people to believe in the overwhelming importance of the non-verbal message compared with the verbal one. Yet we know that even one ill-chosen word... can make or break a communicative effort. Words do matter”，明确提到 “公式流行强化了‘非语言更重要’的误解，导致词汇被低估”，因此选 B。",
          "questionId": "q11"
        },
        {
          "questionNumber": 38,
          "text": "（3）题目 38：What point is Bradley making about language learning?（布拉德利关于语言学习的观点是什么？）\n答案：D（Language must be important since we make an effort to acquire it. 语言必然重要，因为我们会努力学习它）\n解析：定位 Paragraph 4 中 “Bradley (1991)... ‘If we could communicate 93% of information and attitudes with vocal and facial cues, it would be wasteful to spend time learning a language’”，布拉德利用反语指出 “若语言不重要，人们便不会花时间学习”，即 “努力学习证明语言重要”，因此选 D。",
          "questionId": "q12"
        },
        {
          "questionNumber": 39,
          "text": "（4）题目 39：What does Mehrabian himself say about his findings?（梅拉比安本人如何评价自己的研究结果？）\n答案：A（They are relevant to only one area of communication. 结果仅适用于沟通的一个领域）\n解析：定位 Paragraph 5 中 “Mehrabian... ‘all my findings… dealt with communications of feelings and attitudes… it is absurd to imply or suggest that the verbal portion of all communication constitutes only 7% of the message’”，明确提到 “研究仅针对情感与态度沟通，不适用于所有沟通场景”，因此选 A。",
          "questionId": "q13"
        },
        {
          "questionNumber": 40,
          "text": "（5）题目 40：What is the writer’s purpose in the paragraph beginning “To be fair…”?（作者在以 “客观而言……” 开头的段落中，目的是什么？）\n答案：C（To present varying interpretations of Mehrabian’s study. 呈现对梅拉比安研究的不同解读）\n解析：定位 Paragraph 6 中 “many textbook writers attempt to be faithful to the context... Others try to play down the specific percentages... Nonetheless, other textbook authors simply use the numbers without placing any limits on their meaning”，明确列举 “忠实语境、弱化百分比、不加限定使用” 三种不同解读，因此选 C。",
          "questionId": "q14"
        }
      ],
      "questionRange": {
        "start": 36,
        "end": 40
      },
      "text": "答案：A（It makes the claims more attractive. 数值精确性使研究结论更具吸引力）\n解析：定位 Paragraph 4 中 “one appealing aspect of the Mehrabian study is its numerical precision... Communication is a complex phenomenon, but it seems less so when we can rely on these three magical numbers”，明确提到 “数值精确性是研究的吸引力所在”，因此选 A。\n答案：B（It is leading to an undervaluing of words. 其流行导致人们低估词汇的重要性）\n解析：定位 Paragraph 4 中 “the continued references to this research sustain it, encouraging people to believe in the overwhelming importance of the non-verbal message compared with the verbal one. Yet we know that even one ill-chosen word... can make or break a communicative effort. Words do matter”，明确提到 “公式流行强化了‘非语言更重要’的误解，导致词汇被低估”，因此选 B。\n答案：D（Language must be important since we make an effort to acquire it. 语言必然重要，因为我们会努力学习它）\n解析：定位 Paragraph 4 中 “Bradley (1991)... ‘If we could communicate 93% of information and attitudes with vocal and facial cues, it would be wasteful to spend time learning a language’”，布拉德利用反语指出 “若语言不重要，人们便不会花时间学习”，即 “努力学习证明语言重要”，因此选 D。\n答案：A（They are relevant to only one area of communication. 结果仅适用于沟通的一个领域）\n解析：定位 Paragraph 5 中 “Mehrabian... ‘all my findings… dealt with communications of feelings and attitudes… it is absurd to imply or suggest that the verbal portion of all communication constitutes only 7% of the message’”，明确提到 “研究仅针对情感与态度沟通，不适用于所有沟通场景”，因此选 A。\n答案：C（To present varying interpretations of Mehrabian’s study. 呈现对梅拉比安研究的不同解读）\n解析：定位 Paragraph 6 中 “many textbook writers attempt to be faithful to the context... Others try to play down the specific percentages... Nonetheless, other textbook authors simply use the numbers without placing any limits on their meaning”，明确列举 “忠实语境、弱化百分比、不加限定使用” 三种不同解读，因此选 C。"
    }
  ]
}
  );
})(typeof window !== "undefined" ? window : globalThis);
