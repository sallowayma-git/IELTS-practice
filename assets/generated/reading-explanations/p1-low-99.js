(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p1-low-99", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p1-low-99",
  "meta": {
    "examId": "p1-low-99",
    "title": "The history of the bar code 条形码的历史",
    "category": "P1",
    "sourceDoc": "188. P1 - The history of the bar code 条形码的历史.pdf",
    "noteType": "翻译+解析",
    "matchedTitle": "The history of the bar code 条形码的历史"
  },
  "passageNotes": [
    {
      "label": "Paragraph 1",
      "text": "条形码的起点可追溯到 1948 年。研究生 Bernard Silver 偶然听到食品连锁负责人请求“自动读取商品信息”研究，教授拒绝后，Silver 把问题告诉朋友 Norman Woodland，两人由此启动探索。"
    },
    {
      "label": "Paragraph 2",
      "text": "两人的第一套方案是“紫外线+会发光的油墨图案”，概念可行但成本高且图案会褪色。随后他们结合摩尔斯电码与电影声轨记录技术，提出线性条码并在 1952 年申请专利。但当时扫描设备不稳定且成本仍高，未能落地。"
    },
    {
      "label": "Paragraph 3",
      "text": "直到 1970 年代激光技术变便宜，扫描系统才快速推进。各行业出现多套私有编码系统，却缺乏统一标准。零售与制造联盟因此建立委员会，推动形成 UPC，并提出“多角度可读、低成本打印、设备短期回本”等设计原则。"
    },
    {
      "label": "Paragraph 4",
      "text": "委员会比较十余种方案后，于 1973 年 4 月统一采用黑白线条+数字的 UPC 方案（基于 Woodland/Silver 思路并由 IBM 的 George Laurer 工程化）。Alan Haberman 把条码称为“全球通用语言”，强调行业协作可在无政府强制下达成共同标准。"
    },
    {
      "label": "Paragraph 5-6",
      "text": "条码革命投入巨大：超市、连锁、打印商和制造商都投入大量资金改造设备与流程。1974 年 6 月 26 日，俄亥俄一家超市扫描售出第一件条码商品（Juicy Fruit 口香糖），标志条码从长期方案变为可运行现实。"
    },
    {
      "label": "Paragraph 7",
      "text": "新系统初期并未立刻被信任，商家与消费者都有疑虑，媒体甚至称其“失败”。但后续收益被验证：结账速度翻倍、排队减少、库存盘点效率大幅提升，劳动力成本下降。"
    },
    {
      "label": "Paragraph 8-9",
      "text": "如今全球每天扫描超 50 亿次条码，应用从零售扩展到航空行李、医院婴儿识别、马拉松赛事和科研追踪（甚至用于蜜蜂）。首个被扫描的口香糖现收藏于史密森学会。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 判断正误（Questions 9–13）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 9,
          "text": "题目：Bernard Silver was invited to develop a system for capturing product information by the president of a food chain.\n题目翻译：Bernard Silver 是被某食品连锁总裁邀请来开发商品信息采集系统的。\n答案：FALSE\n解析：第1段中被直接请求的是一位教授，不是 Silver；Silver 只是旁听并后来把消息转告 Woodland，所以题干错误。",
          "questionId": "q9"
        },
        {
          "questionNumber": 10,
          "text": "题目：A committee set up in the 1970s said bar codes should be easy to use and not too expensive.\n题目翻译：1970 年代成立的委员会认为条码系统应易用且成本不过高。\n答案：TRUE\n解析：第3段列出的指导原则包括“多角度/多距离可读”（易用）和“标签便宜、系统需在两年半回本”（成本可承受），与题干一致。",
          "questionId": "q10"
        },
        {
          "questionNumber": 11,
          "text": "题目：Alan Haberman disagreed with government policies on business matters.\n题目翻译：Alan Haberman 反对政府在商业事务上的政策。\n答案：NOT GIVEN\n解析：第4段只提到他认为企业不需要政府“推动”也能协作完成标准，并未给出他对整体政府商业政策“反对”的明确信息。",
          "questionId": "q11"
        },
        {
          "questionNumber": 12,
          "text": "题目：Many grocery outlets were unable to afford the necessary scanning equipment.\n题目翻译：许多杂货门店无力负担所需扫描设备。\n答案：NOT GIVEN\n解析：第5段说每家门店至少投入 20 万美元，强调投入巨大，但没有说“许多门店负担不起”或“因此无法实施”。",
          "questionId": "q12"
        },
        {
          "questionNumber": 13,
          "text": "题目：The advantages of the new bar code scanner took some time to be accepted by users.\n题目翻译：新条码扫描系统的优势过了一段时间才被用户接受。\n答案：TRUE\n解析：第7段指出初期用户怀疑、媒体唱衰，随后 benefits eventually became apparent，说明优势确实是后来才被普遍认可。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 9,
        "end": 13
      },
      "text": "题目 9-13 答案依次为：FALSE、TRUE、NOT GIVEN、NOT GIVEN、TRUE。判断依据来自第1、3、4、5、7段对事件主体、标准原则与用户接受过程的描述。"
    },
    {
      "sectionTitle": "2. 笔记填空（Questions 1–8）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 1,
          "text": "题目：Used ultraviolet light and a special type of ______.\n题目翻译：该系统使用紫外线和一种特殊的 ______。\n答案：ink\n解析：第2段第一套方案写的是会在紫外线下发光的 ink，答案为 ink。",
          "questionId": "q1"
        },
        {
          "questionNumber": 2,
          "text": "题目：Based on technology used in Morse code and also for the ______ of films.\n题目翻译：该系统借鉴了摩尔斯电码以及电影 ______ 技术。\n答案：soundtracks\n解析：第2段明确说第二套方案结合了电影 soundtracks 记录方式，空格填 soundtracks。",
          "questionId": "q2"
        },
        {
          "questionNumber": 3,
          "text": "题目：Problems: ______ and expensive.\n题目翻译：问题是：______ 且成本高。\n答案：unreliable\n解析：第2段对当时扫描设备的评价是 rather unreliable，同时成本高，因此答案为 unreliable。",
          "questionId": "q3"
        },
        {
          "questionNumber": 4,
          "text": "题目：Availability of cheaper ______ meant scanning technology spread more widely.\n题目翻译：更便宜的 ______ 出现后，扫描技术才更广泛传播。\n答案：lasers\n解析：第3段说进展发生在 1970 年代、原因是 lasers became affordable，答案是 lasers。",
          "questionId": "q4"
        },
        {
          "questionNumber": 5,
          "text": "题目：Problem: lack of ______ in code systems.\n题目翻译：问题：编码系统缺乏 ______。\n答案：standardization\n解析：第3段写各系统各自为政，“there was no standardization”，答案为 standardization。",
          "questionId": "q5"
        },
        {
          "questionNumber": 6,
          "text": "题目：The ______ of checkouts increased.\n题目翻译：收银结账的 ______ 提高了。\n答案：speed\n解析：第7段指出结账速度达到传统设备的两倍，对应 speed。",
          "questionId": "q6"
        },
        {
          "questionNumber": 7,
          "text": "题目：Participants in ______.\n题目翻译：______ 的参与者。\n答案：marathons\n解析：第8段举例条码应用包括 major marathons 的跑者，因此答案为 marathons。",
          "questionId": "q7"
        },
        {
          "questionNumber": 8,
          "text": "题目：Scientists studying ______.\n题目翻译：研究 ______ 的科学家。\n答案：bees\n解析：第8段提到研究人员把微型条码装在 bees 身上追踪运动，答案是 bees。",
          "questionId": "q8"
        }
      ],
      "questionRange": {
        "start": 1,
        "end": 8
      },
      "text": "题目 1-8 答案依次为：ink、soundtracks、unreliable、lasers、standardization、speed、marathons、bees。答案可在第2、3、7、8段直接定位。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
