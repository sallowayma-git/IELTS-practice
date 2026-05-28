(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p2-high-123", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p2-high-123",
  "meta": {
    "examId": "p2-high-123",
    "title": "Bird Migration 鸟类迁徙",
    "category": "P2",
    "sourceDoc": "ReadingPractice/PDF/36. P2 - Bird Migration 鸟类迁徙.pdf",
    "noteType": "总结",
    "matchedTitle": "Bird Migration 鸟类迁徙"
  },
  "passageNotes": [
    {
      "label": "Paragraph A",
      "text": "A 段说明鸟类为什么具备迁徙能力：鸟类高度机动、飞行速度快，只要有能量就能向任意方向移动；它们有轻质空心骨骼、精细导航系统和保温设计，高空持续飞行时呼吸系统也能高效工作。这些特征让鸟类能够随季节来去，但途中仍要面对危险，并每天寻找食物、水和安全休息地。"
    },
    {
      "label": "Paragraph B",
      "text": "B 段给出迁徙的主要原因：多数解释围绕食物。北半球温带和北极地区的食物只在短暂生长季丰富；迁徙使鸟类利用季节性资源，并在资源稀缺或恶劣天气到来时离开。许多鸟能耐寒，但没有食物时必须迁徙。"
    },
    {
      "label": "Paragraph C",
      "text": "C 段提出未解之谜：虽然食物解释基本成立，但很多鸟飞得比寻找食物和好天气所需更远。北极鸟类和滩涂觅食的岸鸟会飞越两个半球中看似合适的栖息地，前往更南方越冬。这种强迫性的长途迁徙可能随天气波动演化而来，但原因并不真正清楚。"
    },
    {
      "label": "Paragraph D",
      "text": "D 段关注幼鸟如何在没有亲鸟帮助时成功迁徙。很少有成鸟陪同后代迁徙，幼鸟甚至可能不认识亲鸟。布谷鸟把蛋产在其他鸟巢中，由寄养亲鸟抚养；幼鸟长大后仍能独自去热带祖传越冬地，再独自回到北欧寻找同类配偶。"
    },
    {
      "label": "Paragraph E",
      "text": "E 段总结鸟类导航研究发现：证据显示鸟类利用太阳和星星获得罗盘方向，但真正导航还需要位置和时间意识。实验表明，鸟类被带到数千英里外的陌生陆地后仍能快速返回巢址。它们会综合夜空的先天地图、地球磁场等线索；小型鸟类多在夜间迁徙，并利用落日位置和偏振光校准罗盘。夜间飞行还能减少遇到捕食者和脱水的风险。"
    },
    {
      "label": "Paragraph F",
      "text": "F 段说明迁徙成功需要选择正确出发时机。鸟类需要准确预测天气并利用顺风；测试显示，一些鸟能感知房间地板与天花板之间极微小的气压差。它们常在天气变化出现可见迹象前就作出反应，例如草地觅食鸟类会在寒潮开始时离开，并在解冻前返回。"
    },
    {
      "label": "Paragraph G",
      "text": "G 段说明风会带来损失，但也有成功案例。过去人们以为黑暗大风夜里、没有可见参照点的鸟会像没有雷达的飞行员一样彻底迷失；现在知道并非如此。鸟确实会被强气团扫离路线而死亡，但每年秋天也有少量北美鸟被西风吹过大西洋后安全到达欧洲，并有些在次年春天返回北美。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 段落标题匹配（Questions 14-20：Choose the correct heading）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 14,
          "text": "（1）题目 14：Paragraph A\n答案：ii（The physical characteristics of birds that allow them to migrate）\n解析：A 段集中列出鸟类迁徙所需的身体与能力基础，包括 lightweight, hollow bones、finely-tuned navigation system、heat-conserving design 和高效呼吸系统，核心是“使鸟类能够迁徙的生理特征”，因此选 ii。",
          "questionId": "q1"
        },
        {
          "questionNumber": 15,
          "text": "（2）题目 15：Paragraph B\n答案：iv（The main reason why birds migrate）\n解析：B 段第一句说 Most of the explanation revolves around food，随后解释季节性食物丰富与短缺如何驱动迁徙，核心就是鸟类迁徙的主要原因，因此选 iv。",
          "questionId": "q2"
        },
        {
          "questionNumber": 16,
          "text": "（3）题目 16：Paragraph C\n答案：x（The unexplained rejection of closer feeding grounds）\n解析：C 段说许多鸟 journey much further than would be necessary，并飞越 seemingly suitable habitat，结尾说明 we do not really know，核心是无法解释为什么放弃更近的合适觅食地，因此选 x。",
          "questionId": "q3"
        },
        {
          "questionNumber": 17,
          "text": "（4）题目 17：Paragraph D\n答案：vi（Successful migration despite a lack of teaching）\n解析：D 段问 young birds 如何在 without parental assistance 的情况下迁徙，并以布谷鸟长大后独自到祖传越冬地为例。这里不是泛泛讲神秘，而是强调缺少教导仍成功迁徙，因此选 vi。",
          "questionId": "q4"
        },
        {
          "questionNumber": 18,
          "text": "（5）题目 18：Paragraph E\n答案：v（Research findings on how birds find their way）\n解析：E 段列出研究证据：鸟用 sun and stars 获得 compass directions，也利用夜空地图、地球磁场和偏振光等线索，主题是鸟类如何找到路线的研究发现，因此选 v。",
          "questionId": "q5"
        },
        {
          "questionNumber": 19,
          "text": "（6）题目 19：Paragraph F\n答案：i（Choosing the best moment to migrate）\n解析：F 段第一句指出安全抵达的技能之一是 setting off at the right time，随后讲天气预测、顺风和气压变化，核心是选择最佳迁徙时机，因此选 i。",
          "questionId": "q6"
        },
        {
          "questionNumber": 20,
          "text": "（7）题目 20：Paragraph G\n答案：ix（Success despite problems with wind during migration）\n解析：G 段先说强气团会把鸟扫离路线造成死亡，再说北美鸟被西风吹过大西洋后仍安全到达欧洲并有些返回北美。核心是迁徙中遇到风的问题仍可能成功，因此选 ix。",
          "questionId": "q7"
        }
      ],
      "questionRange": {
        "start": 14,
        "end": 20
      },
      "text": "答案：14 ii，15 iv，16 x，17 vi，18 v，19 i，20 ix。A 段是迁徙所需身体特征；B 段是食物驱动的主要原因；C 段是飞越近处合适栖息地的未解问题；D 段是缺少亲鸟教导仍能成功迁徙；E 段是鸟类如何找路的研究发现；F 段是选择正确出发时机；G 段是风造成问题但仍有成功迁徙。"
    },
    {
      "sectionTitle": "2. 多选题（Questions 21-22：Choose TWO letters）",
      "mode": "per_question",
      "items": [],
      "questionRange": {
        "start": 21,
        "end": 22
      },
      "text": "题目：According to the passage, which TWO of the following statements are true of migrating birds?\n答案：A、C\nA 正确：C 段说 many birds journey much further than would be necessary to find food and good weather，对应 Many birds migrate longer distances than they need to。\nC 正确：E 段说夜间飞行会减少 dehydration risk，对应 Birds need less water if they migrate at night。\nB 错误：D 段说 very few adults migrate accompanied by their offspring，没有说家庭群体最成功。D 错误：G 段说强气团会把鸟扫离路线，没有说只有 shore birds 不受风影响。E 错误：D 段布谷鸟幼鸟与同类分离后仍能迁徙并返回寻找同类，原文不支持“分离即无法存活”。"
    },
    {
      "sectionTitle": "3. 句子填空（Questions 23-26：ONE WORD ONLY）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 23,
          "text": "（1）题目 23：The cuckoo is able to migrate despite a lack of ___ guidance.\n答案：parental\n解析：D 段原文是 without parental assistance，题干改写为 despite a lack of parental guidance。题目要求 ONE WORD ONLY，因此填 parental，不能填旧版的 parental guidance。",
          "questionId": "q10"
        },
        {
          "questionNumber": 24,
          "text": "（2）题目 24：Night travel benefits birds because they can avoid contact with ___.\n答案：predators\n解析：E 段说 Travelling at night provides other benefits: the danger of meeting predators ... is reduced。avoid contact with 对应 meeting，答案是 predators。",
          "questionId": "q11"
        },
        {
          "questionNumber": 25,
          "text": "（3）题目 25：Some birds can anticipate weather changes without ___ clues.\n答案：visible\n解析：F 段说 birds react to weather changes before there is any visible sign of them。without visible clues 对应 before there is any visible sign，因此填 visible。",
          "questionId": "q12"
        },
        {
          "questionNumber": 26,
          "text": "（4）题目 26：In the past, birds were thought to be ___ when flying in the dark.\n答案：lost\n解析：G 段说过去的 assumption 是黑暗大风夜里的鸟 was ... hopelessly lost。题干 In the past, birds were thought to be ___ 对应 lost。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 23,
        "end": 26
      },
      "text": "答案：23 parental，24 predators，25 visible，26 lost。新版 PDF 明确要求 ONE WORD ONLY；旧数据把第 23 题填成 parental guidance、把第 26 题做成 weather/visible 相关，都是旧版题干残留。"
    }
  ]
}
  );
})(typeof window !== "undefined" ? window : globalThis);
