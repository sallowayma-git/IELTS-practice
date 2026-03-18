(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p3-low-158", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p3-low-158",
  "meta": {
    "examId": "p3-low-158",
    "title": "Game theory 博弈论",
    "category": "P3",
    "sourceDoc": "P3 解析+1202高频_副本.md",
    "noteType": "总结",
    "matchedTitle": "Game theory 博弈论"
  },
  "passageNotes": [
    {
      "label": "Paragraph 1",
      "text": "博弈论认为，谈判成功概率取决于他人选择。计算机模型通过量化参与者目标、动机和影响力，考量可能选项，评估参与者影响他人的能力，进而预测事件走向。"
    },
    {
      "label": "Paragraph 2",
      "text": "尽管有人不愿让计算机做决策，但许多组织为律所、企业和政府运行这类模拟。然而，政治议题中，向软件输入准确参与者数据尤为困难 —— 荷兰 Decide 公司的赖尼尔・范奥斯特（Reinier van Oosten）指出，当人们意外受 “仇恨” 等非理性情绪驱动（而非追求明显利益）时，预测可能不可靠。但以盈利为主要目标时，梳理动机更简单，因此博弈论模型在经济学中应用效果显著。"
    },
    {
      "label": "Paragraph 3",
      "text": "博弈论软件模拟拍卖利润丰厚，咨询公司协助客户设计盈利拍卖或低价中标。2006 年，美国联邦通信委员会在线拍卖无线电频谱牌照前，斯坦福大学教授保罗・米尔格罗姆（Paul Milgrom）定制软件协助竞标联盟。起初他担忧，但结果显著：软件追踪竞争对手出价，估算 1132 个牌照的预算，发现部分大牌照被高估，指导客户转而购买多个小牌照。两位客户花费比竞争对手少约 1/3，节省近 12 亿美元。这让人疑问：为何不普遍使用？若普遍使用，会如何影响博弈？"
    },
    {
      "label": "Paragraph 4",
      "text": "英国 PA 咨询公司基于博弈论设计模型，解决制药、电视制作等领域问题。英国政府委托其测试 “区域内特定企业数量管控规则”，如：两名冰淇淋卖家共享长海滩，会背对背设在中部（阻止对方移动，牺牲两端顾客）；加入第三名卖家后，僵局打破，市场活跃。通过研究这类连锁反应，软件设计者评估变化影响，帮助客户决策时考量未来影响。"
    },
    {
      "label": "Paragraph 5",
      "text": "博弈论软件发展方向包括 “谈判调解辅助工具”。20 年前，西班牙学者克拉拉・庞萨蒂（Clara Ponsatí）提出：谈判中，先透露最高支付意愿者会失去议价权；但双方均不妥协会导致谈判停滞。中立调解人（掌握双方底线）可推动谈判，若调解人不可信、昂贵或不可得，计算机可替代。谈判方每轮后向软件更新机密议价立场，当双方立场不再互斥时，软件提出折中方案。现为巴塞罗那自治大学经济分析研究所所长的庞萨蒂认为，“调解机器” 可通过解锁对手隐瞒信息推动谈判。"
    },
    {
      "label": "Paragraph 6",
      "text": "博弈论调解软件能否从拍卖、定价扩展至政治军事争端？目前软件尚不足以调解交战国，但未来战争边缘的对手可能用其交换信息避免冲突。部分博弈论学者认为，对手可通过软件预测战争结果，直接达成协议。虽可能过于乐观，但博弈论学者在预测未来方面 track record 令人印象深刻。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 单选题（Questions 27–31：Choose A–D）",
      "mode": "per_question",
      "items": [
        {
          "questionNumber": 27,
          "text": "（1）题目 27：What does the writer suggest about game-theory software in the first paragraph?（作者在第一段中对博弈论软件有何暗示？）\n答案：C（This software anticipates the outcome of future events. 该软件可预测未来事件结果）\n解析：定位 Paragraph 1 中 “Game-theory software then evaluates the ability of each of those players to influence others, and hence predicts the course of events”，“predicts the course of events” 对应 “anticipates the outcome of future events”，因此选 C。",
          "questionId": "q27"
        },
        {
          "questionNumber": 28,
          "text": "（2）题目 28：Reinier van Oosten says predicting what people will do works best if（赖尼尔・范奥斯特认为，在何种情况下预测人类行为最准确？）\n答案：D（profit is the primary motivator. 利润是主要动机）\n解析：定位 Paragraph 2 中 “However, sorting out people’s motivations is much easier when making money is the main object”，“making money is the main object” 对应 “profit is the primary motivator”，因此选 D。",
          "questionId": "q28"
        },
        {
          "questionNumber": 29,
          "text": "（3）题目 29：After using game-theory software in 2006, Dr Milgrom instructed his clients to（2006 年使用博弈论软件后，米尔格罗姆博士指导客户如何做？）\n答案：D（purchase a mix of licences. 购买多种牌照）\n解析：定位 Paragraph 3 中 “Milgrom’s clients were then directed to obtain a collection of smaller, less-expensive licences instead”，“a collection of smaller licences” 对应 “a mix of licences”，因此选 D。",
          "questionId": "q29"
        },
        {
          "questionNumber": 30,
          "text": "（4）题目 30：The writer refers to Stephen Black’s ice-cream-seller example in order to（作者提及斯蒂芬・布莱克的冰淇淋卖家案例，目的是什么？）\n答案：A（show the impact new competitors have on business. 展示新竞争者对企业的影响）\n解析：定位 Paragraph 4 中 “Introduce a third seller, however, and the stifling equilibrium is broken as relocations and pricing changes energise the market”，案例核心是 “新竞争者打破僵局”，因此选 A。",
          "questionId": "q30"
        },
        {
          "questionNumber": 31,
          "text": "（5）题目 31：Ponsatí believes business negotiations are more likely to progress if（庞萨蒂认为，在何种情况下商业谈判更可能推进？）\n答案：B（mediators or computers take over the bargaining process. 调解人或计算机接管谈判流程）\n解析：定位 Paragraph 5 中 “difficult negotiations can often be pushed along by neutral mediators... if a human mediator was not trusted, affordable, or available, a computer could do the job instead”，明确提到 “调解人或计算机推动谈判”，因此选 B。",
          "questionId": "q31"
        }
      ],
      "questionRange": {
        "start": 27,
        "end": 31
      },
      "text": "答案：C（This software anticipates the outcome of future events. 该软件可预测未来事件结果）\n解析：定位 Paragraph 1 中 “Game-theory software then evaluates the ability of each of those players to influence others, and hence predicts the course of events”，“predicts the course of events” 对应 “anticipates the outcome of future events”，因此选 C。\n答案：D（profit is the primary motivator. 利润是主要动机）\n解析：定位 Paragraph 2 中 “However, sorting out people’s motivations is much easier when making money is the main object”，“making money is the main object” 对应 “profit is the primary motivator”，因此选 D。\n答案：D（purchase a mix of licences. 购买多种牌照）\n解析：定位 Paragraph 3 中 “Milgrom’s clients were then directed to obtain a collection of smaller, less-expensive licences instead”，“a collection of smaller licences” 对应 “a mix of licences”，因此选 D。\n答案：A（show the impact new competitors have on business. 展示新竞争者对企业的影响）\n解析：定位 Paragraph 4 中 “Introduce a third seller, however, and the stifling equilibrium is broken as relocations and pricing changes energise the market”，案例核心是 “新竞争者打破僵局”，因此选 A。\n答案：B（mediators or computers take over the bargaining process. 调解人或计算机接管谈判流程）\n解析：定位 Paragraph 5 中 “difficult negotiations can often be pushed along by neutral mediators... if a human mediator was not trusted, affordable, or available, a computer could do the job instead”，明确提到 “调解人或计算机推动谈判”，因此选 B。"
    },
    {
      "sectionTitle": "2. 判断题（Questions 32–35：YES/NO/NOT GIVEN）",
      "mode": "per_question",
      "items": [
        {
          "questionNumber": 32,
          "text": "（1）题目 32：Game-theory software may be unhelpful when dealing with political issues.（博弈论软件处理政治议题时可能无效）\n答案：YES（正确）\n解析：定位 Paragraph 2 中 “feeding software with accurate data on all the players involved is especially tricky for political matters... predictions may become unreliable when people unexpectedly give in to ‘non-rational emotions’”，“tricky”“unreliable” 对应 “may be unhelpful”，与题干描述一致，因此判定为 YES。",
          "questionId": "q32"
        },
        {
          "questionNumber": 33,
          "text": "（2）题目 33：Dr Milgrom was confident about applying his software to an auction in 2006.（米尔格罗姆博士 2006 年对将软件应用于拍卖充满信心）\n答案：NO（错误）\n解析：定位 Paragraph 3 中 “He was apprehensive at first, but the result was a triumph”，“apprehensive”（担忧）与题干 “confident”（自信）描述矛盾，因此判定为 NO。",
          "questionId": "q33"
        },
        {
          "questionNumber": 34,
          "text": "（3）题目 34：Dr Ponsatí believes ‘mediation machines’ are an inappropriate method of negotiation in areas other than business.（庞萨蒂博士认为 “调解机器” 在商业以外领域不适用）\n答案：NOT GIVEN（未提及）\n解析：Paragraph 5 仅提到 “调解机器可推动谈判”，未讨论 “商业以外领域是否适用”，无相关信息，因此判定为 NOT GIVEN。",
          "questionId": "q34"
        },
        {
          "questionNumber": 35,
          "text": "（4）题目 35：Military organisations refuse to accept that software based on game theory could prevent wars.（军方拒绝承认博弈论软件可预防战争）\n答案：NOT GIVEN（未提及）\n解析：Paragraph 6 提到 “学者设想软件可避免战争”，但未提及 “军方拒绝承认”，无相关信息，因此判定为 NOT GIVEN。",
          "questionId": "q35"
        }
      ],
      "questionRange": {
        "start": 32,
        "end": 35
      },
      "text": "答案：YES（正确）\n解析：定位 Paragraph 2 中 “feeding software with accurate data on all the players involved is especially tricky for political matters... predictions may become unreliable when people unexpectedly give in to ‘non-rational emotions’”，“tricky”“unreliable” 对应 “may be unhelpful”，与题干描述一致，因此判定为 YES。\n答案：NO（错误）\n解析：定位 Paragraph 3 中 “He was apprehensive at first, but the result was a triumph”，“apprehensive”（担忧）与题干 “confident”（自信）描述矛盾，因此判定为 NO。\n答案：NOT GIVEN（未提及）\n解析：Paragraph 5 仅提到 “调解机器可推动谈判”，未讨论 “商业以外领域是否适用”，无相关信息，因此判定为 NOT GIVEN。\n答案：NOT GIVEN（未提及）\n解析：Paragraph 6 提到 “学者设想软件可避免战争”，但未提及 “军方拒绝承认”，无相关信息，因此判定为 NOT GIVEN。"
    },
    {
      "sectionTitle": "3. 句子配对（Questions 36–40：Choose A–F）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 36,
          "text": "（1）题目 36：According to Reinier van Oosten, game-theory software fails when（根据赖尼尔・范奥斯特的观点，博弈论软件在何种情况下失效？）\n答案：E（people allow their feelings to influence decisions. 人们让情感影响决策时）\n解析：定位 Paragraph 2 中 “predictions may become unreliable when people unexpectedly give in to ‘non-rational emotions’, such as hatred, rather than pursuing what is apparently in their best interests”，“non-rational emotions” 对应 “feelings influence decisions”，因此选 E。",
          "questionId": "q36"
        },
        {
          "questionNumber": 37,
          "text": "（2）题目 37：Dr Milgrom’s software is successful in detecting if（米尔格罗姆博士的软件能成功探测什么情况？）\n答案：A（something is thought to be worth more than it really is. 某物被高估时）\n解析：定位 Paragraph 3 中 “the software estimated the secret values bidders placed on specific licences, and determined that certain big licences were being over-valued”，“over-valued” 对应 “thought to be worth more than it really is”，因此选 A。",
          "questionId": "q37"
        },
        {
          "questionNumber": 38,
          "text": "（3）题目 38：Dr Black’s game-theory software is a helpful tool when（布莱克博士的博弈论软件在何种情况下是有用工具？）\n答案：D（businesses consider possible future developments. 企业考量未来可能发展时）\n解析：定位 Paragraph 4 中 “the use of modelling makes clients more inclined to look at future repercussions when making business decisions”，“look at future repercussions” 对应 “consider possible future developments”，因此选 D。",
          "questionId": "q38"
        },
        {
          "questionNumber": 39,
          "text": "（4）题目 39：According to Dr Ponsatí, negotiators fall behind if（根据庞萨蒂博士的观点，谈判者在何种情况下会落后？）\n答案：C（too much information is given to the other parties early on. 过早向对方透露过多信息时）\n解析：定位 Paragraph 5 中 “the first side to disclose the maximum amount that it is willing to pay loses considerable bargaining power. Without leverage, it can be pushed backward in the bargaining process”，“disclose the maximum amount early on” 对应 “too much information is given early on”，因此选 C。",
          "questionId": "q39"
        },
        {
          "questionNumber": 40,
          "text": "（5）题目 40：Dr Ponsatí’s mediation machine is useful when（庞萨蒂博士的调解机器在何种情况下有用？）\n答案：B（discussions between the parties begin to break down. 双方讨论陷入僵局时）\n解析：定位 Paragraph 5 中 “if neither side reveals the concessions it is prepared to make, negotiations can become very slow or collapse... difficult negotiations can often be pushed along by neutral mediators... a computer could do the job instead”，“become very slow or collapse” 对应 “begin to break down”，因此选 B。",
          "questionId": "q40"
        }
      ],
      "questionRange": {
        "start": 36,
        "end": 40
      },
      "text": "答案：E（people allow their feelings to influence decisions. 人们让情感影响决策时）\n解析：定位 Paragraph 2 中 “predictions may become unreliable when people unexpectedly give in to ‘non-rational emotions’, such as hatred, rather than pursuing what is apparently in their best interests”，“non-rational emotions” 对应 “feelings influence decisions”，因此选 E。\n答案：A（something is thought to be worth more than it really is. 某物被高估时）\n解析：定位 Paragraph 3 中 “the software estimated the secret values bidders placed on specific licences, and determined that certain big licences were being over-valued”，“over-valued” 对应 “thought to be worth more than it really is”，因此选 A。\n答案：D（businesses consider possible future developments. 企业考量未来可能发展时）\n解析：定位 Paragraph 4 中 “the use of modelling makes clients more inclined to look at future repercussions when making business decisions”，“look at future repercussions” 对应 “consider possible future developments”，因此选 D。\n答案：C（too much information is given to the other parties early on. 过早向对方透露过多信息时）\n解析：定位 Paragraph 5 中 “the first side to disclose the maximum amount that it is willing to pay loses considerable bargaining power. Without leverage, it can be pushed backward in the bargaining process”，“disclose the maximum amount early on” 对应 “too much information is given early on”，因此选 C。\n答案：B（discussions between the parties begin to break down. 双方讨论陷入僵局时）\n解析：定位 Paragraph 5 中 “if neither side reveals the concessions it is prepared to make, negotiations can become very slow or collapse... difficult negotiations can often be pushed along by neutral mediators... a computer could do the job instead”，“become very slow or collapse” 对应 “begin to break down”，因此选 B。"
    }
  ]
}
  );
})(typeof window !== "undefined" ? window : globalThis);
