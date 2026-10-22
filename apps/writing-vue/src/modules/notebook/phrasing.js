/**
 * 札记 phrase bank — how a day's deterministic facts are put into words.
 *
 * Zero model calls. Rules (insight.js, compose.js) decide WHAT a day says; this
 * file decides how it is worded. Every slot has at least six plain variants, so
 * a fortnight of entries does not read like one template.
 *
 *   BANK   fact type -> condition key -> variants ("{name}" = a fact field)
 *   RULES  fact type -> (facts) => condition key, or null to say nothing
 *
 * Picking is seeded and stable. Each fact type + condition key owns a
 * "shuffle bag": calendar days are cut into blocks as long as the variant list,
 * and every block is a seeded permutation of the list. So the same date always
 * yields the same wording on every reload and device, different days differ,
 * and two consecutive days never share a variant. A fact that is missing, or a
 * placeholder that cannot be filled, yields no sentence at all: never a dangling
 * "{x}" or stray punctuation.
 *
 * Wording rules: "这一天" appears only in the opening line of an entry. No "今天"
 * anywhere (entries are often historical). No cheerleading, no exclamation marks,
 * no emoji. Numbers are whole percents, half bands, or "对 11/14" counts, never
 * decimals or "+21%".
 */

/** A gap this long (in calendar days) since the previous practiced day is worth a remark. */
export const LONG_GAP_DAYS = 5

const firstMatch = (table) => (facts) => table.find(([test]) => test(facts))?.[1] ?? null

const NOTE_KEYS = {
  new_candidate: 'new',
  created: 'new',
  reinforced: 'reinforced',
  promoted: 'promoted',
  refined: 'refined',
  improved: 'improved',
  regressed: 'regressed',
  contradicted: 'contradicted',
  superseded: 'superseded'
}

export const BANK = {
  // ---- v1 headings (used when a day has no reading or writing rows to speak of)
  title: {
    improved: [
      '{type}有了起色',
      '{type}做得比较顺',
      '{type}往前挪了一步',
      '{type}这次表现不错',
      '{type}比之前更稳了一点',
      '{type}看得出在变稳'
    ],
    recurring: [
      '{type}仍需留意',
      '{type}还有些不稳',
      '回头再看{type}',
      '{type}值得再看一遍',
      '{type}还要多练几遍',
      '{type}是接下来要盯的地方'
    ],
    quiet: [
      '安静的一天',
      '没有练习的一天',
      '留白的一页',
      '没有新记录的一天',
      '这一页没有练习',
      '暂时没有练习记录'
    ],
    noted: [
      '一点新的了解',
      '记下一点新的看法',
      '这一页有一点新的观察',
      '值得记下的一点',
      '一条新的观察',
      '新添一点观察'
    ],
    first: [
      '札记的第一页',
      '从这里开始',
      '最初的一页',
      '第一天的记录',
      '札记的起点',
      '先记下第一天'
    ],
    gap: [
      '久违的一页',
      '隔了一阵子的记录',
      '重新拾起练习',
      '回到练习',
      '停了一阵之后的练习',
      '暂停之后的重新开始'
    ],
    several: [
      '一段扎实的练习',
      '连着做了几次',
      '一天里的几次练习',
      '几次练习记在这里',
      '练习做得比较密',
      '一口气做了几组'
    ],
    single: [
      '一次练习',
      '做了一次练习',
      '一次单独的练习',
      '一次简短的练习',
      '单独的一次练习',
      '只做了一组练习'
    ],
    writing: [
      '写作的一天',
      '动笔的一天',
      '写下来的一天',
      '一天里的写作',
      '落笔的一天',
      '以写作为主的一天'
    ],
    // Integration-only fallback: a host may report reading rows without an
    // attempt count, and a practiced day still needs a heading (see RULES.title).
    reading: [
      '做了一组阅读题',
      '读文章、做题的一天',
      '在阅读上花了一些时间的一天',
      '阅读练习的一天',
      '一组阅读题的一天',
      '读读写写的一天'
    ],
    // Integration-only fallback: a day with coach feedback but no attempt,
    // writing or skill movement still needs a heading (see RULES.title).
    coach: [
      '与教练讲解有关的一天',
      '和教练的讲解打过交道的一天',
      '在教练的讲解上停留的一天',
      '与教练的一番交流',
      '在教练讲解上花了一些时间的一天',
      '留下教练讲解记录的一天'
    ]
  },

  // ---- the daily headline (①): the one sentence a card leads with
  insightTitle: {
    both: [
      '{up}进步了，{down}还在丢分',
      '{up}有起色，{down}仍需盯住',
      '{up}在变好，{down}还没稳住',
      '{up}往前走了，{down}还在丢分',
      '{up}做得顺，{down}是下一步的重点',
      '{up}有进展，{down}还要再练'
    ],
    writingDrop: [
      '写作 {criterion} 掉了半分',
      '写作里 {criterion} 退了半分',
      '{criterion} 这次掉了半分',
      '写作的 {criterion} 往下走了半分',
      '写作 {criterion} 少了半分，值得看一看',
      '{criterion} 比上次低了半分'
    ],
    readingUp: [
      '{up}进步了',
      '{up}有了起色',
      '{up}这次明显更稳',
      '{up}往前走了一步',
      '{up}做得比之前顺',
      '{up}在变稳'
    ],
    readingMiss: [
      '{down}还在丢分',
      '{down}仍需留意',
      '{down}是这次的主要失分点',
      '{down}还要多练几遍',
      '{down}这次还不稳',
      '{down}是接下来要盯的一类'
    ],
    writingRise: [
      '写作 {criterion} 涨了半分',
      '写作里 {criterion} 上去了半分',
      '{criterion} 这次涨了半分',
      '写作的 {criterion} 往上走了半分',
      '写作 {criterion} 进步了半分',
      '{criterion} 比上次高了半分'
    ],
    steady: [
      '这次的题做得平稳',
      '这一页的练习没有大的起伏',
      '各项与之前差不多',
      '练习的结果和平时接近',
      '没有明显的起伏，按节奏走就好',
      '这次的练习与往常持平'
    ]
  },

  // ---- ② one line per question kind (TFNG 14 对 11（79%）...)
  readingLine: {
    repeat: [
      '{name}在 {assets} 套不同的题里都有丢分，正确率 {pct}%，是要盯住的一类。',
      '{name}在 {assets} 套题里反复丢分，这次正确率 {pct}%。',
      '{name}跨 {assets} 套题都出现了失分，正确率 {pct}%，需要专门练。',
      '{name}在 {assets} 套不同的题里都错过，正确率 {pct}%。',
      '{name}的失分不止一套题，这次 {pct}%，值得专门看。',
      '{name}在多套题里都有错，这次正确率 {pct}%，是要盯住的一类。'
    ],
    insufficient: [
      '{name} {total} 题，对了 {correct}（{pct}%）。',
      '{name}这次 {total} 题对 {correct}（{pct}%）。',
      '{name}做了 {total} 题，对 {correct}（{pct}%）。',
      '{name} 对 {correct}/{total}（{pct}%）。',
      '{name}这一组对了 {correct}/{total}，正确率 {pct}%。',
      '{name}这次的正确率是 {pct}%，对了 {correct}/{total}。'
    ],
    down: [
      '{name} {total} 题对 {correct}（{pct}%），这周此前 {basePct}%，低了 {points} 个百分点。',
      '{name} 对 {correct}/{total}（{pct}%），这周此前是 {basePct}%，有所回落。',
      '{name}这次 {correct}/{total}（{pct}%），比这周此前的 {basePct}% 低了 {points} 个百分点。',
      '{name}对了 {correct}/{total}（{pct}%），这周此前 {basePct}%，掉了一些。',
      '{name} {total} 题对 {correct}（{pct}%），这周此前为 {basePct}%，有所退步。',
      '{name}这次 {correct}/{total}（{pct}%），这周此前 {basePct}%，退了 {points} 个百分点。'
    ],
    high: [
      '{name} {total} 题对 {correct}（{pct}%），丢分比较多。',
      '{name}只对了 {correct}/{total}（{pct}%），失分集中在这里。',
      '{name}对 {correct}/{total}（{pct}%），这一类还需要多练。',
      '{name}这次错得多，{correct}/{total} 对（{pct}%）。',
      '{name}的正确率只有 {pct}%，{correct}/{total}，要重点看。',
      '{name}对 {correct}/{total}，{pct}%，这一类目前是弱项。'
    ],
    up: [
      '{name} {total} 题对 {correct}（{pct}%），这周此前 {basePct}%，高了 {points} 个百分点。',
      '{name} 对 {correct}/{total}（{pct}%），这周此前是 {basePct}%，往上走了。',
      '{name}这次 {correct}/{total}（{pct}%），比这周此前的 {basePct}% 高了 {points} 个百分点。',
      '{name}对了 {correct}/{total}（{pct}%），这周此前 {basePct}%，有进步。',
      '{name} {total} 题对 {correct}（{pct}%），这周此前为 {basePct}%，在变好。',
      '{name}这次 {correct}/{total}（{pct}%），这周此前 {basePct}%，提升了 {points} 个百分点。'
    ],
    flat: [
      '{name} {total} 题对 {correct}（{pct}%），和这周此前（{basePct}%）差不多。',
      '{name}对 {correct}/{total}（{pct}%），与这周此前的 {basePct}% 接近。',
      '{name}这次 {correct}/{total}（{pct}%），这周此前 {basePct}%，没有明显变化。',
      '{name}对了 {correct}/{total}（{pct}%），和这周此前（{basePct}%）持平。',
      '{name} {total} 题对 {correct}（{pct}%），这周此前 {basePct}%，基本稳定。',
      '{name}的正确率 {pct}%，这周此前 {basePct}%，变化不大。'
    ]
  },

  // The one sentence on the top-missed question set.
  topMiss: {
    withKind: [
      '《{title}》这套题错得最多，主要在{zh}。',
      '这次练习里错得最多的是《{title}》，集中在{zh}。',
      '《{title}》里错的题最多（错 {wrong}/{total}），主要在{zh}。',
      '错得最多的一套是《{title}》，丢分主要在{zh}。',
      '《{title}》这套题错了 {wrong}/{total}，主要在{zh}。',
      '这套题丢分最多：《{title}》，集中在{zh}。'
    ],
    plain: [
      '《{title}》这套题错得最多，丢分比较集中。',
      '《{title}》这套题错了 {wrong}/{total}，是最需要回看的一套。',
      '丢分最多的是《{title}》，错了 {wrong}/{total}。',
      '《{title}》这套题错得最多（{wrong}/{total}）。',
      '《{title}》是这次错得最多的一套。',
      '这次练习里，《{title}》的错题最多。'
    ]
  },

  // ---- ③ writing
  writingLine: {
    legacy: [
      '写作交了 {count} 篇，约 Band {band}。',
      '写作 {count} 篇，评分约为 Band {band}。',
      '提交了 {count} 篇写作，均分约 Band {band}。',
      '{count} 篇写作已经评完，约为 Band {band}。',
      '写作方面，{count} 篇的评分约为 Band {band}。',
      '写作交了 {count} 篇，平均约在 Band {band}。'
    ],
    first: [
      '写作 {count} 篇，均分约 Band {band}，之后可以拿它来对照。',
      '写作交了 {count} 篇，均分约 Band {band}，这是对照的起点。',
      '{count} 篇写作，均分约 Band {band}，先作为之后比较的基准。',
      '写作均分约 Band {band}（{count} 篇），以后的写作可以和它对照。',
      '这是第一组可以比较的写作，均分约 Band {band}。',
      '写作 {count} 篇，均分约 Band {band}，以后就拿它来比。'
    ],
    up: [
      '写作均分约 Band {band}，比上次写作高了{delta}。',
      '写作均分约 Band {band}，比上次写作提高了{delta}。',
      '写作均分约 Band {band}，比上次高了{delta}，往上走了。',
      '写作均分约 Band {band}，较上次写作有{delta}的进步。',
      '这次写作均分约 Band {band}，比上次高了{delta}。',
      '写作均分约 Band {band}，比上一篇写作的均分高了{delta}。'
    ],
    down: [
      '写作均分约 Band {band}，比上次写作低了{delta}。',
      '写作均分约 Band {band}，比上次写作退了{delta}。',
      '写作均分约 Band {band}，较上次写作少了{delta}，需要留意。',
      '这次写作均分约 Band {band}，比上次低了{delta}。',
      '写作均分约 Band {band}，比上一篇写作的均分少了{delta}。',
      '写作均分约 Band {band}，比上次掉了{delta}。'
    ],
    same: [
      '写作均分约 Band {band}，和上次写作持平。',
      '写作均分约 Band {band}，与上次写作差不多。',
      '写作均分约 Band {band}，和上一篇写作持平。',
      '这次写作均分约 Band {band}，与上次一样。',
      '写作均分约 Band {band}，和之前的水平接近。',
      '写作均分约 Band {band}，比上次没有变化。'
    ]
  },

  // One criterion that moved by at least half a band: 「TR（任务回应）涨了半分」.
  criterionLine: {
    up: [
      '{label}涨了{delta}。',
      '{label}比上次高了{delta}。',
      '{label}这次涨了{delta}。',
      '{label}往上走了{delta}。',
      '{label}有{delta}的进步。',
      '{label}比之前涨了{delta}。'
    ],
    down: [
      '{label}掉了{delta}。',
      '{label}比上次低了{delta}。',
      '{label}这次退了{delta}。',
      '{label}往下掉了{delta}。',
      '{label}少了{delta}，需要留意。',
      '{label}退了{delta}，要再看一看。'
    ]
  },

  // ---- ④ learner model
  dueLine: {
    due: [
      '有 {due} 个复习到期，别让它们堆着。',
      '到期的复习有 {due} 个，先过一遍。',
      '{due} 个复习已经到期，按顺序做掉。',
      '有 {due} 个复习到了时间，不必一次做完。',
      '复习到期的有 {due} 个，先从最早的开始。',
      '{due} 个到期的复习在等着，逐个过就行。'
    ]
  },

  weakLine: {
    weak: [
      '最弱的一项是「{label}」，近期错误率约 {rate}%。',
      '近期错得最多的是「{label}」，错误率约 {rate}%。',
      '「{label}」是目前最弱的一项，近期错误率约 {rate}%。',
      '学习模型里，「{label}」的近期错误率最高，约 {rate}%。',
      '「{label}」还需要多练，近期错误率约 {rate}%。',
      '目前最需要补的是「{label}」，近期错误率约 {rate}%。'
    ]
  },

  // ---- ⑤ the one thing for tomorrow
  tomorrow: {
    missKind: [
      '明天只做一件事：重做{name}，先把每道错题的原文定位写下来。',
      '明天只做一件事：回头把{name}的错题再做一遍，逐题说明判断依据。',
      '明天只做一件事：拿一组{name}，做完后只看错的题。',
      '明天只做一件事：练{name}，每错一题就找出原文里的对应句。',
      '明天只做一件事：把{name}的错题按原因分类，再做一组新的。',
      '明天只做一件事：集中做一组{name}，错的题先不急着看答案。'
    ],
    writing: [
      '明天只做一件事：写一篇作文，专门盯住{criterion}（{zh}）。',
      '明天只做一件事：写一段短文，把注意力放在{criterion}（{zh}）上。',
      '明天只做一件事：写一篇作文后，只检查{criterion}（{zh}）那一部分。',
      '明天只做一件事：改写一篇旧作文，先修{criterion}（{zh}）。',
      '明天只做一件事：重写一段，专门练{criterion}（{zh}）。',
      '明天只做一件事：写一篇练习，写完对照{criterion}（{zh}）的要求检查。'
    ],
    readingDown: [
      '明天只做一件事：做一组{name}，做完先对照错题的判断依据。',
      '明天只做一件事：练一组{name}，错的题逐个回到原文核对。',
      '明天只做一件事：做一组新的{name}，先不看答案。',
      '明天只做一件事：把{name}的错题再过一遍，写下错在哪一步。',
      '明天只做一件事：集中练{name}，每一题都说明为什么选它。',
      '明天只做一件事：做一组{name}，做完只复盘错的那几题。'
    ],
    due: [
      '明天只做一件事：先过完 {due} 个到期的复习。',
      '明天只做一件事：把 {due} 个到期的复习逐个过一遍。',
      '明天只做一件事：先处理 {due} 个到期复习，再开始新题。',
      '明天只做一件事：复习到期的 {due} 项，其余的留到后面。',
      '明天只做一件事：从最早到期的复习开始，做完 {due} 项。',
      '明天只做一件事：把 {due} 个到期复习做完就够了。'
    ],
    keep: [
      '明天只做一件事：完整做完一套题，不必追求更多。',
      '明天只做一件事：保持节奏，完整做一套题。',
      '明天只做一件事：按计划做一套完整的题。',
      '明天只做一件事：安排一套完整练习，按时间做完。',
      '明天只做一件事：做一套题，做完再看结果。',
      '明天只做一件事：保持现在的节奏，做一套完整的题。'
    ]
  },

  planLink: {
    link: [
      '计划里已有「{label}」，就从它开始。',
      '计划里正好有「{label}」，可以直接做。',
      '「{label}」已经在计划里，从它开始最顺。',
      '计划中的「{label}」刚好对上，先做它。',
      '可以直接从计划里的「{label}」开始。',
      '计划里有「{label}」这一项，照着做就行。'
    ]
  },

  // ---- opening line of the 观察 paragraph: the only place "这一天" may appear
  opening: {
    first: [
      '这是札记的第一页，从这一天开始记。',
      '札记从这一天开始，先记下当天的情况。',
      '第一页，先记下这一天做了什么。',
      '这一天是札记的起点。',
      '这一页从这一天开始写起。',
      '先从这一天记下练习的情况。'
    ],
    gap: [
      '距上一次练习已过去 {gap} 天，这一天算是重新开始。',
      '隔了 {gap} 天，又回到了练习上来。',
      '和上一次练习相隔 {gap} 天，这一页从回来的这一天记起。',
      '上一次练习还是 {gap} 天前，先看看这一天的情况。',
      '中断了 {gap} 天之后，这一天又有了练习记录。',
      '停了 {gap} 天，这一天重新开始练习。'
    ],
    quiet: [
      '这一天没有练习记录。',
      '这一天没有新的练习记录，这一页留白。',
      '这一天没有留下练习的痕迹。',
      '这一页留白，没有练习可记。',
      '这一天没有做题，也没有交作文。',
      '这一天的记录是空的。'
    ],
    noted: [
      '这一天没有练习，但记下了一点新的了解。',
      '这一天没有新的练习，只有一点新的观察。',
      '没有新的练习，只记下一点观察。',
      '这一天没有练习，记下的是一点新的看法。',
      '这一天没有做题，只留下一点新的观察。',
      '这一天没有练习，但有一条新的了解被记下。'
    ]
  },

  attempts: {
    single_timed: [
      '做了 {attempts} 次练习，约 {minutes} 分钟。',
      '完成了 {attempts} 次练习，前后约 {minutes} 分钟。',
      '练了 {attempts} 次，用时约 {minutes} 分钟。',
      '完成 {attempts} 次练习，用时约 {minutes} 分钟。',
      '这次做了 {attempts} 次练习，约 {minutes} 分钟。',
      '练习一共 {attempts} 次，用了约 {minutes} 分钟。'
    ],
    single: [
      '做了 {attempts} 次练习。',
      '完成了 {attempts} 次练习。',
      '练了 {attempts} 次。',
      '这次完成的是 {attempts} 次练习。',
      '做完了 {attempts} 次练习。',
      '完成的练习是 {attempts} 次。'
    ],
    several_timed: [
      '一共做了 {attempts} 次练习，加起来约 {minutes} 分钟。',
      '前后练了 {attempts} 次，约 {minutes} 分钟。',
      '练了 {attempts} 次，累计用时约 {minutes} 分钟。',
      '完成的练习有 {attempts} 次，用时约 {minutes} 分钟。',
      '共完成 {attempts} 次练习，约用 {minutes} 分钟。',
      '{attempts} 次练习做下来，约 {minutes} 分钟。'
    ],
    several: [
      '一共做了 {attempts} 次练习。',
      '共完成 {attempts} 次练习。',
      '一共练了 {attempts} 次。',
      '完成的练习有 {attempts} 次。',
      '前后做了 {attempts} 次练习。',
      '练习总计 {attempts} 次。'
    ]
  },

  // Study-plan lead line above the open items.
  practice: {
    single: [
      '计划里还剩一项没做：{label}，下次练习可以从它开始。',
      '下一次练习，从「{label}」开始就好。',
      '计划里只剩「{label}」这一项，留给下一次。',
      '「{label}」还没做，可以放在下一次。',
      '还剩「{label}」一项，下次练习时做它。',
      '计划里的最后一项是「{label}」，留到下次。'
    ],
    several: [
      '计划里还有 {count} 项没做，可以从第一项开始。',
      '还剩 {count} 项练习没做，先做排在最前面的那一项。',
      '接下来排着 {count} 项练习，不必一次做完，从第一项开始。',
      '{count} 项练习还在计划里，挑最前面的一项做起。',
      '计划里还有 {count} 项，先从最前面的一项做起。',
      '还有 {count} 项练习等着，按顺序来就好。'
    ]
  },

  // ---- weekly headline, only when the digest has no observation to take a title from
  weekTitle: {
    writing: [
      '这周的写作有了轮廓',
      '这周主要在写作上下功夫',
      '这一周的写作练得多一些',
      '写作是这段时间的重点',
      '这段时间多在练写作',
      '写作的节奏慢慢找到了'
    ],
    reading: [
      '这周主要在阅读上',
      '这段时间的阅读练习记在这里',
      '阅读是这段时间的重点',
      '这一周多在做阅读题',
      '这段时间的题目以阅读为主',
      '阅读的节奏在这段时间里慢慢稳下来'
    ],
    general: [
      '这段时间的整理',
      '这一段时间的小结',
      '这段时间的一些观察',
      '一段时间的练习记录',
      '这段时间的回顾',
      '这段时间的整理与观察'
    ]
  },

  // ---- memory notes: each (bank, key, day) is one pick
  note: {
    new: [
      '这是新注意到的一点。',
      '这一点是刚刚才看出来的。',
      '以前没有留意到这一点，这次记下了。',
      '这是新记下的一点。',
      '这一点是最近才显现出来的。',
      '这一点之前还没有足够的依据，现在有了。'
    ],
    reinforced: [
      '这一点再次得到印证。',
      '这一次的练习又印证了这一点。',
      '又一次看到了同样的情形。',
      '这一点和之前的观察吻合。',
      '这次的表现又一次支持了这一点。',
      '同样的情形又出现了一次。'
    ],
    promoted: [
      '这一点已确认为长期了解。',
      '这一点已经归入长期了解。',
      '这一点被确认下来，成了长期了解。',
      '这一点已经可以当作长期了解。',
      '这一点经过多次印证，已转为长期了解。',
      '这一点现在是长期了解的一部分了。'
    ],
    refined: [
      '这一点的表述更准确了。',
      '这一点现在说得更准确了。',
      '对这一点的描述更贴近实际了。',
      '这一点的措辞做了修正，更准确。',
      '这一点换了更贴切的说法。',
      '这一点的描述比之前更清楚了。'
    ],
    improved: [
      '这一点正在改善。',
      '这一点比之前有改善。',
      '这一点在慢慢好转。',
      '这方面在变好。',
      '这一点的情况比之前好了一些。',
      '这方面的表现有了起色。'
    ],
    regressed: [
      '这一点出现了回退。',
      '这一点比之前退了一些。',
      '这一点有所反复。',
      '这方面出现了回落。',
      '这一点的表现比之前弱了一些。',
      '这方面又有些反复，需要留意。'
    ],
    contradicted: [
      '这一点出现了反例，会被重新审视。',
      '出现了和这一点不符的情形，会再审视一遍。',
      '这一点遇到了反例，之后会重新审视。',
      '这一点和当天的表现对不上，会被重新审视。',
      '这一点有了不一致的证据，之后再核对。',
      '这一点与新的表现有出入，会重新核对。'
    ],
    superseded: [
      '这一点已被新的判断取代。',
      '这一点由新的判断接替了。',
      '这一点有了更新的判断，取代了原来的说法。',
      '原来的说法已被更新的判断取代。',
      '这一点的旧说法已经由新的判断替换。',
      '这一点现在以更新的判断为准。'
    ],
    other: [
      '这一点有所更新。',
      '这一点做了更新。',
      '这一点的记录有所变动。',
      '这一点有新的变化。',
      '这一点的记录已经更新。',
      '这一点的说法有了调整。'
    ]
  },

  // A second or later note of the same key on one day: its own verdict, never bare.
  noteAgain: {
    new: [
      '这一条同样是新注意到的。',
      '这一条也是刚刚才看出来的。',
      '这一条同样是新记下的。',
      '这一条也是这次才留意到的。',
      '这一条同样是最近才显现的。',
      '这一条也是新添的依据。'
    ],
    reinforced: [
      '这一条同样得到了印证。',
      '这一条也和观察吻合。',
      '这一条的情形同样又出现了。',
      '这一条同样得到了练习的支持。',
      '这一条也被这次的表现支持。',
      '这一条同样又得到一次印证。'
    ],
    promoted: [
      '这一条也已确认为长期了解。',
      '这一条同样归入了长期了解。',
      '这一条也被确认为长期了解。',
      '这一条同样可以当作长期了解。',
      '这一条也已经转为长期了解。',
      '这一条同样成了长期了解的一部分。'
    ],
    refined: [
      '这一条的表述也更准确了。',
      '这一条同样说得更贴近实际了。',
      '这一条的措辞也做了修正。',
      '这一条同样修正得更准确。',
      '这一条也换了更贴切的说法。',
      '这一条的描述同样更清楚了。'
    ],
    improved: [
      '这一条也在改善。',
      '这一条同样在慢慢好转。',
      '这一条也比之前有改善。',
      '这一条同样在变好。',
      '这一条的情况也比之前好了一些。',
      '这一条同样有了起色。'
    ],
    regressed: [
      '这一条也出现了回退。',
      '这一条同样有所反复。',
      '这一条也比之前退了一些。',
      '这一条同样出现了回落。',
      '这一条的表现也弱了一些。',
      '这一条同样又有些反复。'
    ],
    contradicted: [
      '这一条同样遇到了反例，会被重新审视。',
      '这一条也出现了不符的情形，会再审视。',
      '这一条的反例也记下了，之后会重新审视。',
      '这一条同样会被重新审视。',
      '这一条也有了不一致的证据，之后再核对。',
      '这一条同样与新的表现有出入，会重新核对。'
    ],
    superseded: [
      '这一条也已被新的判断取代。',
      '这一条同样由新的判断接替了。',
      '这一条的原说法也已被更新的判断取代。',
      '这一条同样有了更新的判断。',
      '这一条的旧说法也已经替换。',
      '这一条同样以更新的判断为准。'
    ],
    other: [
      '这一条同样有所更新。',
      '这一条也做了更新。',
      '这一条的记录同样有变动。',
      '这一条也有了新的变化。',
      '这一条的记录同样已经更新。',
      '这一条的说法也有了调整。'
    ]
  },

  // ---- v1 fallbacks (kept for hosts without v2 fields)
  changeLead: {
    both: [
      '{improvedNames}比较顺，{recurringNames}还不稳。',
      '{improvedNames}有进展，{recurringNames}还需留意。',
      '{improvedNames}做得顺，{recurringNames}还不太稳。',
      '{improvedNames}在变稳，{recurringNames}还要再看。',
      '有进展的是{improvedNames}；还不稳的是{recurringNames}。',
      '{improvedNames}有起色，{recurringNames}仍要多练。'
    ],
    improved: [
      '{improvedNames}做得比较顺。',
      '{improvedNames}有了起色。',
      '{improvedNames}这次比较顺。',
      '{improvedNames}在变稳。',
      '看得出{improvedNames}有进展。',
      '{improvedNames}这次表现不错。'
    ],
    recurring: [
      '{recurringNames}还不稳，需要留意。',
      '{recurringNames}还需要再看一看。',
      '要再留意的是{recurringNames}。',
      '{recurringNames}这次还不太稳。',
      '{recurringNames}仍然需要留意。',
      '{recurringNames}还要多练几遍。'
    ]
  }
}

export const RULES = {
  // ---- v2 daily entry
  insightTitle: firstMatch([
    [(f) => f.up && f.down, 'both'],
    [(f) => f.up, 'readingUp'],
    [(f) => f.criterion, 'writingDrop'],
    [(f) => f.down, 'readingMiss'],
    [(f) => f.rise, 'writingRise'],
    [() => true, 'steady']
  ]),
  readingLine: firstMatch([
    [(f) => f.repeat, 'repeat'],
    [(f) => !f.hasBase, 'insufficient'],
    [(f) => f.trend === 'down', 'down'],
    [(f) => f.highError, 'high'],
    [(f) => f.trend === 'up', 'up'],
    [(f) => f.trend === 'flat', 'flat'],
    [() => true, 'insufficient']
  ]),
  topMiss: (f) => (!f.title || !(f.wrong > 0) ? null : f.zh ? 'withKind' : 'plain'),
  writingLine: firstMatch([
    [(f) => f.legacy, 'legacy'],
    [(f) => !f.band, null],
    [(f) => !f.prevBand, 'first'],
    [(f) => f.bandUp, 'up'],
    [(f) => f.bandDown, 'down'],
    [() => true, 'same']
  ]),
  criterionLine: (f) => (f.up ? 'up' : 'down'),
  dueLine: (f) => (f.due > 0 ? 'due' : null),
  weakLine: (f) => (f.label ? 'weak' : null),
  // The tomorrow sentence is picked by the rule that chose its facts (insight.js tomorrowView).
  tomorrow: (f) => f.key || null,
  planLink: (f) => (f.label ? 'link' : null),
  // ---- v1 / shared
  title: firstMatch([
    [(f) => f.quiet, 'quiet'],
    [(f) => f.notesOnly, 'noted'],
    [(f) => f.improved?.length > 0, 'improved'],
    [(f) => f.recurring?.length > 0, 'recurring'],
    [(f) => f.first, 'first'],
    [(f) => f.longGap, 'gap'],
    [(f) => f.attempts > 1, 'several'],
    [(f) => f.attempts === 1, 'single'],
    [(f) => f.written > 0, 'writing'],
    [(f) => f.reading, 'reading'],
    [(f) => f.feedback > 0 || f.reask > 0, 'coach'],
    [() => true, null]
  ]),
  opening: firstMatch([
    [(f) => f.quiet, 'quiet'],
    [(f) => f.notesOnly, 'noted'],
    [(f) => f.first, 'first'],
    [(f) => f.longGap, 'gap'],
    [() => true, null]
  ]),
  attempts: firstMatch([
    [(f) => f.attempts === 1 && f.minutes > 0, 'single_timed'],
    [(f) => f.attempts === 1, 'single'],
    [(f) => f.attempts > 1 && f.minutes > 0, 'several_timed'],
    [(f) => f.attempts > 1, 'several']
  ]),
  changeLead: firstMatch([
    [(f) => f.improved?.length > 0 && f.recurring?.length > 0, 'both'],
    [(f) => f.improved?.length > 0, 'improved'],
    [(f) => f.recurring?.length > 0, 'recurring']
  ]),
  note: (facts) => NOTE_KEYS[facts.kind] || 'other',
  noteAgain: (facts) => NOTE_KEYS[facts.kind] || 'other',
  practice: firstMatch([
    [(f) => f.count === 1, 'single'],
    [(f) => f.count > 1, 'several']
  ]),
  weekTitle: (f) => f.theme || null
}

const MS_PER_DAY = 86_400_000

/** Whole days since 1970-01-01 for "YYYY-MM-DD"; NaN when it is not a date. */
export function dayNumber(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  if (!match) return Number.NaN
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY)
}

/** Calendar days from `earlier` to `later`; NaN when either is not a date. */
export function daysBetween(earlier, later) {
  return dayNumber(later) - dayNumber(earlier)
}

/** FNV-1a: a stable 32-bit hash of a string (same result on every platform). */
function hash32(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** The seeded permutation of 0..size-1 owned by one block of days. */
function blockOrder(label, size, block) {
  const random = mulberry32(hash32(`${label}#${block}`))
  const order = Array.from({ length: size }, (_, index) => index)
  for (let index = size - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[order[index], order[other]] = [order[other], order[index]]
  }
  return order
}

/**
 * Variant index for a day. One pick per (fact type, key, day): consecutive
 * days' picks are consecutive bag positions, which never repeat (see header).
 */
export function pickIndex(label, size, day) {
  if (size <= 1) return 0
  const raw = dayNumber(day)
  const position = Number.isFinite(raw) ? raw : hash32(String(day))
  // A pair of variants has no room for a shuffle: plain alternation.
  if (size === 2) return (((position + hash32(label)) % 2) + 2) % 2
  const block = Math.floor(position / size)
  const order = blockOrder(label, size, block)
  const previousLast = blockOrder(label, size, block - 1)[size - 1]
  // Only the first two slots can move, so the previous block's last pick is stable.
  if (order[0] === previousLast) [order[0], order[1]] = [order[1], order[0]]
  return order[position - block * size]
}

/** Names of the "{placeholders}" a variant uses, in order. */
export function placeholdersOf(template) {
  return [...String(template).matchAll(/\{(\w+)\}/g)].map((match) => match[1])
}

const present = (value) => value !== undefined && value !== null && value !== '' && !Number.isNaN(value)

/** A sentence ending in "？" or "！" does not also take the template's full stop. */
const tidy = (text) => text.replace(/([。？！?!])。+/g, '$1')

/** Fill a variant from the fact sheet, or '' when any placeholder has no fact. */
export function fill(template, facts) {
  let complete = true
  const text = String(template).replace(/\{(\w+)\}/g, (_, name) => {
    if (!present(facts[name])) complete = false
    return String(facts[name])
  })
  return complete ? tidy(text) : ''
}

/** The condition key RULES chooses for these facts (null: nothing to say). */
export function keyFor(factType, facts) {
  return RULES[factType]?.(facts) ?? null
}

/**
 * One sentence (or heading) for a fact type on a given journal day; '' when
 * the facts do not call for it. Callers wanting one sentence per fact type per
 * day (see compose.js memoryNotes) must not ask twice for the same key.
 */
export function phrase(factType, facts, day) {
  const key = keyFor(factType, facts)
  const variants = key && BANK[factType]?.[key]
  if (!variants) return ''
  const index = pickIndex(`${factType}.${key}`, variants.length, day)
  return fill(variants[index], facts)
}
