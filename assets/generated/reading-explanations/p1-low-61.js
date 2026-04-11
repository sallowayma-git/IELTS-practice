(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p1-low-61", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p1-low-61",
  "meta": {
    "examId": "p1-low-61",
    "title": "Carnivorous plants 食虫植物",
    "category": "P1",
    "sourceDoc": "153. P1 - Carnivorous plants 食虫植物.pdf",
    "noteType": "总结",
    "matchedTitle": "Carnivorous plants 食虫植物"
  },
  "passageNotes": [
    {
      "label": "Paragraph A",
      "text": "食虫植物是一类能够捕捉和消化昆虫及其他小动物的植物。它们通常生长在营养贫瘠的环境中，如沼泽和酸性土壤，通过捕食昆虫来补充土壤中缺乏的营养物质，特别是氮和磷。"
    },
    {
      "label": "Paragraph B",
      "text": "食虫植物有多种捕食机制。捕蝇草使用快速关闭的陷阱叶来捕捉昆虫，而猪笼草则使用充满消化液的瓶状结构来困住猎物。茅膏菜使用粘性腺毛来粘住昆虫，然后缓慢卷曲叶子将猎物包裹起来。"
    },
    {
      "label": "Paragraph C",
      "text": "食虫植物的捕食过程通常包括几个步骤：吸引、捕捉、消化和吸收。许多食虫植物使用鲜艳的颜色、甜美的气味或花蜜来吸引猎物。一旦猎物被捕捉，植物会分泌消化酶来分解猎物的身体，然后吸收释放出的营养物质。"
    },
    {
      "label": "Paragraph D",
      "text": "尽管食虫植物看起来像是植物界的异类，但它们在生态系统中扮演着重要角色。它们帮助控制昆虫种群，并为其他生物提供栖息地。此外，食虫植物也是科学研究的重要对象，特别是在植物生理学和进化生物学领域。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 笔记填空（Questions 1–5）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 1,
          "text": "题目：He understood why the plant did not respond to ______.\n题目翻译：他理解了为什么这种植物不会对 ______ 作出反应。\n答案：raindrops\n解析：达尔文观察到茅膏菜会忽略雨滴，这可避免对假信号的无效反应。",
          "questionId": "q1"
        },
        {
          "questionNumber": 2,
          "text": "题目：Venus flytrap leaves close and then act like a temporary ______.\n题目翻译：捕蝇草叶片闭合后会暂时像一个 ______ 一样工作。\n答案：stomach\n解析：文中写达尔文证明其叶片闭合后形成临时“胃”，分泌酶消化猎物。",
          "questionId": "q2"
        },
        {
          "questionNumber": 3,
          "text": "题目：The charge causes ______ in cell membranes to open.\n题目翻译：电荷会导致细胞膜中的 ______ 打开。\n答案：pores\n解析：Volkov 的实验显示电信号沿液体通道传递并触发膜孔开启，水分随之转移。",
          "questionId": "q3"
        },
        {
          "questionNumber": 4,
          "text": "题目：When water is pumped out of bladder cells, a ______ builds up inside.\n题目翻译：当囊泡细胞把水抽出后，内部会形成 ______。\n答案：vacuum\n解析：狸藻通过抽水降低囊内压力，形成真空状态以便快速吸入猎物。",
          "questionId": "q4"
        },
        {
          "questionNumber": 5,
          "text": "题目：Some pitcher plants are big enough to capture and eat ______.\n题目翻译：一些猪笼草大到足以捕获并吞食 ______。\n答案：frogs\n解析：原文明确提到最大类型可吞食整只青蛙。",
          "questionId": "q5"
        }
      ],
      "questionRange": {
        "start": 1,
        "end": 5
      },
      "text": "题目 1-5 答案依次为：raindrops, stomach, pores, vacuum, frogs。"
    },
    {
      "sectionTitle": "2. 判断正误（Questions 6–13）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 13,
          "text": "题目：Pitcher plants increase in size after they have digested a lot of insects.\n题目翻译：猪笼草在消化大量昆虫后会变大。\n答案：TRUE\n解析：文中提到当科学家给猪笼草额外投喂昆虫时，植株会长得更大。",
          "questionId": "q6"
        },
        {
          "questionNumber": 7,
          "text": "题目：Carnivorous plants produce light-harvesting enzymes with the nutrients they extract from animals.\n题目翻译：食虫植物利用从动物体内获取的营养来构建光捕获酶。\n答案：TRUE\n解析：作者指出它们从猎物获取氮和磷以构建 light-harvesting enzymes，题干与原文一致。",
          "questionId": "q7"
        },
        {
          "questionNumber": 8,
          "text": "题目：Pitcher plants and Venus flytraps are more efficient at photosynthesis than plants with ordinary leaves.\n题目翻译：猪笼草和捕蝇草的光合作用效率高于普通叶片植物。\n答案：FALSE\n解析：原文反而说这些捕食结构并不利于光合作用，效率低于普通平展叶片。",
          "questionId": "q8"
        },
        {
          "questionNumber": 9,
          "text": "题目：Venus flytraps are better adapted to the soil of swamps and bogs than other carnivorous plants.\n题目翻译：捕蝇草比其他食虫植物更适应沼泽土壤。\n答案：NOT GIVEN\n解析：文中只讨论食虫植物整体在贫瘠沼泽环境中的优势，没有给出捕蝇草与其他食虫植物的对比结论。",
          "questionId": "q9"
        },
        {
          "questionNumber": 10,
          "text": "题目：Carnivorous plants frequently find it difficult to photosynthesise in bogs due to a lack of sunlight.\n题目翻译：食虫植物在沼泽中常因缺乏阳光而难以进行光合作用。\n答案：FALSE\n解析：原文说 bogs 往往阳光充足，不是缺光；它们的问题主要是捕食结构本身光合效率低。",
          "questionId": "q10"
        },
        {
          "questionNumber": 11,
          "text": "题目：Scientists have campaigned to reduce the amount of nitrogen that is released into the soil by agricultural practices.\n题目翻译：科学家已发起行动，减少农业向土壤释放氮。\n答案：NOT GIVEN\n解析：文章提到农业化肥和污染增加了氮输入并伤害食虫植物，但未提到科学家开展了相关“运动/行动”。",
          "questionId": "q11"
        },
        {
          "questionNumber": 12,
          "text": "题目：A lot of exotic carnivorous plants are sold illegally.\n题目翻译：大量异域食虫植物通过非法渠道交易。\n答案：TRUE\n解析：文中直言 exotic carnivorous plants 的黑市交易很强劲，说明非法销售规模显著。",
          "questionId": "q12"
        },
        {
          "questionNumber": 13,
          "text": "题目：Preventing wildfires is beneficial to the Venus flytrap.\n题目翻译：抑制野火对捕蝇草有益。\n答案：FALSE\n解析：原文指出政府压制野火会让其他植物快速生长并挤压捕蝇草，结果是负面影响。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 6,
        "end": 13
      },
      "text": "题目 6-13 答案依次为：TRUE, TRUE, FALSE, NOT GIVEN, FALSE, NOT GIVEN, TRUE, FALSE。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
