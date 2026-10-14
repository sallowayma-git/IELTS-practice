/**
 * 札记 phrase bank — how a day's deterministic facts are put into words.
 *
 * Zero model calls. The daily entry is rule-generated: the same fact types are
 * reported every day, but each is worded with one of several variants so a
 * week of entries does not read like one template. Everything that decides
 * what is said lives in the two tables below; compose.js only supplies facts
 * and lays out the sentences that come back.
 *
 *   BANK   fact type -> condition key -> variants ("{name}" = a fact field)
 *   RULES  fact type -> (facts) => condition key, or null to say nothing
 *
 * Fact sheet (the flat object RULES and placeholders read; compose.js builds it):
 *   day, attempts, minutes, written, degraded, band, feedback, reask,
 *   improved[], recurring[], improvedNames, recurringNames (plain, at most three,
 *   joined with 、), type (strongest improved, else recurring skill),
 *   practiced (any practice fact), events (memory events), quiet (no practice
 *   and no events), notesOnly (no practice, some events), first, gap, longGap.
 * Small sheets for the other fact types: note {kind}, noteAgain {kind}.
 *
 * Wording rules: "这一天" appears only in the opening line of an entry, so a
 * whole entry says it at most once. No narrator filler, no disapproval, no
 * over-claiming from one day's numbers (titles describe, they do not grade).
 *
 * Picking is seeded and stable. Each fact type + condition key owns a
 * "shuffle bag": calendar days are cut into blocks as long as the variant list,
 * and every block is a seeded permutation of the list. So the same date always
 * yields the same wording on every reload and device, different days differ,
 * and two consecutive days never share a variant (inside a block all picks are
 * distinct; the first pick of a block is forced away from the previous block's
 * last pick, which is itself a pure function of the date, so no history is
 * needed). Texts are also unique across the keys of one fact type (and, for
 * notes, across `note` and `noteAgain`), so a key change between days cannot
 * repeat a sentence. A fact that is missing, or a placeholder that cannot be
 * filled, yields no sentence at all — never a dangling "{x}" or stray punctuation.
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
  // Short heading under the date. No trailing punctuation.
  title: {
    improved: [
      '{type}有了起色',
      '{type}做得比较顺',
      '{type}往前挪了一步',
      '{type}这次表现不错',
      '{type}比之前更稳了一点'
    ],
    recurring: [
      '{type}仍需留意',
      '{type}还有些不稳',
      '回头再看{type}',
      '{type}值得再看一遍'
    ],
    quiet: [
      '安静的一天',
      '没有练习的一天',
      '留白的一页',
      '没有新记录的一天'
    ],
    noted: [
      '一点新的了解',
      '记下一点新的看法',
      '这一页有一点新的观察',
      '值得记下的一点'
    ],
    first: [
      '札记的第一页',
      '从这里开始',
      '最初的一页',
      '第一天的记录'
    ],
    // Number-free on purpose: the opening line already states the gap.
    gap: [
      '久违的一页',
      '隔了一阵子的记录',
      '重新拾起练习',
      '回到练习',
      '停了一阵之后的练习'
    ],
    several: [
      '一段扎实的练习',
      '连着做了几次',
      '一天里的几次练习',
      '几次练习记在这里'
    ],
    single: [
      '一次练习',
      '做了一次练习',
      '一次单独的练习',
      '一次简短的练习'
    ],
    writing: [
      '写作的一天',
      '动笔的一天',
      '写下来的一天',
      '一天里的写作'
    ],
    coach: [
      '与教练讲解有关的一天',
      '和教练的讲解打过交道的一天',
      '在教练的讲解上停留的一天',
      '与教练的一番交流'
    ]
  },

  // First sentence of the 观察 paragraph: the only place "这一天" may appear.
  opening: {
    default: [
      '这一天的练习记在下面。',
      '这一天的记录如下。',
      '练习的情况按顺序记在下面。',
      '这一天做过的练习如下。',
      '这一天做过的事整理如下。'
    ],
    first: [
      '这是札记的第一页，从这一天开始记。',
      '札记从这一天开始，先记下当天的情况。',
      '第一页，先记下这一天做了什么。',
      '这一天是札记的起点。'
    ],
    gap: [
      '距上一次练习已过去 {gap} 天，这一天算是重新开始。',
      '隔了 {gap} 天，又回到了练习上来。',
      '和上一次练习相隔 {gap} 天，这一页从回来的这一天记起。',
      '上一次练习还是 {gap} 天前，先看看这一天的情况。',
      '中断了 {gap} 天之后，这一天又有了练习记录。'
    ],
    quiet: [
      '这一天没有练习记录。',
      '这一天没有新的练习记录，这一页留白。',
      '这一天没有留下练习的痕迹。',
      '这一页留白，没有练习可记。'
    ],
    noted: [
      '这一天没有练习，但记下了一点新的了解。',
      '这一天没有新的练习，只有一点新的观察。',
      '没有新的练习，只记下一点观察。',
      '这一天没有练习，记下的是一点新的看法。'
    ]
  },

  attempts: {
    single_timed: [
      '做了 {attempts} 次练习，约 {minutes} 分钟。',
      '完成了 {attempts} 次练习，前后约 {minutes} 分钟。',
      '练了 {attempts} 次，用时约 {minutes} 分钟。',
      '完成 {attempts} 次练习，用时约 {minutes} 分钟。'
    ],
    single: [
      '做了 {attempts} 次练习。',
      '完成了 {attempts} 次练习。',
      '练了 {attempts} 次。',
      '这次完成的是 {attempts} 次练习。'
    ],
    several_timed: [
      '一共做了 {attempts} 次练习，加起来约 {minutes} 分钟。',
      '前后练了 {attempts} 次，约 {minutes} 分钟。',
      '练了 {attempts} 次，累计用时约 {minutes} 分钟。',
      '完成的练习有 {attempts} 次，用时约 {minutes} 分钟。',
      '共完成 {attempts} 次练习，约用 {minutes} 分钟。'
    ],
    several: [
      '一共做了 {attempts} 次练习。',
      '共完成 {attempts} 次练习。',
      '一共练了 {attempts} 次。',
      '完成的练习有 {attempts} 次。'
    ]
  },

  writing: {
    band_single: [
      '提交了 {written} 篇写作，评分约为 Band {band}。',
      '写作交了 {written} 篇，评分约为 Band {band}。',
      '{written} 篇写作已经评完，约为 Band {band}。',
      '写作方面，{written} 篇作文得到的评分约为 Band {band}。'
    ],
    band_several: [
      '提交了 {written} 篇写作，平均约为 Band {band}。',
      '写作交了 {written} 篇，平均评分约为 Band {band}。',
      '{written} 篇写作评完了，平均约在 Band {band}。',
      '写作方面，{written} 篇作文的平均评分约为 Band {band}。'
    ],
    single: [
      '提交了 {written} 篇写作。',
      '写作交了 {written} 篇。',
      '写作方面，完成了 {written} 篇作文。',
      '{written} 篇写作已经提交。'
    ],
    several: [
      '共提交了 {written} 篇写作。',
      '写作一共交了 {written} 篇。',
      '写作方面，共完成了 {written} 篇作文。',
      '{written} 篇写作都已经提交。'
    ]
  },

  degraded: {
    single: [
      '这篇的逐句详解没能完整生成，评分本身不受影响。',
      '逐句详解这次没有生成完整，不过评分不受影响。',
      '这篇作文的逐句详解不完整，评分本身不受影响。',
      '逐句详解没能完整生成，评分不受影响。'
    ],
    several: [
      '其中 {degraded} 篇的逐句详解没能完整生成，评分本身不受影响。',
      '有 {degraded} 篇的逐句详解不完整，评分不受影响。',
      '逐句详解没能完整生成的有 {degraded} 篇，评分本身不受影响。',
      '{degraded} 篇的逐句详解缺了一部分，评分不受影响。'
    ]
  },

  // Feedback given on coach answers; never implies the user asked anything.
  coach: {
    default: [
      '给教练的讲解留了 {feedback} 次反馈。',
      '你在教练的讲解下留了 {feedback} 次反馈。',
      '和教练的交流中，有 {feedback} 次对讲解做了反馈。',
      '对讲解做的反馈有 {feedback} 次。',
      '教练的讲解收到了 {feedback} 次反馈。'
    ]
  },

  reask: {
    default: [
      '有 {reask} 次，同一个问题又向教练问了一遍。',
      '同一个问题向教练追问了 {reask} 次。',
      '{reask} 次追问落在同一个问题上。',
      '追问同一个问题的有 {reask} 次。'
    ]
  },

  // Lead-in above the 变化 rows, named by skill; neutral about the two halves.
  changeLead: {
    both: [
      '{improvedNames}比较顺，{recurringNames}还不稳。',
      '{improvedNames}有进展，{recurringNames}还需留意。',
      '{improvedNames}做得顺，{recurringNames}还不太稳。',
      '{improvedNames}在变稳，{recurringNames}还要再看。',
      '有进展的是{improvedNames}；还不稳的是{recurringNames}。'
    ],
    improved: [
      '{improvedNames}做得比较顺。',
      '{improvedNames}有了起色。',
      '{improvedNames}这次比较顺。',
      '{improvedNames}在变稳。',
      '看得出{improvedNames}有进展。'
    ],
    recurring: [
      '{recurringNames}还不稳，需要留意。',
      '{recurringNames}还需要再看一看。',
      '要再留意的是{recurringNames}。',
      '{recurringNames}这次还不太稳。',
      '{recurringNames}仍然需要留意。'
    ]
  },

  // What happened to a remembered sentence (the sentence itself comes before it).
  note: {
    new: [
      '这是新注意到的一点。',
      '这一点是刚刚才看出来的。',
      '以前没有留意到这一点，这次记下了。',
      '这是新记下的一点。'
    ],
    reinforced: [
      '这一点再次得到印证。',
      '这一次的练习又印证了这一点。',
      '又一次看到了同样的情形。',
      '这一点和之前的观察吻合。'
    ],
    promoted: [
      '这一点已确认为长期了解。',
      '这一点已经归入长期了解。',
      '这一点被确认下来，成了长期了解。',
      '这一点已经可以当作长期了解。'
    ],
    refined: [
      '这一点的表述更准确了。',
      '这一点现在说得更准确了。',
      '对这一点的描述更贴近实际了。',
      '这一点的措辞做了修正，更准确。'
    ],
    improved: [
      '这一点正在改善。',
      '这一点比之前有改善。',
      '这一点在慢慢好转。',
      '这方面在变好。'
    ],
    regressed: [
      '这一点出现了回退。',
      '这一点比之前退了一些。',
      '这一点有所反复。',
      '这方面出现了回落。'
    ],
    contradicted: [
      '这一点出现了反例，会被重新审视。',
      '出现了和这一点不符的情形，会再审视一遍。',
      '这一点遇到了反例，之后会重新审视。',
      '这一点和当天的表现对不上，会被重新审视。'
    ],
    superseded: [
      '这一点已被新的判断取代。',
      '这一点由新的判断接替了。',
      '这一点有了更新的判断，取代了原来的说法。',
      '原来的说法已被更新的判断取代。'
    ],
    other: [
      '这一点有所更新。',
      '这一点做了更新。',
      '这一点的记录有所变动。',
      '这一点有新的变化。'
    ]
  },

  // A second or later note of the same key on one day: its own verdict, never bare.
  noteAgain: {
    new: [
      '这一条同样是新注意到的。',
      '这一条也是刚刚才看出来的。',
      '这一条同样是新记下的。',
      '这一条也是这次才留意到的。'
    ],
    reinforced: [
      '这一条同样得到了印证。',
      '这一条也和观察吻合。',
      '这一条的情形同样又出现了。',
      '这一条同样得到了练习的支持。'
    ],
    promoted: [
      '这一条也已确认为长期了解。',
      '这一条同样归入了长期了解。',
      '这一条也被确认为长期了解。',
      '这一条同样可以当作长期了解。'
    ],
    refined: [
      '这一条的表述也更准确了。',
      '这一条同样说得更贴近实际了。',
      '这一条的措辞也做了修正。',
      '这一条同样修正得更准确。'
    ],
    improved: [
      '这一条也在改善。',
      '这一条同样在慢慢好转。',
      '这一条也比之前有改善。',
      '这一条同样在变好。'
    ],
    regressed: [
      '这一条也出现了回退。',
      '这一条同样有所反复。',
      '这一条也比之前退了一些。',
      '这一条同样出现了回落。'
    ],
    contradicted: [
      '这一条同样遇到了反例，会被重新审视。',
      '这一条也出现了不符的情形，会再审视。',
      '这一条的反例也记下了，之后会重新审视。',
      '这一条同样会被重新审视。'
    ],
    superseded: [
      '这一条也已被新的判断取代。',
      '这一条同样由新的判断接替了。',
      '这一条的原说法也已被更新的判断取代。',
      '这一条同样有了更新的判断。'
    ],
    other: [
      '这一条同样有所更新。',
      '这一条也做了更新。',
      '这一条的记录同样有变动。',
      '这一条也有了新的变化。'
    ]
  }
}

export const RULES = {
  title: firstMatch([
    [(f) => f.quiet, 'quiet'],
    [(f) => f.notesOnly, 'noted'],
    [(f) => f.improved.length > 0, 'improved'],
    [(f) => f.recurring.length > 0, 'recurring'],
    [(f) => f.first, 'first'],
    [(f) => f.longGap, 'gap'],
    [(f) => f.attempts > 1, 'several'],
    [(f) => f.attempts === 1, 'single'],
    [(f) => f.written > 0, 'writing'],
    [() => true, 'coach']
  ]),
  opening: firstMatch([
    [(f) => f.quiet, 'quiet'],
    [(f) => f.notesOnly, 'noted'],
    [(f) => f.first, 'first'],
    [(f) => f.longGap, 'gap'],
    [() => true, 'default']
  ]),
  attempts: firstMatch([
    [(f) => f.attempts === 1 && f.minutes > 0, 'single_timed'],
    [(f) => f.attempts === 1, 'single'],
    [(f) => f.attempts > 1 && f.minutes > 0, 'several_timed'],
    [(f) => f.attempts > 1, 'several']
  ]),
  writing: firstMatch([
    [(f) => f.written === 1 && f.band > 0, 'band_single'],
    [(f) => f.written > 1 && f.band > 0, 'band_several'],
    [(f) => f.written === 1, 'single'],
    [(f) => f.written > 1, 'several']
  ]),
  degraded: firstMatch([
    [(f) => f.written === 1 && f.degraded > 0, 'single'],
    [(f) => f.written > 1 && f.degraded > 0, 'several']
  ]),
  coach: firstMatch([[(f) => f.feedback > 0, 'default']]),
  reask: firstMatch([[(f) => f.reask > 0, 'default']]),
  changeLead: firstMatch([
    [(f) => f.improved.length > 0 && f.recurring.length > 0, 'both'],
    [(f) => f.improved.length > 0, 'improved'],
    [(f) => f.recurring.length > 0, 'recurring']
  ]),
  note: (facts) => NOTE_KEYS[facts.kind] || 'other',
  noteAgain: (facts) => NOTE_KEYS[facts.kind] || 'other'
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
