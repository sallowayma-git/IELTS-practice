(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p1-medium-20", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p1-medium-20",
  "meta": {
    "examId": "p1-medium-20",
    "title": "The Development of Plastics 塑料的发展史",
    "category": "P1",
    "sourceDoc": "116. P1 - The Development of Plastics 塑料的发展史【次】.pdf",
    "noteType": "翻译+解析",
    "matchedTitle": "The Development of Plastics 塑料的发展史"
  },
  "passageNotes": [
    {
      "label": "Paragraph 1",
      "text": "19世纪橡胶在欧洲实现商业化后，迅速成为运输和电气领域的重要材料。进入20世纪，化学工业通过“聚合”原理开发出大量塑料，逐步在多数应用中取代天然橡胶。文章先用橡胶解释聚合物概念，再引出塑料体系的发展。"
    },
    {
      "label": "Paragraph 2",
      "text": "第一种塑料来自美国一场“象牙替代材料”竞赛。John Wesley Hyatt 用赛璐珞（celluloid）赢得奖金。赛璐珞由植物来源纤维素与樟脑溶液制成，随后用于刀柄、眼镜框、可拆领口等产品，其中最关键的用途是摄影胶片；文中强调没有赛璐珞，19世纪末电影业很难起飞。"
    },
    {
      "label": "Paragraph 3",
      "text": "赛璐珞属于热塑性材料，可反复受热软化和重塑。1907年，Leo Baekeland 发明酚醛树脂（Bakelite），它是首批热固性塑料代表：可在高温时铸模，但固化后不能再加热重塑。其耐水、耐酸并具绝缘性，因此被广泛用于开关、家居把手和汽车电气部件。"
    },
    {
      "label": "Paragraph 4",
      "text": "20世纪30年代，英国化学家发现乙烯在热压下可聚合成聚乙烯；50年代又有聚丙烯。乙烯结构微调可得到PVC：硬质PVC耐火，适合排水系统；加助剂后可变软，能替代部分橡胶用品。同类材料PTFE（特氟龙）摩擦系数低，适合轴承与不粘锅。德国在30年代开发聚苯乙烯（透明似玻璃），并发展出硬质发泡聚苯乙烯用于包装与保温。"
    },
    {
      "label": "Paragraph 5",
      "text": "聚氨酯也在德国发展起来，可用于粘合剂、涂层及硬泡保温材料。文章还介绍了20世纪30年代的人造纤维尼龙：由杜邦化学家 Wallace Carothers 开发，最初用于二战降落伞，战后迅速替代丝袜中的真丝。随后出现更多合成纤维，与棉、毛混纺后提升耐用与易护理性。"
    },
    {
      "label": "Paragraph 6",
      "text": "塑料“难降解”既是强项也是环境负担。海滩长期堆积塑料瓶，分类回收又因混合材质而复杂。文中给出两类改性方向：加入淀粉让材料受细菌作用后分解；或加入光降解组分使其在阳光下逐步衰减。后者也带来储存要求，例如相关塑料瓶在使用前需避光保存。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 表格填空（Questions 1–7）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 1,
          "text": "题目：Celluloid — Common use: ______\n题目翻译：赛璐珞——常见用途：______\n答案：photographic film\n解析：第二段明确指出赛璐珞最著名用途是摄影胶片，并强调其对早期电影业的重要性。", 
          "questionId": "q1"
        },
        {
          "questionNumber": 2,
          "text": "题目：Name of plastic invented in 1907 in the US: ______\n题目翻译：1907年在美国发明的塑料名称：______\n答案：Bakelite\n解析：第三段写明 Leo Baekeland 于1907年发明并命名该材料为 Bakelite。",
          "questionId": "q2"
        },
        {
          "questionNumber": 3,
          "text": "题目：Bakelite — Common use: ______, household items and car parts\n题目翻译：酚醛树脂——常见用途：______、家居用品和汽车部件\n答案：switches\n解析：第三段列举其用途时首先提到开关（switches），与表格空格对应。",
          "questionId": "q3"
        },
        {
          "questionNumber": 4,
          "text": "题目：Polythene — Original region: ______\n题目翻译：聚乙烯——最初发现地区：______\n答案：British\n解析：第四段写“British chemists discovered ... polythene”，对应地区信息为英国（British）。",
          "questionId": "q4"
        },
        {
          "questionNumber": 5,
          "text": "题目：Rigid PVC — Property: ______\n题目翻译：硬质PVC——性质：______\n答案：fireproof\n解析：第四段直接描述硬质PVC是“a hard, fireproof plastic suitable for drains and gutters”。",
          "questionId": "q5"
        },
        {
          "questionNumber": 6,
          "text": "题目：Polystyrene — Property: ______\n题目翻译：聚苯乙烯——性质：______\n答案：clear and glass-like\n解析：第四段将聚苯乙烯定义为“a clear, glass-like material”，与空格精确对应。",
          "questionId": "q6"
        },
        {
          "questionNumber": 7,
          "text": "题目：Polyurethanes — Property: ______ foams\n题目翻译：聚氨酯——性质：______ 泡沫\n答案：rigid\n解析：第四段后半部分指出聚氨酯可制成“rigid foams”用于保温，答案是 rigid。",
          "questionId": "q7"
        }
      ],
      "questionRange": {
        "start": 1,
        "end": 7
      },
      "text": "题目1答案photographic film：赛璐珞关键应用是摄影胶片。\n题目2答案Bakelite：1907年贝克兰发明并命名。\n题目3答案switches：酚醛树脂典型用途之一。\n题目4答案British：聚乙烯由英国化学家发现。\n题目5答案fireproof：硬质PVC的核心特性。\n题目6答案clear and glass-like：聚苯乙烯外观特征。\n题目7答案rigid：聚氨酯可形成rigid foams。"
    },
    {
      "sectionTitle": "2. 判断正误（Questions 8–13）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 8,
          "text": "题目：The chemical structure of plastic is very different from that of rubber.\n题目翻译：塑料的化学结构与橡胶截然不同。\n答案：FALSE\n解析：第一段把橡胶和塑料都放在聚合物框架下，强调“same bonding principle—polymerization”支撑塑料制造，不是“截然不同”。",
          "questionId": "q8"
        },
        {
          "questionNumber": 9,
          "text": "题目：John Wesley was a famous chemist.\n题目翻译：约翰·韦斯利是一位著名化学家。\n答案：NOT GIVEN\n解析：文中仅说明 John Wesley Hyatt 赢得竞赛并开发赛璐珞，没有评价其“著名化学家”身份。",
          "questionId": "q9"
        },
        {
          "questionNumber": 10,
          "text": "题目：Celluloid and Bakelite react to heat in the same way.\n题目翻译：赛璐珞和酚醛树脂对热的反应方式相同。\n答案：FALSE\n解析：赛璐珞是热塑性，可反复受热重塑；酚醛树脂是热固性，固化后不能再软化，反应方式不同。",
          "questionId": "q10"
        },
        {
          "questionNumber": 11,
          "text": "题目：The mix of different varieties of plastic can make recycling more difficult.\n题目翻译：不同塑料类型混用会使回收更困难。\n答案：TRUE\n解析：第六段明确说同一制品常混有不同塑料、处理方法不同，这正是回收难点。",
          "questionId": "q11"
        },
        {
          "questionNumber": 12,
          "text": "题目：Adding starch to plastic can make plastic more durable.\n题目翻译：在塑料中加入淀粉会让塑料更耐久。\n答案：FALSE\n解析：第六段指出加入淀粉后塑料会在细菌作用下分解，更易降解而非更耐久。",
          "questionId": "q12"
        },
        {
          "questionNumber": 13,
          "text": "题目：Some plastic containers have to be preserved in special conditions.\n题目翻译：某些塑料容器需要在特殊条件下保存。\n答案：TRUE\n解析：文末提到含光降解组分的瓶子必须避光储存，否则会在使用前提前分解。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 8,
        "end": 13
      },
      "text": "题目8答案FALSE：橡胶与塑料同属聚合原理体系。\n题目9答案NOT GIVEN：文中未给出“著名化学家”评价。\n题目10答案FALSE：热塑性与热固性对热响应相反。\n题目11答案TRUE：混合材质确实提高回收难度。\n题目12答案FALSE：加淀粉是为加速降解。\n题目13答案TRUE：部分容器需要避光等特殊存放条件。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
