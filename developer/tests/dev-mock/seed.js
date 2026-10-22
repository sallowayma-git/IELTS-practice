/**
 * Dev-only seed data for the Tauri mock (tauri-mock.js).
 *
 * English IELTS content; shapes follow the camelCase DTOs in crates/ielts-domain
 * and the e2e preview mocks under developer/tests/e2e. Only reachable through
 * VITE_TAURI_MOCK=1 in the dev server; never part of a build.
 */
import payloadP1 from './fixtures/reading/p1-high-01.json' with { type: 'json' }
import payloadP2 from './fixtures/reading/p2-high-235.json' with { type: 'json' }
import payloadP3 from './fixtures/reading/p3-high-229.json' with { type: 'json' }

const DAY_MS = 86_400_000

/** Deterministic PRNG so screenshots and sorting stay stable across reloads. */
function rng(seed = 20261019) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIXTURE_BY_CATEGORY = { P1: payloadP1, P2: payloadP2, P3: payloadP3 }
const FIXTURE_BY_EXAM = { 'p1-high-01': payloadP1, 'p2-high-235': payloadP2, 'p3-high-229': payloadP3 }

// ---------------------------------------------------------------- reading ---

// Last element is questionKinds: the stable tag keys the UI renders on each
// card (single_choice, multi_choice, judgement, completion, heading_match,
// paragraph_match, matching). The three fixture-backed rows (p1-high-01,
// p2-high-235, p3-high-229) must match what classify_question_kinds (Rust)
// yields for their real payload; see crates/ielts-db/src/reading/question_kinds.rs.
const READING_ROWS = [
  ['p1-high-01', 'A Brief History of Tea', 'P1', 'high', false, ['heading_match', 'matching']],
  ['p1-high-05', 'Katherine Mansfield', 'P1', 'high', false, ['single_choice', 'completion']],
  ['p1-high-101', 'The Impact of the Potato', 'P1', 'high', false, ['judgement', 'matching']],
  ['p1-high-12', 'Urban Beekeeping', 'P1', 'high', false, ['completion']],
  ['p1-medium-18', 'The Science of Sleep Cycles', 'P1', 'medium', false, ['single_choice', 'judgement']],
  ['p1-medium-26', 'Coral Reef Restoration', 'P1', 'medium', false, ['heading_match']],
  ['p1-medium-33', 'Early Mapmaking in Europe', 'P1', 'medium', false, ['completion', 'matching']],
  ['p1-medium-40', 'Honeybee Navigation', 'P1', 'medium', false, ['multi_choice', 'completion']],
  ['p1-low-47', 'Folding Bicycles', 'P1', 'low', false, ['judgement']],
  ['p1-low-52', 'The Lost Art of Glassblowing', 'P1', 'low', true, []],
  ['p1-low-60', 'Migrating Monarch Butterflies', 'P1', 'low', false, ['matching']],
  ['p2-high-235', 'The return of the black-footed ferret', 'P2', 'high', false, ['completion', 'paragraph_match', 'matching']],
  ['p2-high-236', 'War of the Plants', 'P2', 'high', false, ['single_choice', 'multi_choice', 'completion']],
  ['p2-medium-14', 'Chocolate: Origins and Trade', 'P2', 'medium', false, ['heading_match', 'paragraph_match']],
  ['p2-medium-22', 'The Rise of Night Markets', 'P2', 'medium', false, ['completion']],
  ['p2-medium-31', 'Desert Rain Harvesting', 'P2', 'medium', false, ['judgement', 'matching']],
  ['p2-medium-50', 'Volcanic Soil and Farming', 'P2', 'medium', false, ['single_choice']],
  ['p2-low-40', 'Musical Instruments of the Andes', 'P2', 'low', false, ['matching']],
  ['p2-low-44', 'The Economics of Public Libraries', 'P2', 'low', false, ['judgement', 'completion']],
  ['p2-low-58', 'Ancient Road Networks', 'P2', 'low', true, []],
  ['p3-high-229', 'All in the family', 'P3', 'high', false, ['single_choice', 'judgement', 'completion']],
  ['p3-high-230', 'Language and Workplace Culture', 'P3', 'high', false, ['heading_match', 'matching']],
  ['p3-medium-11', 'Why Teenagers Take Risks', 'P3', 'medium', false, ['single_choice', 'completion']],
  ['p3-medium-24', 'Probability in Everyday Decisions', 'P3', 'medium', false, ['judgement']],
  ['p3-medium-60', 'Museum Visitor Behaviour', 'P3', 'medium', false, ['multi_choice', 'matching']],
  ['p3-low-999', 'Risk taking', 'P3', 'low', false, ['completion']],
  ['p3-low-71', 'Designing Cities for Cyclists', 'P3', 'low', false, ['paragraph_match', 'matching']],
  ['p3-low-80', 'The Ethics of Gene Editing', 'P3', 'low', false, ['single_choice', 'judgement']],
  ['p3-low-88', 'Ocean Acidification Debate', 'P3', 'low', false, ['multi_choice', 'completion']],
  ['p3-low-95', 'Memory and Music', 'P3', 'low', true, []],
]

export function buildReadingAssets() {
  return READING_ROWS.map(([id, title, category, frequency, pdfOnly, questionKinds]) => ({
    id,
    title,
    category,
    difficulty: null,
    frequency,
    fingerprint: `fp-${id}`,
    schemaVersion: 2,
    contentRef: null,
    payloadRef: pdfOnly ? null : `dev-mock://${id}`,
    activity: 'reading',
    pdfOnly,
    questionKinds,
  }))
}

/**
 * Payload for one asset. The three real fixtures are used as-is; the others
 * reuse the passage of their category under their own title and id.
 */
export function buildReadingPayload(entry) {
  const base = FIXTURE_BY_EXAM[entry.id] || FIXTURE_BY_CATEGORY[entry.category]
  return {
    ...base,
    examId: entry.id,
    meta: { ...base.meta, title: entry.title, category: entry.category, frequency: entry.frequency },
  }
}

/** Index of { asset, payload } envelopes, keyed by asset id. */
function buildReadingPayloads(assets) {
  const out = {}
  for (const entry of assets) {
    out[entry.id] = {
      asset: {
        schemaVersion: 2,
        id: entry.id,
        activity: 'reading',
        sourceKind: 'builtin',
        title: entry.title,
        category: entry.category,
        difficulty: null,
        frequency: entry.frequency,
        fingerprint: entry.fingerprint,
        pdfOnly: entry.pdfOnly,
        contentRef: null,
      },
      payload: buildReadingPayload(entry),
    }
  }
  return out
}

// ---------------------------------------------------------------- writing ---

const TASK2_PROMPTS = [
  ['education', 'Some people believe that university students should study a broad range of subjects. Others think they should specialise early. Discuss both views and give your own opinion.'],
  ['technology', 'Some argue that technology has made people more isolated, while others say it brings people closer together. Discuss both views.'],
  ['society', 'Many cities are struggling with traffic congestion. What are the causes, and what measures could governments take to solve it?'],
  ['environment', 'Some people think that the best way to reduce pollution is to tax companies. Others believe individuals should change their habits. Discuss both views.'],
  ['health', 'Governments should invest more money in public health than in new roads. To what extent do you agree or disagree?'],
  ['culture', 'Some people say that globalisation is destroying local traditions. Others believe it creates new forms of culture. Which view do you find more convincing?'],
  ['government', 'Should governments fund the arts from public money, or should artists rely on private sponsorship? Give reasons for your answer.'],
  ['economy', 'Working from home is becoming more common. Do the advantages outweigh the disadvantages for employees and employers?'],
  ['education', 'Some people think children should start learning a foreign language at primary school. Others believe this should wait until secondary school. Discuss.'],
  ['technology', 'Social media companies should be legally responsible for harmful content posted by their users. To what extent do you agree?'],
  ['society', 'Living alone is becoming more common in many countries. Is this a positive or negative development for society?'],
  ['environment', 'Some believe that wildlife conservation is more important than economic development. Others disagree. What is your view?'],
  ['health', 'Fast food is cheap and convenient, yet many governments are reluctant to restrict it. Should they take stronger action?'],
  ['culture', 'Is it important for young people to learn about the history of their own country before studying the history of others?'],
  ['economy', 'Some people think that the best way to improve a country is to reduce taxes. Others think that higher taxes pay for better services. Discuss.'],
  ['education', 'Exams are the best way to measure a student\'s ability. To what extent do you agree or disagree?'],
  ['technology', 'Automation will create more jobs than it destroys. Do you agree or disagree with this view?'],
  ['society', 'Public transport should be free for everyone. What are the advantages and disadvantages of this policy?'],
  ['environment', 'Plastic packaging is essential for food safety, yet it causes serious pollution. How can this problem be solved?'],
  ['government', 'Some people believe that all citizens should be required to vote in elections. Do you agree?'],
]

// [category, prompt, chart kind, labels, values]
const TASK1_PROMPTS = [
  ['bar_chart', 'The chart shows the percentage of households with internet access in four countries between 2005 and 2020. Summarise the information by selecting and reporting the main features.', 'bar', ['Japan', 'Brazil', 'Kenya', 'Germany'], [82, 47, 19, 91]],
  ['pie_chart', 'The pie charts compare how energy was produced in two countries in 1990 and 2015. Summarise the information and make comparisons where relevant.', 'bar', ['Coal', 'Gas', 'Nuclear', 'Renewables'], [42, 18, 25, 15]],
  ['line_chart', 'The line graph shows the number of visitors to a national park from 2010 to 2022, split by domestic and international tourists. Describe the main trends.', 'line', ['2010', '2014', '2018', '2022'], [120, 150, 210, 180]],
  ['table', 'The table gives data on tourist arrivals and average spending in five European cities. Summarise the key features and report the main trends.', 'bar', ['Lisbon', 'Prague', 'Vienna', 'Rome', 'Oslo'], [34, 28, 26, 41, 17]],
  ['process', 'The diagram illustrates the process of recycling plastic bottles, from collection to the production of new packaging. Describe the stages.', 'bar', ['Collect', 'Sort', 'Wash', 'Shred', 'Pellet'], [5, 4, 3, 3, 2]],
  ['map', 'The maps show the changes to a town centre between 2000 and 2020. Describe the main changes that took place.', 'bar', ['Housing', 'Parks', 'Shops', 'Car parks'], [30, 12, 22, 16]],
  ['bar_chart', 'The bar chart shows the average monthly rainfall in four cities during 2023. Summarise the information and make comparisons.', 'bar', ['Oslo', 'Cairo', 'Mumbai', 'Lima'], [58, 2, 510, 9]],
  ['line_chart', 'The graph shows the average price of electric cars and petrol cars in the UK between 2015 and 2025. Report the main features.', 'line', ['2015', '2019', '2022', '2025'], [38, 36, 44, 31]],
  ['pie_chart', 'The pie charts show how students spent their time at university in 2000 and 2020. Summarise and compare the information.', 'bar', ['Study', 'Work', 'Social', 'Sleep'], [35, 12, 18, 35]],
  ['mixed', 'The chart shows the number of cyclists and the number of car journeys in a city centre between 2016 and 2025. Write a report describing the key trends.', 'line', ['2016', '2019', '2022', '2025'], [14, 19, 27, 33]],
]

/** Small inline SVG chart as a data URL (no network, no files). */
export function svgChart(kind, labels, values, caption) {
  const width = 480
  const height = 270
  const left = 44
  const bottom = height - 36
  const top = 30
  const max = Math.max(...values) * 1.15
  const step = (width - left - 20) / values.length
  const yFor = (value) => bottom - (value / max) * (bottom - top)
  const body = kind === 'line'
    ? `<polyline fill="none" stroke="#be5a3c" stroke-width="3" points="${values.map((v, i) => `${left + step * i + step / 2},${yFor(v)}`).join(' ')}"/>`
      + values.map((v, i) => `<circle cx="${left + step * i + step / 2}" cy="${yFor(v)}" r="4" fill="#be5a3c"/>`).join('')
    : values.map((v, i) => {
      const barWidth = step * 0.56
      const x = left + step * i + (step - barWidth) / 2
      return `<rect x="${x}" y="${yFor(v)}" width="${barWidth}" height="${bottom - yFor(v)}" fill="${i % 2 ? '#7a7468' : '#be5a3c'}"/>`
    }).join('')
  const labelSvg = labels.map((label, i) => `<text x="${left + step * i + step / 2}" y="${bottom + 16}" font-size="11" text-anchor="middle" fill="#55514a">${label}</text>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="#f7f5ef"/>`
    + `<text x="${left}" y="18" font-size="12" fill="#3b3730">${caption}</text>`
    + `<line x1="${left}" y1="${bottom}" x2="${width - 20}" y2="${bottom}" stroke="#7a7468" stroke-width="1.5"/>`
    + `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#7a7468" stroke-width="1.5"/>`
    + body + labelSvg + '</svg>'
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function titleJson(text) {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
}

function buildTopics(now) {
  const topics = []
  TASK1_PROMPTS.forEach(([category, text, kind, labels, values], i) => {
    topics.push({
      id: `topic-t1-${String(i + 1).padStart(2, '0')}`,
      taskType: 'task1',
      category,
      difficulty: (i % 5) + 1,
      titleJson: titleJson(text),
      imagePath: svgChart(kind, labels, values, text.slice(0, 44)),
      isOfficial: i < 3,
      usageCount: (i * 3) % 9,
      createdAt: new Date(now - (60 - i) * DAY_MS).toISOString(),
      updatedAt: new Date(now - (20 - i) * DAY_MS).toISOString(),
    })
  })
  TASK2_PROMPTS.forEach(([category, text], i) => {
    topics.push({
      id: `topic-t2-${String(i + 1).padStart(2, '0')}`,
      taskType: 'task2',
      category,
      difficulty: (i % 5) + 1,
      titleJson: titleJson(text),
      imagePath: null,
      isOfficial: i % 6 === 0,
      usageCount: (i * 7) % 13,
      createdAt: new Date(now - (70 - i) * DAY_MS).toISOString(),
      updatedAt: new Date(now - (25 - i) * DAY_MS).toISOString(),
    })
  })
  return topics
}

function buildWritingPrompts(now) {
  const iso = (days) => new Date(now - days * DAY_MS).toISOString()
  return [
    { id: 'prompt-task1-v1', taskType: 'task1', version: '1', body: 'You are an IELTS Writing Task 1 examiner. Score the report on Task Achievement, Coherence and Cohesion, Lexical Resource and Grammatical Range and Accuracy.', isActive: false, createdAt: iso(90), updatedAt: iso(90) },
    { id: 'prompt-task1-v2', taskType: 'task1', version: '2', body: 'You are an IELTS Writing Task 1 examiner. Check that the overview captures the main trends before the detail. Score on the four public criteria and explain each band briefly.', isActive: true, createdAt: iso(30), updatedAt: iso(30) },
    { id: 'prompt-task2-v1', taskType: 'task2', version: '1', body: 'You are an IELTS Writing Task 2 examiner. Judge how fully both views are addressed and whether the position is clear.', isActive: false, createdAt: iso(90), updatedAt: iso(90) },
    { id: 'prompt-task2-v2', taskType: 'task2', version: '2', body: 'You are an IELTS Writing Task 2 examiner. Judge argument development, paragraph logic and the precision of vocabulary. Give concrete rewrite suggestions for two sentences.', isActive: true, createdAt: iso(14), updatedAt: iso(14) },
  ]
}

// ------------------------------------------------------- essay + evaluation ---

// [sentence, [[error kind, marked word, reason, correction]]]
const ESSAY_SENTENCES = [
  ['Universities must equips students for work while preserving deeper inquiry.', [['grammar', 'equips', 'Modal verbs take the base form, so equips should be equip.', 'equip']]],
  ['Practical projects make abstract knowledge visible, especially when students must explain their decisions to people outside their discipline.', []],
  ['Such tasks teach them to communicate, negotiate and revise plans under real constraints.', []],
  ['However, a narrow focus on current workplace tools can age quickly.', []],
  ['Employers change systems, industries reorganise, and graduates face problems that no syllabus could predict.', []],
  ['Their capacity to recieve and evaluate new ideas depends on the theory they learnt at university.', [['spelling', 'recieve', 'Spelling: the correct form is receive.', 'receive']]],
  ['Conversely, a programme that emphasises employability alone may leave students without the critical habits that sustain lifelong learning.', []],
  ['Placements and collaborative briefs test whether students apply ideas responsibly, while seminars give them time to question assumptions.', [['sentence_structure', 'while seminars give them time to question assumptions', 'The clause is overloaded; splitting it keeps the contrast clear.', 'Seminars, meanwhile, give them time to question assumptions.']]],
  ['Very big changes in technology make this balance even more important.', [['word_choice', 'Very big', 'Intensified informal collocation; use a precise adjective.', 'Profound']]],
  ['Furthermore, this balance prepares students for their first role.', [['coherence', 'Furthermore', 'A mechanical link that does not match the concluding contrast.', 'Above all']]],
  ['Universities should measure success by the adaptability of their graduates rather than by immediate employment figures alone.', []],
]

export const ESSAY_TEXT = ESSAY_SENTENCES.map(([sentence]) => sentence).join(' ')

function buildSentenceRecords() {
  return ESSAY_SENTENCES.map(([sentence, errors]) => {
    let corrected = sentence
    const items = errors.map(([type, word, reason, correction]) => {
      const start = sentence.indexOf(word)
      corrected = corrected.replace(word, correction)
      return { type, word, reason, correction, range: { start, end: start + word.length } }
    })
    const record = { sentence, errors: items }
    if (items.length) record.corrected = corrected
    return record
  })
}

/** Evaluation in the Rust schemaVersion 4 shape; `band` drives the criteria. */
export function buildWritingEvaluation({ id, band, taskType, status = 'completed' }) {
  const shift = (n) => Math.min(9, Math.max(4, Math.round((band + n) * 2) / 2))
  return {
    schemaVersion: 4,
    id,
    status,
    stage: 'finalizing',
    taskType,
    score: {
      overall: band,
      taskResponse: shift(0),
      coherence: shift(-0.5),
      lexical: shift(0.5),
      grammar: shift(-0.5),
    },
    diagnosis: {
      task: {
        prompt_response_quality: 'Both views are addressed and the writer\'s position is explicit.',
        position_clarity: 'The central claim is established early and sustained to the conclusion.',
        argument_development: 'Relevant reasoning is present, but the practical example stays abstract.',
        conclusion_effectiveness: 'The conclusion compares the two priorities rather than repeating them.',
      },
      rationale: {
        task_achievement: 'Both perspectives are addressed and a clear position is sustained.',
        coherence_cohesion: 'Paragraphing is logical, but linking words are mechanical in places.',
        lexical_resource: 'Vocabulary is generally precise, with a few informal collocations.',
        grammatical_range: 'Complex structures appear, though a subject-verb error recurs.',
      },
    },
    feedback: {
      overall: 'The essay keeps a clear position and develops both views in a controlled way. The next gain is concrete support: name one workplace example and vary the transitions between the final two body paragraphs.',
      plan: [
        'Add one concrete workplace example to the first body paragraph.',
        'Replace repeated contrast markers with transitions that name the logical relation.',
        'Proofread for subject-verb agreement and spelling of common academic words.',
        'Use precise adjectives instead of intensifiers such as very big.',
      ],
      paragraphs: [
        { paragraphIndex: 1, summary: 'The opening establishes the practical-skills case efficiently.', issues: ['A named project or placement would make the claim less abstract.'] },
        { paragraphIndex: 2, summary: 'The counterargument is separated and developed logically.', issues: ['The final sentence bridges back to the thesis without a clear link word.'] },
      ],
      sentences: buildSentenceRecords(),
      rewrites: [],
    },
  }
}

/** Progress events the evaluation emits, in order. The last one is terminal. */
export const EVAL_EVENT_TEMPLATE = [
  { eventType: 'stage', payload: { stage: 'preparing', message: '正在准备评测...' } },
  { eventType: 'log', payload: { message: '已读取作文草稿' } },
  { eventType: 'stage', payload: { stage: 'scoring', message: '正在按 IELTS 标准逐项评分' } },
  { eventType: 'log', payload: { message: '任务回应与连贯性分析中' } },
  { eventType: 'completed', payload: { message: '评分完成' } },
]

// ---------------------------------------------------------------- history ---

function wrongAnswer(correct) {
  const text = String(correct ?? '')
  if (/^[A-H]$/.test(text)) return text === 'A' ? 'B' : 'A'
  if (/^(TRUE|FALSE|NOT GIVEN)$/i.test(text)) return 'NOT GIVEN'
  return 'unclear'
}

function readingDetail(item, asset, ratio) {
  const key = buildReadingPayload(asset).answerKey || {}
  const rand = rng(item.id.length * 97 + Math.round(ratio * 1000))
  const answers = Object.keys(key).map((questionId) => {
    const isCorrect = rand() < ratio
    return {
      questionId,
      answer: isCorrect ? key[questionId] : wrongAnswer(key[questionId]),
      isCorrect,
      weight: 1,
      questionKind: null,
      marked: questionId === 'q1' || questionId === 'q9',
    }
  })
  return {
    summary: item,
    attempt: {
      id: item.id,
      activity: 'reading',
      mode: 'single',
      status: 'completed',
      submittedAt: item.submittedAt,
      durationMs: item.durationMs,
      scoreValue: ratio,
      scoreScale: 'ratio',
      correctCount: answers.filter((a) => a.isCorrect).length,
      questionCount: answers.length,
      assetId: asset.id,
      titleSnapshot: asset.title,
      answers,
      annotations: [],
    },
  }
}

/** Result detail for a writing attempt; `essay` overrides the canned text for live submissions. */
export function writingDetail(item, band, essay = {}) {
  return {
    summary: item,
    attempt: {
      schemaVersion: 1,
      id: item.id,
      activity: 'writing',
      mode: item.mode,
      status: 'completed',
      startedAt: new Date(Date.parse(item.submittedAt) - item.durationMs).toISOString(),
      submittedAt: item.submittedAt,
      completedAt: item.submittedAt,
      durationMs: item.durationMs,
      scoreValue: band,
      scoreScale: 'band9',
      taskType: item.taskType,
      titleSnapshot: item.title,
      promptSnapshot: essay.promptSnapshot || item.title,
      contentText: essay.contentText || ESSAY_TEXT,
      answers: [],
      annotations: [],
    },
    evaluation: buildWritingEvaluation({ id: `evaluation-${item.id}`, band, taskType: item.taskType }),
  }
}

/** 40 attempts over the last 30 days: 24 reading, 16 writing, upward trend. */
function buildHistory(now, assets) {
  const items = []
  const details = {}
  const practiceAssets = assets.filter((a) => !a.pdfOnly)
  for (let i = 0; i < 40; i += 1) {
    const progress = i / 39
    const dayOffset = Math.floor((29 * (39 - i)) / 39)
    const submittedAt = new Date(now - dayOffset * DAY_MS - ((i * 37) % 600) * 60_000).toISOString()
    const noise = rng(1000 + i)() - 0.5
    if (i % 5 === 1 || i % 5 === 4) {
      const taskType = i % 2 === 0 ? 'task2' : 'task1'
      const band = Math.min(7.5, Math.max(5.5, Math.round((5.5 + 2.0 * progress + noise * 0.6) * 2) / 2))
      const id = `writing-attempt-${String(i + 1).padStart(2, '0')}`
      const prompt = taskType === 'task2' ? TASK2_PROMPTS[i % TASK2_PROMPTS.length][1] : TASK1_PROMPTS[i % TASK1_PROMPTS.length][1]
      const item = {
        id,
        activity: 'writing',
        title: prompt.split('.')[0].slice(0, 90),
        status: 'completed',
        mode: 'freeform',
        submittedAt,
        durationMs: 2_100_000 + Math.round(rng(3000 + i)() * 600_000),
        scoreValue: band,
        scoreScale: 'band9',
        scoreLabel: 'Overall Band',
        scoreDisplay: band.toFixed(1),
        taskType,
        sessionId: id,
      }
      items.push(item)
      details[id] = writingDetail(item, band)
    } else {
      const asset = practiceAssets[i % practiceAssets.length]
      const ratio = Math.min(0.92, Math.max(0.45, Math.round((0.45 + 0.47 * progress + noise * 0.08) * 100) / 100))
      const id = `reading-attempt-${String(i + 1).padStart(2, '0')}`
      const item = {
        id,
        activity: 'reading',
        title: asset.title,
        status: 'completed',
        mode: 'single',
        submittedAt,
        durationMs: 1_080_000 + Math.round(rng(2000 + i)() * 420_000),
        scoreValue: ratio,
        scoreScale: 'ratio',
        scoreLabel: 'Accuracy',
        scoreDisplay: `${Math.round(ratio * 100)}%`,
        taskType: 'reading',
        assetId: asset.id,
        sessionId: `session-${id}`,
      }
      items.push(item)
      details[id] = readingDetail(item, asset, ratio)
    }
  }
  return { items, details }
}

// --------------------------------------------------------------- settings ---

function buildAiConfigs() {
  return [
    { id: 'ai-cfg-deepseek', configName: 'DeepSeek 主力', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', isDefault: true, isEnabled: true, hasSecret: true },
    { id: 'ai-cfg-openai', configName: 'OpenAI 备用', provider: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', isDefault: false, isEnabled: true, hasSecret: false },
  ]
}

function buildBackups(now) {
  const entry = (name, daysAgo, sizeBytes) => ({
    name,
    grantId: `grant-${name}`,
    displayPath: `C:/atlas/backups/${name}`,
    modifiedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
    sizeBytes,
  })
  return [
    entry('ielts-backup-2026-10-12.zip', 7, 2_481_920),
    entry('ielts-backup-2026-10-05.zip', 14, 2_310_144),
    entry('ielts-backup-2026-09-28.zip', 21, 1_998_336),
  ]
}

function buildSettings(now) {
  const stamp = new Date(now - 2 * DAY_MS).toISOString()
  return [
    { namespace: 'app', key: 'locale', value: 'zh-CN', updatedAt: stamp },
    { namespace: 'app', key: 'theme', value: 'paper', updatedAt: stamp },
    { namespace: 'app', key: 'reducedMotion', value: false, updatedAt: stamp },
  ]
}

export const APP_INFO = { name: 'ielts-practice', version: '0.1.0', tauriVersion: '2', productName: 'IELTS Practice', host: 'tauri' }

export const APP_DATA_PATHS = {
  appData: 'C:/atlas/data',
  logs: 'C:/atlas/logs',
  backups: 'C:/atlas/backups',
  imports: 'C:/atlas/imports',
  exports: 'C:/atlas/exports',
  diagnostics: 'C:/atlas/diagnostics',
  dbDir: 'C:/atlas/data/db',
}

// ----------------------------------------------------- notebook / learner ---

function buildNotebookSeed(now) {
  const ZERO = { newCandidates: 0, promoted: 0, reinforced: 0, refined: 0, improved: 0, regressed: 0, contradicted: 0, superseded: 0 }
  const dayList = []
  for (let i = 27; i >= 0; i -= 1) dayList.push(new Date(now - i * DAY_MS).toISOString().slice(0, 10))
  const practiceDays = dayList.filter((_, i) => i % 4 !== 3)
  const topics = [
    ['reading.tfng', 'writing.taskResponse', 'reading.matching_headings'],
    ['reading.short_answer', 'reading.yng', 'writing.coherence'],
    ['reading.summary_completion', 'writing.lexical', 'reading.tfng'],
    ['reading.matching_headings', 'writing.grammar', 'reading.multi_choice'],
  ]
  const journalShell = (journalDate, facts) => ({
    id: `journal-${journalDate}`,
    userId: 'local',
    journalDate,
    version: 1,
    status: 'published',
    facts: {
      journalDate, timeSpentMs: 0, writingEvalSummary: { completed: 0, degraded: 0, averageBand: null },
      skillDeltas: [], memoryChanges: ZERO, coachFeedbackCount: 0, coachReaskCount: 0,
      sourceHash: `hash-${journalDate}`, todayObservationIds: [], memoryEvents: [], ...facts,
    },
    sourceHash: `hash-${journalDate}`,
    renderedMarkdown: null,
    supersededBy: null,
    createdAt: `${journalDate}T23:00:00Z`,
    updatedAt: `${journalDate}T23:00:00Z`,
  })
  const journals = {}
  practiceDays.forEach((date, n) => {
    const keys = topics[n % topics.length]
    const writing = n % 3 === 0
    journals[date] = journalShell(date, {
      attemptsCount: 1 + (n % 4),
      timeSpentMs: (20 + ((n * 7) % 50)) * 60_000,
      writingEvalSummary: { completed: writing ? 1 : 0, degraded: 0, averageBand: writing ? 6.5 : null },
      skillDeltas: keys.map((key, k) => ({ skillKey: key, delta: (n + k) % 3 === 0 ? -0.3 : 0.3, evidenceCount: 2 })),
      coachFeedbackCount: n % 3,
      coachReaskCount: n % 5 === 0 ? 1 : 0,
      memoryEvents: n % 2 === 0
        ? [{ memoryId: 'mem-tfng', namespace: 'skill', canonicalKey: 'reading.tfng', changeKind: n > 14 ? 'improved' : 'reinforced', evidenceObservationIds: [`obs-tfng-${n % 3}`] }]
        : [],
    })
  })
  const weeks = [
    { window: '2026-W36', windowStart: '2026-08-31', windowEnd: '2026-09-06', observations: ['刚开始记录时，判断题的错误率偏高', '写作还没有固定的审题习惯'], changes: ['完成了第一轮基础练习'], nextPractice: ['先把判断题的三种选项区分清楚', '写作先练审题，不急着写全文'] },
    { window: '2026-W37', windowStart: '2026-09-07', windowEnd: '2026-09-13', observations: ['判断题开始能分清“错误”与“未提及”的边界', '写作的审题速度变快了一些'], changes: ['判断题正确率从三成升到四成'], nextPractice: ['继续做判断题对照练习', '写作尝试列大纲再写'] },
    { window: '2026-W38', windowStart: '2026-09-14', windowEnd: '2026-09-20', observations: ['判断题里，未提及与错误仍然混在一起', '段落大意配对的干扰项命中率在下降', '写作的衔接词开始有意识地使用'], changes: ['判断题的正确率从四成回升到六成', '词汇资源的分数稳定在六分上下'], nextPractice: ['针对判断题做两组对照练习', '每周一篇小作文，重点看段落衔接'] },
    { window: '2026-W39', windowStart: '2026-09-21', windowEnd: '2026-09-27', observations: ['段落大意题的错误集中在细节型干扰项', '简答题开始能把原文的同义替换找出来'], changes: ['简答题的定位速度明显变快', '是非题仍然把作者观点当成事实'], nextPractice: ['练习是非题与判断题的边界', '做一套限时简答题'] },
    { window: '2026-W40', windowStart: '2026-09-28', windowEnd: '2026-10-04', observations: ['摘要填空的语法形式判断更稳定', '写作语法的错误集中在从句与时态'], changes: ['摘要填空的得分从五分提到六分半'], nextPractice: ['针对从句结构做一组语法修正', '摘要填空做两篇计时练习'] },
    { window: '2026-W41', windowStart: '2026-10-05', windowEnd: '2026-10-11', observations: ['判断题的证据定位已经能给出原文句子', '阅读整体节奏偏慢，后半部分容易赶时间'], changes: ['判断题的错误与未提及开始分开判断', '写作任务回应的分数持续上升'], nextPractice: ['阅读计时：每篇控制在二十分钟内', '继续练习段落大意配对'] },
  ]
  const catalog = [
    { id: 'mem-tfng', canonicalKey: 'reading.tfng', statement: '判断题中，你常把“未提及”误判为“错误”。', sourceClass: 'observed', namespace: 'skill', status: 'active', version: 2, scope: 'activity:reading', confidenceBand: 'medium', supportCount: 4, contradictionCount: 0, firstSeen: '2026-09-14T09:00:00Z', pendingVerification: false, evidenceObservationIds: ['obs-tfng-0'], lastSeen: '2026-10-02T09:00:00Z' },
    { id: 'mem-pref', canonicalKey: 'pref.examples', statement: '你更喜欢先看例句，再看规则讲解。', sourceClass: 'user_explicit', namespace: 'preference', status: 'active', version: 1, scope: 'activity:reading', confidenceBand: 'high', supportCount: 3, contradictionCount: 0, firstSeen: '2026-09-14T09:00:00Z', pendingVerification: false, evidenceObservationIds: [], lastSeen: '2026-09-28T09:00:00Z' },
    { id: 'mem-time', canonicalKey: 'pace.reading', statement: '阅读时，后半部分的节奏往往比前半部分慢一半。', sourceClass: 'observed', namespace: 'skill', status: 'active', version: 1, scope: 'activity:reading', confidenceBand: 'medium', supportCount: 2, contradictionCount: 0, firstSeen: '2026-10-01T09:00:00Z', pendingVerification: false, evidenceObservationIds: [], lastSeen: '2026-10-05T09:00:00Z' },
  ]
  const skills = [
    ['reading.tfng', 'high', 'declining', 1, 2], ['reading.matching_headings', 'high', 'stable', 2, 2],
    ['reading.yng', 'medium', 'improving', 4, 3], ['reading.short_answer', 'medium', 'improving', 5, 4],
    ['reading.summary_completion', 'medium', 'stable', 3, 2], ['writing.taskResponse', 'low', 'improving', 6, 4],
    ['writing.coherence', 'high', 'insufficient_evidence', 1, 1], ['writing.lexical', 'low', 'stable', 7, 5],
  ]
  const priority = ['urgent', 'high', 'high', 'moderate', 'moderate', 'moderate', 'watch', 'watch', 'urgent', 'high', 'moderate', 'watch']
  const reasons = [['low_mastery_estimate', 'recent_errors'], ['high_uncertainty'], ['review_due'], ['needs_new_asset_transfer', 'recent_errors'], ['stability_check'], ['review_due', 'low_mastery_estimate'], ['high_uncertainty'], ['stability_check'], ['recent_errors'], ['needs_new_asset_transfer'], ['review_due'], ['stability_check']]
  const probes = ['novel_item', 'same_item_retention', 'contrastive_pair', 'coach_micro_drill', 'writing_rewrite']
  const skillKeys = ['reading.tfng', 'reading.matching_headings', 'reading.yng', 'reading.short_answer', 'reading.summary_completion', 'writing.taskResponse', 'writing.coherence', 'writing.lexical', 'reading.multi_choice', 'reading.sentence_completion', 'writing.grammar', 'reading.flow_chart_completion']
  return {
    journals,
    dayList,
    weeks,
    catalog,
    states: skills.map(([skillKey, uncertaintyBand, trend, evidenceCount, distinctAssetCount], i) => ({
      skillKey, uncertaintyBand, trend, evidenceCount: evidenceCount * 3 + i, distinctAssetCount,
      nextReviewAt: new Date(now + (i + 1) * DAY_MS).toISOString(),
    })),
    needs: skillKeys.map((skillKey, i) => ({
      skillKey, priorityBand: priority[i], reasonCodes: reasons[i], preferredProbe: probes[i % probes.length],
      evidenceCount: 2 + (i % 5), distinctAssetCount: 1 + (i % 3), avoidAssetIds: i % 2 ? ['p1-high-01'] : [],
      dueAt: new Date(now + ((i % 6) - 1) * DAY_MS).toISOString(),
    })),
    plan: {
      plan: { id: 'plan-1', userId: 'local', goal: '复习判断题边界', availableMinutes: 45, targetDate: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
      items: [
        { id: 'spi-1', planId: 'plan-1', skillProbe: { skillKey: 'reading.tfng', probeKind: 'contrastive_pair' }, whyText: '用两组“错误 / 未提及”对照题，练习定位原文证据。', estimatedMinutes: 15, done: false, createdAt: '2026-10-01T00:00:00Z' },
        { id: 'spi-2', planId: 'plan-1', skillProbe: 'reading.matching_headings', whyText: '段落大意的干扰项要逐段排除。', estimatedMinutes: 10, done: false, createdAt: '2026-10-01T00:00:00Z' },
      ],
    },
  }
}

function buildSoulSeed(now) {
  const notes = '先看错题，再开始新的练习。'
  return {
    profile: {
      'soul.nickname': '小林',
      'soul.address': '你',
      'soul.tone': '平衡',
      'soul.targetBand': 7,
      'soul.examDate': '2027-05-09',
      'soul.message': '希望先把判断题的错误率降下来。',
      'soul.companionNotes': notes,
      'soul.toneSuggestion': '平衡',
    },
    revisions: [{
      id: 'soul-model-1',
      key: 'soul.companionNotes',
      before: null,
      after: notes,
      actor: 'model',
      evidenceIds: ['qtype.tfng.wrong', 'repeated.tfng.passages'],
      reason: '同类题在两篇文章里都有错题。',
      runId: 'drmrun-dev-mock',
      createdAt: new Date(now - 2 * DAY_MS).toISOString(),
      revertsId: null,
    }],
  }
}

// ------------------------------------------------------------------ seed ---

/**
 * Seed state for the dev command table. The in-page mock creates one per page
 * load (tauri-mock.js); the HTTP backend creates one per process and keeps it
 * across reloads (server.js).
 */
export function createSeedState(now = Date.now()) {
  const assets = buildReadingAssets()
  const history = buildHistory(now, assets)
  return {
    now,
    reading: { assets, payloads: buildReadingPayloads(assets), drafts: {} },
    history: { items: history.items, details: history.details, retention: { maxTerminalAttempts: 200 }, clearTokens: {} },
    topics: buildTopics(now),
    prompts: buildWritingPrompts(now),
    writing: { drafts: {}, attempts: {}, evaluations: {}, events: {}, timers: {} },
    settings: buildSettings(now),
    soul: buildSoulSeed(now),
    aiConfigs: buildAiConfigs(),
    secretRefs: [{ name: 'ai.deepseek.api_key', refId: 'secret-ref-1', updatedAt: new Date(now - 3 * DAY_MS).toISOString() }],
    backups: buildBackups(now),
    notebook: buildNotebookSeed(now),
  }
}
