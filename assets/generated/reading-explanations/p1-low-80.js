(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p1-low-80", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p1-low-80",
  "meta": {
    "examId": "p1-low-80",
    "title": "The unsung sense 被低估的嗅觉",
    "category": "P1",
    "sourceDoc": "170. P1 - The unsung sense 被低估的嗅觉.pdf",
    "noteType": "翻译+解析",
    "matchedTitle": "The unsung sense 被低估的嗅觉"
  },
  "passageNotes": [
    {
      "label": "Paragraph 1",
      "text": "文章开篇指出，嗅觉研究长期被视觉和听觉压制。主流观点一直认为人类不像其他哺乳动物那样受气味影响，因此嗅觉被视为“次要感官”。"
    },
    {
      "label": "Paragraph 2-3",
      "text": "19 世纪解剖学家 Broca 认为哺乳动物可分为“嗅觉强”的宏嗅型和“嗅觉弱”的微嗅型，人类被归入后者（与灵长类、海洋哺乳动物并列）。后续遗传研究似乎支持这个判断：多数哺乳动物约有 1000 种嗅觉受体，人类大约只有 400 种。"
    },
    {
      "label": "Paragraph 4-5",
      "text": "新证据显示旧结论并不完整。脑成像发现人脑用于嗅觉处理的区域比早期估计更大；虽然人类受体类型更少，但鼻腔受体与更多神经区域连接，处理效率并不低。实验还显示人类可在极低浓度下识别气味，例如在大型泳池中识别“一滴”化学物。"
    },
    {
      "label": "Paragraph 6-8",
      "text": "嗅觉与情绪、恐惧和记忆系统紧密耦合，可能直接影响认知与判断。文中举例：夜店加入橙香、海水味、薄荷味后，人们跳舞和欢笑更多，甚至觉得音乐更好。另有研究显示，不熟悉的气味会让决策更情绪化。多数被试会改变行为，但很少人能意识到自己闻到了什么。"
    },
    {
      "label": "Paragraph 9",
      "text": "人类嗅觉“意识感弱”的一个核心原因是难以精确定位气味来源。视觉和听觉擅长定位，嗅觉不擅长，导致大脑难以像处理画面和声音那样聚焦细节，因此复杂气味混合中通常只能分辨少数成分。"
    },
    {
      "label": "Paragraph 10",
      "text": "嗅觉能力可以通过训练提升。调香师通过多年训练学习识别、命名和想象大量气味，这一过程伴随嗅觉脑区的功能重组，使其处理气味更高效。"
    },
    {
      "label": "Paragraph 11-12",
      "text": "气味确实是强记忆线索，但“气味记忆更准确更完整”是误解。其特殊性在于情绪强度更高，不一定更精确。负面气味比正面气味更容易形成强记忆连接；且第一次把某气味与对象联系时，大脑反应最强，这可解释为什么很多气味会把人拉回童年场景。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 判断正误（Questions 7–13）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 7,
          "text": "题目：Human vision and hearing are designed to locate exactly where stimuli are coming from.\n题目翻译：人的视觉和听觉天生就是为了精确定位刺激来源。\n答案：TRUE\n解析：第9段明确对比了视觉/听觉与嗅觉，指出视觉和听觉“are built to identify sights and sounds with precision”，与题干一致。",
          "questionId": "q7"
        },
        {
          "questionNumber": 8,
          "text": "题目：Even when complex multiple smells are present, most humans can identify only a few individual odours.\n题目翻译：即使存在复杂的多重气味，大多数人也只能识别其中少数单独气味。\n答案：TRUE\n解析：第9段末尾说我们在复杂混合气味中通常只能分辨大约四种气味，直接支持题干。",
          "questionId": "q8"
        },
        {
          "questionNumber": 9,
          "text": "题目：Professional help is needed when a person is developing their sense of smell.\n题目翻译：人在提升嗅觉能力时需要专业人士协助。\n答案：NOT GIVEN\n解析：第10段只说嗅觉可以训练，并以调香师长期训练为例，但未给出“普通人必须借助专业帮助”的明确结论。",
          "questionId": "q9"
        },
        {
          "questionNumber": 10,
          "text": "题目：Smells stimulate more precise memories than sights or sounds do.\n题目翻译：与视觉或听觉相比，气味能激发更精确的记忆。\n答案：FALSE\n解析：第11段明确否定这一点：气味触发的记忆并不更准确或更细致，只是情绪色彩更强，因此题干与原文相反。",
          "questionId": "q10"
        },
        {
          "questionNumber": 11,
          "text": "题目：A pleasant smell creates the strongest memories.\n题目翻译：愉快的气味会形成最强的记忆。\n答案：FALSE\n解析：第12段指出不愉快气味与记忆的连接通常更强，题干说“pleasant smell”最强，和原文相反。",
          "questionId": "q11"
        },
        {
          "questionNumber": 12,
          "text": "题目：Sensitivity to new smells declines in adulthood.\n题目翻译：人到成年后对新气味的敏感度会下降。\n答案：NOT GIVEN\n解析：文中提到首次气味关联多发生在幼年、并讨论记忆强度，但没有直接陈述“成年后对新气味敏感度下降”的规律。",
          "questionId": "q12"
        },
        {
          "questionNumber": 13,
          "text": "题目：Smell-related memories can frequently evoke childhood experiences.\n题目翻译：与气味有关的记忆经常会唤起童年经历。\n答案：TRUE\n解析：第12段结尾明确说明这可能解释了为什么气味常把我们带回童年，和题干一致。",
          "questionId": "q13"
        }
      ],
      "questionRange": {
        "start": 7,
        "end": 13
      },
      "text": "题目 7-13 答案依次为：TRUE、TRUE、NOT GIVEN、FALSE、FALSE、NOT GIVEN、TRUE。证据集中在第9-12段，核心信息是嗅觉定位能力弱、气味记忆情绪强于精度、负面气味和首次气味关联更容易形成强记忆。"
    },
    {
      "sectionTitle": "2. 笔记填空（Questions 1–6）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 1,
          "text": "题目：Broca categorised humans with other ______ and sea mammals as having a small smell organ.\n题目翻译：Broca 把人类与其他 ______ 和海洋哺乳动物归为嗅觉器官较小的一类。\n答案：primates\n解析：第2段原文把 humans 归入与 marine mammals 和 primates 同组，空格应填 primates。",
          "questionId": "q1"
        },
        {
          "questionNumber": 2,
          "text": "题目：Humans have about ______ kinds of smell receptor.\n题目翻译：人类大约有 ______ 种嗅觉受体。\n答案：400\n解析：第3段说人类 only possess four hundred or so types，因此答案是 400。",
          "questionId": "q2"
        },
        {
          "questionNumber": 3,
          "text": "题目：Studies prove that humans can detect a single ______ of some substance in a huge quantity of liquid.\n题目翻译：研究证明人类可以在大量液体中识别某种物质的一 ______。\n答案：drop\n解析：第5段给出的典型证据是“one drop of a chemical in a large swimming pool”，答案为 drop。",
          "questionId": "q3"
        },
        {
          "questionNumber": 4,
          "text": "题目：The effects of introducing certain aromas into a ______ were studied.\n题目翻译：研究测试了在 ______ 中加入特定气味的效果。\n答案：nightclub\n解析：第6段举的荷兰研究场景是把气味注入 nightclub，空格填 nightclub。",
          "questionId": "q4"
        },
        {
          "questionNumber": 5,
          "text": "题目：Certain smells altered the way Dutch party-goers felt about the ______.\n题目翻译：某些气味改变了荷兰派对参与者对 ______ 的感受。\n答案：music\n解析：第6段写到受试者甚至觉得 music 更好，因此答案是 music。",
          "questionId": "q5"
        },
        {
          "questionNumber": 6,
          "text": "题目：As many as ______ of people in research studies reacted to introduced smells.\n题目翻译：研究中多达 ______ 的人会对引入的气味产生行为反应。\n答案：95%\n解析：第8段明确给出 up to 95% 的受试者行为发生变化，答案为 95%。",
          "questionId": "q6"
        }
      ],
      "questionRange": {
        "start": 1,
        "end": 6
      },
      "text": "题目 1-6 答案依次为：primates、400、drop、nightclub、music、95%。这些答案都可在第2-8段对应句中直接定位。"
    }
  ]
});
})(typeof window !== "undefined" ? window : globalThis);
