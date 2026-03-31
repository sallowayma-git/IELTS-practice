(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p1-medium-60", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p1-medium-60",
  "meta": {
    "examId": "p1-medium-60",
    "title": "Sorry—who are you 脸盲症",
    "category": "P1",
    "sourceDoc": "152. P1 - Sorry—who are you 脸盲症【次】.pdf",
    "noteType": "翻译+解析",
    "matchedTitle": "Sorry—who are you 脸盲症"
  },
  "passageNotes": [
    {
      "label": "Paragraph 1",
      "text": "Jacob Hodes 从学生时代起就存在识人困难：即便别人和他打招呼，他也常不知道对方是谁。他并非有意忽视他人，而是无法稳定回忆面孔特征。这类长期、跨场景的识别障碍后来被诊断为 prosopagnosia（脸盲）。"
    },
    {
      "label": "Paragraph 2-3",
      "text": "过去公开记录中的脸盲案例很少，且多与脑损伤有关。近年研究识别出“发育性脸盲”（developmental prosopagnosia），可从出生即存在或在幼年早期出现。哈佛/UCL与德国团队的调查都给出约2%到2.5%的比例，提示该问题并不罕见。"
    },
    {
      "label": "Paragraph 4-5",
      "text": "许多患者知道自己识别人脸困难，但并不总能意识到他人与自己能力差距。多数发育性脸盲者会建立补偿策略，如靠发型、穿着和说话方式识别。神经科学家关注该群体，不仅为了研究视觉识别，更为了理解大脑是否存在“任务专门化”处理机制。"
    },
    {
      "label": "Paragraph 6",
      "text": "患者个体差异很大：有人只在人脸上受损，有人连常见动物和物体也识别困难；有人能分辨情绪却认不出具体人脸，有人相反。这种异质性使病因研究复杂化，也是当前研究的核心挑战之一。"
    },
    {
      "label": "Paragraph 7",
      "text": "遗传因素可能参与发病。Martina Gruter 团队在家系研究中观察到同一家族中多例出现，提出“单基因”解释的证据。Duchaine 则补充早期视觉经验的作用，例如幼儿期左眼晶状体异常导致关键时期视觉输入受限，也可能增加风险。"
    },
    {
      "label": "Paragraph 8",
      "text": "治疗方面，DeGutis 在实验室训练中获得一定积极结果，个别患者在日常生活也反馈改善。与此同时，研究者对训练外推保持谨慎：长期面对人脸本身就是“高频训练”，且实验中存在被试用替代线索“应试”的可能，可能高估真实识别提升。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 判断正误（Questions 1–7）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 1,
          "text": "题目：Before attending college, Jacob was capable of recognising people he knew well.\n题目翻译：在上大学前，Jacob 能识别他熟悉的人。\n答案：FALSE\n解析：第一段说他“all his life”都存在识人困难，连亲友打招呼都可能认不出，题干与原文相反。", 
          "questionId": "q1"
        },
        {
          "questionNumber": 2,
          "text": "题目：Researchers believe that prosopagnosia may be a growing problem.\n题目翻译：研究者认为脸盲症可能正在变得更严重或更普遍。\n答案：NOT GIVEN\n解析：文章给出患病比例和“并不少见”的判断，但没有讨论其是否“正在增长”的时间趋势。",
          "questionId": "q2"
        },
        {
          "questionNumber": 3,
          "text": "题目：It is harder to identify developmental prosopagnosia in babies than in young children.\n题目翻译：与幼儿相比，在婴儿阶段更难识别发育性脸盲。\n答案：NOT GIVEN\n解析：文中只定义该类型“出生即有或幼年早期出现”，没有比较婴儿与幼儿诊断难度。",
          "questionId": "q3"
        },
        {
          "questionNumber": 4,
          "text": "题目：A German study seems to support the Harvard and UCL research findings.\n题目翻译：德国研究似乎支持哈佛和UCL的研究结论。\n答案：TRUE\n解析：两项研究分别得到约2%和2.5%的比例，方向一致，属于相互支持。",
          "questionId": "q4"
        },
        {
          "questionNumber": 5,
          "text": "题目：In general, prosopagnosics are aware that other people can recognise faces more easily than they can.\n题目翻译：一般来说，脸盲症患者知道别人比自己更容易识别人脸。\n答案：FALSE\n解析：第四段指出他们“often don't realise”别人有更强识别能力，题干与原文冲突。",
          "questionId": "q5"
        },
        {
          "questionNumber": 6,
          "text": "题目：In most cases, prosopagnosics have developed ways to deal with their problem.\n题目翻译：多数情况下，脸盲症患者已经发展出应对策略。\n答案：TRUE\n解析：第五段明确写“the majority ... possess strategies”，与题干一致。",
          "questionId": "q6"
        },
        {
          "questionNumber": 7,
          "text": "题目：The study of prosopagnosia may help neuroscientists to treat different kinds of brain injury.\n题目翻译：脸盲研究可帮助神经科学家治疗不同类型脑损伤。\n答案：NOT GIVEN\n解析：文章强调研究价值在于理解大脑信息处理机制，并未提出“用于治疗不同脑损伤”的结论。",
          "questionId": "q7"
        }
      ],
      "questionRange": {
        "start": 1,
        "end": 7
      },
      "text": "题目1答案FALSE：Jacob 从小就存在识人困难。\n题目2答案NOT GIVEN：文中未给出“发病率上升”趋势。\n题目3答案NOT GIVEN：未比较婴儿与幼儿诊断难度。\n题目4答案TRUE：德国与哈佛/UCL结果方向一致。\n题目5答案FALSE：患者通常并未意识到他人识别优势。\n题目6答案TRUE：多数患者确有补偿策略。\n题目7答案NOT GIVEN：文章未谈“治疗不同脑损伤”。"
    },
    {
      "sectionTitle": "2. 句子填空（Questions 8–13）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 8,
          "text": "题目：As well as being unable to recognise facial features, prosopagnosics may also have problems recognising commonly seen ______ and objects.\n题目翻译：除了无法识别人脸特征，患者还可能难以识别常见的 ______ 和物体。\n答案：animals\n解析：第六段指出部分患者除人脸外，对“animals ... familiar as well”也存在识别困难。",
          "questionId": "q8"
        },
        {
          "questionNumber": 9,
          "text": "题目：Some also have problems recognizing the ______ on someone else's face.\n题目翻译：有些人还难以识别他人面部的 ______。\n答案：emotion\n解析：第六段对比案例中提到，有的被试连他人面部所表达的情绪也无法识别，对应 emotion。",
          "questionId": "q9"
        },
        {
          "questionNumber": 10,
          "text": "题目：Prosopagnosia may be caused by just one ______, according to Martina Gruter.\n题目翻译：根据 Martina Gruter 的观点，脸盲可能由单个 ______ 导致。\n答案：gene\n解析：第七段家系研究给出的解释是“a single gene could be responsible”。",
          "questionId": "q10"
        },
        {
          "questionNumber": 11,
          "text": "题目：It may also be caused by a defect in the ______ eye, according to Brad Duchaine.\n题目翻译：根据 Brad Duchaine 的观点，这也可能由 ______ 眼缺陷引起。\n答案：left\n解析：第七段提到婴儿期“when it's the left one”会成为重要风险因素，答案为 left。",
          "questionId": "q11"
        },
        {
          "questionNumber": 12,
          "text": "题目：Joseph DeGutis's patient proved he had been successfully trained to recognise faces inside the ______ and in the outside world.\n题目翻译：Joseph DeGutis 的患者证明其在 ______ 内及现实生活中都提升了人脸识别能力。\n答案：laboratory\n解析：第八段先写训练测试发生在 laboratory，再提到患者在日常生活中也感觉更容易识别。",
          "questionId": "q12"
        },
        {
          "questionNumber": 13,
          "text": "题目：Thomas Gruter doubts that the training will work and mentions that ______ by some subjects can affect research results.\n题目翻译：Thomas Gruter 质疑训练有效性，并指出部分受试者的 ______ 会影响研究结果。\n答案：cheating\n解析：第八段明确写“cheating is a possibility during tests”，即被试可能通过取巧策略提高测试分数。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 8,
        "end": 13
      },
      "text": "题目8答案animals：部分患者对常见动物也会识别受损。\n题目9答案emotion：有的患者无法识别他人面部情绪。\n题目10答案gene：家系研究支持单基因假设。\n题目11答案left：左眼早期视觉缺陷被提为风险因素。\n题目12答案laboratory：训练成效先在实验室验证。\n题目13答案cheating：被试取巧会污染实验结果。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
