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
    "sourceDoc": "116. P1 - The Development of Plastics 塑料的发展史.pdf",
    "noteType": "翻译+解析",
    "matchedTitle": "The Development of Plastics 塑料的发展史"
  },
  "passageNotes": [
    {
      "label": "Paragraph 1",
      "text": "新版 PDF 直接说第一批塑料是作为天然橡胶替代品开发的。橡胶本身是聚合物，许多小单元反复连接成大分子；同一种聚合原则也是化学工业制造大量塑料的基础。"
    },
    {
      "label": "Paragraph 2",
      "text": "第一种塑料源自美国一场替代象牙台球材料的竞赛。John Wesley Hyatt 用 celluloid 获胜。新版 PDF 说 celluloid 来自植物纤维素、樟脑和乙醇溶液，随后用于刀柄、可拆领口和袖口等日用品；最著名产品是 photographic film。"
    },
    {
      "label": "Paragraph 3",
      "text": "Celluloid 可被反复加热软化并重塑，是 thermoplastic。1907 年，Leo Baekeland 在美国发明 Bakelite；它属于 thermosets，可热铸模，但定型后不能再被热软化。新版 PDF 强调 Bakelite 是良好绝缘体，耐水耐酸，用于 electrical switches 和各种家用品。"
    },
    {
      "label": "Paragraph 4",
      "text": "随着塑料种类增加，英国化学家在 1930 年代发现乙烯可聚合成 polythene；1950 年代出现 polypropylene，两者都用于瓶子、管道和塑料袋。改变化学起始材料得到 rigid PVC，它是 fireproof，适合排水沟槽；soft PVC 可用于 waterproof clothing；Teflon/PTFE 摩擦很小，适合不粘锅。"
    },
    {
      "label": "Paragraph 5",
      "text": "Polystyrene 在 1930 年代于德国开发，是硬质、透明、像玻璃的材料，用于 food containers 和 toys。Expanded polystyrene 是 rigid，用于包装和保温。Polyurethane 同样在德国开发，通常制成 foam，用于 insulating materials。新版 PDF 随后介绍 nylon：Wallace Carothers 在杜邦工作，尼龙先用于二战降落伞，战后取代丝袜中的丝。"
    },
    {
      "label": "Paragraph 6",
      "text": "塑料有巨大用途，但最大缺点来自它的 indestructibility。全球海滩都有难以破坏的塑料瓶。回收也不容易，因为同一物品里常有不同种类塑料，处理方式不同。加入 starch 可让塑料被细菌攻击后分解；加入会在阳光中衰变的材料时，瓶子必须避光储存，避免使用前解体。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 表格填空（Questions 1–7）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 1,
          "text": "题目：Celluloid — Common uses: billiard balls, cutlery, clothing, ______\n题目翻译：Celluloid——常见用途：台球、餐具、服饰、______\n答案：photographic film\n解析：PDF 第二段写明最著名的 celluloid product 是 photographic film，且说明没有它电影业无法在 19 世纪末起飞。",
          "questionId": "q1"
        },
        {
          "questionNumber": 2,
          "text": "题目：Name of plastic, 1907, USA: ______\n题目翻译：1907 年、美国的塑料名称：______\n答案：Bakelite\n解析：PDF 第三段明确写 Leo Baekeland 在 1907 年发明这种塑料，并命名为 Bakelite。",
          "questionId": "q2"
        },
        {
          "questionNumber": 3,
          "text": "题目：Bakelite — Common uses: ______, household object\n题目翻译：Bakelite——常见用途：______、家居物品\n答案：electrical switches\n解析：PDF 第三段说 Bakelite was soon being used in the manufacture of electrical switches as well as a variety of domestic items。表格的 household object 对应 domestic items，空格对应 electrical switches。",
          "questionId": "q3"
        },
        {
          "questionNumber": 4,
          "text": "题目：Polythene — Country of origin: ______\n题目翻译：Polythene——原产国/地区：______\n答案：Britain\n解析：PDF 第四段写 chemists in Britain discovered ... polythene。表格列名是 Country of origin，所以答案应为 Britain，不是旧数据里的 British。",
          "questionId": "q4"
        },
        {
          "questionNumber": 5,
          "text": "题目：Rigid PVC — Properties: is ______\n题目翻译：硬质 PVC——性质：是 ______ 的\n答案：fireproof\n解析：PDF 第四段直接说 rigid PVC 是 a fireproof plastic suitable for drains and gutters。",
          "questionId": "q5"
        },
        {
          "questionNumber": 6,
          "text": "题目：Polystyrene — Properties: resembles ______\n题目翻译：Polystyrene——性质：像 ______\n答案：glass\n解析：PDF 第五段说 Polystyrene 是 a hard, clear material like glass。表格提示 resembles，空格只需填 glass。",
          "questionId": "q6"
        },
        {
          "questionNumber": 7,
          "text": "题目：Polyurethane — Properties: usually manufactured as a ______\n题目翻译：Polyurethane——性质：通常制成一种 ______\n答案：foam\n解析：PDF 第五段说 Polyurethane was commonly produced as a foam，并用于 insulating materials。",
          "questionId": "q7"
        }
      ],
      "questionRange": {
        "start": 1,
        "end": 7
      },
      "text": "题目1答案photographic film：新版 PDF 的 celluloid 表格空格对应最著名产品。\n题目2答案Bakelite：1907 年由 Baekeland 命名。\n题目3答案electrical switches：新版题表对应 electrical switches，而不是旧版 switches。\n题目4答案Britain：题表问 Country of origin，PDF 原文是 chemists in Britain。\n题目5答案fireproof：rigid PVC 的性质。\n题目6答案glass：题表问 resembles，PDF 是 like glass。\n题目7答案foam：Polyurethane usually manufactured as a foam。"
    },
    {
      "sectionTitle": "2. 判断正误（Questions 8–13）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 8,
          "text": "题目：The chemical structure of rubber is very different from that of plastics.\n题目翻译：橡胶的化学结构与塑料非常不同。\n答案：FALSE\n解析：PDF 第一段说 rubber is a polymer，并说同一种 polymerization 原理是制造大量塑料的基础。因此“very different”与原文相反。",
          "questionId": "q8"
        },
        {
          "questionNumber": 9,
          "text": "题目：John Wesley Hyatt was an industrial chemist.\n题目翻译：John Wesley Hyatt 是一名工业化学家。\n答案：NOT GIVEN\n解析：PDF 只说明 John Wesley Hyatt 赢得竞赛并使用 celluloid，没有说明他是否是 industrial chemist。",
          "questionId": "q9"
        },
        {
          "questionNumber": 10,
          "text": "题目：Celluloid and Bakelite react in the same way to heat.\n题目翻译：Celluloid 和 Bakelite 对热的反应方式相同。\n答案：FALSE\n解析：PDF 第三段说 Celluloid 可反复受热软化和重塑；Bakelite 定型后不能被热软化。两者对热反应不同。",
          "questionId": "q10"
        },
        {
          "questionNumber": 11,
          "text": "题目：If an object is made of several plastics, these prove hard to break down and reuse.\n题目翻译：如果一个物品由多种塑料制成，它们会很难分解和再利用。\n答案：TRUE\n解析：PDF 最后一段说塑料不容易回收，因为同一物品里常有不同类型塑料，且需要不同处理方式。这与题干含义一致。",
          "questionId": "q11"
        },
        {
          "questionNumber": 12,
          "text": "题目：Adding starch to plastic makes it more durable.\n题目翻译：向塑料中加入淀粉会让它更耐用。\n答案：FALSE\n解析：PDF 说加入 starch 会让塑料被细菌攻击并 fall apart，目的是更易降解，不是更耐用。",
          "questionId": "q12"
        },
        {
          "questionNumber": 13,
          "text": "题目：Containers which are designed to decompose need particular storage conditions.\n题目翻译：设计为可分解的容器需要特殊储存条件。\n答案：TRUE\n解析：PDF 最后一句说这类瓶子必须 stored in the dark，避免使用前 disintegrate。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 8,
        "end": 13
      },
      "text": "题目8答案FALSE：橡胶和塑料共享 polymerization 原理。\n题目9答案NOT GIVEN：PDF 未说明 Hyatt 是 industrial chemist。\n题目10答案FALSE：Celluloid 可热重塑，Bakelite 固化后不可。\n题目11答案TRUE：多塑料混合导致回收处理困难。\n题目12答案FALSE：starch 让塑料更易分解。\n题目13答案TRUE：可分解容器需要避光储存。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
