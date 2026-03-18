(function registerReadingExplanationData(global) {
  'use strict';
  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== "function") {
    throw new Error("reading_explanation_registry_missing");
  }
  global.__READING_EXPLANATION_DATA__.register("p3-high-161", {
  "schemaVersion": "ReadingExplanationV1",
  "examId": "p3-high-161",
  "meta": {
    "examId": "p3-high-161",
    "title": "Insect-inspired robots 昆虫机器人",
    "category": "P3",
    "sourceDoc": "P3 解析+1202高频_副本.md",
    "noteType": "总结",
    "matchedTitle": "Insect-inspired robots 昆虫机器人"
  },
  "passageNotes": [
    {
      "label": "Paragraph A",
      "text": "小虫穿越空旷盐滩、蟑螂翻越障碍、螳螂虾用高光谱眼睛扫描水下世界 —— 昆虫用微小大脑和简单器官解决复杂的移动、视觉和导航问题（处理数据堪比超级计算机）。这一能力推动 “仿生学与仿生机器人” 发展（模仿昆虫系统控制人造机器），近期会议展示了该领域的研究成果。"
    },
    {
      "label": "Paragraph B",
      "text": "亚历克斯・泽林斯基（Alex Zelinsky）博士提出，胡蜂利用地标返巢的方式，未来可能应用于汽车导航。他的团队研发的机器人，通过全景相机识别 50 个不同地标实现导航。灵感源于胡蜂：胡蜂离巢时会回头定位，通过往返飞行从不同角度记忆巢穴特征。机器人的全景相机会记录周边区域和关键地标，按导航可靠性存储，再将地标按大小缩放（判断距离远近），构建多尺度地图并指导转向。该技术为机器导航未知环境提供通用方案。"
    },
    {
      "label": "Paragraph C",
      "text": "三十年来，吕迪格・韦纳（Ruediger Wehner）教授从瑞士前往撒哈拉沙漠，研究猫蚁（Cataglyphis）—— 这种体重仅 0.1 毫克的蚂蚁离巢觅食后能精准返巢。猫蚁利用 “空气分子散射光线形成的偏振光” 定位，眼睛上缘有专门感光器探测偏振光，其他感光器负责其他导航任务。太阳移动时，蚂蚁每次离巢都会记录方向并更新内置罗盘；通过眼部其他感光器存储巢口附近地标的快照，返巢时比对；还能测量行进距离，路径整合器定期告知相对于起点的当前位置。蚂蚁不在大脑整合所有信息，而是在不同器官完成复杂计算，如同超级计算机同时运行多个子程序。韦纳团队模仿蚂蚁的偏振光导航和图像存储能力，研发出 “Sahabot”—— 配备偏振器和 CCD 相机，存储 360° 环境图像，通过偏振光和地标图像比对实现导航。"
    },
    {
      "label": "Paragraph D",
      "text": "罗伯特・米歇尔森（Robert Michelson）教授面临不同沙漠挑战 —— 设计能在火星稀薄大气中导航、悬停的飞行机器人。受昆虫飞行启发，他突破自然限制，提出全新飞行概念 “Entomopter”（昆虫飞行器）：类似双头蜻蜓，翅膀往复拍打。米歇尔森指出，扑翼设计比固定翼飞行器升力更高，能在火星稀薄大气中低速飞行或悬停（固定翼需超 400 公里 / 小时速度，无法停留探索）。"
    },
    {
      "label": "Paragraph E",
      "text": "工程师罗杰・奎因（Roger Quinn）和昆虫学家罗伊・里茨曼（Roy Ritzmann）教授从蟑螂获取灵感。他们认为，蟑螂在崎岖地形快速奔跑的能力，未来可能催生六足全地形车或 “轮足（whegs）” 车。蟑螂越野能力的关键在于 “腿部无需大脑指令即可自主决策”。团队借鉴蟑螂技能，研发机器人行走装置和控制策略，捕捉其穿越复杂地形、避障导航的能力，已设计出六足或轮足机器人，能应对崎岖地形。"
    },
    {
      "label": "Paragraph F",
      "text": "国际专家认为仿生机器人领域机遇巨大，但会议代表对未来展望不同：部分担忧初期应用可能用于军事；芭芭拉・韦伯（Barbara Webb）博士等预测，廉价昆虫型机器人集群将成为社会清洁工；索尼娅・克莱因洛格尔（Sonja Kleinlogel）希望研究螳螂虾的高光谱眼睛，研发监测海洋环境健康的远程传感器；多位代表关注仿生机器人的伦理问题，呼吁发展中密切关注。"
    }
  ],
  "questionExplanations": [
    {
      "sectionTitle": "1. 段落匹配（Questions 27–32：Which section contains the following information?）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 27,
          "text": "（1）题目 27：positive and negative possibilities for the use of insect-inspired robots（昆虫灵感机器人的积极与消极应用可能）\n答案：F\n解析：定位 Paragraph F 中 “some were concerned that the initial applications of biorobotics may be military, others... predicted swarms of tiny, cheap, insect-like robots as society’s cleaners and collectors... Several delegates were concerned about the ethical implications”，明确提到 “军事（消极）、清洁（积极）、伦理担忧（消极）”，与题干对应，因此答案为 F。",
          "questionId": "q27"
        },
        {
          "questionNumber": 28,
          "text": "（2）题目 28：how perceived size is used as an aid to navigation（感知大小如何用于辅助导航）\n答案：B\n解析：定位 Paragraph B 中 “The landmarks are then scaled, from small to large, so that the robot can recognise whether it is getting closer to or further away from them”，明确提到 “通过地标大小判断距离，辅助导航”，与题干对应，因此答案为 B。",
          "questionId": "q28"
        },
        {
          "questionNumber": 29,
          "text": "（3）题目 29：an example of decision-making taking place in the limbs（肢体自主决策的例子）\n答案：E\n解析：定位 Paragraph E 中 “the key to the cockroach’s remarkable cross-country performance lies partly in the fact that its legs do a lot of the thinking without having to consult the brain”，明确提到 “蟑螂腿部无需大脑指令即可决策”，与题干对应，因此答案为 E。",
          "questionId": "q29"
        },
        {
          "questionNumber": 30,
          "text": "（4）题目 30：a description of a potential aid in space exploration（太空探索潜在辅助工具的描述）\n答案：D\n解析：定位 Paragraph D 中 “design a flying robot that can not only navigate but also stay aloft and hover in the thin atmosphere of Mars... the ‘Entomopter’... enabling it to fly slowly or hover in the thin Martian air”，明确提到 “火星探索用昆虫飞行器”，与题干对应，因此答案为 D。",
          "questionId": "q30"
        },
        {
          "questionNumber": 31,
          "text": "（5）题目 31：the range of skills that have inspired biorobotics（启发仿生机器人的多种技能范围）\n答案：A\n解析：定位 Paragraph A 中 “A tiny insect navigates... A cockroach successfully works out how to scramble over an obstacle. The mantis shrimp scans its aquatic world through hyperspectral eyes”，列举 “导航、越障、视觉” 等多种昆虫技能，与题干对应，因此答案为 A。",
          "questionId": "q31"
        },
        {
          "questionNumber": 32,
          "text": "（6）题目 32：how a variety of navigational methods operate at the same time（多种导航方式如何同时运行）\n答案：C\n解析：定位 Paragraph C 中 “Cataglyphis uses polarised light... stores a snapshot image of landmarks... a way of measuring distance travelled... a path integrator periodically informs the ant of its current position... the ant actually performs a number of complex calculations in different organs... many separate sub-routines going on simultaneously”，明确提到 “偏振光、地标快照、距离测量等多种导航方式并行”，与题干对应，因此答案为 C。",
          "questionId": "q32"
        }
      ],
      "questionRange": {
        "start": 27,
        "end": 32
      },
      "text": "答案：F\n解析：定位 Paragraph F 中 “some were concerned that the initial applications of biorobotics may be military, others... predicted swarms of tiny, cheap, insect-like robots as society’s cleaners and collectors... Several delegates were concerned about the ethical implications”，明确提到 “军事（消极）、清洁（积极）、伦理担忧（消极）”，与题干对应，因此答案为 F。\n答案：B\n解析：定位 Paragraph B 中 “The landmarks are then scaled, from small to large, so that the robot can recognise whether it is getting closer to or further away from them”，明确提到 “通过地标大小判断距离，辅助导航”，与题干对应，因此答案为 B。\n答案：E\n解析：定位 Paragraph E 中 “the key to the cockroach’s remarkable cross-country performance lies partly in the fact that its legs do a lot of the thinking without having to consult the brain”，明确提到 “蟑螂腿部无需大脑指令即可决策”，与题干对应，因此答案为 E。\n答案：D\n解析：定位 Paragraph D 中 “design a flying robot that can not only navigate but also stay aloft and hover in the thin atmosphere of Mars... the ‘Entomopter’... enabling it to fly slowly or hover in the thin Martian air”，明确提到 “火星探索用昆虫飞行器”，与题干对应，因此答案为 D。\n答案：A\n解析：定位 Paragraph A 中 “A tiny insect navigates... A cockroach successfully works out how to scramble over an obstacle. The mantis shrimp scans its aquatic world through hyperspectral eyes”，列举 “导航、越障、视觉” 等多种昆虫技能，与题干对应，因此答案为 A。\n答案：C\n解析：定位 Paragraph C 中 “Cataglyphis uses polarised light... stores a snapshot image of landmarks... a way of measuring distance travelled... a path integrator periodically informs the ant of its current position... the ant actually performs a number of complex calculations in different organs... many separate sub-routines going on simultaneously”，明确提到 “偏振光、地标快照、距离测量等多种导航方式并行”，与题干对应，因此答案为 C。"
    },
    {
      "sectionTitle": "2. 简答题（Questions 33–36：NO MORE THAN THREE WORDS）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 33,
          "text": "（1）题目 33：Which creature sees particularly well under water?（哪种生物水下视力特别好？）\n答案：mantis shrimp（螳螂虾）\n解析：定位 Paragraph A 中 “The mantis shrimp scans its aquatic world through hyperspectral eyes”，“hyperspectral eyes”（高光谱眼睛）表明其水下视力好，因此答案为 “mantis shrimp”。",
          "questionId": "q33"
        },
        {
          "questionNumber": 34,
          "text": "（2）题目 34：In addition to a computer, what technical equipment is fitted in Dr Zelinsky’s robot?（除计算机外，泽林斯基博士的机器人还配备什么技术设备？）\n答案：(a) panoramic camera（全景相机）\n解析：定位 Paragraph B 中 “A research team led by Dr Zelinsky has shown that a robot can navigate its way among 50 different landmarks by recognising them individually using a panoramic camera”，明确提到 “全景相机”，因此答案为 “(a) panoramic camera”。",
          "questionId": "q34"
        },
        {
          "questionNumber": 35,
          "text": "（3）题目 35：Where is the Cataglyphis ant found?（猫蚁在哪里被发现？）\n答案：the Sahara Desert（撒哈拉沙漠）\n解析：定位 Paragraph C 中 “journeyed from Switzerland to the Sahara Desert where Cataglyphis... performs acts of navigational genius”，明确提到 “撒哈拉沙漠”，因此答案为 “the Sahara Desert”。",
          "questionId": "q35"
        },
        {
          "questionNumber": 36,
          "text": "（4）题目 36：What atmospheric effect helps the Cataglyphis ant to know its direction?（哪种大气效应帮助猫蚁判断方向？）\n答案：polarised light（偏振光）\n解析：定位 Paragraph C 中 “Cataglyphis uses polarised light, caused when air molecules scatter light, to orient and steer itself”，明确提到 “偏振光”，因此答案为 “polarised light”。",
          "questionId": "q36"
        }
      ],
      "questionRange": {
        "start": 33,
        "end": 36
      },
      "text": "答案：mantis shrimp（螳螂虾）\n解析：定位 Paragraph A 中 “The mantis shrimp scans its aquatic world through hyperspectral eyes”，“hyperspectral eyes”（高光谱眼睛）表明其水下视力好，因此答案为 “mantis shrimp”。\n答案：(a) panoramic camera（全景相机）\n解析：定位 Paragraph B 中 “A research team led by Dr Zelinsky has shown that a robot can navigate its way among 50 different landmarks by recognising them individually using a panoramic camera”，明确提到 “全景相机”，因此答案为 “(a) panoramic camera”。\n答案：the Sahara Desert（撒哈拉沙漠）\n解析：定位 Paragraph C 中 “journeyed from Switzerland to the Sahara Desert where Cataglyphis... performs acts of navigational genius”，明确提到 “撒哈拉沙漠”，因此答案为 “the Sahara Desert”。\n答案：polarised light（偏振光）\n解析：定位 Paragraph C 中 “Cataglyphis uses polarised light, caused when air molecules scatter light, to orient and steer itself”，明确提到 “偏振光”，因此答案为 “polarised light”。"
    },
    {
      "sectionTitle": "3. 人物 - 机器人匹配（Questions 37–40：Choose A–G）",
      "mode": "group",
      "items": [
        {
          "questionNumber": 37,
          "text": "（1）题目 37：Dr Alex Zelinsky（亚历克斯・泽林斯基博士）\n答案：D（a robot that categorises information from the environment according to its usefulness. 按实用性分类环境信息的机器人）\n解析：定位 Paragraph B 中 “the robot’s panoramic camera logs the surrounding area and its key landmarks, which are then stored in its computer according to how reliable they are as navigational aids”，“按导航可靠性存储” 对应 “按实用性分类”，因此选 D。",
          "questionId": "q37"
        },
        {
          "questionNumber": 38,
          "text": "（2）题目 38：Professor Ruediger Wehner（吕迪格・韦纳教授）\n答案：A（a robot that makes use of light as well as stored images for navigational purposes. 利用光线和存储图像导航的机器人）\n解析：定位 Paragraph C 中 “Sahabot... uses polarisers and a CCD camera to store 360° images of its surroundings. It navigates by using polarised sunlight and comparing the current images of landmarks to the ones in its memory”，“偏振光 + 图像比对” 对应 “light as well as stored images”，因此选 A。",
          "questionId": "q38"
        },
        {
          "questionNumber": 39,
          "text": "（3）题目 39：Professor Robert Michelson（罗伯特・米歇尔森教授）\n答案：F（a robot that has improved on the ability of the insect on which it is based. 在模仿昆虫能力基础上改进的机器人）\n解析：定位 Paragraph D 中 “Drawing inspiration from insect flight, he has gone beyond nature to devise a completely new concept for a flying machine... the flapping-wing design gives the craft unusually high lift compared with a fixed-wing flyer”，“突破自然限制、升力更高” 对应 “improved on the ability of the insect”，因此选 F。",
          "questionId": "q39"
        },
        {
          "questionNumber": 40,
          "text": "（4）题目 40：Roger Quinn and Professor Roy Ritzmann（罗杰・奎因与罗伊・里茨曼教授）\n答案：C（a robot that can move over difficult surfaces. 能在复杂表面移动的机器人）\n解析：定位 Paragraph E 中 “the ability of cockroaches to run very fast over rough terrain... the team has already designed a series of robots that run on six legs or on whegs, enabling them to handle surprisingly rugged terrain”，“应对崎岖地形” 对应 “move over difficult surfaces”，因此选 C。",
          "questionId": "q40"
        }
      ],
      "questionRange": {
        "start": 37,
        "end": 40
      },
      "text": "答案：D（a robot that categorises information from the environment according to its usefulness. 按实用性分类环境信息的机器人）\n解析：定位 Paragraph B 中 “the robot’s panoramic camera logs the surrounding area and its key landmarks, which are then stored in its computer according to how reliable they are as navigational aids”，“按导航可靠性存储” 对应 “按实用性分类”，因此选 D。\n答案：A（a robot that makes use of light as well as stored images for navigational purposes. 利用光线和存储图像导航的机器人）\n解析：定位 Paragraph C 中 “Sahabot... uses polarisers and a CCD camera to store 360° images of its surroundings. It navigates by using polarised sunlight and comparing the current images of landmarks to the ones in its memory”，“偏振光 + 图像比对” 对应 “light as well as stored images”，因此选 A。\n答案：F（a robot that has improved on the ability of the insect on which it is based. 在模仿昆虫能力基础上改进的机器人）\n解析：定位 Paragraph D 中 “Drawing inspiration from insect flight, he has gone beyond nature to devise a completely new concept for a flying machine... the flapping-wing design gives the craft unusually high lift compared with a fixed-wing flyer”，“突破自然限制、升力更高” 对应 “improved on the ability of the insect”，因此选 F。\n答案：C（a robot that can move over difficult surfaces. 能在复杂表面移动的机器人）\n解析：定位 Paragraph E 中 “the ability of cockroaches to run very fast over rough terrain... the team has already designed a series of robots that run on six legs or on whegs, enabling them to handle surprisingly rugged terrain”，“应对崎岖地形” 对应 “move over difficult surfaces”，因此选 C。"
    }
  ]
}
  );
})(typeof window !== "undefined" ? window : globalThis);
