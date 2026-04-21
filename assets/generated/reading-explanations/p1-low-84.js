(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p1-low-84", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p1-low-84",
  "meta": {
    "examId": "p1-low-84",
    "title": "Why good ideas fail TF公司",
    "category": "P1",
    "sourceDoc": "174. P1 - Why good ideas fail TF公司.pdf",
    "noteType": "翻译+解析",
    "matchedTitle": "Why good ideas fail TF公司"
  },
  "passageNotes": [
    {
      "label": "Case Background",
      "text": "案例先回顾 TF 的历史：公司在 1970 年代因准确抓住家居潮流而成功，但到 2004 年门店衰退。创始人 Tibal Fisher 将品牌转为 TF's Nextstage，目标重新抓住老化中的原有客户，并聚焦 60+ 人群，推出“更易读、更易握、更易操作”的产品。市场调研当时给出积极信号。"
    },
    {
      "label": "Failure Outcome",
      "text": "2007 年门店斥资 4000 万美元改造并上线新品牌，门店更舒适并加入咖啡区，管理层预期“只要把人引进店里就会成交”。但到 2009 年模式失败，门店持续冷清。用户反馈是：新店像“老年活动中心”，不断提醒他们“自己正在变老”。"
    },
    {
      "label": "Expert 1 - Core Diagnosis",
      "text": "Donna Sturgess 认为 TF 的关键失误是只看“表层态度”，忽视消费者潜意识联想与情绪机制。她强调消费者与品牌的关系本质上是情绪性的，情绪会触发或阻断购买，因此只靠显性问卷很容易误判。"
    },
    {
      "label": "Expert 1 - Parallel Case",
      "text": "她以减重药 Alli 为例：这类产品同样触发用户负面自我感受，若处理不好，用户会因羞耻或抗拒而放弃购买/使用。应对方式是把情绪策略嵌入全流程，包括命名和包装。"
    },
    {
      "label": "Expert 1 - Research Methods",
      "text": "她说明研究方法不必复杂但要更贴近真实情境，例如一对一访谈、入户观察消费者行为等。重点是抓住“行为和情绪线索”，而非只收集口头态度。"
    },
    {
      "label": "Expert 2 - Branding Principle",
      "text": "Alex Lee 给出的原则是：消费者（尤其 60+）倾向购买与“理想中的自己”相匹配的品牌，而不是“现实中的自己”。这与冲浪装备广告总拍冲浪者而非普通购物者是同一逻辑。"
    },
    {
      "label": "Expert 2 - OXO Practice",
      "text": "OXO 通过 focus groups 发现，用户会把品牌和“健康、活力”形象关联。尽管产品设计确实照顾老年人与视力/手部能力下降人群，公司也避免在营销中直接把产品定义成“辅助工具”，以免损伤品牌吸引力。"
    },
    {
      "label": "Expert 2 - Practical Research Advice",
      "text": "他强调调研不必过度复杂，简单大厅问卷也能挖到洞见；同时管理者的商业直觉仍有价值。对于 TF，直觉本可提示：60+ 人群并不愿支持一个要求他们“按年龄行事”的品牌。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 判断正误（Questions 1–5）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 1,
          "text": "题目：The TF Nextstage stores planned to sell products to make life easier for older people.\n题目翻译：TF Nextstage 计划销售帮助老年人生活更方便的产品。\n答案：TRUE\n解析：案例背景段明确列出为 60+ 用户设计的易读屏幕、舒适握柄和易操作电子设备，题干成立。",
          "questionId": "q1"
        },
        {
          "questionNumber": 2,
          "text": "题目：TF's market research indicated that people liked the products.\n题目翻译：TF 的市场调研显示人们喜欢这些产品。\n答案：TRUE\n解析：原文写 market research was very positive，显示消费者支持度强，和题干一致。",
          "questionId": "q2"
        },
        {
          "questionNumber": 3,
          "text": "题目：It cost more than expected to remodel the TF stores.\n题目翻译：TF 门店改造成本超过预期。\n答案：NOT GIVEN\n解析：文中只给出改造花费 4000 万美元，没有出现“超预算”或“低于预算”的对比信息。",
          "questionId": "q3"
        },
        {
          "questionNumber": 4,
          "text": "题目：The TF Nextstage coffee shops sold their own brand of food and drink.\n题目翻译：TF Nextstage 咖啡区销售自有品牌食品饮料。\n答案：NOT GIVEN\n解析：文章仅提到门店配有咖啡区以增加客流，未说明其品牌归属或具体售卖策略。",
          "questionId": "q4"
        },
        {
          "questionNumber": 5,
          "text": "题目：TF Nextstage customers liked the atmosphere in the new stores.\n题目翻译：TF Nextstage 顾客喜欢新门店氛围。\n答案：FALSE\n解析：原文写顾客抱怨门店像 senior center，并因被提醒衰老而反感，题干与原文相反。",
          "questionId": "q5"
        }
      ],
      "questionRange": {
        "start": 1,
        "end": 5
      },
      "text": "题目 1-5 答案依次为：TRUE、TRUE、NOT GIVEN、NOT GIVEN、FALSE。依据来自案例描述与用户反馈段落。"
    },
    {
      "sectionTitle": "2. 笔记填空（Questions 6–13）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 6,
          "text": "题目：The TF team limited their research to attitudes that occur at a ______ level in customers' minds.\n题目翻译：TF 团队把调研局限在消费者心理中的 ______ 层面态度。\n答案：surface\n解析：Donna Sturgess 直接指出管理层只看了 surface attitudes，因此答案是 surface。",
          "questionId": "q6"
        },
        {
          "questionNumber": 7,
          "text": "题目：Use: help people achieve ______.\n题目翻译：用途：帮助人们实现 ______。\n答案：weight loss\n解析：Alli 被定义为 aid weight loss 的产品，空格对应 weight loss。",
          "questionId": "q7"
        },
        {
          "questionNumber": 8,
          "text": "题目：Giving the product a ______ that seems helpful and supportive.\n题目翻译：给产品一个显得有帮助且有支持感的 ______。\n答案：name\n解析：她说先做的是“came up with a name that sounds like a helpful partner”，答案是 name。",
          "questionId": "q8"
        },
        {
          "questionNumber": 9,
          "text": "题目：Giving the product a reusable ______.\n题目翻译：为产品设计一个可重复利用的 ______。\n答案：container\n解析：文本写包装容器不仅装药，还可存放饮食指南与食谱，因此答案为 container。",
          "questionId": "q9"
        },
        {
          "questionNumber": 10,
          "text": "题目：Good information can come from interviews or studying the ______ of consumers in the home.\n题目翻译：有价值信息可来自访谈，或研究家庭场景中消费者的 ______。\n答案：behaviour\n解析：原文是 ethnographic observation ... examine their behaviour，空格填 behaviour。",
          "questionId": "q10"
        },
        {
          "questionNumber": 11,
          "text": "题目：We organised ______ to find out what images customers associate with our products.\n题目翻译：我们组织了 ______ 来了解顾客把哪些形象与我们产品关联。\n答案：focus groups\n解析：Alex Lee 明确说 “We conducted what are known as focus groups”，答案是 focus groups。",
          "questionId": "q11"
        },
        {
          "questionNumber": 12,
          "text": "题目：Market research can be basic, e.g. by doing ______.\n题目翻译：市场调研可以很基础，例如做 ______。\n答案：simple surveys\n解析：文中给出的例子是 “simple surveys in the lobby of our building”，对应 simple surveys。",
          "questionId": "q12"
        },
        {
          "questionNumber": 13,
          "text": "题目：Company executives should follow their ______.\n题目翻译：公司高管应当遵循自己的 ______。\n答案：instincts\n解析：结尾说最重要信号有时来自 executive's own instincts，答案为 instincts。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 6,
        "end": 13
      },
      "text": "题目 6-13 答案依次为：surface、weight loss、name、container、behaviour、focus groups、simple surveys、instincts。答案均可在两位专家反馈段落中逐句定位。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
