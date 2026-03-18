(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p2-high-130", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p2-high-130",
  "meta": {
    "examId": "p2-high-130",
    "title": "Investment in shares versus investment in other assets 回报数据分析",
    "category": "P2",
    "sourceDoc": "P2 33-59之_副本.md",
    "noteType": "总结",
    "matchedTitle": "Investment in shares versus investment in other assets 回报数据分析【高】"
  },
  "passageNotes": [
    {
      "label": "Paragraph A",
      "text": "1958 年，美国美林证券银行家路易斯・恩格尔（Louis Engel）致电芝加哥大学商学院院长吉姆・洛里（Jim Lorie），询问股票投资者与低风险资产投资者的收益对比，洛里提出需 5 万美元资金研究，恩格尔同意资助。1960 年，芝加哥大学证券价格研究中心（CRSP）成立，半个世纪后，CRSP 数据广泛应用 —— 据本月研讨会报告，过去 40 年至少 1/3 的金融实证研究以其为基础，可能还影响了更多研究。"
    },
    {
      "label": "Paragraph B",
      "text": "在计算机早期，收集 CRSP 数据困难重重：1926-1960 年纽约证券交易所的 300 万条股票信息需从纸质档案转至磁带，还需耗时调整价格以应对市场复杂情况。洛里与合作者劳伦斯・费希尔（Lawrence Fisher）选择 1926 年为起始年，因希望数据覆盖至少一个完整经济周期（繁荣至萧条或反之）。"
    },
    {
      "label": "Paragraph C",
      "text": "1964 年，两人发表首篇基于 CRSP 数据的研究，指出 35 年间股票年复合回报率（因投资者纳税状态不同）在 6.8%-9% 之间。尽管缺乏其他资产的完整数据，但研究声称股票回报率 “显著高于其他投资方式”，首次为 “长期股票收益优于其他资产” 的流行观点提供实证支持。他们还发现，许多人因谨慎天性和担忧股市风险，选择低收益资产，经济学家将 “投资者为承担风险所需的额外收益” 称为 “股权风险溢价”，但对其合理规模仍有分歧。"
    },
    {
      "label": "Paragraph D",
      "text": "1964 年报告后，金融经济学家对 CRSP 数据的研究热情高涨。1974 年，诺贝尔奖得主迈伦・斯科尔斯（Myron Scholes）出任 CRSP 主任，确保数据库实时更新并向学界开放。随着计算成本降低，CRSP 数据实用性增强，此后数据库扩展至全类型投资，且在全球范围内推广。"
    },
    {
      "label": "Paragraph E",
      "text": "CRSP 数据的早期应用之一是支持芝加哥大学经济学家尤金・法玛（Eugene Fama）的 “有效市场假说”：长期来看股价随机波动无规律，因所有相关信息已反映在股价中，聪明投资者无法预测股价获利。但法玛也承认股价存在短期可预测性，这一观点引发大量基于数据挖掘寻找 “异常规律” 的研究 —— 理论上这些规律可获利，但有效市场理论支持者发现，规律一旦被发表就会消失。"
    },
    {
      "label": "Paragraph F",
      "text": "然而，数据量过大导致金融经济学家日益专业化，这既有利也有弊。部分学者担忧，大量统计分析掩盖了对 “2008 年金融危机成因及防范” 等重大问题的深度思考。耶鲁大学经济学家罗伯特・席勒（Robert Shiller）长期质疑有效市场假说，认为 CRSP 数据库让经济学家误以为金融研究已科学化，传统投资与市场脆弱性的观点被视为过时。他担忧学者因过度专注数据分析而忽略全局，主张 “回归历史、研究制度法律” 才能预见危机。"
    },
    {
      "label": "Paragraph G",
      "text": "斯科尔斯回应批评时指出，实证分析需求持续增长证明其价值。CRSP 成立 50 周年研讨会上，官方公布计划：扩大投资指标范围（含成长股与价值股），声称新指标学术性更强且成本更低。对有效市场支持者而言，这足以确保 CRSP 持续成功。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 段落标题匹配（Questions 14–20：Choose the correct heading）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 14,
          "text": "（1）题目 14：Paragraph A\n答案：iii（A request and a far-reaching result，一个请求与深远影响）\n解析：Paragraph A 从 “恩格尔的咨询请求” 讲起，到 CRSP 成立及数据的广泛影响，核心是 “请求与结果”，与标题 iii 一致，因此选 iii。",
          "questionId": "q14"
        },
        {
          "questionNumber": 15,
          "text": "（2）题目 15：Paragraph B\n答案：iv（Difficulties in collecting CRSP data，收集 CRSP 数据的困难）\n解析：Paragraph B 描述 “数据转磁带、价格调整、周期选择” 等收集难点，核心是 “数据收集困难”，与标题 iv 一致，因此选 iv。",
          "questionId": "q15"
        },
        {
          "questionNumber": 16,
          "text": "（3）题目 16：Paragraph C\n答案：ii（Initial findings of the CRSP project，CRSP 项目的初步发现）\n解析：Paragraph C 呈现首篇研究的 “股票回报率、风险溢价” 等结论，核心是 “初步发现”，与标题 ii 一致，因此选 ii。",
          "questionId": "q16"
        },
        {
          "questionNumber": 17,
          "text": "（4）题目 17：Paragraph D\n答案：i（Technological developments improve CRSP data，技术发展改善 CRSP 数据）\n解析：Paragraph D 强调 “计算成本降低、数据库更新扩容”，核心是 “技术提升数据实用性”，与标题 i 一致，因此选 i。",
          "questionId": "q17"
        },
        {
          "questionNumber": 18,
          "text": "（5）题目 18：Paragraph E\n答案：viii（CRSP data not always being a useful basis for investment，CRSP 数据并非总是可靠的投资依据）\n解析：Paragraph E 指出 “短期规律易消失，无法长期指导投资”，核心是 “数据的局限性”，与标题 viii 一致，因此选 viii。",
          "questionId": "q18"
        },
        {
          "questionNumber": 19,
          "text": "（6）题目 19：Paragraph F\n答案：vi（Too much data for people to have an overall understanding，数据过多导致无法把握全局）\n解析：Paragraph F 批评 “数据量过大让学者忽略整体问题”，核心是 “数据过载的弊端”，与标题 vi 一致，因此选 vi。",
          "questionId": "q19"
        },
        {
          "questionNumber": 20,
          "text": "（7）题目 20：Paragraph G\n答案：v（What the future holds，未来展望）\n解析：Paragraph G 公布 CRSP“扩大指标、降低成本” 的未来计划，核心是 “未来前景”，与标题 v 一致，因此选 v。",
          "questionId": "q20"
        }
      ],
      "questionRange": {
        "start": 14,
        "end": 20
      },
      "text": "答案：iii（A request and a far-reaching result，一个请求与深远影响）\n解析：Paragraph A 从 “恩格尔的咨询请求” 讲起，到 CRSP 成立及数据的广泛影响，核心是 “请求与结果”，与标题 iii 一致，因此选 iii。\n答案：iv（Difficulties in collecting CRSP data，收集 CRSP 数据的困难）\n解析：Paragraph B 描述 “数据转磁带、价格调整、周期选择” 等收集难点，核心是 “数据收集困难”，与标题 iv 一致，因此选 iv。\n答案：ii（Initial findings of the CRSP project，CRSP 项目的初步发现）\n解析：Paragraph C 呈现首篇研究的 “股票回报率、风险溢价” 等结论，核心是 “初步发现”，与标题 ii 一致，因此选 ii。\n答案：i（Technological developments improve CRSP data，技术发展改善 CRSP 数据）\n解析：Paragraph D 强调 “计算成本降低、数据库更新扩容”，核心是 “技术提升数据实用性”，与标题 i 一致，因此选 i。\n答案：viii（CRSP data not always being a useful basis for investment，CRSP 数据并非总是可靠的投资依据）\n解析：Paragraph E 指出 “短期规律易消失，无法长期指导投资”，核心是 “数据的局限性”，与标题 viii 一致，因此选 viii。\n答案：vi（Too much data for people to have an overall understanding，数据过多导致无法把握全局）\n解析：Paragraph F 批评 “数据量过大让学者忽略整体问题”，核心是 “数据过载的弊端”，与标题 vi 一致，因此选 vi。\n答案：v（What the future holds，未来展望）\n解析：Paragraph G 公布 CRSP“扩大指标、降低成本” 的未来计划，核心是 “未来前景”，与标题 v 一致，因此选 v。"
    },
    {
      "sectionTitle": "2. 经济学家 - 观点匹配（Questions 21–23：Match each statement with the correct economist）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 21,
          "text": "（1）题目 21：A traditional approach may have helped predict a financial downturn.（传统方法或有助于预测金融危机）\n答案：D（Robert Shiller，罗伯特・席勒）\n解析：定位 Paragraph F 中 “Robert Shiller... to have seen the 2008 global financial crisis coming, it would have been better to ‘go back to old-fashioned readings of history, studying institutions and laws’”，明确提到席勒主张传统方法可预测危机，因此选 D。",
          "questionId": "q21"
        },
        {
          "questionNumber": 22,
          "text": "（2）题目 22：Some people invest conservatively and as a result make less money.（部分人因保守投资而收益更低）\n答案：A（Fisher and Lorie，费希尔与洛里）\n解析：定位 Paragraph C 中 “Fisher and Lorie also observed that many people chose to invest in assets with lower returns because they were cautious by nature and were concerned about the risk of loss inherent in investing in the stock market”，明确提到两人发现保守投资导致低收益，因此选 A。",
          "questionId": "q22"
        },
        {
          "questionNumber": 23,
          "text": "（3）题目 23：It may be possible to forecast share prices but not over the long term.（股价可能短期可预测，但长期不能）\n答案：C（Eugene Fama，尤金・法玛）\n解析：定位 Paragraph E 中 “Fama did concede that there was some evidence of temporary short-term predictability in share prices, however. That stipulation has resulted in a vast number of papers based on discovering such ‘variations’ through data mining”，明确提到法玛认可短期可预测性，因此选 C。",
          "questionId": "q23"
        }
      ],
      "questionRange": {
        "start": 21,
        "end": 23
      },
      "text": "答案：D（Robert Shiller，罗伯特・席勒）\n解析：定位 Paragraph F 中 “Robert Shiller... to have seen the 2008 global financial crisis coming, it would have been better to ‘go back to old-fashioned readings of history, studying institutions and laws’”，明确提到席勒主张传统方法可预测危机，因此选 D。\n答案：A（Fisher and Lorie，费希尔与洛里）\n解析：定位 Paragraph C 中 “Fisher and Lorie also observed that many people chose to invest in assets with lower returns because they were cautious by nature and were concerned about the risk of loss inherent in investing in the stock market”，明确提到两人发现保守投资导致低收益，因此选 A。\n答案：C（Eugene Fama，尤金・法玛）\n解析：定位 Paragraph E 中 “Fama did concede that there was some evidence of temporary short-term predictability in share prices, however. That stipulation has resulted in a vast number of papers based on discovering such ‘variations’ through data mining”，明确提到法玛认可短期可预测性，因此选 C。"
    },
    {
      "sectionTitle": "3. 摘要填空（Questions 24–26：ONE WORD ONLY）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 24,
          "text": "（1）题目 24：In 1958 a \\___\\___\\__ working for a financial management company telephoned Jim Lorie...\n题目翻译：1958 年，一名在金融管理公司工作的_\\___\\___\\_致电吉姆・洛里……\n答案：banker（银行家）\n解析：定位 Paragraph A 中 “Louis Engel, a banker at Merrill Lynch, a US-based financial management company, who wanted to know how investors in shares had performed”，明确提到致电者是 “banker”，因此答案为 “banker”。",
          "questionId": "q24"
        },
        {
          "questionNumber": 25,
          "text": "（2）题目 25：Compiling the CRSP data was difficult because \\___\\___\\__ were still being developed...\n题目翻译：收集 CRSP 数据困难，因为_\\___\\___\\_仍在发展阶段……\n答案：computers（计算机）\n解析：定位 Paragraph B 中 “Getting the CRSP data together was a tough process in what were then the early days of computers”，明确提到 “计算机早期发展” 是困难原因，因此答案为 “computers”。",
          "questionId": "q25"
        },
        {
          "questionNumber": 26,
          "text": "（3）题目 26：...information that had previously been on \\___\\___\\__ needed to be put onto magnetic tape.\n题目翻译：…… 此前存储在_\\___\\___\\_上的信息需转至磁带。\n答案：paper（纸张）\n解析：定位 Paragraph B 中 “Up to three million pieces of information... were transferred from paper in the exchange’s archive to magnetic tape”，明确提到信息原存储在 “paper” 上，因此答案为 “paper”。",
          "questionId": "q26"
        }
      ],
      "questionRange": {
        "start": 24,
        "end": 26
      },
      "text": "题目翻译：1958 年，一名在金融管理公司工作的_\\___\\___\\_致电吉姆・洛里……\n答案：banker（银行家）\n解析：定位 Paragraph A 中 “Louis Engel, a banker at Merrill Lynch, a US-based financial management company, who wanted to know how investors in shares had performed”，明确提到致电者是 “banker”，因此答案为 “banker”。\n题目翻译：收集 CRSP 数据困难，因为_\\___\\___\\_仍在发展阶段……\n答案：computers（计算机）\n解析：定位 Paragraph B 中 “Getting the CRSP data together was a tough process in what were then the early days of computers”，明确提到 “计算机早期发展” 是困难原因，因此答案为 “computers”。\n题目翻译：…… 此前存储在_\\___\\___\\_上的信息需转至磁带。\n答案：paper（纸张）\n解析：定位 Paragraph B 中 “Up to three million pieces of information... were transferred from paper in the exchange’s archive to magnetic tape”，明确提到信息原存储在 “paper” 上，因此答案为 “paper”。"
    }
  ]
}
  );
})(typeof window !== "undefined" ? window : globalThis);
