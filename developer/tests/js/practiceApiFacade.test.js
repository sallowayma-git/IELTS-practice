#!/usr/bin/env node
import assert from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const require = createRequire(import.meta.url)

function ensureServerBundle() {
    execFileSync('npm', ['run', 'build:server'], {
        cwd: repoRoot,
        stdio: 'inherit'
    })
}

function createMockServices(options = {}) {
    const calls = {
        writingStarts: [],
        readingCoachQueries: [],
        settingsQueries: []
    }

    return {
        calls,
        services: {
            db: options.db || {},
            configService: {},
            promptService: {},
            settingsService: {
                async get(key) {
                    calls.settingsQueries.push(key)
                    if (typeof options.settingsGet === 'function') {
                        return options.settingsGet(key)
                    }
                    if (Object.prototype.hasOwnProperty.call(options, 'readingCoachEnabled') && key === 'practice.readingCoach.enabled') {
                        return options.readingCoachEnabled
                    }
                    return true
                },
                async getAll() {
                    return {}
                },
                async update(payload = {}) {
                    return payload
                },
                async reset() {
                    return true
                }
            },
            uploadService: {},
            essayService: {},
            topicService: {
                async list(filters, pagination) {
                    return {
                        data: [
                            {
                                id: 7,
                                type: 'task2',
                                category: 'education',
                                difficulty: 3,
                                title_json: JSON.stringify({
                                    type: 'doc',
                                    content: [
                                        {
                                            type: 'paragraph',
                                            content: [
                                                { type: 'text', text: 'Some people think homework should be optional.' }
                                            ]
                                        }
                                    ]
                                }),
                                image_path: null,
                                is_official: 1
                            }
                        ],
                        total: 1,
                        page: pagination.page,
                        limit: pagination.limit
                    }
                },
                async getById(id) {
                    if (Number(id) !== 7) return null
                    return {
                        id: 7,
                        type: 'task2',
                        category: 'education',
                        difficulty: 3,
                        title_json: 'Discuss both views and give your opinion.',
                        image_path: null,
                        is_official: 1
                    }
                }
            },
            evaluateService: {
                async start(payload) {
                    calls.writingStarts.push(payload)
                    return { sessionId: 'writing-session-1' }
                },
                async getSessionState(sessionId) {
                    return {
                        sessionId,
                        active: true,
                        status: 'running',
                        lastSequence: 2,
                        events: [
                            { type: 'start', sessionId, sequence: 1 },
                            { type: 'progress', sessionId, sequence: 2, data: { percent: 10 } }
                        ]
                    }
                },
                async cancel(sessionId) {
                    return { ok: true, sessionId }
                },
                subscribeSession(_sessionId, _handler) {
                    return () => {}
                }
            },
            readingCoachService: {
                async query(payload, queryOptions = {}) {
                    calls.readingCoachQueries.push(payload)
                    if (typeof queryOptions.onEvent === 'function') {
                        queryOptions.onEvent({ type: 'retrieval', data: { chunkCount: 1 } })
                    }
                    const defaultResponse = {
                        coachVersion: 'test',
                        answer: 'Use paragraph evidence first.',
                        answerSections: [
                            {
                                type: 'reasoning',
                                text: 'You matched a paragraph keyword before checking the full question constraint.'
                            },
                            {
                                type: 'next_step',
                                text: 'Write the exact question constraint before choosing the option.'
                            }
                        ],
                        reviewOverall: {
                            primaryWeakness: '定位后没有复核限定词。',
                            patternSummary: '错题集中在关键词命中后过早选择。',
                            teachingPlan: '先定位，再核对限定词，最后排除局部真实但不答题的选项。'
                        },
                        reviewQuestionAnalyses: [
                            {
                                questionNumber: '14',
                                likelyMistake: '被 paragraph keyword 吸引',
                                whyUserChoseWrong: '没有核对题干关系',
                                whyCorrectAnswerWorks: '正确答案满足完整题干约束',
                                whyWrongAnswerFails: '错误答案只满足局部词汇',
                                nextRule: '每题定位后先写一句题干真正问什么。'
                            }
                        ],
                        followUps: ['Show evidence'],
                        confidence: 'high'
                    }
                    if (typeof options.readingCoachResponse === 'function') {
                        return options.readingCoachResponse(payload)
                    }
                    return options.readingCoachResponse || defaultResponse
                }
            }
        }
    }
}

async function createApp(options = {}) {
    const { createServerApp } = require(path.join(repoRoot, 'server/dist/app.js'))
    const bundle = createMockServices(options)
    const app = await createServerApp(bundle.services)
    return { app, calls: bundle.calls }
}

function parseSseEvents(payload) {
    return String(payload || '')
        .split('\n\n')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
            const lines = chunk.split('\n')
            const event = String(lines.find((line) => line.startsWith('event: ')) || '').slice('event: '.length)
            const dataLine = lines.find((line) => line.startsWith('data: '))
            return {
                event,
                data: dataLine ? JSON.parse(dataLine.slice('data: '.length)) : null
            }
        })
}

function createFakePracticeHistoryDb() {
    const rows = new Map()
    const suiteRows = new Map()
    const clone = (value) => JSON.parse(JSON.stringify(value))
    const sortRows = (items) => items.sort((left, right) => String(right.submitted_at || '').localeCompare(String(left.submitted_at || '')))

    return {
        exec() {},
        close() {},
        prepare(sql) {
            const normalized = String(sql || '').replace(/\s+/g, ' ').trim()
            if (normalized.startsWith('INSERT INTO practice_history_records')) {
                return {
                    run(record) {
                        rows.set(record.id, {
                            id: record.id,
                            activity: record.activity,
                            session_id: record.sessionId,
                            asset_id: record.assetId,
                            exam_id: record.examId,
                            title: record.title,
                            status: record.status,
                            score: record.score,
                            total_questions: record.totalQuestions,
                            correct_answers: record.correctAnswers,
                            accuracy: record.accuracy,
                            duration: record.duration,
                            submitted_at: record.submittedAt,
                            started_at: record.startTime,
                            ended_at: record.endTime,
                            metadata_json: record.metadataJson,
                            submission_json: record.submissionJson,
                            created_at: record.submittedAt,
                            updated_at: record.updatedAt
                        })
                        return { changes: 1 }
                    }
                }
            }

            if (normalized.startsWith('INSERT INTO practice_reading_suite_sessions')) {
                return {
                    run(record) {
                        suiteRows.set(record.sessionId, {
                            session_id: record.sessionId,
                            status: record.status,
                            flow_mode: record.flowMode,
                            frequency_scope: record.frequencyScope,
                            current_index: record.currentIndex,
                            total_passages: record.totalPassages,
                            session_json: record.sessionJson,
                            created_at: record.createdAt,
                            updated_at: record.updatedAt,
                            completed_at: record.completedAt
                        })
                        return { changes: 1 }
                    }
                }
            }

            if (normalized.startsWith('SELECT * FROM practice_reading_suite_sessions WHERE session_id = ?')) {
                return {
                    get(sessionId) {
                        const row = suiteRows.get(sessionId)
                        return row ? clone(row) : undefined
                    }
                }
            }

            if (normalized.startsWith('DELETE FROM practice_reading_suite_sessions WHERE session_id = ?')) {
                return {
                    run(sessionId) {
                        const deleted = suiteRows.delete(sessionId)
                        return { changes: deleted ? 1 : 0 }
                    }
                }
            }

            if (normalized.startsWith('SELECT COUNT(*) AS total FROM practice_history_records')) {
                return {
                    get(activity) {
                        const data = Array.from(rows.values()).filter((row) => !activity || row.activity === activity)
                        return { total: data.length }
                    }
                }
            }

            if (normalized.startsWith('SELECT * FROM practice_history_records WHERE id = ? AND activity = ?')) {
                return {
                    get(id, activity) {
                        const row = rows.get(id)
                        return row && row.activity === activity ? clone(row) : undefined
                    }
                }
            }

            if (normalized.startsWith('SELECT * FROM practice_history_records WHERE session_id = ? AND activity = ?')) {
                return {
                    get(sessionId, activity) {
                        const row = Array.from(rows.values()).find((entry) => (
                            entry.session_id === sessionId && entry.activity === activity
                        ))
                        return row ? clone(row) : undefined
                    }
                }
            }

            if (normalized === 'SELECT * FROM practice_history_records WHERE activity = ? ORDER BY submitted_at DESC') {
                return {
                    all(activity) {
                        return sortRows(Array.from(rows.values()).filter((row) => row.activity === activity)).map(clone)
                    }
                }
            }

            if (normalized.startsWith('DELETE FROM practice_history_records WHERE id = ? AND activity = ?')) {
                return {
                    run(id, activity) {
                        const row = rows.get(id)
                        if (!row || row.activity !== activity) {
                            return { changes: 0 }
                        }
                        rows.delete(id)
                        return { changes: 1 }
                    }
                }
            }

            if (normalized.startsWith('DELETE FROM practice_history_records WHERE activity = ?')) {
                return {
                    run(activity) {
                        let deleted = 0
                        Array.from(rows.entries()).forEach(([id, row]) => {
                            if (row.activity === activity) {
                                rows.delete(id)
                                deleted += 1
                            }
                        })
                        return { changes: deleted }
                    }
                }
            }

            if (normalized === 'DELETE FROM practice_history_records') {
                return {
                    run() {
                        const deleted = rows.size
                        rows.clear()
                        return { changes: deleted }
                    }
                }
            }

            if (normalized.startsWith('SELECT id, activity, session_id, asset_id, exam_id, title, status, score, total_questions, correct_answers, accuracy, duration, submitted_at, started_at, ended_at, metadata_json FROM practice_history_records')) {
                return {
                    all(...args) {
                        let activity = null
                        let limit
                        let offset
                        if (normalized.includes('WHERE activity = ?')) {
                            activity = args[0]
                            limit = Number(args[1])
                            offset = Number(args[2])
                        } else {
                            limit = Number(args[0])
                            offset = Number(args[1])
                        }
                        const data = sortRows(Array.from(rows.values()).filter((row) => !activity || row.activity === activity))
                        return data.slice(offset, offset + limit).map((row) => {
                            const { submission_json, ...summary } = row
                            return clone(summary)
                        })
                    }
                }
            }

            if (normalized.startsWith('SELECT * FROM practice_history_records')) {
                return {
                    all(...args) {
                        let activity = null
                        let limit
                        let offset
                        if (normalized.includes('WHERE activity = ?')) {
                            activity = args[0]
                            limit = Number(args[1])
                            offset = Number(args[2])
                        } else {
                            limit = Number(args[0])
                            offset = Number(args[1])
                        }
                        const data = sortRows(Array.from(rows.values()).filter((row) => !activity || row.activity === activity))
                        return data.slice(offset, offset + limit).map(clone)
                    }
                }
            }

            throw new Error(`Unexpected fake db SQL: ${normalized}`)
        }
    }
}

async function testReadingAssetFacade() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'GET',
        url: '/api/practice/assets?activity=reading&page=1&limit=2'
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const payload = response.json()
    assert.strictEqual(payload.success, true)
    assert.strictEqual(payload.data.page, 1)
    assert.strictEqual(payload.data.limit, 2)
    assert.ok(payload.data.total > 100, 'reading manifest should expose generated exam assets')
    assert.strictEqual(payload.data.data.length, 2)
    assert.strictEqual(payload.data.data[0].activity, 'reading')
    assert.strictEqual(payload.data.data[0].source, 'reading_exam')
    assert.ok(payload.data.data[0].id)
    assert.ok(payload.data.data[0].title)
    assert.ok(payload.data.data[0].metadata.script, 'generated reading asset should expose existing script metadata')
    assert.strictEqual(payload.data.data[0].payloadRef, payload.data.data[0].metadata.dataKey)
}

function createProviderReadingPayload(assetId, category) {
    return {
        schemaVersion: 'ReadingExamSourceV1',
        examId: assetId,
        meta: {
            title: `Provider ${category}`,
            category,
            frequency: 'high',
            pdfFilename: null,
            legacyPath: null,
            legacyFilename: null,
            questionIntroHtml: null
        },
        passage: {
            blocks: [
                {
                    blockId: `${assetId}-passage`,
                    kind: 'html',
                    html: `<p>${assetId} passage</p>`
                }
            ]
        },
        questionGroups: [
            {
                groupId: `${assetId}-group`,
                kind: 'provider-test',
                questionIds: ['q1'],
                bodyHtml: '<input name="q1" type="text" />',
                leadHtml: null,
                allowOptionReuse: false
            }
        ],
        answerKey: {
            q1: 'A'
        },
        questionOrder: ['q1'],
        questionDisplayMap: {
            q1: '1'
        },
        questionCount: 1,
        interactionModel: {
            q1: {
                questionId: 'q1',
                displayLabel: '1',
                control: 'text',
                source: 'fallback',
                name: 'q1'
            }
        }
    }
}

function createInjectedReadingAssetProvider() {
    const calls = {
        listAssets: 0,
        getAsset: [],
        getStatus: 0,
        refresh: 0
    }
    const assets = ['P1', 'P2', 'P3'].map((category) => {
        const id = `provider-${category.toLowerCase()}`
        return {
            id,
            activity: 'reading',
            title: `Provider ${category}`,
            source: 'reading_exam',
            category,
            payloadRef: id,
            metadata: {
                dataKey: id,
                frequency: 'high'
            },
            payload: createProviderReadingPayload(id, category)
        }
    })
    const summaries = assets.map(({ payload, ...asset }) => asset)
    return {
        calls,
        provider: {
            listAssets() {
                calls.listAssets += 1
                return summaries.map((asset) => ({ ...asset, metadata: { ...asset.metadata } }))
            },
            getAsset(assetId) {
                calls.getAsset.push(assetId)
                const asset = assets.find((entry) => entry.id === assetId)
                if (!asset) {
                    const error = new Error(`not found: ${assetId}`)
                    error.statusCode = 404
                    error.code = 'practice_asset_not_found'
                    throw error
                }
                return {
                    ...asset,
                    metadata: { ...asset.metadata },
                    payload: JSON.parse(JSON.stringify(asset.payload))
                }
            },
            getStatus() {
                calls.getStatus += 1
                return {
                    source: 'builtin',
                    ready: true,
                    assetCount: assets.length,
                    htmlCount: assets.length,
                    pdfCount: 0,
                    version: 'provider-test',
                    lastLoadedAt: '2026-06-04T00:00:00.000Z',
                    error: null
                }
            },
            refresh() {
                calls.refresh += 1
                return this.getStatus()
            }
        }
    }
}

async function testPracticeServiceUsesInjectedReadingAssetProvider() {
    const { PracticeService } = require(path.join(repoRoot, 'server/dist/lib/practice/service.js'))
    const bundle = createMockServices()
    const injected = createInjectedReadingAssetProvider()
    const service = new PracticeService(bundle.services, {
        readingAssetProvider: injected.provider
    })

    const listed = await service.listAssets({ activity: 'reading', page: 1, limit: 10, refresh: true })
    assert.strictEqual(injected.calls.refresh, 1)
    assert.strictEqual(listed.total, 3)
    assert.deepStrictEqual(listed.data.map((asset) => asset.id), ['provider-p1', 'provider-p2', 'provider-p3'])
    assert.strictEqual(listed.data[0].payload, undefined)

    const detail = await service.getAsset('reading', 'provider-p1')
    assert.strictEqual(detail.id, 'provider-p1')
    assert.strictEqual(detail.payload.examId, 'provider-p1')

    const session = await service.createSession({
        activity: 'reading',
        assetId: 'provider-p1',
        attempt: {
            answers: {
                q1: 'A'
            },
            durationSec: 9
        }
    })
    assert.strictEqual(session.status, 'submitted')
    assert.strictEqual(session.submission.examId, 'provider-p1')
    assert.strictEqual(session.submission.scoreInfo.correct, 1)

    const suite = await service.createReadingSuite({
        frequencyScope: 'custom',
        sequence: ['provider-p1', 'provider-p2', 'provider-p3']
    })
    assert.deepStrictEqual(suite.sequence.map((entry) => entry.assetId), ['provider-p1', 'provider-p2', 'provider-p3'])
    assert.deepStrictEqual(suite.sequence.map((entry) => entry.category), ['P1', 'P2', 'P3'])

    const suiteSubmit = await service.submitReadingSuitePassage(suite.sessionId, 'provider-p1', {
        answers: {
            q1: 'A'
        },
        durationSec: 11
    })
    assert.strictEqual(suiteSubmit.suiteSession.currentIndex, 1)
    assert.strictEqual(suiteSubmit.submission.metadata.practiceMode, 'suite')
    assert.ok(injected.calls.getAsset.filter((assetId) => assetId === 'provider-p1').length >= 3)
}

async function testPracticePaginationClamp() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'GET',
        url: '/api/practice/assets?activity=reading&page=1&limit=999'
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const payload = response.json()
    assert.strictEqual(payload.success, true)
    assert.strictEqual(payload.data.page, 1)
    assert.strictEqual(payload.data.limit, 200)
    assert.strictEqual(payload.data.data.length, 200)
    assert.ok(payload.data.total >= 200)
}

async function testReadingAssetDetailFacade() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'GET',
        url: '/api/practice/assets/reading/p1-high-01'
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const asset = response.json().data
    assert.strictEqual(asset.id, 'p1-high-01')
    assert.strictEqual(asset.activity, 'reading')
    assert.strictEqual(asset.source, 'reading_exam')
    assert.strictEqual(asset.payload.examId, 'p1-high-01')
    assert.strictEqual(asset.payload.questionCount, 13)
    assert.ok(asset.payload.passage.blocks[0].html.includes('A Brief History of Tea'))
    assert.ok(asset.payload.questionGroups.length > 0)
    assert.strictEqual(asset.payload.answerKey.q1, 'viii')
    assert.deepStrictEqual(asset.payload.questionOrder.slice(0, 3), ['q1', 'q2', 'q3'])
    assert.strictEqual(asset.payload.questionDisplayMap.q13, '13')
    assert.strictEqual(asset.payload.interactionModel.q1.control, 'dragdrop')
    assert.strictEqual(asset.payload.interactionModel.q1.source, 'dropzone')
    assert.strictEqual(asset.payload.interactionModel.q1.allowOptionReuse, false)
    assert.ok(asset.payload.interactionModel.q1.options.some((option) => option.value === 'viii'))
    assert.strictEqual(asset.payload.interactionModel.q9.control, 'dragdrop')
    assert.strictEqual(asset.payload.interactionModel.q9.allowOptionReuse, true)
    assert.ok(asset.payload.interactionModel.q9.options.some((option) => option.value === 'D'))
    assert.strictEqual(asset.payload.reviewExplanations.examId, 'p1-high-01')
    assert.ok(asset.payload.reviewExplanations.passageNotes.some((note) => note.text.includes('茶的起源')), 'reading detail must expose official passage notes')
    assert.ok(
        asset.payload.reviewExplanations.questionExplanations.some((section) => (
            section.questionRange?.start === 1
            && section.questionRange?.end === 8
            && section.items.some((item) => item.questionNumber === 1 && item.text.includes('一次偶然的发现'))
        )),
        'reading detail must expose official question explanations'
    )
    assert.strictEqual(asset.payload.reviewExplanations.questionExplanations[0].items[0].questionId, 'q1')
}

async function testOpenSourceLatestReadingAssetsFacade() {
    const { app } = await createApp()
    const latestAssetIds = ['p2-high-235', 'p2-high-236', 'p3-high-229']
    const latestExplanationAssetIds = ['p2-high-234', 'p2-high-235', 'p2-high-236', 'p3-high-229']
    const latestPassageNoteOnlyExplanationAssetIds = ['p1-low-223', 'p2-low-148', 'p3-medium-197']

    try {
        for (const assetId of latestAssetIds) {
            const response = await app.inject({
                method: 'GET',
                url: `/api/practice/assets/reading/${encodeURIComponent(assetId)}`
            })
            assert.strictEqual(response.statusCode, 200, `${assetId} should be exposed through Practice assets API`)
            const asset = response.json().data
            const payload = asset.payload
            assert.strictEqual(asset.id, assetId)
            assert.strictEqual(asset.activity, 'reading')
            assert.strictEqual(asset.source, 'reading_exam')
            assert.strictEqual(payload.examId, assetId)
            assert.ok(Array.isArray(payload.passage.blocks) && payload.passage.blocks.length > 0, `${assetId} should expose passage blocks`)
            assert.ok(Array.isArray(payload.questionGroups) && payload.questionGroups.length > 0, `${assetId} should expose question groups`)
            assert.ok(Array.isArray(payload.questionOrder) && payload.questionOrder.length > 0, `${assetId} should expose question order`)
            assert.strictEqual(payload.questionCount, payload.questionOrder.length, `${assetId} question count should match order`)
            assert.ok(payload.answerKey && typeof payload.answerKey === 'object', `${assetId} should expose answer key`)
            assert.ok(payload.interactionModel && typeof payload.interactionModel === 'object', `${assetId} should expose interaction model`)
            payload.questionOrder.forEach((questionId) => {
                assert.ok(Object.prototype.hasOwnProperty.call(payload.answerKey, questionId), `${assetId} missing answer key for ${questionId}`)
                assert.ok(payload.interactionModel[questionId], `${assetId} missing interaction model for ${questionId}`)
            })
        }

        for (const assetId of latestExplanationAssetIds) {
            const response = await app.inject({
                method: 'GET',
                url: `/api/practice/assets/reading/${encodeURIComponent(assetId)}`
            })
            assert.strictEqual(response.statusCode, 200, `${assetId} explanation asset should resolve`)
            const payload = response.json().data.payload
            assert.strictEqual(payload.reviewExplanations?.examId, assetId, `${assetId} should attach official explanation payload`)
            assert.ok(
                Array.isArray(payload.reviewExplanations?.passageNotes) && payload.reviewExplanations.passageNotes.length > 0,
                `${assetId} should expose official passage notes`
            )
            assert.ok(
                Array.isArray(payload.reviewExplanations?.questionExplanations) && payload.reviewExplanations.questionExplanations.length > 0,
                `${assetId} should expose official question explanations`
            )
        }

        for (const assetId of latestPassageNoteOnlyExplanationAssetIds) {
            const response = await app.inject({
                method: 'GET',
                url: `/api/practice/assets/reading/${encodeURIComponent(assetId)}`
            })
            assert.strictEqual(response.statusCode, 200, `${assetId} passage-note explanation asset should resolve`)
            const payload = response.json().data.payload
            assert.strictEqual(payload.reviewExplanations?.examId, assetId, `${assetId} should attach official explanation payload`)
            assert.ok(
                Array.isArray(payload.reviewExplanations?.passageNotes) && payload.reviewExplanations.passageNotes.length > 0,
                `${assetId} should expose official passage notes`
            )
        }
    } finally {
        await app.close()
    }
}

async function testReadingAssetDetailInputModes() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'GET',
        url: '/api/practice/assets/reading/p2-low-148'
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const asset = response.json().data
    const payload = asset.payload
    assert.strictEqual(payload.examId, 'p2-low-148')
    assert.strictEqual(payload.questionDisplayMap.q1, '14')
    assert.strictEqual(payload.interactionModel.q1.control, 'radio')
    assert.strictEqual(payload.interactionModel.q1.source, 'native_input')
    assert.ok(payload.interactionModel.q1.options.some((option) => option.value === 'A'))
    assert.strictEqual(payload.interactionModel.q6.control, 'text')
    assert.strictEqual(payload.interactionModel.q6.source, 'native_input')
    assert.strictEqual(payload.interactionModel.q10.control, 'checkbox')
    assert.strictEqual(payload.interactionModel.q10.name, 'q10_11')
    assert.ok(payload.interactionModel.q10.options.some((option) => option.value === 'B'))
}

async function testReadingAssetDetailMinifiedWrapperFacade() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'GET',
        url: '/api/practice/assets/reading/p2-low-051'
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const asset = response.json().data
    const payload = asset.payload
    assert.strictEqual(asset.id, 'p2-low-051')
    assert.strictEqual(payload.examId, 'p2-low-051')
    assert.strictEqual(payload.questionCount, 13)
    assert.strictEqual(payload.questionDisplayMap.q1, '14')
    assert.strictEqual(payload.answerKey.q11, 'Tasmanian tiger')
    assert.ok(payload.passage.blocks[0].html.includes('The dingo debate'))
    assert.ok(payload.questionGroups.length > 0)
    assert.strictEqual(payload.interactionModel.q1.control, 'radio')
    assert.strictEqual(payload.interactionModel.q11.control, 'text')
}

async function testMissingReadingAssetDetail() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'GET',
        url: '/api/practice/assets/reading/not-real'
    })
    await app.close()

    assert.strictEqual(response.statusCode, 404)
    const payload = response.json()
    assert.strictEqual(payload.error, 'practice_asset_not_found')
}

async function testReadingAssetPayloadCacheHotPath() {
    const runtime = require(path.join(repoRoot, 'server/dist/lib/practice/reading-assets.js'))
    runtime.clearReadingAssetCaches()
    assert.deepStrictEqual(runtime.getReadingAssetCacheStats(), {
        manifestCached: false,
        payloadEntries: 0,
        payloadLimit: 32,
        payloadAssetIds: []
    })

    const { app } = await createApp()
    try {
        const listResponse = await app.inject({
            method: 'GET',
            url: '/api/practice/assets?activity=reading&page=1&limit=50'
        })
        assert.strictEqual(listResponse.statusCode, 200)
        let stats = runtime.getReadingAssetCacheStats()
        assert.strictEqual(stats.manifestCached, true)
        assert.strictEqual(stats.payloadEntries, 0)

        const detailResponse = await app.inject({
            method: 'GET',
            url: '/api/practice/assets/reading/p2-low-148'
        })
        assert.strictEqual(detailResponse.statusCode, 200)
        stats = runtime.getReadingAssetCacheStats()
        assert.strictEqual(stats.payloadEntries, 1)
        assert.deepStrictEqual(stats.payloadAssetIds, ['p2-low-148'])

        const repeatedDetailResponse = await app.inject({
            method: 'GET',
            url: '/api/practice/assets/reading/p2-low-148'
        })
        assert.strictEqual(repeatedDetailResponse.statusCode, 200)
        assert.strictEqual(runtime.getReadingAssetCacheStats().payloadEntries, 1)

        const submitResponse = await app.inject({
            method: 'POST',
            url: '/api/practice/sessions',
            payload: {
                activity: 'reading',
                assetId: 'p2-low-148',
                attempt: {
                    answers: {
                        q1: 'B',
                        q6: 'dancing'
                    }
                }
            }
        })
        assert.strictEqual(submitResponse.statusCode, 200)
        assert.strictEqual(runtime.getReadingAssetCacheStats().payloadEntries, 1)

        const listedAssets = listResponse.json().data.data
        const extraAssetIds = listedAssets
            .map((asset) => asset.id)
            .filter((assetId) => assetId !== 'p2-low-148')
            .slice(0, runtime.getReadingAssetCacheStats().payloadLimit + 6)

        for (const assetId of extraAssetIds) {
            const response = await app.inject({
                method: 'GET',
                url: `/api/practice/assets/reading/${encodeURIComponent(assetId)}`
            })
            assert.strictEqual(response.statusCode, 200)
        }

        stats = runtime.getReadingAssetCacheStats()
        assert.ok(stats.payloadEntries <= stats.payloadLimit, 'reading payload cache must remain bounded')
        assert.strictEqual(stats.payloadAssetIds.length, stats.payloadEntries)
    } finally {
        await app.close()
        runtime.clearReadingAssetCaches()
    }
}

async function testReadingAssetForceRefreshClearsLoaderCache() {
    const runtime = require(path.join(repoRoot, 'server/dist/lib/practice/reading-assets.js'))
    runtime.clearReadingAssetCaches()
    const { app } = await createApp()
    try {
        let response = await app.inject({
            method: 'GET',
            url: '/api/practice/assets/reading/p2-low-148'
        })
        assert.strictEqual(response.statusCode, 200)
        let stats = runtime.getReadingAssetCacheStats()
        assert.strictEqual(stats.manifestCached, true)
        assert.strictEqual(stats.payloadEntries, 1)
        assert.deepStrictEqual(stats.payloadAssetIds, ['p2-low-148'])

        response = await app.inject({
            method: 'GET',
            url: '/api/practice/assets?activity=reading&page=1&limit=20&refresh=true'
        })
        assert.strictEqual(response.statusCode, 200)
        stats = runtime.getReadingAssetCacheStats()
        assert.strictEqual(stats.manifestCached, true)
        assert.strictEqual(stats.payloadEntries, 0)

        response = await app.inject({
            method: 'GET',
            url: '/api/practice/assets/reading/p2-low-148'
        })
        assert.strictEqual(response.statusCode, 200)
        assert.strictEqual(runtime.getReadingAssetCacheStats().payloadEntries, 1)

        response = await app.inject({
            method: 'GET',
            url: '/api/practice/assets/reading/p2-low-148?refresh=1'
        })
        assert.strictEqual(response.statusCode, 200)
        stats = runtime.getReadingAssetCacheStats()
        assert.strictEqual(stats.manifestCached, true)
        assert.strictEqual(stats.payloadEntries, 1)
        assert.deepStrictEqual(stats.payloadAssetIds, ['p2-low-148'])
    } finally {
        await app.close()
        runtime.clearReadingAssetCaches()
    }
}

async function testReadingInteractionCoverage() {
    const { app } = await createApp()
    const assets = []
    let page = 1
    let total = 0
    do {
        const listResponse = await app.inject({
            method: 'GET',
            url: `/api/practice/assets?activity=reading&page=${page}&limit=200`
        })
        assert.strictEqual(listResponse.statusCode, 200)
        const pagePayload = listResponse.json().data
        const pageAssets = Array.isArray(pagePayload.data) ? pagePayload.data : []
        total = Number(pagePayload.total || pageAssets.length)
        assets.push(...pageAssets)
        page += 1
    } while (assets.length < total)

    const failures = []
    const controlCounts = new Map()
    const allowedControls = new Set(['radio', 'checkbox', 'text', 'select', 'dragdrop'])

    for (const asset of assets) {
        const detailResponse = await app.inject({
            method: 'GET',
            url: `/api/practice/assets/reading/${encodeURIComponent(asset.id)}`
        })
        if (detailResponse.statusCode !== 200) {
            failures.push({ assetId: asset.id, issue: `status_${detailResponse.statusCode}` })
            continue
        }

        const detail = detailResponse.json().data
        const payload = detail.payload
        const questionOrder = Array.isArray(payload?.questionOrder) ? payload.questionOrder : []
        const answerKey = payload?.answerKey && typeof payload.answerKey === 'object' ? payload.answerKey : {}
        const interactionModel = payload?.interactionModel && typeof payload.interactionModel === 'object'
            ? payload.interactionModel
            : {}

        if (payload.questionCount !== questionOrder.length) {
            failures.push({ assetId: asset.id, issue: 'question_count_mismatch', questionCount: payload.questionCount, orderLength: questionOrder.length })
        }

        questionOrder.forEach((questionId) => {
            if (!Object.prototype.hasOwnProperty.call(answerKey, questionId)) {
                failures.push({ assetId: asset.id, questionId, issue: 'missing_answer_key' })
            }
            const interaction = interactionModel[questionId]
            if (!interaction) {
                failures.push({ assetId: asset.id, questionId, issue: 'missing_interaction' })
                return
            }
            if (!allowedControls.has(interaction.control)) {
                failures.push({ assetId: asset.id, questionId, issue: 'invalid_control', control: interaction.control })
                return
            }
            controlCounts.set(interaction.control, (controlCounts.get(interaction.control) || 0) + 1)
        })
    }

    await app.close()

    assert.strictEqual(failures.length, 0, `reading interaction coverage failures: ${JSON.stringify(failures.slice(0, 20))}`)
    ;['radio', 'checkbox', 'text', 'dragdrop'].forEach((control) => {
        assert.ok((controlCounts.get(control) || 0) > 0, `expected generated reading assets to include ${control} controls`)
    })
}

async function testPracticeMigrationStatusFacade() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'GET',
        url: '/api/practice/migration-status'
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const status = response.json().data
    assert.strictEqual(status.defaultRenderer, 'vue')
    assert.strictEqual(status.legacyFallbackEnabled, true)
    assert.strictEqual(status.legacyDeletionAllowed, false)
    assert.strictEqual(status.legacyProductEntrypointVisible, false)
    assert.strictEqual(status.legacyReadingFallbackEnabled, false)
    assert.strictEqual(status.normalVueReadingUsesLegacy, false)
    assert.deepStrictEqual(status.electronEntrypoints, {
        primary: 'dist/writing/index.html',
        fallback: null,
        fallbackIpc: null,
        bootRecovery: 'index.html',
        diagnosticFallbackIpc: null,
        practiceRouteIpc: 'navigate-to-practice-route'
    })
    const capabilities = new Map(status.capabilities.map((item) => [item.id, item]))
    assert.strictEqual(capabilities.get('single-reading-practice').renderer, 'vue')
    assert.strictEqual(capabilities.get('single-reading-practice').support, 'primary')
    assert.ok(capabilities.get('single-reading-practice').routePattern.includes('/reading/:assetId'))
    assert.ok(!capabilities.get('single-reading-practice').routePattern.includes('legacy fallback start'))
    assert.ok(capabilities.get('single-reading-practice').apiSurface.includes('server/src/lib/practice/reading/ReadingAssetProvider.ts reading library provider contract'))
    assert.ok(capabilities.get('single-reading-practice').apiSurface.includes('server/src/lib/practice/reading/BuiltinReadingAssetProvider.ts builtin provider'))
    assert.ok(capabilities.get('single-reading-practice').apiSurface.includes('server/src/lib/practice/reading/reading-generated-loader.ts VM-free JSON parser'))
    assert.ok(capabilities.get('single-reading-practice').apiSurface.includes('server/src/lib/practice/reading/reading-generated-loader.ts bounded payload cache'))
    assert.ok(capabilities.get('single-reading-practice').apiSurface.includes('PracticeHistorySummary list without submission_json parsing'))
    assert.ok(capabilities.get('single-reading-practice').apiSurface.includes('practice_history_records submission_json-only session replay'))
    assert.ok(capabilities.get('single-reading-practice').apiSurface.includes('server/src/lib/reading/coach-service.ts bounded coach caches'))
    assert.ok(capabilities.get('single-reading-practice').verifiedBy.includes('developer/tests/e2e/practice_reading_vue_flow.py'))
    assert.strictEqual(capabilities.get('writing-practice').renderer, 'vue')
    assert.strictEqual(capabilities.get('writing-practice').support, 'primary')
    assert.ok(capabilities.get('writing-practice').apiSurface.includes("electronAPI.openPracticeRoute('/writing')"))
    assert.ok(capabilities.get('writing-practice').apiSurface.includes('server/src/lib/writing/evaluate-service.ts bounded SSE replay cache'))
    assert.ok(capabilities.get('writing-practice').apiSurface.includes('Essay history summary list without content/evaluation_json parsing'))
    assert.strictEqual(capabilities.get('suite-reading-practice').renderer, 'vue')
    assert.strictEqual(capabilities.get('suite-reading-practice').support, 'primary')
    assert.ok(capabilities.get('suite-reading-practice').routePattern.includes('/reading-suite/:sessionId'))
    assert.ok(capabilities.get('suite-reading-practice').apiSurface.includes('/api/practice/reading-suite'))
    assert.ok(capabilities.get('suite-reading-practice').apiSurface.includes('practice_reading_suite_sessions SQLite table'))
    assert.ok(capabilities.get('suite-reading-practice').apiSurface.includes('server/src/lib/practice/reading-suite-store.ts'))
    assert.ok(capabilities.get('suite-reading-practice').apiSurface.includes('js/presentation/app-actions.js -> /reading-suite/:sessionId'))
    assert.ok(capabilities.get('suite-reading-practice').legacyFallbackSurface.includes('js/app/suitePracticeMixin.js'))
    assert.ok(capabilities.get('suite-reading-practice').legacyFallbackSurface.includes('js/runtime/unifiedReadingPage.js'))
    assert.ok(capabilities.get('suite-reading-practice').legacyFallbackSurface.includes('explicit test_env/suite_test/ci legacy suite regression only'))
    assert.ok(capabilities.get('suite-reading-practice').verifiedBy.includes('developer/tests/e2e/practice_reading_suite_vue_flow.py'))
    assert.ok(capabilities.get('suite-reading-practice').verifiedBy.includes('developer/tests/js/legacySuiteVueRoute.test.js'))
    assert.strictEqual(capabilities.get('listening-practice').renderer, 'legacy')
    assert.strictEqual(capabilities.get('listening-practice').support, 'fallback')
    assert.ok(status.deletionCriteria.some((item) => item.includes('Vue product navigation exposes no legacy standby button')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('no standalone writing navigation IPC')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('Normal reading and suite product paths do not fall back')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('openPracticeRoute()')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('Legacy homepage suite launch uses /api/practice/reading-suite')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('only explicit test_env/suite_test/ci regression mode may call suitePracticeMixin')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('Runtime assets/scripts contains only exam index JS data')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('Electron debug test runners have been deleted')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('Practice shared/data layer owns HTTP errors')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('canonical submission_json only')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('PracticeHistorySummary rows')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('bounded loader cache')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('ReadingCoach generated exam bundles and query responses are bounded LRU caches')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('Writing evaluation SSE replay events are bounded by event count and session count')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('Writing essay history list returns summary rows with topic_text snapshots')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('PracticeService does not own a reading-session Map')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('practice_reading_suite_sessions')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('PracticeService does not own a suite-session Map')))
    assert.ok(status.deletionCriteria.some((item) => item.includes('without node:vm or runInNewContext')))
}

async function testWritingAssetFacade() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'GET',
        url: '/api/practice/assets?activity=writing&page=1&limit=20'
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const payload = response.json()
    assert.strictEqual(payload.success, true)
    assert.strictEqual(payload.data.total, 1)
    assert.deepStrictEqual(payload.data.data[0], {
        id: '7',
        activity: 'writing',
        title: 'Some people think homework should be optional.',
        source: 'writing_topic',
        category: 'education',
        difficulty: 3,
        payloadRef: '7',
        metadata: {
            taskType: 'task2',
            imagePath: null,
            isOfficial: true
        }
    })
}

async function testWritingSessionFacade() {
    const { app, calls } = await createApp()
    const response = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'writing',
            assetId: 7,
            attempt: {
                taskType: 'task2',
                topicText: 'Discuss both views and give your opinion.',
                content: 'This essay has enough text to start a mocked evaluation.',
                wordCount: 12
            },
            settings: {
                apiConfigId: 3,
                promptVersion: 'v-test'
            }
        }
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    assert.deepStrictEqual(response.json().data, {
        sessionId: 'writing-session-1',
        activity: 'writing',
        status: 'active',
        legacy: {
            provider: 'writing_evaluation',
            sessionId: 'writing-session-1'
        }
    })
    assert.deepStrictEqual(calls.writingStarts[0], {
        task_type: 'task2',
        topic_id: 7,
        topic_text: 'Discuss both views and give your opinion.',
        content: 'This essay has enough text to start a mocked evaluation.',
        word_count: 12,
        config_id: 3,
        api_config_id: 3,
        prompt_version: 'v-test'
    })
}

async function testReadingSessionSubmitScoreAndReview() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'b',
                    q2: 'G',
                    q3: 'C',
                    q4: 'D',
                    q5: 'E',
                    q6: 'dancing.',
                    q7: 'advertising',
                    q8: 'play',
                    q9: 'beauty',
                    q10: 'B',
                    q11: 'D',
                    q12: 'A',
                    q13: 'C'
                },
                markedQuestions: ['q1', '2'],
                highlights: [
                    {
                        scope: 'passage',
                        text: 'Art changes how people see everyday experience.',
                        kind: 'note',
                        start: 12,
                        end: 61,
                        before: 'Paragraph A ',
                        after: ' It then',
                        occurrence: 2
                    }
                ],
                questionTimelineLite: [
                    {
                        questionId: 'q1',
                        firstAnsweredAt: '2026-05-21T00:00:10.000Z',
                        lastAnsweredAt: '2026-05-21T00:00:30.000Z',
                        changeCount: 1,
                        visitCount: 3,
                        elapsedMs: 12000
                    }
                ],
                interactionCount: 18,
                startTime: '2026-05-21T00:00:00.000Z',
                endTime: '2026-05-21T00:01:40.000Z',
                durationSec: 100,
                effectiveEndTime: '2026-05-21T00:01:40.000Z',
                effectiveEndTimeMs: 1779321700000,
                scrollY: 240,
                timerSnapshot: {
                    running: false,
                    elapsedSeconds: 100,
                    durationSeconds: 100,
                    displaySeconds: 100,
                    effectiveStartTimeMs: 1779321600000,
                    effectiveEndTimeMs: 1779321700000,
                    anchorMs: 1779321600000,
                    mode: 'elapsed',
                    limitSeconds: null,
                    source: 'local',
                    actualEndTimeMs: 1779321700000,
                    pausedAtMs: 1779321700000,
                    pausedOffsetMs: 0
                }
            }
        }
    })

    assert.strictEqual(response.statusCode, 200)
    const data = response.json().data
    assert.strictEqual(data.activity, 'reading')
    assert.strictEqual(data.status, 'submitted')
    assert.strictEqual(data.legacy.provider, 'practice_reading')
    assert.ok(data.sessionId.startsWith('reading-'))
    assert.strictEqual(data.submission.sessionId, data.sessionId)
    assert.strictEqual(data.submission.readOnly, true)
    assert.strictEqual(data.submission.scoreInfo.correct, 13)
    assert.strictEqual(data.submission.scoreInfo.totalQuestions, 13)
    assert.strictEqual(data.submission.scoreInfo.percentage, 100)
    assert.strictEqual(data.submission.answerComparison.q1.isCorrect, true)
    assert.deepStrictEqual(data.submission.answerComparison.q1.normalizedUserAnswer, ['B'])
    assert.deepStrictEqual(data.submission.answerComparison.q6.normalizedUserAnswer, ['dancing'])
    assert.strictEqual(data.submission.coachContext.submitted, true)
    assert.deepStrictEqual(data.submission.coachContext.wrongQuestions, [])
    assert.strictEqual(data.submission.analysisSignals.questionCount, 13)
    assert.strictEqual(data.submission.analysisSignals.unansweredCount, 0)
    assert.strictEqual(data.submission.analysisSignals.changedAnswerCount, 1)
    assert.strictEqual(data.submission.analysisSignals.markedQuestionCount, 2)
    assert.strictEqual(data.submission.analysisSignals.highlightCount, 1)
    assert.strictEqual(data.submission.questionTimelineLite.find((item) => item.questionId === 'q1').changeCount, 1)
    assert.strictEqual(data.submission.questionTimelineLite.find((item) => item.questionId === 'q1').visitCount, 3)
    assert.strictEqual(data.submission.questionTimelineLite.find((item) => item.questionId === 'q1').elapsedMs, 12000)
    assert.strictEqual(data.submission.questionTimelineLite.find((item) => item.questionId === 'q1').durationMs, 12000)
    assert.deepStrictEqual(data.submission.markedQuestions, ['q1', 'q2'])
    assert.strictEqual(data.submission.highlights[0].scope, 'passage')
    assert.strictEqual(data.submission.highlights[0].kind, 'note')
    assert.strictEqual(data.submission.highlights[0].startOffset, 12)
    assert.strictEqual(data.submission.highlights[0].endOffset, 61)
    assert.strictEqual(data.submission.highlights[0].before, 'Paragraph A')
    assert.strictEqual(data.submission.highlights[0].after, 'It then')
    assert.strictEqual(data.submission.highlights[0].occurrence, 2)
    assert.strictEqual(data.submission.metadata.effectiveEndTime, '2026-05-21T00:01:40.000Z')
    assert.strictEqual(data.submission.metadata.effectiveEndTimeMs, 1779321700000)
    assert.strictEqual(data.submission.metadata.scrollY, 240)
    assert.strictEqual(data.submission.metadata.timerSnapshot.durationSeconds, 100)
    assert.strictEqual(data.submission.metadata.timerSnapshot.source, 'local')
    assert.strictEqual(data.submission.singleAttemptAnalysis.summary.accuracy, 1)
    assert.ok(Array.isArray(data.submission.singleAttemptAnalysis.radar.byQuestionKind))
    assert.ok(Array.isArray(data.submission.singleAttemptAnalysis.nextActions))
    assert.strictEqual(data.submission.singleAttemptAnalysisInput.analysisSignals.changedAnswerCount, 1)
    assert.strictEqual(data.submission.analysisArtifacts.analysisSignals.changedAnswerCount, 1)
    assert.strictEqual(data.submission.analysisArtifacts.highlights[0].text, data.submission.highlights[0].text)
    assert.strictEqual(data.submission.analysisArtifacts.questionTimelineLite.find((item) => item.questionId === 'q1').durationMs, 12000)
    assert.strictEqual(data.submission.analysisArtifacts.singleAttemptAnalysis.summary.accuracy, 1)
    assert.strictEqual(data.historyRecord.activity, 'reading')
    assert.strictEqual(data.historyRecord.sessionId, data.sessionId)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(data.historyRecord, 'legacyRecord'), false)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(data.historyRecord, 'submission'), false)
    assert.strictEqual(data.historyRecord.score, 13)
    assert.strictEqual(data.historyRecord.totalQuestions, 13)
    assert.strictEqual(data.historyRecord.correctAnswers, 13)
    assert.deepStrictEqual(
        data.historyRecord.metadata.questionTypePerformance,
        data.submission.questionTypePerformance,
        'history summary metadata must expose reading question type performance without embedding submission'
    )

    const stateResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/sessions/reading/${encodeURIComponent(data.sessionId)}`
    })

    assert.strictEqual(stateResponse.statusCode, 200)
    const state = stateResponse.json().data
    assert.strictEqual(state.sessionId, data.sessionId)
    assert.strictEqual(state.activity, 'reading')
    assert.strictEqual(state.status, 'submitted')
    assert.strictEqual(state.active, false)
    assert.strictEqual(state.submission.scoreInfo.percentage, 100)
    assert.strictEqual(state.submission.analysisSignals.markedQuestionCount, 2)

    const cancelResponse = await app.inject({
        method: 'DELETE',
        url: `/api/practice/sessions/reading/${encodeURIComponent(data.sessionId)}`
    })
    assert.strictEqual(cancelResponse.statusCode, 409)
    assert.strictEqual(cancelResponse.json().error, 'practice_session_not_cancellable')

    const replayAfterCancelResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/sessions/reading/${encodeURIComponent(data.sessionId)}`
    })
    await app.close()

    assert.strictEqual(replayAfterCancelResponse.statusCode, 200)
    assert.strictEqual(replayAfterCancelResponse.json().data.submission.sessionId, data.sessionId)
}

async function testReadingSuiteSessionLifecycle() {
    const { app } = await createApp()
    const createResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/reading-suite',
        payload: {
            flowMode: 'simulation',
            frequencyScope: 'all',
            seed: 'api-suite-seed'
        }
    })

    assert.strictEqual(createResponse.statusCode, 200)
    const created = createResponse.json().data
    assert.ok(created.sessionId.startsWith('suite-'))
    assert.strictEqual(created.activity, 'reading')
    assert.strictEqual(created.practiceMode, 'suite')
    assert.strictEqual(created.status, 'active')
    assert.strictEqual(created.flowMode, 'simulation')
    assert.strictEqual(created.frequencyScope, 'all')
    assert.strictEqual(created.timer.source, 'suite')
    assert.strictEqual(created.timer.mode, 'elapsed')
    assert.strictEqual(created.timer.limitSeconds, null)
    assert.strictEqual(created.timer.effectiveStartTimeMs, created.timer.anchorMs)
    assert.ok(Number.isInteger(created.timer.anchorMs))
    assert.strictEqual(Object.prototype.hasOwnProperty.call(created, 'globalTimerAnchorMs'), false)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(created, 'suiteTimerAnchorMs'), false)
    assert.strictEqual(created.sequence.length, 3)
    assert.deepStrictEqual(created.sequence.map((entry) => entry.category), ['P1', 'P2', 'P3'])
    assert.deepStrictEqual(created.sequence.map((entry) => entry.status), ['active', 'pending', 'pending'])
    assert.strictEqual(created.aggregate.submittedPassages, 0)
    assert.strictEqual(created.aggregate.totalPassages, 3)

    const stateResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/reading-suite/${encodeURIComponent(created.sessionId)}`
    })
    assert.strictEqual(stateResponse.statusCode, 200)
    assert.strictEqual(stateResponse.json().data.sessionId, created.sessionId)

    const outOfOrderResponse = await app.inject({
        method: 'POST',
        url: `/api/practice/reading-suite/${encodeURIComponent(created.sessionId)}/passages/${encodeURIComponent(created.sequence[1].assetId)}`,
        payload: {
            attempt: {
                answers: {},
                durationSec: 10
            }
        }
    })
    assert.strictEqual(outOfOrderResponse.statusCode, 409)
    assert.strictEqual(outOfOrderResponse.json().error, 'reading_suite_passage_out_of_order')

    let suite = created
    const suiteTimerAnchorMs = created.timer.anchorMs
    const submittedSessionIds = []
    for (let index = 0; index < 3; index += 1) {
        const activeEntry = suite.sequence.find((entry) => entry.status === 'active')
        assert.ok(activeEntry, `missing active suite passage at index ${index}`)
        const response = await app.inject({
            method: 'POST',
            url: `/api/practice/reading-suite/${encodeURIComponent(suite.sessionId)}/passages/${encodeURIComponent(activeEntry.assetId)}`,
            payload: {
                attempt: {
                    answers: {},
                    markedQuestions: [`q${index + 1}`],
                    durationSec: 30 + index,
                    timerSnapshot: {
                        running: false,
                        elapsedSeconds: 30 + index,
                        durationSeconds: 30 + index,
                        displaySeconds: 30 + index,
                        effectiveStartTimeMs: suiteTimerAnchorMs,
                        effectiveEndTimeMs: suiteTimerAnchorMs + (30 + index) * 1000,
                        anchorMs: suiteTimerAnchorMs,
                        mode: 'elapsed',
                        limitSeconds: null,
                        source: 'suite',
                        actualEndTimeMs: suiteTimerAnchorMs + (30 + index) * 1000,
                        pausedAtMs: suiteTimerAnchorMs + (30 + index) * 1000,
                        pausedOffsetMs: index * 1000
                    }
                }
            }
        })
        assert.strictEqual(response.statusCode, 200)
        const payload = response.json().data
        suite = payload.suiteSession
        submittedSessionIds.push(payload.submission.sessionId)
        assert.strictEqual(payload.sessionId, created.sessionId)
        assert.strictEqual(payload.activity, 'reading')
        assert.strictEqual(payload.submission.metadata.practiceMode, 'suite')
        assert.strictEqual(payload.submission.metadata.suiteSessionId, created.sessionId)
        assert.strictEqual(payload.submission.metadata.suitePassageIndex, index)
        assert.strictEqual(payload.submission.metadata.timerSnapshot.source, 'suite')
        assert.strictEqual(payload.submission.metadata.timerSnapshot.anchorMs, suiteTimerAnchorMs)
        assert.strictEqual(payload.submission.metadata.timerSnapshot.effectiveStartTimeMs, suiteTimerAnchorMs)
        assert.strictEqual(payload.submission.metadata.timerSnapshot.mode, 'elapsed')
        assert.strictEqual(payload.suiteSession.timer.anchorMs, suiteTimerAnchorMs)
        assert.strictEqual(payload.suiteSession.timer.source, 'suite')
        assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.suiteSession, 'globalTimerAnchorMs'), false)
        assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.suiteSession, 'suiteTimerAnchorMs'), false)
        assert.strictEqual(payload.submission.legacy.practiceMode, 'suite')
        assert.strictEqual(suite.sequence[index].status, 'submitted')
        assert.strictEqual(suite.sequence[index].sessionId, payload.submission.sessionId)
        assert.strictEqual(suite.aggregate.submittedPassages, index + 1)
        assert.ok(suite.aggregate.totalQuestions >= suite.aggregate.submittedPassages)

        const replayResponse = await app.inject({
            method: 'GET',
            url: `/api/practice/sessions/reading/${encodeURIComponent(payload.submission.sessionId)}`
        })
        assert.strictEqual(replayResponse.statusCode, 200)
        assert.strictEqual(replayResponse.json().data.submission.metadata.suiteSessionId, created.sessionId)
    }

    assert.strictEqual(suite.status, 'completed')
    assert.strictEqual(suite.aggregate.submittedPassages, 3)
    assert.strictEqual(suite.aggregate.totalPassages, 3)
    assert.ok(suite.completedAt)
    assert.strictEqual(submittedSessionIds.length, 3)

    const completedStateResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/reading-suite/${encodeURIComponent(created.sessionId)}`
    })
    await app.close()

    assert.strictEqual(completedStateResponse.statusCode, 200)
    const completedState = completedStateResponse.json().data
    assert.strictEqual(completedState.status, 'completed')
    assert.strictEqual(completedState.timer.anchorMs, suiteTimerAnchorMs)
    assert.deepStrictEqual(completedState.sequence.map((entry) => entry.status), ['submitted', 'submitted', 'submitted'])
    assert.strictEqual(completedState.aggregate.submittedPassages, 3)
}

async function testReadingSuiteTimerCreateContract() {
    const { app } = await createApp()
    const createResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/reading-suite',
        payload: {
            flowMode: 'stationary',
            frequencyScope: 'high_medium',
            seed: 'api-suite-timer-seed',
            timer: {
                anchorMs: 1779321600000,
                mode: 'countdown',
                limitSeconds: 3600,
                pausedOffsetMs: 12000,
                running: true
            }
        }
    })
    await app.close()

    assert.strictEqual(createResponse.statusCode, 200)
    const created = createResponse.json().data
    assert.strictEqual(created.flowMode, 'stationary')
    assert.strictEqual(created.frequencyScope, 'high_medium')
    assert.deepStrictEqual(created.timer, {
        source: 'suite',
        anchorMs: 1779321600000,
        effectiveStartTimeMs: 1779321600000,
        mode: 'countdown',
        limitSeconds: 3600,
        pausedOffsetMs: 12000,
        pausedAtMs: null,
        running: true
    })
    assert.strictEqual(Object.prototype.hasOwnProperty.call(created, 'timerAnchorMs'), false)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(created, 'globalTimerAnchorMs'), false)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(created, 'suiteTimerAnchorMs'), false)
}

async function testReadingSuiteCustomSequenceContract() {
    const { app } = await createApp()
    const createResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/reading-suite',
        payload: {
            flowMode: 'classic',
            frequencyScope: 'custom',
            sequence: ['p1-high-01', 'p2-low-148', 'p3-low-151']
        }
    })

    assert.strictEqual(createResponse.statusCode, 200)
    const created = createResponse.json().data
    assert.strictEqual(created.frequencyScope, 'custom')
    assert.strictEqual(created.flowMode, 'classic')
    assert.deepStrictEqual(created.sequence.map((entry) => entry.assetId), ['p1-high-01', 'p2-low-148', 'p3-low-151'])
    assert.deepStrictEqual(created.sequence.map((entry) => entry.category), ['P1', 'P2', 'P3'])
    assert.deepStrictEqual(created.sequence.map((entry) => entry.status), ['active', 'pending', 'pending'])
    assert.strictEqual(Object.prototype.hasOwnProperty.call(created, 'customSequence'), false)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(created, 'selectedAssets'), false)

    const invalidOrderResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/reading-suite',
        payload: {
            flowMode: 'classic',
            frequencyScope: 'custom',
            sequence: ['p2-low-148', 'p1-high-01', 'p3-low-151']
        }
    })
    await app.close()

    assert.strictEqual(invalidOrderResponse.statusCode, 409)
    assert.strictEqual(invalidOrderResponse.json().error, 'reading_suite_custom_sequence_invalid')
}

async function testReadingSuitePersistsAcrossPracticeServiceInstances() {
    const db = createFakePracticeHistoryDb()
    try {
        const first = await createApp({ db })
        const createResponse = await first.app.inject({
            method: 'POST',
            url: '/api/practice/reading-suite',
            payload: {
                flowMode: 'simulation',
                frequencyScope: 'all',
                seed: 'api-suite-persistence-seed'
            }
        })
        assert.strictEqual(createResponse.statusCode, 200)
        const created = createResponse.json().data
        const firstPassage = created.sequence[0]

        const submitResponse = await first.app.inject({
            method: 'POST',
            url: `/api/practice/reading-suite/${encodeURIComponent(created.sessionId)}/passages/${encodeURIComponent(firstPassage.assetId)}`,
            payload: {
                attempt: {
                    answers: {},
                    markedQuestions: ['q1'],
                    durationSec: 42
                }
            }
        })
        assert.strictEqual(submitResponse.statusCode, 200)
        assert.strictEqual(submitResponse.json().data.suiteSession.currentIndex, 1)
        await first.app.close()

        const second = await createApp({ db })
        const stateResponse = await second.app.inject({
            method: 'GET',
            url: `/api/practice/reading-suite/${encodeURIComponent(created.sessionId)}`
        })
        assert.strictEqual(stateResponse.statusCode, 200)
        const restored = stateResponse.json().data
        assert.strictEqual(restored.sessionId, created.sessionId)
        assert.strictEqual(restored.status, 'active')
        assert.strictEqual(restored.currentIndex, 1)
        assert.deepStrictEqual(restored.sequence.map((entry) => entry.status), ['submitted', 'active', 'pending'])
        assert.strictEqual(restored.sequence[0].sessionId, submitResponse.json().data.submission.sessionId)
        assert.strictEqual(restored.aggregate.submittedPassages, 1)
        assert.strictEqual(restored.aggregate.totalPassages, 3)

        const secondPassage = restored.sequence[1]
        const secondSubmitResponse = await second.app.inject({
            method: 'POST',
            url: `/api/practice/reading-suite/${encodeURIComponent(restored.sessionId)}/passages/${encodeURIComponent(secondPassage.assetId)}`,
            payload: {
                attempt: {
                    answers: {},
                    markedQuestions: ['q2'],
                    durationSec: 43
                }
            }
        })
        assert.strictEqual(secondSubmitResponse.statusCode, 200)
        assert.strictEqual(secondSubmitResponse.json().data.suiteSession.currentIndex, 2)
        await second.app.close()

        const third = await createApp({ db })
        const progressedResponse = await third.app.inject({
            method: 'GET',
            url: `/api/practice/reading-suite/${encodeURIComponent(created.sessionId)}`
        })
        assert.strictEqual(progressedResponse.statusCode, 200)
        const progressed = progressedResponse.json().data
        assert.strictEqual(progressed.currentIndex, 2)
        assert.deepStrictEqual(progressed.sequence.map((entry) => entry.status), ['submitted', 'submitted', 'active'])
        assert.strictEqual(progressed.aggregate.submittedPassages, 2)
        await third.app.close()
    } finally {
        db.close()
    }
}

async function testReadingHistoryPersistsAcrossPracticeServiceInstances() {
    const db = createFakePracticeHistoryDb()
    const sessionId = 'reading-history-test-1'
    try {
        const first = await createApp({ db })
        const createResponse = await first.app.inject({
            method: 'POST',
            url: '/api/practice/sessions',
            payload: {
                activity: 'reading',
                assetId: 'p2-low-148',
                attempt: {
                    answers: {
                        q1: 'B',
                        q6: 'dancing'
                    },
                    markedQuestions: ['q6'],
                    questionTimelineLite: [
                        {
                            questionId: 'q6',
                            firstAnsweredAt: '2026-05-21T01:00:20.000Z',
                            lastAnsweredAt: '2026-05-21T01:01:00.000Z',
                            changeCount: 2
                        }
                    ],
                    interactionCount: 4,
                    startTime: '2026-05-21T01:00:00.000Z',
                    endTime: '2026-05-21T01:02:00.000Z',
                    durationSec: 120
                },
                settings: {
                    sessionId
                }
            }
        })
        assert.strictEqual(createResponse.statusCode, 200)
        const created = createResponse.json().data
        assert.strictEqual(created.sessionId, sessionId)
        assert.strictEqual(created.historyRecord.id, `reading-${sessionId}`)
        assert.strictEqual(Object.prototype.hasOwnProperty.call(created.historyRecord, 'legacyRecord'), false)
        assert.strictEqual(Object.prototype.hasOwnProperty.call(created.historyRecord, 'submission'), false)
        assert.strictEqual(created.historyRecord.sessionId, sessionId)
        assert.strictEqual(created.historyRecord.score, created.submission.scoreInfo.correct)
        assert.strictEqual(created.historyRecord.totalQuestions, 13)

        const listResponse = await first.app.inject({
            method: 'GET',
            url: '/api/practice/history?activity=reading&page=1&limit=999'
        })
        assert.strictEqual(listResponse.statusCode, 200)
        const list = listResponse.json().data
        assert.strictEqual(list.total, 1)
        assert.strictEqual(list.limit, 200)
        assert.strictEqual(list.data[0].sessionId, sessionId)
        assert.strictEqual(Object.prototype.hasOwnProperty.call(list.data[0], 'submission'), false)
        assert.strictEqual(list.data[0].score, created.submission.scoreInfo.correct)
        assert.strictEqual(list.data[0].totalQuestions, 13)
        assert.deepStrictEqual(
            list.data[0].metadata.questionTypePerformance,
            created.submission.questionTypePerformance,
            'history list summary must expose questionTypePerformance for Vue records radar'
        )
        await first.app.close()

        const second = await createApp({ db })
        const replayResponse = await second.app.inject({
            method: 'GET',
            url: `/api/practice/sessions/reading/${encodeURIComponent(sessionId)}`
        })
        assert.strictEqual(replayResponse.statusCode, 200)
        const replay = replayResponse.json().data
        assert.strictEqual(replay.sessionId, sessionId)
        assert.strictEqual(replay.submission.sessionId, sessionId)
        assert.strictEqual(replay.submission.answers.q1, 'B')
        assert.strictEqual(replay.submission.analysisSignals.changedAnswerCount, 1)
        assert.deepStrictEqual(replay.submission.markedQuestions, ['q6'])
        assert.strictEqual(replay.legacy.practiceMode, 'single')
        assert.strictEqual(replay.legacy.renderMode, 'vue-reading')
        assert.strictEqual(replay.submission.singleAttemptAnalysisInput.analysisSignals.changedAnswerCount, 1)

        const coachResponse = await second.app.inject({
            method: 'POST',
            url: '/api/practice/coach',
            payload: {
                activity: 'reading',
                sessionId,
                payload: {
                    query: 'Persist this coach answer',
                    attemptContext: { submitted: false }
                }
            }
        })
        assert.strictEqual(coachResponse.statusCode, 200)
        const coachData = coachResponse.json().data
        assert.strictEqual(coachData.singleAttemptAnalysisLlm.diagnosis[0].reason, '定位后没有复核限定词。')
        assert.strictEqual(coachData.singleAttemptAnalysisLlm.nextActions[0].instruction, '先定位，再核对限定词，最后排除局部真实但不答题的选项。')

        const detailResponse = await second.app.inject({
            method: 'GET',
            url: `/api/practice/history/reading/${encodeURIComponent(`reading-${sessionId}`)}`
        })
        assert.strictEqual(detailResponse.statusCode, 200)
        const detail = detailResponse.json().data
        assert.strictEqual(detail.sessionId, sessionId)
        assert.strictEqual(Object.prototype.hasOwnProperty.call(detail, 'legacyRecord'), false)
        assert.strictEqual(detail.submission.readingCoachSnapshot.answer, 'Use paragraph evidence first.')
        assert.ok(detail.submission.readingCoachTranscript.length >= 2)
        assert.strictEqual(detail.submission.singleAttemptAnalysisLlm.diagnosis[0].reason, '定位后没有复核限定词。')
        assert.strictEqual(detail.submission.singleAttemptAnalysisLlm.nextActions[0].instruction, '先定位，再核对限定词，最后排除局部真实但不答题的选项。')
        assert.strictEqual(detail.submission.analysisArtifacts.singleAttemptAnalysisLlm.nextActions[0].instruction, '先定位，再核对限定词，最后排除局部真实但不答题的选项。')
        await second.app.close()
    } finally {
        db.close()
    }
}

async function testReadingHistoryDeleteAndClear() {
    const db = createFakePracticeHistoryDb()
    try {
        const first = await createApp({ db })
        const firstCreate = await first.app.inject({
            method: 'POST',
            url: '/api/practice/sessions',
            payload: {
                activity: 'reading',
                assetId: 'p2-low-148',
                attempt: {
                    answers: { q1: 'B' },
                    durationSec: 60
                },
                settings: {
                    sessionId: 'reading-delete-1'
                }
            }
        })
        assert.strictEqual(firstCreate.statusCode, 200)
        const secondCreate = await first.app.inject({
            method: 'POST',
            url: '/api/practice/sessions',
            payload: {
                activity: 'reading',
                assetId: 'p1-high-01',
                attempt: {
                    answers: { q1: 'viii' },
                    durationSec: 75
                },
                settings: {
                    sessionId: 'reading-delete-2'
                }
            }
        })
        assert.strictEqual(secondCreate.statusCode, 200)

        const deleteBySession = await first.app.inject({
            method: 'DELETE',
            url: '/api/practice/history/reading/reading-delete-1'
        })
        assert.strictEqual(deleteBySession.statusCode, 200)
        assert.deepStrictEqual(deleteBySession.json().data, {
            deleted: true,
            id: 'reading-reading-delete-1'
        })

        const replayDeleted = await first.app.inject({
            method: 'GET',
            url: '/api/practice/sessions/reading/reading-delete-1'
        })
        assert.strictEqual(replayDeleted.statusCode, 404)
        assert.strictEqual(replayDeleted.json().error, 'practice_session_not_found')

        const listAfterSingleDelete = await first.app.inject({
            method: 'GET',
            url: '/api/practice/history?activity=reading&page=1&limit=20'
        })
        assert.strictEqual(listAfterSingleDelete.statusCode, 200)
        assert.strictEqual(listAfterSingleDelete.json().data.total, 1)
        assert.strictEqual(listAfterSingleDelete.json().data.data[0].sessionId, 'reading-delete-2')

        const missingDelete = await first.app.inject({
            method: 'DELETE',
            url: '/api/practice/history/reading/not-a-record'
        })
        assert.strictEqual(missingDelete.statusCode, 404)
        assert.strictEqual(missingDelete.json().error, 'practice_history_not_found')

        const clearResponse = await first.app.inject({
            method: 'DELETE',
            url: '/api/practice/history?activity=reading'
        })
        assert.strictEqual(clearResponse.statusCode, 200)
        assert.deepStrictEqual(clearResponse.json().data, {
            deletedCount: 1,
            activity: 'reading'
        })

        const listAfterClear = await first.app.inject({
            method: 'GET',
            url: '/api/practice/history?activity=reading&page=1&limit=20'
        })
        await first.app.close()
        assert.strictEqual(listAfterClear.statusCode, 200)
        assert.strictEqual(listAfterClear.json().data.total, 0)
    } finally {
        db.close()
    }
}

async function testLocalApiRejectsUntrustedWriteOrigin() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'DELETE',
        url: '/api/practice/history?activity=reading',
        headers: {
            origin: 'https://evil.example'
        }
    })
    const optionsResponse = await app.inject({
        method: 'OPTIONS',
        url: '/api/practice/history?activity=reading',
        headers: {
            origin: 'https://evil.example',
            'access-control-request-method': 'DELETE'
        }
    })
    const trustedResponse = await app.inject({
        method: 'OPTIONS',
        url: '/api/practice/history?activity=reading',
        headers: {
            origin: 'app://app',
            'access-control-request-method': 'DELETE'
        }
    })
    await app.close()

    assert.strictEqual(response.statusCode, 403)
    assert.strictEqual(response.json().error, 'local_api_forbidden_origin')
    assert.strictEqual(optionsResponse.statusCode, 403)
    assert.strictEqual(optionsResponse.json().error, 'local_api_forbidden_origin')
    assert.strictEqual(trustedResponse.statusCode, 204)
    assert.strictEqual(trustedResponse.headers['access-control-allow-origin'], 'app://app')
}

async function testReadingHistoryArchiveRoundTrip() {
    const sourceDb = createFakePracticeHistoryDb()
    const targetDb = createFakePracticeHistoryDb()
    const sessionId = 'reading-archive-1'
    try {
        const source = await createApp({ db: sourceDb })
        const createResponse = await source.app.inject({
            method: 'POST',
            url: '/api/practice/sessions',
            payload: {
                activity: 'reading',
                assetId: 'p2-low-148',
                attempt: {
                    answers: {
                        q1: 'B',
                        q6: 'dancing'
                    },
                    markedQuestions: ['q6'],
                    highlights: [
                        {
                            scope: 'passage',
                            text: 'archive canonical highlight',
                            kind: 'note',
                            startOffset: 4,
                            endOffset: 31,
                            before: 'Before',
                            after: 'After',
                            occurrence: 1
                        }
                    ],
                    questionTimelineLite: [
                        {
                            questionId: 'q6',
                            firstAnsweredAt: '2026-05-21T00:00:20.000Z',
                            lastAnsweredAt: '2026-05-21T00:01:20.000Z',
                            changeCount: 2,
                            visitCount: 5,
                            elapsedMs: 42000
                        }
                    ],
                    interactionCount: 6,
                    startTime: '2026-05-21T00:00:00.000Z',
                    endTime: '2026-05-21T00:01:36.000Z',
                    durationSec: 96,
                    timerSnapshot: {
                        running: false,
                        elapsedSeconds: 96,
                        durationSeconds: 96,
                        displaySeconds: 96,
                        effectiveStartTimeMs: 1779321600000,
                        effectiveEndTimeMs: 1779321696000,
                        anchorMs: 1779321600000,
                        mode: 'elapsed',
                        limitSeconds: null,
                        source: 'local',
                        actualEndTimeMs: 1779321696000,
                        pausedAtMs: 1779321696000,
                        pausedOffsetMs: 0
                    }
                },
                settings: {
                    sessionId
                }
            }
        })
        assert.strictEqual(createResponse.statusCode, 200)
        const created = createResponse.json().data

        const coachResponse = await source.app.inject({
            method: 'POST',
            url: '/api/practice/coach',
            payload: {
                activity: 'reading',
                sessionId,
                payload: {
                    query: 'Archive this automatic review.',
                    surface: 'review_workspace',
                    action: 'review_set',
                    promptKind: 'preset'
                }
            }
        })
        assert.strictEqual(coachResponse.statusCode, 200)

        const archiveResponse = await source.app.inject({
            method: 'GET',
            url: '/api/practice/history/archive?activity=reading'
        })
        assert.strictEqual(archiveResponse.statusCode, 200)
        const archive = archiveResponse.json().data
        assert.strictEqual(archive.schemaVersion, 'practice-history-archive.v1')
        assert.strictEqual(archive.activity, 'reading')
        assert.strictEqual(archive.count, 1)
        assert.strictEqual(archive.submissions.length, 1)
        assert.strictEqual(archive.submissions[0].sessionId, sessionId)
        assert.strictEqual(archive.submissions[0].answers.q1, 'B')
        assert.strictEqual(archive.submissions[0].answerComparison.q1.normalizedUserAnswer[0], 'B')
        assert.strictEqual(archive.submissions[0].scoreInfo.duration, 96)
        assert.strictEqual(archive.submissions[0].metadata.timerSnapshot.durationSeconds, 96)
        assert.strictEqual(archive.submissions[0].metadata.timerSnapshot.source, 'local')
        assert.strictEqual(archive.submissions[0].highlights[0].text, 'archive canonical highlight')
        assert.strictEqual(archive.submissions[0].highlights[0].kind, 'note')
        assert.strictEqual(archive.submissions[0].questionTimelineLite.find((item) => item.questionId === 'q6').visitCount, 5)
        assert.strictEqual(archive.submissions[0].questionTimelineLite.find((item) => item.questionId === 'q6').durationMs, 42000)
        assert.strictEqual(archive.submissions[0].analysisSignals.markedQuestionCount, 1)
        assert.strictEqual(archive.submissions[0].questionTimelineLite.find((item) => item.questionId === 'q6').changeCount, 2)
        assert.strictEqual(archive.submissions[0].readingCoachSnapshot.answer, 'Use paragraph evidence first.')
        assert.ok(
            archive.submissions[0].readingCoachTranscript.some((entry) => entry.role === 'user' && entry.content === 'Archive this automatic review.'),
            'archive export must keep review_set user turn in canonical transcript'
        )
        assert.ok(
            archive.submissions[0].readingCoachTranscript.some((entry) => entry.role === 'assistant' && entry.content === 'Use paragraph evidence first.'),
            'archive export must keep review_set assistant turn in canonical transcript'
        )
        assert.strictEqual(archive.submissions[0].singleAttemptAnalysisLlm.diagnosis[0].reason, '定位后没有复核限定词。')
        assert.strictEqual(archive.submissions[0].singleAttemptAnalysisLlm.nextActions[0].instruction, '先定位，再核对限定词，最后排除局部真实但不答题的选项。')
        assert.strictEqual(archive.submissions[0].analysisArtifacts.singleAttemptAnalysisLlm.nextActions[0].instruction, '先定位，再核对限定词，最后排除局部真实但不答题的选项。')
        assert.strictEqual(Object.prototype.hasOwnProperty.call(archive.submissions[0], 'legacyRecord'), false)
        await source.app.close()

        const target = await createApp({ db: targetDb })
        const importResponse = await target.app.inject({
            method: 'POST',
            url: '/api/practice/history/archive/reading',
            payload: archive
        })
        assert.strictEqual(importResponse.statusCode, 200)
        const imported = importResponse.json().data
        assert.strictEqual(imported.activity, 'reading')
        assert.strictEqual(imported.importedCount, 1)
        assert.strictEqual(imported.skippedCount, 0)
        assert.strictEqual(imported.records.length, 1)
        assert.strictEqual(imported.records[0].sessionId, sessionId)
        assert.strictEqual(Object.prototype.hasOwnProperty.call(imported.records[0], 'submission'), false)

        const replayResponse = await target.app.inject({
            method: 'GET',
            url: `/api/practice/sessions/reading/${encodeURIComponent(sessionId)}`
        })
        assert.strictEqual(replayResponse.statusCode, 200)
        const replay = replayResponse.json().data
        assert.strictEqual(replay.submission.sessionId, sessionId)
        assert.strictEqual(replay.submission.answers.q6, 'dancing')
        assert.strictEqual(replay.submission.scoreInfo.totalQuestions, created.submission.scoreInfo.totalQuestions)
        assert.strictEqual(replay.submission.scoreInfo.duration, 96)
        assert.strictEqual(replay.submission.answerComparison.q1.normalizedUserAnswer[0], 'B')
        assert.strictEqual(replay.submission.metadata.timerSnapshot.durationSeconds, 96)
        assert.deepStrictEqual(replay.submission.markedQuestions, ['q6'])
        assert.strictEqual(replay.submission.highlights[0].text, 'archive canonical highlight')
        assert.strictEqual(replay.submission.questionTimelineLite.find((item) => item.questionId === 'q6').visitCount, 5)
        assert.strictEqual(replay.submission.highlights[0].kind, 'note')
        assert.strictEqual(replay.submission.questionTimelineLite.find((item) => item.questionId === 'q6').durationMs, 42000)
        assert.strictEqual(replay.submission.readingCoachSnapshot.answer, 'Use paragraph evidence first.')
        assert.ok(
            replay.submission.readingCoachTranscript.some((entry) => entry.role === 'user' && entry.content === 'Archive this automatic review.'),
            'archive import/replay must keep review_set user turn in canonical transcript'
        )
        assert.strictEqual(replay.submission.singleAttemptAnalysisLlm.diagnosis[0].reason, '定位后没有复核限定词。')
        assert.strictEqual(replay.submission.singleAttemptAnalysisLlm.nextActions[0].instruction, '先定位，再核对限定词，最后排除局部真实但不答题的选项。')
        assert.strictEqual(replay.submission.analysisArtifacts.singleAttemptAnalysisLlm.nextActions[0].instruction, '先定位，再核对限定词，最后排除局部真实但不答题的选项。')

        const invalidImportResponse = await target.app.inject({
            method: 'POST',
            url: '/api/practice/history/archive/reading',
            payload: {
                submissions: [
                    { activity: 'reading', sessionId: '', status: 'submitted' },
                    archive.submissions[0]
                ]
            }
        })
        assert.strictEqual(invalidImportResponse.statusCode, 200)
        const invalidImport = invalidImportResponse.json().data
        assert.strictEqual(invalidImport.importedCount, 1)
        assert.strictEqual(invalidImport.skippedCount, 1)
        assert.strictEqual(invalidImport.errors[0].reason, 'invalid_reading_submission')

        const legacyImportResponse = await target.app.inject({
            method: 'POST',
            url: '/api/practice/history/archive/reading',
            payload: {
                practice_records: [
                    {
                        id: 'legacy-reading-record-1',
                        type: 'reading',
                        examId: 'p2-low-148',
                        title: 'Legacy reading record',
                        sessionId: 'legacy-session-1',
                        startTime: '2026-05-20T00:00:00.000Z',
                        endTime: '2026-05-20T00:02:00.000Z',
                        duration: 120,
                        answers: {
                            q1: 'B',
                            q6: 'dancing'
                        },
                        markedQuestions: ['q6'],
                        questionTimelineLite: [
                            {
                                questionId: 'q1',
                                changeCount: 1
                            }
                        ],
                        interactionCount: 3,
                        singleAttemptAnalysisLlm: {
                            diagnosis: [
                                {
                                    code: 'legacy_diag',
                                    reason: 'legacy review patch',
                                    evidence: []
                                }
                            ],
                            nextActions: [],
                            confidence: 0.8
                        },
                        readingCoachTranscript: [
                            {
                                role: 'assistant',
                                content: 'legacy coach'
                            }
                        ],
                        readingCoachSnapshot: {
                            answer: 'legacy snapshot'
                        }
                    }
                ]
            }
        })
        assert.strictEqual(legacyImportResponse.statusCode, 200)
        const legacyImport = legacyImportResponse.json().data
        assert.strictEqual(legacyImport.activity, 'reading')
        assert.strictEqual(legacyImport.importedCount, 1)
        assert.strictEqual(legacyImport.skippedCount, 0)
        assert.strictEqual(legacyImport.totalCount, 1)
        assert.strictEqual(legacyImport.records[0].sessionId, 'legacy-session-1')

        const legacyReplayResponse = await target.app.inject({
            method: 'GET',
            url: '/api/practice/sessions/reading/legacy-session-1'
        })
        assert.strictEqual(legacyReplayResponse.statusCode, 200)
        const legacySubmission = legacyReplayResponse.json().data.submission
        assert.strictEqual(legacySubmission.sessionId, 'legacy-session-1')
        assert.strictEqual(legacySubmission.answers.q1, 'B')
        assert.strictEqual(legacySubmission.answers.q6, 'dancing')
        assert.strictEqual(legacySubmission.analysisSignals.changedAnswerCount, 1)
        assert.strictEqual(legacySubmission.readingCoachTranscript[0].content, 'legacy coach')
        assert.strictEqual(legacySubmission.readingCoachSnapshot.answer, 'legacy snapshot')
        assert.strictEqual(legacySubmission.singleAttemptAnalysisLlm.diagnosis[0].reason, 'legacy review patch')
        assert.strictEqual(legacySubmission.analysisArtifacts.singleAttemptAnalysisLlm.diagnosis[0].reason, 'legacy review patch')
        assert.strictEqual(legacySubmission.metadata.importSource, 'legacy_practice_records')
        assert.strictEqual(legacySubmission.metadata.legacyPracticeRecordId, 'legacy-reading-record-1')
        assert.strictEqual(legacySubmission.metadata.renderMode, 'legacy-reading')
        assert.strictEqual(legacySubmission.legacy.renderMode, 'vue-reading')
        await target.app.close()
    } finally {
        sourceDb.close()
        targetDb.close()
    }
}

async function testReadingSessionAnswerNormalization() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p1-high-230',
            attempt: {
                answers: {
                    q7: 'yes',
                    q8: 'NG',
                    q9: 'No'
                }
            }
        }
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const submission = response.json().data.submission
    assert.strictEqual(submission.answerComparison.q7.isCorrect, true)
    assert.strictEqual(submission.answerComparison.q8.isCorrect, true)
    assert.strictEqual(submission.answerComparison.q9.isCorrect, true)
    assert.deepStrictEqual(submission.answerComparison.q7.normalizedUserAnswer, ['true'])
    assert.deepStrictEqual(submission.answerComparison.q8.normalizedUserAnswer, ['not given'])
    assert.deepStrictEqual(submission.answerComparison.q9.normalizedUserAnswer, ['false'])
    assert.strictEqual(submission.scoreInfo.correct, 3)
    assert.strictEqual(submission.scoreInfo.totalQuestions, 13)
}

async function testReadingSessionCheckboxSetScoring() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p1-medium-57',
            attempt: {
                answers: {
                    q11: ['C', 'E']
                }
            }
        }
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const submission = response.json().data.submission
    assert.strictEqual(submission.answerComparison.q11.matchMode, 'set')
    assert.strictEqual(submission.answerComparison.q11.weight, 3)
    assert.strictEqual(submission.answerComparison.q11.isCorrect, false)
    assert.deepStrictEqual(submission.answerComparison.q11.normalizedCorrectAnswer, ['C', 'E', 'G'])
    assert.strictEqual(submission.scoreInfo.totalQuestions, 13)
}

async function testPracticeCoachFacade() {
    const { app, calls } = await createApp()
    const response = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId: 'reading-session-1',
            payload: {
                examId: 'p1-high-01',
                query: 'How should I locate evidence?',
                attemptContext: { submitted: true }
            }
        }
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const data = response.json().data
    assert.strictEqual(data.coachVersion, 'test')
    assert.strictEqual(data.answer, 'Use paragraph evidence first.')
    assert.strictEqual(data.reviewOverall.primaryWeakness, '定位后没有复核限定词。')
    assert.strictEqual(data.reviewQuestionAnalyses[0].nextRule, '每题定位后先写一句题干真正问什么。')
    assert.deepStrictEqual(data.followUps, ['Show evidence'])
    assert.deepStrictEqual(calls.readingCoachQueries[0], {
        examId: 'p1-high-01',
        query: 'How should I locate evidence?',
        attemptContext: { submitted: true }
    })
}

async function testPracticeCoachUsesSubmittedReadingSession() {
    const { app, calls } = await createApp()
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A',
                    q6: 'dancing'
                },
                markedQuestions: ['q1'],
                questionTimelineLite: [
                    {
                        questionId: 'q1',
                        displayLabel: '14',
                        firstAnsweredAt: '2026-05-21T00:00:10.000Z',
                        lastAnsweredAt: '2026-05-21T00:00:40.000Z',
                        changeCount: 2,
                        visitCount: 4,
                        elapsedMs: 18000
                    }
                ],
                interactionCount: 9,
                durationSec: 120
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const coachResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                examId: 'p1-high-01',
                query: 'What should I review first?',
                attemptContext: {
                    submitted: false,
                    score: 0,
                    analysisSignals: { questionCount: 999 },
                    markedQuestions: ['q999'],
                    questionTimelineLite: [{ questionId: 'q999', changeCount: 99 }],
                    questionTypePerformance: { fake: { total: 99, correct: 0, accuracy: 0 } }
                }
            }
        }
    })
    const coachPayload = calls.readingCoachQueries.at(-1)
    const payloadOnlySessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            payload: {
                sessionId,
                examId: 'p1-high-01',
                query: 'Payload-only session should still hydrate context.',
                attemptContext: { submitted: false, score: 0 }
            }
        }
    })
    await app.close()

    assert.strictEqual(coachResponse.statusCode, 200)
    const data = coachResponse.json().data
    assert.strictEqual(data.singleAttemptAnalysisLlm.model_trace.source, 'reading_coach_v2')
    assert.strictEqual(data.singleAttemptAnalysisLlm.diagnosis[0].reason, '定位后没有复核限定词。')
    assert.strictEqual(data.singleAttemptAnalysisLlm.diagnosis[0].evidence.source, 'reading_coach_review_overall')
    assert.strictEqual(data.singleAttemptAnalysisLlm.diagnosis[0].evidence.field, 'primaryWeakness')
    assert.strictEqual(data.singleAttemptAnalysisLlm.diagnosis[0].evidence.patternSummary, '错题集中在关键词命中后过早选择。')
    assert.strictEqual(data.singleAttemptAnalysisLlm.nextActions[0].instruction, '先定位，再核对限定词，最后排除局部真实但不答题的选项。')
    assert.strictEqual(data.singleAttemptAnalysisLlm.nextActions[0].evidence.source, 'reading_coach_review_overall')
    assert.strictEqual(data.singleAttemptAnalysisLlm.nextActions[0].evidence.field, 'teachingPlan')
    assert.strictEqual(coachPayload.examId, 'p2-low-148')
    assert.strictEqual(coachPayload.sessionId, sessionId)
    assert.strictEqual(coachPayload.query, 'What should I review first?')
    assert.strictEqual(coachPayload.attemptContext.submitted, true)
    assert.ok(coachPayload.attemptContext.wrongQuestions.includes('14'), 'wrong q1 display label should be passed to coach')
    assert.strictEqual(coachPayload.attemptContext.selectedAnswers['14'], 'A')
    assert.strictEqual(coachPayload.attemptContext.selectedAnswers['19'], 'dancing')
    assert.strictEqual(coachPayload.attemptContext.analysisSignals.questionCount, 13)
    assert.strictEqual(coachPayload.attemptContext.analysisSignals.changedAnswerCount, 1)
    assert.deepStrictEqual(coachPayload.attemptContext.markedQuestions, ['q1'])
    assert.strictEqual(coachPayload.attemptContext.questionTimelineLite.find((item) => item.questionId === 'q1').visitCount, 4)
    assert.strictEqual(coachPayload.attemptContext.questionTimelineLite.find((item) => item.questionId === 'q1').elapsedMs, 18000)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(coachPayload.attemptContext.questionTypePerformance, 'fake'), false)
    assert.ok(
        Object.values(coachPayload.attemptContext.questionTypePerformance).some((entry) => Number(entry?.total || 0) > 0),
        'persisted question type performance should be passed to coach'
    )

    assert.strictEqual(payloadOnlySessionResponse.statusCode, 200)
    const payloadOnlyCoachPayload = calls.readingCoachQueries.at(-1)
    assert.strictEqual(payloadOnlyCoachPayload.sessionId, sessionId)
    assert.strictEqual(payloadOnlyCoachPayload.examId, 'p2-low-148')
    assert.strictEqual(payloadOnlyCoachPayload.query, 'Payload-only session should still hydrate context.')
    assert.strictEqual(payloadOnlyCoachPayload.attemptContext.submitted, true)
    assert.strictEqual(payloadOnlyCoachPayload.attemptContext.selectedAnswers['14'], 'A')
    assert.strictEqual(payloadOnlyCoachPayload.attemptContext.analysisSignals.questionCount, 13)
    assert.strictEqual(payloadOnlyCoachPayload.attemptContext.questionTimelineLite.find((item) => item.questionId === 'q1').visitCount, 4)
}

async function testPracticeCoachKeepsFullGeneratedQuestionAnalyses() {
    const reviewQuestionAnalyses = Array.from({ length: 6 }, (_, index) => {
        const questionNumber = String(14 + index)
        return {
            questionNumber,
            likelyMistake: `Q${questionNumber} 错因`,
            whyUserChoseWrong: `Q${questionNumber} 误选原因`,
            whyCorrectAnswerWorks: `Q${questionNumber} 正确依据`,
            whyWrongAnswerFails: `Q${questionNumber} 排除理由`,
            nextRule: `Q${questionNumber} 下次规则`
        }
    })
    const { app } = await createApp({
        readingCoachResponse: {
            coachVersion: 'test',
            answer: 'Generated review ready.',
            reviewOverall: {
                primaryWeakness: '定位后没有复核限定词。',
                patternSummary: '错题集中在关键词命中后过早选择。',
                teachingPlan: '先定位，再核对限定词，最后排除局部真实但不答题的选项。'
            },
            reviewQuestionAnalyses,
            confidence: 'high'
        }
    })
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A',
                    q6: 'dancing'
                }
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const coachResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'Run generated review.',
                surface: 'review_workspace',
                action: 'review_set',
                promptKind: 'preset'
            }
        }
    })
    assert.strictEqual(coachResponse.statusCode, 200)
    const coachData = coachResponse.json().data
    assert.strictEqual(coachData.singleAttemptAnalysisLlm.diagnosis.length, 4)
    assert.strictEqual(coachData.singleAttemptAnalysisLlm.nextActions.length, 3)
    assert.strictEqual(coachData.singleAttemptAnalysisLlm.reviewQuestionAnalyses.length, 6)
    assert.strictEqual(coachData.singleAttemptAnalysisLlm.reviewQuestionAnalyses[5].questionNumber, '19')
    assert.strictEqual(coachData.singleAttemptAnalysisLlm.reviewQuestionAnalyses[5].whyCorrectAnswerWorks, 'Q19 正确依据')

    const detailResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/history/reading/${encodeURIComponent(`reading-${sessionId}`)}`
    })
    const replayResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/sessions/reading/${encodeURIComponent(sessionId)}`
    })
    await app.close()

    assert.strictEqual(detailResponse.statusCode, 200)
    const detail = detailResponse.json().data
    assert.strictEqual(detail.submission.singleAttemptAnalysisLlm.reviewQuestionAnalyses.length, 6)
    assert.strictEqual(detail.submission.singleAttemptAnalysisLlm.reviewQuestionAnalyses[5].nextRule, 'Q19 下次规则')
    assert.strictEqual(detail.submission.analysisArtifacts.singleAttemptAnalysisLlm.reviewQuestionAnalyses[5].nextRule, 'Q19 下次规则')

    assert.strictEqual(replayResponse.statusCode, 200)
    const replay = replayResponse.json().data
    assert.strictEqual(replay.submission.singleAttemptAnalysisLlm.reviewQuestionAnalyses.length, 6)
    assert.strictEqual(replay.submission.singleAttemptAnalysisLlm.reviewQuestionAnalyses[5].whyWrongAnswerFails, 'Q19 排除理由')
    assert.strictEqual(replay.submission.analysisArtifacts.singleAttemptAnalysisLlm.reviewQuestionAnalyses[5].whyWrongAnswerFails, 'Q19 排除理由')
}

async function testLegacyReadingAssistantUsesPracticeCoachSessionContext() {
    const legacyPatch = {
        diagnosis: [
            {
                code: 'legacy_review_patch',
                reason: '旧 reading assistant URL 必须复用 practice session 上下文。',
                evidence: ['legacy']
            }
        ],
        nextActions: [
            {
                type: 'legacy_next_action',
                target: 'Q14',
                instruction: '旧入口也必须把复盘写回 canonical history。',
                evidence: ['legacy']
            }
        ],
        confidence: 0.93,
        model_trace: {
            source: 'legacy_route_returned_patch',
            degraded: false
        }
    }
    const { app, calls } = await createApp({
        readingCoachResponse: {
            coachVersion: 'test',
            answer: 'Legacy review ready.',
            singleAttemptAnalysisLlm: legacyPatch,
            confidence: 'high'
        }
    })
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A',
                    q6: 'dancing'
                }
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const legacyResponse = await app.inject({
        method: 'POST',
        url: '/api/reading/assistant/query',
        payload: {
            sessionId,
            query: 'Run legacy review.',
            surface: 'review_workspace',
            action: 'review_set',
            promptKind: 'preset',
            attemptContext: { submitted: false, score: 0 }
        }
    })
    assert.strictEqual(legacyResponse.statusCode, 200)
    assert.strictEqual(legacyResponse.json().success, true)
    assert.deepStrictEqual(legacyResponse.json().data.singleAttemptAnalysisLlm, legacyPatch)

    const coachPayload = calls.readingCoachQueries.at(-1)
    assert.strictEqual(coachPayload.examId, 'p2-low-148')
    assert.strictEqual(coachPayload.sessionId, sessionId)
    assert.strictEqual(coachPayload.query, 'Run legacy review.')
    assert.strictEqual(coachPayload.attemptContext.submitted, true)
    assert.ok(coachPayload.attemptContext.wrongQuestions.includes('14'), 'legacy URL should hydrate wrong question labels')
    assert.strictEqual(coachPayload.attemptContext.selectedAnswers['14'], 'A')
    assert.strictEqual(coachPayload.attemptContext.selectedAnswers['19'], 'dancing')

    const detailResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/history/reading/${encodeURIComponent(`reading-${sessionId}`)}`
    })
    await app.close()

    assert.strictEqual(detailResponse.statusCode, 200)
    const detail = detailResponse.json().data
    assert.deepStrictEqual(detail.submission.singleAttemptAnalysisLlm, legacyPatch)
    assert.deepStrictEqual(detail.submission.analysisArtifacts.singleAttemptAnalysisLlm, legacyPatch)
    assert.strictEqual(detail.submission.readingCoachSnapshot.answer, 'Legacy review ready.')
    assert.ok(
        detail.submission.readingCoachTranscript.some((entry) => entry.role === 'user' && entry.content === 'Run legacy review.'),
        'legacy URL review query must be persisted into transcript'
    )
}

async function testPracticeCoachPreservesReturnedSingleAttemptLlm() {
    const canonicalPatch = {
        diagnosis: [
            {
                code: 'canonical_returned_patch',
                reason: '直接保留 coach 返回的结构化复盘，不允许 fallback 重建覆盖。',
                evidence: ['Q14 evidence']
            }
        ],
        nextActions: [
            {
                type: 'canonical_next_action',
                target: 'Q14',
                instruction: '按返回 patch 原样执行，不重写字段。',
                evidence: ['coach-returned']
            }
        ],
        confidence: 0.91,
        model_trace: {
            source: 'coach_returned_patch',
            degraded: false
        }
    }
    const { app } = await createApp({
        readingCoachResponse: {
            coachVersion: 'test',
            answer: 'Canonical review ready.',
            reviewOverall: {
                primaryWeakness: 'fallback should not win',
                patternSummary: 'fallback should not win',
                teachingPlan: 'fallback should not win'
            },
            reviewQuestionAnalyses: [
                {
                    questionNumber: '14',
                    likelyMistake: 'fallback should not win',
                    whyUserChoseWrong: 'fallback should not win',
                    nextRule: 'fallback should not win'
                }
            ],
            singleAttemptAnalysisLlm: canonicalPatch,
            confidence: 'high'
        }
    })
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A'
                }
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const coachResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'Run the automatic review.',
                surface: 'review_workspace',
                action: 'review_set',
                promptKind: 'preset'
            }
        }
    })
    assert.strictEqual(coachResponse.statusCode, 200)
    assert.deepStrictEqual(coachResponse.json().data.singleAttemptAnalysisLlm, canonicalPatch)

    const detailResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/history/reading/${encodeURIComponent(`reading-${sessionId}`)}`
    })

    const replayResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/sessions/reading/${encodeURIComponent(sessionId)}`
    })
    await app.close()

    assert.strictEqual(detailResponse.statusCode, 200)
    const detail = detailResponse.json().data
    assert.deepStrictEqual(detail.submission.singleAttemptAnalysisLlm, canonicalPatch)
    assert.deepStrictEqual(detail.submission.analysisArtifacts.singleAttemptAnalysisLlm, canonicalPatch)
    assert.strictEqual(detail.submission.readingCoachSnapshot.answer, 'Canonical review ready.')
    assert.ok(
        detail.submission.readingCoachTranscript.some((entry) => entry.role === 'assistant' && entry.content === 'Canonical review ready.'),
        'review_set coach answer must be persisted into transcript'
    )
    assert.strictEqual(replayResponse.statusCode, 200)
    const replay = replayResponse.json().data
    assert.deepStrictEqual(replay.submission.singleAttemptAnalysisLlm, canonicalPatch)
    assert.deepStrictEqual(replay.submission.analysisArtifacts.singleAttemptAnalysisLlm, canonicalPatch)
    assert.strictEqual(replay.submission.readingCoachSnapshot.answer, 'Canonical review ready.')
    assert.ok(
        replay.submission.readingCoachTranscript.some((entry) => entry.role === 'user' && entry.content === 'Run the automatic review.'),
        'session state replay must hydrate the persisted review_set transcript'
    )
}

async function testPracticeCoachStreamPersistsReturnedSingleAttemptLlm() {
    const streamPatch = {
        diagnosis: [
            {
                code: 'stream_review_patch',
                reason: 'SSE 复盘入口也必须写回同一个 canonical patch。',
                evidence: ['stream']
            }
        ],
        nextActions: [
            {
                type: 'stream_next_action',
                target: 'Q14',
                instruction: 'stream complete 后回放必须能看到这条训练建议。',
                evidence: ['stream']
            }
        ],
        confidence: 0.88,
        model_trace: {
            source: 'coach_stream_returned_patch',
            degraded: false
        }
    }
    const { app } = await createApp({
        readingCoachResponse: {
            coachVersion: 'test',
            answer: 'Stream review ready.',
            answerSections: [
                {
                    type: 'reasoning',
                    text: 'Stream path uses the same assistant facade.'
                }
            ],
            singleAttemptAnalysisLlm: streamPatch,
            confidence: 'high'
        }
    })
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A'
                }
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const streamResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach/stream',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'Run stream review.',
                surface: 'review_workspace',
                action: 'review_set',
                promptKind: 'preset'
            }
        }
    })
    assert.strictEqual(streamResponse.statusCode, 200)
    assert.match(String(streamResponse.headers['content-type'] || ''), /text\/event-stream/)
    const events = parseSseEvents(streamResponse.payload)
    assert.ok(events.some((entry) => entry.event === 'retrieval'), 'stream should forward coach progress events')
    const complete = events.find((entry) => entry.event === 'complete')
    assert.ok(complete, 'stream should emit complete event')
    assert.deepStrictEqual(complete.data.data.singleAttemptAnalysisLlm, streamPatch)

    const replayResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/sessions/reading/${encodeURIComponent(sessionId)}`
    })
    await app.close()

    assert.strictEqual(replayResponse.statusCode, 200)
    const replay = replayResponse.json().data
    assert.deepStrictEqual(replay.submission.singleAttemptAnalysisLlm, streamPatch)
    assert.deepStrictEqual(replay.submission.analysisArtifacts.singleAttemptAnalysisLlm, streamPatch)
    assert.strictEqual(replay.submission.readingCoachSnapshot.answer, 'Stream review ready.')
    assert.ok(
        replay.submission.readingCoachTranscript.some((entry) => entry.role === 'user' && entry.content === 'Run stream review.'),
        'stream review_set query must be persisted into transcript'
    )
}

async function testLegacyReadingAssistantStreamUsesPracticeCoachSessionContext() {
    const streamPatch = {
        diagnosis: [
            {
                code: 'legacy_stream_review_patch',
                reason: '旧 SSE URL 也必须进入统一 practice coach 链路。',
                evidence: ['legacy-stream']
            }
        ],
        nextActions: [
            {
                type: 'legacy_stream_next_action',
                target: 'Q14',
                instruction: '旧 SSE complete 后回放必须看到同一条复盘。',
                evidence: ['legacy-stream']
            }
        ],
        confidence: 0.89,
        model_trace: {
            source: 'legacy_stream_returned_patch',
            degraded: false
        }
    }
    const { app, calls } = await createApp({
        readingCoachResponse: {
            coachVersion: 'test',
            answer: 'Legacy stream review ready.',
            singleAttemptAnalysisLlm: streamPatch,
            confidence: 'high'
        }
    })
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A'
                }
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const streamResponse = await app.inject({
        method: 'POST',
        url: '/api/reading/assistant/query/stream',
        payload: {
            sessionId,
            query: 'Run legacy stream review.',
            surface: 'review_workspace',
            action: 'review_set',
            promptKind: 'preset'
        }
    })
    assert.strictEqual(streamResponse.statusCode, 200)
    assert.match(String(streamResponse.headers['content-type'] || ''), /text\/event-stream/)
    const events = parseSseEvents(streamResponse.payload)
    assert.ok(events.some((entry) => entry.event === 'retrieval'), 'legacy stream should forward coach progress events')
    const start = events.find((entry) => entry.event === 'start')
    assert.strictEqual(start.data.requestId, sessionId)
    const complete = events.find((entry) => entry.event === 'complete')
    assert.ok(complete, 'legacy stream should emit complete event')
    assert.strictEqual(complete.data.requestId, sessionId)
    assert.deepStrictEqual(complete.data.data.singleAttemptAnalysisLlm, streamPatch)

    const coachPayload = calls.readingCoachQueries.at(-1)
    assert.strictEqual(coachPayload.examId, 'p2-low-148')
    assert.strictEqual(coachPayload.attemptContext.submitted, true)

    const replayResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/sessions/reading/${encodeURIComponent(sessionId)}`
    })
    await app.close()

    assert.strictEqual(replayResponse.statusCode, 200)
    const replay = replayResponse.json().data
    assert.deepStrictEqual(replay.submission.singleAttemptAnalysisLlm, streamPatch)
    assert.deepStrictEqual(replay.submission.analysisArtifacts.singleAttemptAnalysisLlm, streamPatch)
    assert.strictEqual(replay.submission.readingCoachSnapshot.answer, 'Legacy stream review ready.')
    assert.ok(
        replay.submission.readingCoachTranscript.some((entry) => entry.role === 'user' && entry.content === 'Run legacy stream review.'),
        'legacy stream review query must be persisted into transcript'
    )
}

async function testPracticeCoachChatPresetDoesNotPolluteSingleAttemptLlm() {
    const existingPatch = {
        diagnosis: [
            {
                code: 'existing_review_patch',
                reason: '历史复盘结果必须保留，但普通聊天不能把它重新暴露成新复盘。',
                evidence: []
            }
        ],
        nextActions: [
            {
                type: 'existing_next_action',
                target: 'reading',
                instruction: '保持已有复盘，不被 chat preset 覆盖。',
                evidence: []
            }
        ],
        confidence: 0.74,
        model_trace: {
            source: 'existing_submission_patch',
            degraded: false
        }
    }
    const { app } = await createApp({
        readingCoachResponse: {
            coachVersion: 'test',
            answer: 'This is a normal chat answer, not a review artifact.',
            answerSections: [
                {
                    type: 'reasoning',
                    text: 'Use contrast markers before deciding.'
                }
            ],
            followUps: ['Show one example'],
            confidence: 'medium'
        }
    })
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A'
                },
                singleAttemptAnalysisLlm: existingPatch
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const coachResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'Explain this question.',
                surface: 'chat_widget',
                action: 'chat',
                promptKind: 'preset'
            }
        }
    })
    assert.strictEqual(coachResponse.statusCode, 200)
    const coachData = coachResponse.json().data
    assert.strictEqual(Object.prototype.hasOwnProperty.call(coachData, 'singleAttemptAnalysisLlm'), false)

    const detailResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/history/reading/${encodeURIComponent(`reading-${sessionId}`)}`
    })
    await app.close()

    assert.strictEqual(detailResponse.statusCode, 200)
    const detail = detailResponse.json().data
    assert.deepStrictEqual(detail.submission.singleAttemptAnalysisLlm, existingPatch)
    assert.deepStrictEqual(detail.submission.analysisArtifacts.singleAttemptAnalysisLlm, existingPatch)
    assert.strictEqual(detail.submission.readingCoachSnapshot.answer, 'This is a normal chat answer, not a review artifact.')
}

async function testPracticeCoachReviewWorkspaceChatExposesPersistedPatch() {
    const { app } = await createApp()
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A'
                }
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const coachResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'Continue the review from the review workspace.',
                surface: 'review_workspace',
                action: 'chat',
                promptKind: 'followup'
            }
        }
    })

    const detailResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/history/reading/${encodeURIComponent(`reading-${sessionId}`)}`
    })
    await app.close()

    assert.strictEqual(coachResponse.statusCode, 200)
    const coachData = coachResponse.json().data
    assert.strictEqual(coachData.singleAttemptAnalysisLlm.model_trace.source, 'reading_coach_v2')
    assert.strictEqual(coachData.singleAttemptAnalysisLlm.diagnosis[0].evidence.source, 'reading_coach_review_overall')

    assert.strictEqual(detailResponse.statusCode, 200)
    const detail = detailResponse.json().data
    assert.strictEqual(detail.submission.singleAttemptAnalysisLlm.model_trace.source, 'reading_coach_v2')
    assert.strictEqual(detail.submission.singleAttemptAnalysisLlm.diagnosis[0].evidence.source, 'reading_coach_review_overall')
    assert.strictEqual(detail.submission.analysisArtifacts.singleAttemptAnalysisLlm.diagnosis[0].evidence.source, 'reading_coach_review_overall')
}

async function testPracticeCoachHydratesSubmittedSessionHistory() {
    const { app, calls } = await createApp()
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A'
                }
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const firstCoachResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'First coach turn',
                surface: 'chat_widget',
                action: 'chat',
                promptKind: 'freeform'
            }
        }
    })
    assert.strictEqual(firstCoachResponse.statusCode, 200)

    const followupResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'Explain that again',
                surface: 'chat_widget',
                action: 'chat',
                promptKind: 'followup'
            }
        }
    })
    await app.close()

    assert.strictEqual(followupResponse.statusCode, 200)
    const followupPayload = calls.readingCoachQueries.at(-1)
    assert.ok(Array.isArray(followupPayload.history), 'session coach follow-up should hydrate persisted transcript as history')
    assert.strictEqual(followupPayload.history[0].role, 'user')
    assert.strictEqual(followupPayload.history[0].content, 'First coach turn')
    assert.strictEqual(followupPayload.history[1].role, 'assistant')
    assert.strictEqual(followupPayload.history[1].content, 'Use paragraph evidence first.')
    assert.strictEqual(followupPayload.promptKind, 'followup')
}

async function testPracticeCoachReviewRequiresPersistedSession() {
    const { app, calls } = await createApp()

    const coachResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId: 'missing-reading-session',
            payload: {
                examId: 'p2-low-148',
                query: 'Run review for a missing session.',
                surface: 'review_workspace',
                action: 'review_set',
                promptKind: 'preset',
                attemptContext: { submitted: true }
            }
        }
    })

    const legacyResponse = await app.inject({
        method: 'POST',
        url: '/api/reading/assistant/query',
        payload: {
            examId: 'p2-low-148',
            sessionId: 'missing-reading-session',
            query: 'Run legacy review for a missing session.',
            surface: 'review_workspace',
            action: 'review_set',
            promptKind: 'preset',
            attemptContext: { submitted: true }
        }
    })
    await app.close()

    assert.strictEqual(coachResponse.statusCode, 404)
    assert.strictEqual(coachResponse.json().error, 'practice_session_not_found')
    assert.strictEqual(legacyResponse.statusCode, 200)
    assert.strictEqual(legacyResponse.json().success, true)
    assert.strictEqual(legacyResponse.json().data.answer, 'Use paragraph evidence first.')
    assert.strictEqual(calls.readingCoachQueries.length, 1, 'legacy reading assistant must remain stateless when no practice history exists')
    assert.strictEqual(calls.readingCoachQueries[0].examId, 'p2-low-148')
    assert.strictEqual(calls.readingCoachQueries[0].sessionId, 'missing-reading-session')
}

async function testPracticeCoachRejectsDisabledSettingWithoutCallingReadingCoach() {
    const { app, calls } = await createApp({
        readingCoachEnabled: false
    })

    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A'
                },
                durationSec: 61
            },
            settings: {
                sessionId: 'disabled-coach-reading-session'
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const coachResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'This must be rejected when coach is disabled.',
                surface: 'review_workspace',
                action: 'review_set',
                promptKind: 'preset'
            }
        }
    })
    assert.strictEqual(coachResponse.statusCode, 403)
    assert.strictEqual(coachResponse.json().error, 'practice_coach_disabled')
    assert.strictEqual(coachResponse.json().details.settingKey, 'practice.readingCoach.enabled')
    assert.strictEqual(coachResponse.json().details.enabled, false)

    const streamResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach/stream',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'This stream must be rejected when coach is disabled.',
                surface: 'review_workspace',
                action: 'review_set',
                promptKind: 'preset'
            }
        }
    })
    assert.strictEqual(streamResponse.statusCode, 200)
    assert.match(String(streamResponse.headers['content-type'] || ''), /text\/event-stream/)
    const practiceStreamEvents = parseSseEvents(streamResponse.payload)
    const practiceStreamError = practiceStreamEvents.find((entry) => entry.event === 'error')
    assert.ok(practiceStreamError, 'practice coach SSE should emit disabled error event')
    assert.strictEqual(practiceStreamError.data.error.error, 'practice_coach_disabled')
    assert.strictEqual(practiceStreamError.data.error.details.settingKey, 'practice.readingCoach.enabled')

    const legacyResponse = await app.inject({
        method: 'POST',
        url: '/api/reading/assistant/query',
        payload: {
            sessionId,
            query: 'Legacy reading assistant must also reject disabled coach.',
            surface: 'review_workspace',
            action: 'review_set',
            promptKind: 'preset'
        }
    })
    assert.strictEqual(legacyResponse.statusCode, 403)
    assert.strictEqual(legacyResponse.json().error, 'practice_coach_disabled')
    assert.strictEqual(legacyResponse.json().details.settingKey, 'practice.readingCoach.enabled')

    const legacyStreamResponse = await app.inject({
        method: 'POST',
        url: '/api/reading/assistant/query/stream',
        payload: {
            sessionId,
            query: 'Legacy reading assistant SSE must also reject disabled coach.',
            surface: 'review_workspace',
            action: 'review_set',
            promptKind: 'preset'
        }
    })
    assert.strictEqual(legacyStreamResponse.statusCode, 200)
    assert.match(String(legacyStreamResponse.headers['content-type'] || ''), /text\/event-stream/)
    const legacyStreamEvents = parseSseEvents(legacyStreamResponse.payload)
    const legacyStreamError = legacyStreamEvents.find((entry) => entry.event === 'error')
    assert.ok(legacyStreamError, 'legacy reading assistant SSE should emit disabled error event')
    assert.strictEqual(legacyStreamError.data.error.error, 'practice_coach_disabled')
    assert.strictEqual(legacyStreamError.data.error.details.settingKey, 'practice.readingCoach.enabled')

    const replayResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/sessions/reading/${encodeURIComponent(sessionId)}`
    })
    await app.close()

    assert.strictEqual(replayResponse.statusCode, 200)
    assert.strictEqual(calls.readingCoachQueries.length, 0, 'disabled coach must not call ReadingCoach service at all')
    assert.ok(
        calls.settingsQueries.every((key) => key === 'practice.readingCoach.enabled'),
        'coach setting lookup must use the canonical practice.readingCoach.enabled key only'
    )
    assert.ok(
        calls.settingsQueries.length >= 4,
        'practice coach and legacy coach routes should all consult the canonical disabled setting'
    )
    assert.strictEqual(replayResponse.json().data.submission.answers.q1, 'A')
    assert.strictEqual(replayResponse.json().data.submission.singleAttemptAnalysisLlm, null)
}

async function testReadingSubmitHistoryAndSuiteRemainAvailableWhenCoachDisabled() {
    const { app, calls } = await createApp({
        readingCoachEnabled: false
    })

    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A',
                    q6: 'dancing'
                },
                markedQuestions: ['q6'],
                durationSec: 88
            },
            settings: {
                sessionId: 'reading-disabled-coach-history'
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const submissionData = sessionResponse.json().data

    const replayResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/sessions/reading/${encodeURIComponent(submissionData.sessionId)}`
    })
    assert.strictEqual(replayResponse.statusCode, 200)

    const historyListResponse = await app.inject({
        method: 'GET',
        url: '/api/practice/history?activity=reading&page=1&limit=20'
    })
    assert.strictEqual(historyListResponse.statusCode, 200)

    const historyDetailResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/history/reading/${encodeURIComponent(`reading-${submissionData.sessionId}`)}`
    })
    assert.strictEqual(historyDetailResponse.statusCode, 200)

    const suiteCreateResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/reading-suite',
        payload: {
            flowMode: 'simulation',
            frequencyScope: 'all',
            seed: 'disabled-coach-suite-seed'
        }
    })
    assert.strictEqual(suiteCreateResponse.statusCode, 200)
    const suite = suiteCreateResponse.json().data

    const suiteGetResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/reading-suite/${encodeURIComponent(suite.sessionId)}`
    })
    await app.close()

    assert.strictEqual(suiteGetResponse.statusCode, 200)
    assert.strictEqual(calls.readingCoachQueries.length, 0, 'reading submit/history/suite must not be statically coupled to coach runtime')

    const replay = replayResponse.json().data
    assert.strictEqual(replay.submission.answers.q1, 'A')
    assert.strictEqual(replay.submission.answers.q6, 'dancing')
    assert.ok(replay.submission.analysisSignals, 'reading replay should preserve base analysis when coach is disabled')
    assert.ok(replay.submission.singleAttemptAnalysis?.summary, 'reading replay should preserve base single attempt analysis when coach is disabled')
    assert.strictEqual(replay.submission.singleAttemptAnalysisLlm, null)

    const historyList = historyListResponse.json().data
    assert.ok(Array.isArray(historyList.data) && historyList.data.length >= 1, 'reading history list remains available when coach is disabled')
    assert.strictEqual(historyList.data[0].sessionId, submissionData.sessionId)

    const detail = historyDetailResponse.json().data
    assert.strictEqual(detail.submission.sessionId, submissionData.sessionId)
    assert.ok(detail.submission.analysisArtifacts.analysisSignals, 'reading history detail should preserve base analysis artifacts when coach is disabled')
    assert.strictEqual(detail.submission.singleAttemptAnalysisLlm, null)

    const restoredSuite = suiteGetResponse.json().data
    assert.strictEqual(restoredSuite.sessionId, suite.sessionId)
    assert.strictEqual(restoredSuite.sequence.length, 3)
    assert.strictEqual(restoredSuite.sequence[0].status, 'active')
}

async function testPracticeCoachFailureKeepsSubmittedReadingSession() {
    const { app } = await createApp({
        readingCoachResponse() {
            throw new Error('simulated coach outage')
        }
    })
    const sessionResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/sessions',
        payload: {
            activity: 'reading',
            assetId: 'p2-low-148',
            attempt: {
                answers: {
                    q1: 'A',
                    q6: 'dancing'
                },
                markedQuestions: ['q6'],
                durationSec: 88
            }
        }
    })
    assert.strictEqual(sessionResponse.statusCode, 200)
    const sessionId = sessionResponse.json().data.sessionId

    const coachResponse = await app.inject({
        method: 'POST',
        url: '/api/practice/coach',
        payload: {
            activity: 'reading',
            sessionId,
            payload: {
                query: 'Run review even if the model is down.',
                surface: 'review_workspace',
                action: 'review_set',
                promptKind: 'preset'
            }
        }
    })
    assert.strictEqual(coachResponse.statusCode, 500)
    assert.strictEqual(coachResponse.json().error, 'practice_coach_failed')

    const replayResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/sessions/reading/${encodeURIComponent(sessionId)}`
    })
    const detailResponse = await app.inject({
        method: 'GET',
        url: `/api/practice/history/reading/${encodeURIComponent(`reading-${sessionId}`)}`
    })
    await app.close()

    assert.strictEqual(replayResponse.statusCode, 200)
    const replay = replayResponse.json().data
    assert.strictEqual(replay.submission.answers.q1, 'A')
    assert.strictEqual(replay.submission.answers.q6, 'dancing')
    assert.strictEqual(replay.submission.analysisSignals.markedQuestionCount, 1)
    assert.ok(replay.submission.singleAttemptAnalysis?.summary, 'base single attempt analysis must survive coach failure')
    assert.strictEqual(replay.submission.readingCoachSnapshot.error, true)
    assert.strictEqual(replay.submission.readingCoachSnapshot.code, 'practice_coach_failed')
    assert.match(replay.submission.readingCoachSnapshot.message, /simulated coach outage/)
    assert.ok(
        replay.submission.readingCoachTranscript.some((entry) => entry.role === 'user' && entry.content === 'Run review even if the model is down.'),
        'coach failure must keep the user review query in canonical history'
    )
    assert.ok(
        replay.submission.readingCoachTranscript.some((entry) => entry.role === 'assistant' && entry.isError === true && String(entry.content || '').includes('simulated coach outage')),
        'coach failure must keep the failed assistant turn in canonical history'
    )
    assert.strictEqual(replay.submission.singleAttemptAnalysisLlm, null)

    assert.strictEqual(detailResponse.statusCode, 200)
    const detail = detailResponse.json().data
    assert.strictEqual(detail.submission.sessionId, sessionId)
    assert.ok(detail.submission.analysisSignals, 'history detail must keep canonical analysis signals after coach failure')
    assert.ok(detail.submission.analysisArtifacts.analysisSignals, 'history detail must keep base analysis artifacts after coach failure')
    assert.strictEqual(detail.submission.analysisArtifacts.singleAttemptAnalysisLlm, null)
    assert.ok(
        detail.submission.readingCoachTranscript.some((entry) => entry.role === 'assistant' && entry.isError === true && entry.snapshot?.error === true),
        'history detail must persist coach failure snapshot for replay'
    )
    assert.strictEqual(detail.submission.readingCoachSnapshot.error, true)
    assert.match(detail.submission.readingCoachSnapshot.message, /simulated coach outage/)
    assert.strictEqual(detail.submission.singleAttemptAnalysisLlm, null)
}

async function testWritingSessionStateFacade() {
    const { app } = await createApp()
    const response = await app.inject({
        method: 'GET',
        url: '/api/practice/sessions/writing/writing-session-1'
    })
    await app.close()

    assert.strictEqual(response.statusCode, 200)
    const data = response.json().data
    assert.strictEqual(data.sessionId, 'writing-session-1')
    assert.strictEqual(data.activity, 'writing')
    assert.strictEqual(data.status, 'running')
    assert.strictEqual(data.active, true)
    assert.strictEqual(data.lastSequence, 2)
    assert.strictEqual(data.events.length, 2)
    assert.strictEqual(data.legacy.sessionId, 'writing-session-1')
}

async function main() {
    ensureServerBundle()
    await testReadingAssetFacade()
    await testPracticeServiceUsesInjectedReadingAssetProvider()
    await testPracticePaginationClamp()
    await testReadingAssetDetailFacade()
    await testOpenSourceLatestReadingAssetsFacade()
    await testReadingAssetDetailInputModes()
    await testReadingAssetDetailMinifiedWrapperFacade()
    await testMissingReadingAssetDetail()
    await testReadingAssetPayloadCacheHotPath()
    await testReadingAssetForceRefreshClearsLoaderCache()
    await testReadingInteractionCoverage()
    await testPracticeMigrationStatusFacade()
    await testWritingAssetFacade()
    await testWritingSessionFacade()
    await testReadingSessionSubmitScoreAndReview()
    await testReadingSuiteSessionLifecycle()
    await testReadingSuiteTimerCreateContract()
    await testReadingSuiteCustomSequenceContract()
    await testReadingSuitePersistsAcrossPracticeServiceInstances()
    await testReadingHistoryPersistsAcrossPracticeServiceInstances()
    await testReadingHistoryDeleteAndClear()
    await testLocalApiRejectsUntrustedWriteOrigin()
    await testReadingHistoryArchiveRoundTrip()
    await testReadingSessionAnswerNormalization()
    await testReadingSessionCheckboxSetScoring()
    await testPracticeCoachFacade()
    await testPracticeCoachUsesSubmittedReadingSession()
    await testPracticeCoachKeepsFullGeneratedQuestionAnalyses()
    await testLegacyReadingAssistantUsesPracticeCoachSessionContext()
    await testPracticeCoachPreservesReturnedSingleAttemptLlm()
    await testPracticeCoachStreamPersistsReturnedSingleAttemptLlm()
    await testLegacyReadingAssistantStreamUsesPracticeCoachSessionContext()
    await testPracticeCoachChatPresetDoesNotPolluteSingleAttemptLlm()
    await testPracticeCoachReviewWorkspaceChatExposesPersistedPatch()
    await testPracticeCoachHydratesSubmittedSessionHistory()
    await testPracticeCoachReviewRequiresPersistedSession()
    await testPracticeCoachRejectsDisabledSettingWithoutCallingReadingCoach()
    await testReadingSubmitHistoryAndSuiteRemainAvailableWhenCoachDisabled()
    await testPracticeCoachFailureKeepsSubmittedReadingSession()
    await testWritingSessionStateFacade()
    console.log('practiceApiFacade.test.js passed')
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
