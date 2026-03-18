(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p3-high-192", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p3-high-192",
  "meta": {
    "examId": "p3-high-192",
    "title": "Voynich Manuscript 伏尼契手稿",
    "category": "P3",
    "sourceDoc": "P3 解析+1202高频_副本.md",
    "noteType": "总结",
    "matchedTitle": "Voynich Manuscript 伏尼契手稿"
  },
  "passageNotes": [
    {
      "label": "Paragraph 1",
      "text": "耶鲁大学拜内克图书馆（Beinecke Library）收藏着世界上最珍贵的书籍（如莎士比亚首版对开本、古腾堡圣经、中世纪早期手稿），但该馆最具争议的藏品是一部不起眼的羊皮纸手稿 —— 大小如精装书，含约 240 页图画与文本，年代和作者均未知。若不是手稿图画暗示 “神秘知识”、文本看似 “无法破解的密码”，这本编号为 MS 408 的手稿不会引起太多关注。学界称其为 “伏尼契手稿”，得名于 1912 年从意大利耶稣会学院买下它的美国书商威尔弗里德・伏尼契（Wilfrid Voynich）。"
    },
    {
      "label": "Paragraph 2",
      "text": "多年来，从业余爱好者到顶尖密码破译员，无数人试图破解手稿，却均以失败告终。学术论文、书籍和网站致力于解读其内容（内容可自由获取）。基尔大学伏尼契手稿专家戈登・拉格（Gordon Rugg）博士指出：“多数谜团依赖二手报道，而这份手稿你可以亲眼看到。”"
    },
    {
      "label": "Paragraph 3",
      "text": "手稿的确奇特：一页页画着怪异植物、占星符号和人物，配着类似速记的文字。伏尼契本人认为手稿是 13 世纪英国修士罗杰・培根（Roger Bacon）的作品（培根以炼金术、哲学和科学知识闻名）。1921 年，宾夕法尼亚大学哲学教授威廉・纽博尔德（William Newbold）的研究似乎支持这一观点 —— 他声称找到培根使用的密码系统密钥，认为手稿证明 “培根在显微镜发明前数百年就已使用显微镜”，“中世纪修士观察活细胞” 的说法引发轰动。但很快有学者指出，纽博尔德的 “破译方法” 可得出多种解读，他实则陷入 “一厢情愿的想法”。"
    },
    {
      "label": "Paragraph 4",
      "text": "伏尼契手稿仍让世界级专家束手无策。1944 年，美国著名密码破译员威廉・弗里德曼（William Friedman）带领团队攻关，从最基础的密码破译任务入手：分析文本字符的出现频率，寻找潜在结构线索。但团队很快陷入困境：手稿 “字母表” 规模不明（17 万个字符中可识别出 70 多个不同符号）；更关键的是，弗里德曼发现 “部分单词和短语的出现频率远超常规语言”，让人怀疑手稿并非隐藏真实语言（加密通常会降低单词频率）。"
    },
    {
      "label": "Paragraph 5",
      "text": "弗里德曼认为，解开这一矛盾的最合理解释是 “伏尼契语（Voynichese）是人造语言”—— 其词汇基于概念而非语言学规则。那么这份手稿是否是已知最早的人造语言实例？《伏尼契手稿》合著者罗布・丘吉尔（Rob Churchill）表示：“弗里德曼的假说值得尊重，因其结合了他毕生的密码分析经验。” 但这仍留下诸多未解之谜（如作者身份、怪异图画的含义），丘吉尔补充道：“这对整体理解手稿帮助不大。”"
    },
    {
      "label": "Paragraph 6",
      "text": "尽管弗里德曼的研究已过去 60 多年，他当时就推测 “改变密码破译的工具 —— 计算机” 将带来重大突破，事实也的确如此 —— 如今计算机是挖掘手稿语言线索的关键工具。"
    },
    {
      "label": "Paragraph 7",
      "text": "目前的发现仍令人困惑。2001 年，英国伯明翰大学伏尼契手稿专家加布里埃尔・兰迪尼（Gabriel Landini）博士用 “频谱分析”（一种模式检测方法）研究手稿，发现 “手稿含真实单词而非随机无意义内容”，表明存在潜在自然语言。但次年，德国达姆施塔特欧洲空间局的伏尼契手稿专家勒内・赞德贝根（René Zandbergen）发现 “文本的熵值（信息传输速率的衡量标准）与弗里德曼‘使用人造语言’的推测一致”。"
    },
    {
      "label": "Paragraph 8",
      "text": "许多人认为伏尼契手稿并非骗局 —— 中世纪造假者怎会从随机无意义内容中创造出如此多 “信息痕迹”？但拉格的新研究对此提出挑战。他使用意大利数学家吉罗拉莫・卡尔达诺（Girolamo Cardano）1150 年提出的 “格栅系统”（用特制格栅从表格中选取符号），发现可快速生成 “具有伏尼契手稿基本特征的文本”。2004 年发表结果时，拉格强调 “并非要证明手稿是骗局，只是证明‘数月内造出如此复杂的骗局’是可行的”。"
    },
    {
      "label": "Paragraph 9",
      "text": "自然有人持不同意见：赞德贝根等学者仍认为文本有真实含义，只是可能永远无法破译；丘吉尔等学者则提出 “手稿图文的怪异程度暗示作者可能脱离现实”。"
    },
    {
      "label": "Paragraph 10",
      "text": "唯一确定的是，这本锁在耶鲁大学的手稿仍魅力不减。拉格说：“许多人从解谜中获得极大的智力乐趣，而伏尼契手稿是最具挑战性的谜题。”"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 判断题（Questions 27–30：TRUE/FALSE/NOT GIVEN）",
      "mode": "per_question",
      "items": [
        {
          "questionNumber": 27,
          "text": "（1）题目 27：It is uncertain when the Voynich manuscript was written.（伏尼契手稿的写作时间不确定）\n答案：TRUE（正确）\n解析：定位 Paragraph 1 中 “containing 240-odd pages of drawings and text of unknown age and authorship”，“年代未知（unknown age）” 即 “写作时间不确定”，与题干描述一致，因此判定为 TRUE。",
          "questionId": "q27"
        },
        {
          "questionNumber": 28,
          "text": "（2）题目 28：Wilfrid Voynich donated the manuscript to the Beinecke Library.（威尔弗里德・伏尼契将手稿捐赠给拜内克图书馆）\n答案：NOT GIVEN（未提及）\n解析：Paragraph 1 仅提到 “Wilfrid Voynich, who bought the manuscript from a Jesuit college in Italy in 1912”，“伏尼契 1912 年买下手稿”，未提及 “捐赠给图书馆”，无相关信息，因此判定为 NOT GIVEN。",
          "questionId": "q28"
        },
        {
          "questionNumber": 29,
          "text": "（3）题目 29：Interest in the Voynich manuscript extends beyond that of academics and professional codebreakers.（对伏尼契手稿的兴趣超出学者和专业密码破译员的范围）\n答案：TRUE（正确）\n解析：定位 Paragraph 2 中 “the manuscript has attracted the attention of everyone from amateur dabblers to top code-breakers”，“从业余爱好者到顶尖破译员” 即 “兴趣超出学者和专业人员”，与题干描述一致，因此判定为 TRUE。",
          "questionId": "q29"
        },
        {
          "questionNumber": 30,
          "text": "（4）题目 30：The text of the Voynich manuscript contains just under 70 symbols.（伏尼契手稿文本包含不到 70 个符号）\n答案：FALSE（错误）\n解析：定位 Paragraph 4 中 “It is possible to make out more than 70 distinct symbols among the 170,000-character text”，“超过 70 个不同符号” 与题干 “不到 70 个” 描述矛盾，因此判定为 FALSE。",
          "questionId": "q30"
        }
      ],
      "questionRange": {
        "start": 27,
        "end": 30
      },
      "text": "答案：TRUE（正确）\n解析：定位 Paragraph 1 中 “containing 240-odd pages of drawings and text of unknown age and authorship”，“年代未知（unknown age）” 即 “写作时间不确定”，与题干描述一致，因此判定为 TRUE。\n答案：NOT GIVEN（未提及）\n解析：Paragraph 1 仅提到 “Wilfrid Voynich, who bought the manuscript from a Jesuit college in Italy in 1912”，“伏尼契 1912 年买下手稿”，未提及 “捐赠给图书馆”，无相关信息，因此判定为 NOT GIVEN。\n答案：TRUE（正确）\n解析：定位 Paragraph 2 中 “the manuscript has attracted the attention of everyone from amateur dabblers to top code-breakers”，“从业余爱好者到顶尖破译员” 即 “兴趣超出学者和专业人员”，与题干描述一致，因此判定为 TRUE。\n答案：FALSE（错误）\n解析：定位 Paragraph 4 中 “It is possible to make out more than 70 distinct symbols among the 170,000-character text”，“超过 70 个不同符号” 与题干 “不到 70 个” 描述矛盾，因此判定为 FALSE。"
    },
    {
      "sectionTitle": "2. 人物 - 观点匹配（Questions 31–34：A=Gordon Rugg / B=Roger Bacon / C=William Newbold / D=William Friedman / E=Rob Churchill / F=Gabriel Landini / G=René Zandbergen / H=Girolamo Cardano）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 31,
          "text": "（1）题目 31：The number of times that some words occur makes it unlikely that the manuscript is based on an authentic language.（部分单词的出现次数让手稿不太可能基于真实语言）\n答案：D（William Friedman，威廉・弗里德曼）\n解析：定位 Paragraph 4 中 “Friedman discovered that some words and phrases appeared more often than expected in a standard language, casting doubt on claims that the manuscript concealed a real language”，弗里德曼发现 “单词出现频率异常，怀疑非真实语言”，因此选 D。",
          "questionId": "q31"
        },
        {
          "questionNumber": 32,
          "text": "（2）题目 32：Unlike some other similar objects of fascination, people can gain direct access to the Voynich manuscript.（与其他类似热门谜团不同，人们可直接接触伏尼契手稿）\n答案：A（Gordon Rugg，戈登・拉格）\n解析：定位 Paragraph 2 中 “Dr Gordon Rugg... ‘Most other mysteries involve second-hand reports, but this is one that you can see for yourself’”，拉格指出 “手稿可亲眼看到，与其他依赖二手报道的谜团不同”，因此选 A。",
          "questionId": "q32"
        },
        {
          "questionNumber": 33,
          "text": "（3）题目 33：The person who wrote the manuscript may not have been entirely sane.（手稿作者可能并非完全神志清醒）\n答案：E（Rob Churchill，罗布・丘吉尔）\n解析：定位 Paragraph 9 中 “others, such as Churchill, have suggested that the sheer weirdness of the illustrations and text hints at an author who had lost touch with reality”，丘吉尔认为 “图文怪异暗示作者脱离现实（神志不清）”，因此选 E。",
          "questionId": "q33"
        },
        {
          "questionNumber": 34,
          "text": "（4）题目 34：It is likely that the author of the manuscript is the same person as suggested by Wilfrid Voynich.（手稿作者可能与威尔弗里德・伏尼契提出的一致）\n答案：C（William Newbold，威廉・纽博尔德）\n解析：定位 Paragraph 3 中 “Voynich himself believed that the manuscript was the work of the 13th-century English monk Roger Bacon... in 1921 Voynich’s view... appeared to win support from the work of William Newbold”，纽博尔德的研究曾支持伏尼契 “作者是培根” 的观点，因此选 C。",
          "questionId": "q34"
        }
      ],
      "questionRange": {
        "start": 31,
        "end": 34
      },
      "text": "答案：D（William Friedman，威廉・弗里德曼）\n解析：定位 Paragraph 4 中 “Friedman discovered that some words and phrases appeared more often than expected in a standard language, casting doubt on claims that the manuscript concealed a real language”，弗里德曼发现 “单词出现频率异常，怀疑非真实语言”，因此选 D。\n答案：A（Gordon Rugg，戈登・拉格）\n解析：定位 Paragraph 2 中 “Dr Gordon Rugg... ‘Most other mysteries involve second-hand reports, but this is one that you can see for yourself’”，拉格指出 “手稿可亲眼看到，与其他依赖二手报道的谜团不同”，因此选 A。\n答案：E（Rob Churchill，罗布・丘吉尔）\n解析：定位 Paragraph 9 中 “others, such as Churchill, have suggested that the sheer weirdness of the illustrations and text hints at an author who had lost touch with reality”，丘吉尔认为 “图文怪异暗示作者脱离现实（神志不清）”，因此选 E。\n答案：C（William Newbold，威廉・纽博尔德）\n解析：定位 Paragraph 3 中 “Voynich himself believed that the manuscript was the work of the 13th-century English monk Roger Bacon... in 1921 Voynich’s view... appeared to win support from the work of William Newbold”，纽博尔德的研究曾支持伏尼契 “作者是培根” 的观点，因此选 C。"
    },
    {
      "sectionTitle": "3. 摘要填空（Questions 35–39：NO MORE THAN TWO WORDS）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 35,
          "text": "（1）题目 35：William Newbold believed that the author of the Voynich manuscript had been able to look at cells through a \\___\\___.（威廉・纽博尔德认为伏尼契手稿的作者曾能通过_\\___\\__观察细胞。）\n答案：microscope（显微镜）\n解析：定位 Paragraph 3 中 “the manuscript proved that Bacon had access to a microscope centuries before they were supposedly first invented. The claim that this medieval monk had observed living cells”，“使用显微镜观察细胞”，因此答案为 “microscope”。",
          "questionId": "q35"
        },
        {
          "questionNumber": 36,
          "text": "（2）题目 36：William Friedman concluded that the manuscript was written in an artificial language that was based on \\___\\___.（威廉・弗里德曼认为手稿是用基于_\\___\\__的人造语言写成的。）\n答案：concepts（概念）\n解析：定位 Paragraph 5 中 “‘Voynichese’ is some sort of specially created artificial language, whose words are devised from concepts rather than linguistics”，“词汇基于概念”，因此答案为 “concepts”。",
          "questionId": "q36"
        },
        {
          "questionNumber": 37,
          "text": "（3）题目 37：He couldn’t find out the meaning of this language but he believed that the \\___\\___ would continue to bring advances in code-breaking.（他无法解读这种语言的含义，但相信_\\___\\__将持续为密码破译带来进展。）\n答案：computer（计算机）\n解析：定位 Paragraph 6 中 “he suspected that major insights would come from using the device that had already transformed code-breaking: the computer”，“计算机是密码破译的关键工具”，因此答案为 “computer”。",
          "questionId": "q37"
        },
        {
          "questionNumber": 38,
          "text": "（4）题目 38：Dr Gabriel Landini used a system known as \\___\\___ in his research, and claims to have demonstrated the presence of genuine words.（加布里埃尔・兰迪尼博士在研究中使用了名为_\\___\\__的系统，声称证明了真实单词的存在。）\n答案：spectral analysis（频谱分析）\n解析：定位 Paragraph 7 中 “Dr Gabriel Landini... published the results of his study of the manuscript using a pattern-detecting method called spectral analysis. This revealed evidence that the manuscript contains genuine words”，“使用频谱分析发现真实单词”，因此答案为 “spectral analysis”。",
          "questionId": "q38"
        },
        {
          "questionNumber": 39,
          "text": "（5）题目 39：Dr Gordon Rugg’s system involved a grille, that made it possible to quickly select symbols that appeared in a \\___\\___.（戈登・拉格博士的系统使用了格栅，能快速从_\\___\\__中选取出现的符号。）\n答案：table（表格）\n解析：定位 Paragraph 8 中 “using a system first published by the Italian mathematician Girolamo Cardano in 1150, in which a specially constructed grille is used to pick out symbols from a table”，“从表格中选取符号”，因此答案为 “table”。",
          "questionId": "q39"
        }
      ],
      "questionRange": {
        "start": 35,
        "end": 39
      },
      "text": "答案：microscope（显微镜）\n解析：定位 Paragraph 3 中 “the manuscript proved that Bacon had access to a microscope centuries before they were supposedly first invented. The claim that this medieval monk had observed living cells”，“使用显微镜观察细胞”，因此答案为 “microscope”。\n答案：concepts（概念）\n解析：定位 Paragraph 5 中 “‘Voynichese’ is some sort of specially created artificial language, whose words are devised from concepts rather than linguistics”，“词汇基于概念”，因此答案为 “concepts”。\n答案：computer（计算机）\n解析：定位 Paragraph 6 中 “he suspected that major insights would come from using the device that had already transformed code-breaking: the computer”，“计算机是密码破译的关键工具”，因此答案为 “computer”。\n答案：spectral analysis（频谱分析）\n解析：定位 Paragraph 7 中 “Dr Gabriel Landini... published the results of his study of the manuscript using a pattern-detecting method called spectral analysis. This revealed evidence that the manuscript contains genuine words”，“使用频谱分析发现真实单词”，因此答案为 “spectral analysis”。\n答案：table（表格）\n解析：定位 Paragraph 8 中 “using a system first published by the Italian mathematician Girolamo Cardano in 1150, in which a specially constructed grille is used to pick out symbols from a table”，“从表格中选取符号”，因此答案为 “table”。"
    },
    {
      "sectionTitle": "4. 主旨题（Question 40：Choose A–D）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 40,
          "text": "题目 40：The writer’s main aim in this passage is to（作者的主要目的是？）\n答案：C（describe the numerous attempts to decode the manuscript. 描述破译手稿的诸多尝试）\n解析：全文依次介绍 “伏尼契、纽博尔德、弗里德曼、兰迪尼、赞德贝根、拉格” 等不同研究者的破译方法与结论，核心是 “描述众多破译尝试”，因此选 C。A（解释手稿含义）、B（确定作者身份）、D（识别媒体关注度最高的研究）均未实现，因此排除。",
          "questionId": "q40"
        }
      ],
      "questionRange": {
        "start": 40,
        "end": 40
      },
      "text": "答案：C（describe the numerous attempts to decode the manuscript. 描述破译手稿的诸多尝试）\n解析：全文依次介绍 “伏尼契、纽博尔德、弗里德曼、兰迪尼、赞德贝根、拉格” 等不同研究者的破译方法与结论，核心是 “描述众多破译尝试”，因此选 C。A（解释手稿含义）、B（确定作者身份）、D（识别媒体关注度最高的研究）均未实现，因此排除。"
    }
  ]
}
  );
})(typeof window !== "undefined" ? window : globalThis);
