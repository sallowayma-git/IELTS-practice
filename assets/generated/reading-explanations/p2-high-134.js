(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p2-high-134", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p2-high-134",
  "meta": {
    "examId": "p2-high-134",
    "title": "Roller coaster 过山车",
    "category": "P2",
    "sourceDoc": "PDF句段翻译",
    "noteType": "句段级翻译",
    "matchedTitle": "Roller coaster 过山车"
  },
  "passageNotes": [
    {
      "label": "Paragraph A",
      "text": "和客运列车一样，过山车由一系列相连的车厢组成，沿轨道运行。但与客运列车不同的是，它没有自身的发动机或动力源。在运行的大部分时间里，它仅靠惯性和重力驱动。唯一消耗能量的环节出现在行程最开始——过山车被拉升至最高坡。传统的提升装置是一条沿坡道铺设的长链，链条首尾相连形成环状，绕过坡顶和坡底的两个齿轮。坡底的齿轮由电机驱动，带动链条像传送带一样不断向上运行。过山车车厢扣住链条，被直接拉到顶端。到达最高点后，车厢脱钩释放，开始下冲。"
    },
    {
      "label": "Paragraph B",
      "text": "初始爬坡的目的是积累一种势能储备，简单来说，过山车升得越高，重力能将其下拉的距离就越长。当车厢开始下滑时，势能转化为动能（运动能量），车厢随之加速。到达坡底时，动能达到最大值，推动车厢冲上第二个坡道，再次积累势能。如此循环，轨道不断将动能与势能相互转换。正是这种加速度的起伏变化，让过山车如此令人着迷。"
    },
    {
      "label": "Paragraph C",
      "text": "现代过山车源自16世纪俄罗斯的冰面滑梯。在法国，由于气温较高，滑梯表面涂蜡，并在车厢上加装轮子以方便下滑。美国第一座过山车原本用于将煤炭从山上运下，最初由骡子牵引，后来改用蒸汽机提供动力。"
    }
  ],
  "questionExplanations": []
}
  );
})(typeof window !== "undefined" ? window : globalThis);
