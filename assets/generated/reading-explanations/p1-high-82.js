(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p1-high-82", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p1-high-82",
  "meta": {
    "examId": "p1-high-82",
    "title": "Think Small 微观科学",
    "category": "P1",
    "sourceDoc": "172. P1 - Think Small 微观科学.pdf",
    "noteType": "翻译+解析",
    "matchedTitle": "Think Small 微观科学"
  },
  "passageNotes": [
    {
      "label": "Paragraph A",
      "text": "Izon 把美国总部设在马萨诸塞州剑桥，这里是全球科研和技术密集区。公司在过去三年扩大到原来的 17 倍，但核心只卖一款自 2004 年持续打磨的设备 qNano。qNano 用于极微粒子的测量和分析，售价约 27,000 美元。其竞争优势不是更便宜，而是在同价位里能给出更精确的单粒子测量，而非平均值估算，因此被用于药物递送分析、环境研究等多个场景。"
    },
    {
      "label": "Paragraph B",
      "text": "美国销售负责人 Kristoffer Bolen 在全职工作同时，完成了高科技 MBA 六学期中的第五学期，并且本身已有理学硕士学位。岗位要求他既能推进销售流程，也能深入理解 qNano 这类复杂仪器。客户购买后，Izon 人员会飞往美国各地做上手培训，并持续跟进使用情况，再与新西兰技术团队联动。"
    },
    {
      "label": "Paragraph C",
      "text": "公司起点在新西兰。Hans van der Voorn 卖掉原公司后接触到三位科学家的构想：用带可调微孔的塑料膜测量不同微粒。他先投入 150 万美元推动原型开发，这直接催生 Izon 和 qNano。van der Voorn 认为科学与商业常互不理解，而工程能力是桥梁。为扩张，公司在美国落地团队。当前以外国公司身份运营可减少合规负担，但也限制了本地合作，未来可能改为美国注册。"
    },
    {
      "label": "Paragraph D",
      "text": "qNano 的营销难点在于：目标客户是科学家，且科研圈子实际不大。Izon 很依赖客户发表的研究文章来形成口碑传播。开发与培训经理 Yaniv Gaynor 从高校教师转入私营企业，销售并非其舒适区，但他负责大量售后体验修复，并把客户提问反哺产品迭代。"
    },
    {
      "label": "Paragraph E",
      "text": "公司把自身定义为“科研工具提供者”，并强调应用面很宽。与哈佛合作的项目尝试识别与血栓相关的特定血液微粒，若成功可做出更便捷的检测。另一个规划是升级美国总部空间，把“上门培训”逐步转成“客户到总部培训”，以降低差旅并强化客户关系。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 判断正误（Questions 1–7）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 1,
          "text": "题目：Izon's new US headquarters are located in an area popular with other science businesses.\n题目翻译：Izon 的美国新总部位于一个受其他科学企业欢迎的区域。\n答案：TRUE\n解析：原文写 Cambridge 是全球重要科研中心，同楼办公方多为带科学或制药属性的公司，和题干一致。",
          "questionId": "q1"
        },
        {
          "questionNumber": 2,
          "text": "题目：Izon's growth in the last three years has been faster than the company predicted.\n题目翻译：Izon 最近三年的增长速度比公司预期更快。\n答案：NOT GIVEN\n解析：文章只给出“过去三年扩大到 17 倍”，没有出现任何“与预期相比更快/更慢”的信息。",
          "questionId": "q2"
        },
        {
          "questionNumber": 3,
          "text": "题目：Since 2004, Izon has developed a range of equipment for use in scientific research.\n题目翻译：自 2004 年以来，Izon 开发了一系列用于科研的设备。\n答案：FALSE\n解析：文中明确说公司只卖一款自 2004 年开发的产品 qNano，不是“一系列设备”。",
          "questionId": "q3"
        },
        {
          "questionNumber": 4,
          "text": "题目：One advantage of the qNano is that it is cheaper than its competitors.\n题目翻译：qNano 的一个优势是它比竞品便宜。\n答案：FALSE\n解析：文章强调 qNano 与同价位机器相比优势在“精确测量”，不是价格更低。",
          "questionId": "q4"
        },
        {
          "questionNumber": 5,
          "text": "题目：Drug delivery analysis will be the most profitable application of the qNano.\n题目翻译：药物递送分析将会成为 qNano 最赚钱的应用。\n答案：NOT GIVEN\n解析：文中只说应用范围很广，包含药物递送分析到环境研究，没有比较各应用利润高低。",
          "questionId": "q5"
        },
        {
          "questionNumber": 6,
          "text": "题目：Kristoffer Bolen is still completing his studies.\n题目翻译：Kristoffer Bolen 仍在完成学业。\n答案：TRUE\n解析：他“刚完成六学期中的第五学期”，说明课程尚未全部结束。",
          "questionId": "q6"
        },
        {
          "questionNumber": 7,
          "text": "题目：Bolen's job requires him to fully understand how the qNano works.\n题目翻译：Bolen 的工作要求他充分理解 qNano 的工作原理。\n答案：TRUE\n解析：原文说岗位要求他“in depth”理解复杂技术，同时管理销售流程，和题干一致。",
          "questionId": "q7"
        }
      ],
      "questionRange": {
        "start": 1,
        "end": 7
      },
      "text": "题目 1：总部位于科研企业聚集区。答案 TRUE。\n题目 2：是否超出公司预期未提及。答案 NOT GIVEN。\n题目 3：公司并非开发一系列设备，而是主打一款 qNano。答案 FALSE。\n题目 4：优势不是更便宜，而是测量更精确。答案 FALSE。\n题目 5：未比较各应用盈利性。答案 NOT GIVEN。\n题目 6：Bolen 仍在读 MBA。答案 TRUE。\n题目 7：岗位要求深度理解 qNano。答案 TRUE。"
    },
    {
      "sectionTitle": "2. 笔记填空（Questions 8–13）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 8,
          "text": "题目：He made the ______ which enabled the prototype to be created.\n题目翻译：他进行了这笔 ______，从而使原型得以开发。\n答案：investment\n解析：文中写 van der Voorn 最初投入 150 万美元 investment 推动原型研发。",
          "questionId": "q8"
        },
        {
          "questionNumber": 9,
          "text": "题目：His background in ______ as well as business gave him the skills to run Izon.\n题目翻译：他在 ______ 与商业两方面的背景，让他具备管理 Izon 的能力。\n答案：engineering\n解析：原文明确说他认为 engineering 是科学与商业之间的桥梁，且相关经验对公司成功关键。",
          "questionId": "q9"
        },
        {
          "questionNumber": 10,
          "text": "题目：The company's marketing relies on ______ about its customers' research.\n题目翻译：公司的营销依赖客户科研工作的 ______。\n答案：articles\n解析：文章写关键营销材料是客户发表的 articles，介绍他们如何使用 qNano。",
          "questionId": "q10"
        },
        {
          "questionNumber": 11,
          "text": "题目：Yaniv Gaynor was formerly a ______ with no experience in sales.\n题目翻译：Yaniv Gaynor 之前是一名 ______，没有销售经验。\n答案：teacher\n解析：文中说明他从明尼苏达大学 teacher 岗位转入 Izon，销售流程对他是新领域。",
          "questionId": "q11"
        },
        {
          "questionNumber": 12,
          "text": "题目：To diagnose thrombosis, a ______ may be developed.\n题目翻译：为诊断血栓，未来可能开发一种 ______。\n答案：test\n解析：文中说如果识别到目标血液微粒，就能设计一个简单的 test，便于医生诊断血栓。",
          "questionId": "q12"
        },
        {
          "questionNumber": 13,
          "text": "题目：______ will be done at Izon's US headquarters.\n题目翻译：______ 将会在 Izon 美国总部进行。\n答案：training\n解析：公司计划扩充美国办公室后，把客户 training 带到总部进行，而不是持续外出上门。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 8,
        "end": 13
      },
      "text": "题目 8：原型开发依赖最初资金投入。答案 investment。\n题目 9：管理者的关键技术背景是 engineering。答案 engineering。\n题目 10：营销核心材料是客户发表的 research articles。答案 articles。\n题目 11：Gaynor 转岗前身份是 teacher。答案 teacher。\n题目 12：血栓识别项目目标之一是形成 test。答案 test。\n题目 13：未来把客户 training 集中到美国总部。答案 training。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
