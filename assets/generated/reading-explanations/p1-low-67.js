(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p1-low-67", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p1-low-67",
  "meta": {
    "examId": "p1-low-67",
    "title": "Scented Plants 植物的味道",
    "category": "P1",
    "sourceDoc": "159. P1 - Scented Plants 植物的味道.pdf",
    "noteType": "总结",
    "matchedTitle": "Scented Plants 植物的味道"
  },
  "passageNotes": [
    {
      "label": "Paragraph A",
      "text": "许多植物会散发气味。这可能来自植物的花、叶、茎，甚至在某些情况下来自根。人类可能感知为芳香香水的气味实际上是植物用来吸引传粉者、抑制细菌或抵御捕食者的工具。香气由具有高蒸气压的小型有机颗粒组成，因此如果暴露在空气中，香味化合物很容易蒸发；以这种方式蒸发的化学物质被称为\"挥发性化合物\"。"
    },
    {
      "label": "Paragraph B",
      "text": "虽然我们通常认为植物气味是令人愉快的，但植物中的许多挥发性化合物在被食用时是有毒的。这些化合物被植物用来保护自己免受细菌攻击。人类自古以来就认识并利用了这些植物来源的抗菌剂，当时它们被用来减缓食物变质。例如，丁香香料可以用于烘焙食品和腌制肉类中，以减缓霉菌和细菌的生长，因为少量对人类没有危险。在现代食品保存技术发展之前，欧洲文明严重依赖丁香和其他热带香料来确保食物的长期供应。然而，从欧洲到东南亚的长距离使这些香料极其昂贵，这也是寻找通往亚洲更短路线的部分动机，这导致了美洲的发现。"
    },
    {
      "label": "Paragraph C",
      "text": "虽然植物中的挥发性化合物可能最初是为了驱赶各种食草动物而进化的，但它们现在执行着非凡的功能范围。许多植物共有的一项重要功能是吸引将传播该植物花粉的动物。昆虫是最常以这种方式与植物互动的动物，大多数昆虫通过头部极其敏感的触角检测挥发性化合物。一些触角可以检测到浓度仅为十亿分之几的空气传播挥发性化合物。"
    },
    {
      "label": "Paragraph D",
      "text": "其他植物释放挥发性化合物，作为对入侵昆虫的毒素，还有一些植物在受伤时释放此类化合物，以阻止昆虫在其上产卵，从而进一步伤害它们。例如，植物响应食草动物产卵而释放的挥发性化合物可以吸引卵的寄生虫，从而防止它们孵化。通过这种方式，植物可以避免从卵中孵化出来的饥饿幼虫的攻击。"
    },
    {
      "label": "Paragraph E",
      "text": "植物中的挥发性化合物也可以在一些非常间接的防御系统中用作一种货币。例如，在雨林树 Leonardoxa africana 中，Petalomyrmex phylax 蚂蚁被幼叶吸引，因为它们释放高水平的挥发性化合物水杨酸甲酯，这是一种蚂蚁需要用作巢穴中防腐剂的物质；作为回报，蚂蚁保护树免受食草动物的侵害。这种互利共生关系展示了植物和昆虫之间复杂的化学通讯网络。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 判断正误（Questions 1–7）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 1,
          "text": "（1）题目 1：Plant fragrances are used to attract pollinators.\n题目翻译：植物香气用于吸引传粉者。\n答案：F\n解析：定位 Paragraph A 中 \"a tool used by plants to entice pollinators\"。植物使用香气吸引传粉者，与题干一致，因此答案为 TRUE。",
          "questionId": "q1"
        },
        {
          "questionNumber": 2,
          "text": "（2）题目 2：Many volatile compounds in plants are toxic when eaten.\n题目翻译：植物中的许多挥发性化合物在被食用时是有毒的。\n答案：G\n解析：定位 Paragraph B 中 \"many volatile compounds in plants are toxic when eaten.\"。与题干一致，因此答案为 TRUE。",
          "questionId": "q2"
        },
        {
          "questionNumber": 3,
          "text": "（3）题目 3：Cloves were used to speed up the growth of mould.\n题目翻译：丁香被用来加速霉菌生长。\n答案：H\n解析：定位 Paragraph B 中 \"the spice clove could be used in baked goods and prepared meats to slow the growth of mould and bacteria.\"。丁香用于减缓霉菌生长，与题干矛盾，因此答案为 FALSE。",
          "questionId": "q3"
        },
        {
          "questionNumber": 4,
          "text": "（4）题目 4：Most insects detect volatile compounds through their antennae.\n题目翻译：大多数昆虫通过触角检测挥发性化合物。\n答案：C\n解析：定位 Paragraph C 中 \"most insects detect volatile compounds through the extremely sensitive antennae on their heads.\"。与题干一致，因此答案为 TRUE。",
          "questionId": "q4"
        },
        {
          "questionNumber": 5,
          "text": "（5）题目 5：Some plants emit volatile compounds when they have been injured.\n题目翻译：一些植物在受伤时释放挥发性化合物。\n答案：C\n解析：定位 Paragraph D 中 \"still others emit such compounds when they have been injured.\"。与题干一致，因此答案为 TRUE。",
          "questionId": "q5"
        },
        {
          "questionNumber": 6,
          "text": "（6）题目 6：Volatile compounds released by plants can attract parasites of herbivore eggs.\n题目翻译：植物释放的挥发性化合物可以吸引食草动物卵的寄生虫。\n答案：D\n解析：定位 Paragraph D 中 \"Volatile compounds released by plants in response to herbivore egg-laying, for example, can attract parasites of the eggs.\"。与题干一致，因此答案为 TRUE。",
          "questionId": "q6"
        },
        {
          "questionNumber": 7,
          "text": "（7）题目 7：Ants are attracted to young leaves because they emit methyl salicylate.\n题目翻译：蚂蚁被幼叶吸引，因为它们释放水杨酸甲酯。\n答案：B\n解析：定位 Paragraph E 中 \"ants of the species Petalomyrmex phylax are attracted to young leaves because they emit high levels of the volatile compound methyl salicylate.\"。与题干一致，因此答案为 TRUE。",
          "questionId": "q7"
        }
      ],
      "questionRange": {
        "start": 1,
        "end": 7
      },
      "text": "（1）题目 1：Plant fragrances are used to attract pollinators.\n题目翻译：植物香气用于吸引传粉者。\n答案：F\n解析：定位 Paragraph A 中 \"a tool used by plants to entice pollinators\"。植物使用香气吸引传粉者，与题干一致，因此答案为 TRUE。\n（2）题目 2：Many volatile compounds in plants are toxic when eaten.\n题目翻译：植物中的许多挥发性化合物在被食用时是有毒的。\n答案：G\n解析：定位 Paragraph B 中 \"many volatile compounds in plants are toxic when eaten.\"。与题干一致，因此答案为 TRUE。\n（3）题目 3：Cloves were used to speed up the growth of mould.\n题目翻译：丁香被用来加速霉菌生长。\n答案：H\n解析：定位 Paragraph B 中 \"the spice clove could be used in baked goods and prepared meats to slow the growth of mould and bacteria.\"。丁香用于减缓霉菌生长，与题干矛盾，因此答案为 FALSE。\n（4）题目 4：Most insects detect volatile compounds through their antennae.\n题目翻译：大多数昆虫通过触角检测挥发性化合物。\n答案：C\n解析：定位 Paragraph C 中 \"most insects detect volatile compounds through the extremely sensitive antennae on their heads.\"。与题干一致，因此答案为 TRUE。\n（5）题目 5：Some plants emit volatile compounds when they have been injured.\n题目翻译：一些植物在受伤时释放挥发性化合物。\n答案：C\n解析：定位 Paragraph D 中 \"still others emit such compounds when they have been injured.\"。与题干一致，因此答案为 TRUE。\n（6）题目 6：Volatile compounds released by plants can attract parasites of herbivore eggs.\n题目翻译：植物释放的挥发性化合物可以吸引食草动物卵的寄生虫。\n答案：D\n解析：定位 Paragraph D 中 \"Volatile compounds released by plants in response to herbivore egg-laying, for example, can attract parasites of the eggs.\"。与题干一致，因此答案为 TRUE。\n（7）题目 7：Ants are attracted to young leaves because they emit methyl salicylate.\n题目翻译：蚂蚁被幼叶吸引，因为它们释放水杨酸甲酯。\n答案：B\n解析：定位 Paragraph E 中 \"ants of the species Petalomyrmex phylax are attracted to young leaves because they emit high levels of the volatile compound methyl salicylate.\"。与题干一致，因此答案为 TRUE。"
    },
    {
      "sectionTitle": "2. 笔记填空（Questions 8–13）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 8,
          "text": "（1）题目 8：Fragrances consist of small organic particles with high ______ pressures.\n题目翻译：香气由具有高 ______ 压的小型有机颗粒组成。\n答案：D\n解析：定位 Paragraph A 中 \"Fragrances consist of small organic particles with high vapor pressures.\"。香气由具有高蒸气压的颗粒组成，因此答案为 vapor。",
          "questionId": "q8"
        },
        {
          "questionNumber": 9,
          "text": "（2）题目 9：European civilization was heavily dependent on ______ and other tropical spices.\n题目翻译：欧洲文明严重依赖 ______ 和其他热带香料。\n答案：C\n解析：定位 Paragraph B 中 \"European civilization was heavily dependent on cloves and other tropical spices.\"。欧洲文明严重依赖丁香，因此答案为 cloves。",
          "questionId": "q9"
        },
        {
          "questionNumber": 10,
          "text": "（3）题目 10：Most insects detect volatile compounds through their ______.\n题目翻译：大多数昆虫通过它们的 ______ 检测挥发性化合物。\n答案：FALSE\n解析：定位 Paragraph C 中 \"most insects detect volatile compounds through the extremely sensitive antennae on their heads.\"。通过触角检测，因此答案为 antennae。",
          "questionId": "q10"
        },
        {
          "questionNumber": 11,
          "text": "（4）题目 11：Some plants emit compounds to deter insects from laying ______ on them.\n题目翻译：一些植物释放化合物以阻止昆虫在其上产 ______。\n答案：TRUE\n解析：定位 Paragraph D 中 \"in order to deter insects from laying eggs on them.\"。阻止昆虫产卵，因此答案为 eggs。",
          "questionId": "q11"
        },
        {
          "questionNumber": 12,
          "text": "（5）题目 12：Volatile compounds can attract ______ of the eggs, preventing them from hatching.\n题目翻译：挥发性化合物可以吸引卵的 ______，防止它们孵化。\n答案：NOT GIVEN\n解析：定位 Paragraph D 中 \"can attract parasites of the eggs, thereby preventing them from hatching.\"。吸引卵的寄生虫，因此答案为 parasites。",
          "questionId": "q12"
        },
        {
          "questionNumber": 13,
          "text": "（6）题目 13：Ants use methyl salicylate as an ______ in their nests.\n题目翻译：蚂蚁在其巢穴中使用水杨酸甲酯作为 ______。\n答案：FALSE\n解析：定位 Paragraph E 中 \"a substance that ants need to use as an antiseptic in their nests.\"。蚂蚁需要将其用作防腐剂，因此答案为 antiseptic。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 8,
        "end": 13
      },
      "text": "（1）题目 8：Fragrances consist of small organic particles with high ______ pressures.\n题目翻译：香气由具有高 ______ 压的小型有机颗粒组成。\n答案：D\n解析：定位 Paragraph A 中 \"Fragrances consist of small organic particles with high vapor pressures.\"。香气由具有高蒸气压的颗粒组成，因此答案为 vapor。\n（2）题目 9：European civilization was heavily dependent on ______ and other tropical spices.\n题目翻译：欧洲文明严重依赖 ______ 和其他热带香料。\n答案：C\n解析：定位 Paragraph B 中 \"European civilization was heavily dependent on cloves and other tropical spices.\"。欧洲文明严重依赖丁香，因此答案为 cloves。\n（3）题目 10：Most insects detect volatile compounds through their ______.\n题目翻译：大多数昆虫通过它们的 ______ 检测挥发性化合物。\n答案：FALSE\n解析：定位 Paragraph C 中 \"most insects detect volatile compounds through the extremely sensitive antennae on their heads.\"。通过触角检测，因此答案为 antennae。\n（4）题目 11：Some plants emit compounds to deter insects from laying ______ on them.\n题目翻译：一些植物释放化合物以阻止昆虫在其上产 ______。\n答案：TRUE\n解析：定位 Paragraph D 中 \"in order to deter insects from laying eggs on them.\"。阻止昆虫产卵，因此答案为 eggs。\n（5）题目 12：Volatile compounds can attract ______ of the eggs, preventing them from hatching.\n题目翻译：挥发性化合物可以吸引卵的 ______，防止它们孵化。\n答案：NOT GIVEN\n解析：定位 Paragraph D 中 \"can attract parasites of the eggs, thereby preventing them from hatching.\"。吸引卵的寄生虫，因此答案为 parasites。\n（6）题目 13：Ants use methyl salicylate as an ______ in their nests.\n题目翻译：蚂蚁在其巢穴中使用水杨酸甲酯作为 ______。\n答案：FALSE\n解析：定位 Paragraph E 中 \"a substance that ants need to use as an antiseptic in their nests.\"。蚂蚁需要将其用作防腐剂，因此答案为 antiseptic。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
