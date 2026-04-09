#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const EvaluateService = require(path.join(repoRoot, 'electron', 'services', 'evaluate.service.js'));
const providerOrchestratorPath = path.join(repoRoot, 'electron', 'services', 'provider-orchestrator.service.js');
const llmProviderPath = path.join(repoRoot, 'electron', 'services', 'llm-provider.js');
const {
  decorateEvaluationForStorage,
  mergeStageResults,
  validateReviewStage,
  validateEvaluation
} = require(path.join(repoRoot, 'electron', 'services', 'evaluation-contract.js'));

function createSessionState() {
  return {
    startTime: Date.now(),
    task_type: 'task2',
    topic_id: 42,
    topic_source: 'topic_bank',
    topic_text: 'Some people think...',
    word_count: 265
  };
}

async function runExecutionProbe({ scoringEvaluation, reviewStageResult, reviewStageError = null }) {
  const service = new EvaluateService({}, null);
  const sessionId = reviewStageError ? 'probe-session-degraded' : 'probe-session-success';
  const emitted = [];
  let persistedPayload = null;
  let finishPayload = null;
  let cleanedUp = false;

  service.sessions.set(sessionId, createSessionState());
  service._emitEvent = (targetSessionId, payload) => {
    emitted.push({ sessionId: targetSessionId, ...payload });
  };
  service._executeScoringStage = async () => ({
    usedConfig: { provider: 'openai', default_model: 'qwen-probe' },
    providerPath: [{ provider: 'openai', model: 'qwen-probe', status: 'ok' }],
    evaluation: scoringEvaluation
  });
  service._executeReviewStage = async () => {
    if (reviewStageError) {
      reviewStageError.stageContext = {
        stage: 'review',
        usedConfig: { provider: 'openai', default_model: 'qwen-probe' },
        providerPath: [{ provider: 'openai', model: 'qwen-probe', status: 'ok' }],
      };
      throw reviewStageError;
    }
    return {
      usedConfig: { provider: 'openai', default_model: 'qwen-probe' },
      providerPath: [{ provider: 'openai', model: 'qwen-probe', status: 'ok' }],
      evaluation: reviewStageResult
    };
  };
  service._persistEvaluation = async (_sid, payload) => {
    persistedPayload = payload;
    return reviewStageError ? 100 : 99;
  };
  service._recordSessionFinish = (_sid, payload) => {
    finishPayload = payload;
  };
  service._cleanupSession = () => {
    cleanedUp = true;
  };

  await service._executeEvaluation(sessionId, {
    prompt: { task_type: 'task2' },
    compiledPrompt: {},
    task_type: 'task2',
    topicContext: { source: 'topic_bank', text: 'Some people think...' },
    content: 'Essay text for probe execution.',
    word_count: 265,
    controller: { signal: { aborted: false } }
  });

  return {
    emitted,
    persistedPayload,
    finishPayload,
    cleanedUp
  };
}

async function runProviderOrchestratorProbes() {
  const orchestratorResolvedPath = require.resolve(providerOrchestratorPath);
  const llmProviderResolvedPath = require.resolve(llmProviderPath);
  const originalLlmCacheEntry = require.cache[llmProviderResolvedPath];
  const originalOrchestratorCacheEntry = require.cache[orchestratorResolvedPath];

  const providerCalls = [];
  const providerBehaviors = new Map();

  class FakeLLMProvider {
    constructor({ provider, model }) {
      this.provider = provider;
      this.model = model;
    }

    async streamCompletion({ signal, onChunk }) {
      providerCalls.push(`${this.provider}/${this.model}`);
      const behavior = providerBehaviors.get(this.model);
      if (!behavior) {
        throw new Error(`Missing fake provider behavior for model: ${this.model}`);
      }
      await behavior({ signal, onChunk });
    }
  }

  require.cache[llmProviderResolvedPath] = {
    id: llmProviderResolvedPath,
    filename: llmProviderResolvedPath,
    loaded: true,
    exports: FakeLLMProvider
  };
  delete require.cache[orchestratorResolvedPath];

  try {
    const ProviderOrchestratorService = require(orchestratorResolvedPath);
    const markSuccessCalls = [];
    const markFailureCalls = [];
    const baseConfigs = [
      {
        id: 1,
        provider: 'openai',
        base_url: 'https://fake-a.example/v1',
        api_key: 'k-a',
        default_model: 'model-a',
        enabled: 1,
        max_retries: 0
      },
      {
        id: 2,
        provider: 'openai',
        base_url: 'https://fake-b.example/v1',
        api_key: 'k-b',
        default_model: 'model-b',
        enabled: 1,
        max_retries: 0
      }
    ];
    const configService = {
      async getDecryptedEnabledConfigs() {
        return baseConfigs;
      },
      async getConfigByIdDecrypted(id) {
        return baseConfigs.find((item) => item.id === id) || null;
      },
      markSuccess(id) {
        markSuccessCalls.push(id);
      },
      markFailure(id) {
        markFailureCalls.push(id);
      }
    };
    const orchestrator = new ProviderOrchestratorService(configService);

    providerBehaviors.set('model-a', async () => {
      throw new Error('Server Error: 供应商服务器错误 (500)');
    });
    providerBehaviors.set('model-b', async ({ onChunk }) => {
      onChunk('{"ok":true}');
    });
    providerCalls.length = 0;
    const fallbackResult = await orchestrator.streamCompletion({
      messages: [{ role: 'user', content: 'probe' }],
      temperature: 0.3,
      max_tokens: 32,
      onChunk: () => {},
      signal: new AbortController().signal
    });
    assert.strictEqual(fallbackResult.usedConfig.id, 2, 'normal provider failure should fallback to next enabled provider');
    assert.deepStrictEqual(providerCalls, ['openai/model-a', 'openai/model-b']);
    assert.deepStrictEqual(markSuccessCalls, [2], 'fallback success should only mark successful provider');
    assert(markFailureCalls.includes(1), 'failed primary provider should be marked as failure');

    const timeoutController = new AbortController();
    providerBehaviors.set('model-a', async () => {
      timeoutController.abort('session_timeout');
      const cancelledError = new Error('请求已取消');
      cancelledError.code = 'request_cancelled';
      throw cancelledError;
    });
    providerBehaviors.set('model-b', async ({ onChunk }) => {
      onChunk('{"ok":true}');
    });
    providerCalls.length = 0;

    await assert.rejects(
      () => orchestrator.streamCompletion({
        messages: [{ role: 'user', content: 'probe' }],
        temperature: 0.3,
        max_tokens: 32,
        onChunk: () => {},
        signal: timeoutController.signal
      }),
      (error) => {
        assert.strictEqual(error.code, 'timeout', 'session timeout should be surfaced as timeout code');
        return true;
      }
    );
    assert.deepStrictEqual(
      providerCalls,
      ['openai/model-a'],
      'once session signal is aborted, orchestrator must stop fallback and should not call next provider'
    );
  } finally {
    if (originalLlmCacheEntry) {
      require.cache[llmProviderResolvedPath] = originalLlmCacheEntry;
    } else {
      delete require.cache[llmProviderResolvedPath];
    }
    if (originalOrchestratorCacheEntry) {
      require.cache[orchestratorResolvedPath] = originalOrchestratorCacheEntry;
    } else {
      delete require.cache[orchestratorResolvedPath];
    }
  }
}

async function main() {
  const scoringEvaluation = {
    total_score: 6.5,
    task_achievement: 6.0,
    coherence_cohesion: 6.5,
    lexical_resource: 6.5,
    grammatical_range: 6.0,
    task_analysis: {
      prompt_response_quality: '回应题目主体要求，但论证深度一般',
      position_clarity: '立场明确且基本一致',
      argument_development: '主体段有展开，但例证偏泛',
      conclusion_effectiveness: '结论能回扣题目，但力度不足'
    },
    band_rationale: {
      task_achievement: '回应完整度尚可，但支持展开不足，限制在 6.0 左右',
      coherence_cohesion: '段落结构清楚，但段间推进不够紧',
      lexical_resource: '词汇范围够用，重复表达略多',
      grammatical_range: '复杂句有尝试，但准确率不稳定'
    },
    improvement_plan: [
      '每个主体段补 1 个更具体的例子',
      '减少重复连接词，提升段落推进感'
    ],
    input_context: {
      prompt_summary: '题目要求讨论双方观点并明确给出自己的立场。',
      required_points: ['明确立场', '比较双方观点', '给出结论'],
      major_risks: ['例证偏泛', '段落展开不足']
    }
  };

  const reviewEvaluation = {
    sentences: [
      {
        index: 0,
        original: 'Governments should invest more on public transport.',
        errors: [
          {
            type: 'grammar',
            word: 'invest more on',
            range: { start: 19, end: 33, unit: 'utf16' },
            reason: '固定搭配错误，应为 invest more in',
            correction: 'invest more in'
          }
        ],
        corrected: 'Governments should invest more in public transport.'
      }
    ],
    overall_feedback: '立场明确，但段落展开还不够具体。',
    improvement_plan: [
      '每个主体段增加 1 个具体例子',
      '优先修复高频搭配错误'
    ],
    review_blocks: [
      {
        paragraph_index: 2,
        comment: '主体段中心句明确，但例证不够具体。',
        analysis: '当前段落说明了观点，却没有给出足够可验证的支撑。',
        feedback: '补 1 个具体场景或因果链，论证会更扎实。'
      }
    ],
    rewrite_suggestions: [
      '将空泛判断改写为“观点 + 原因 + 例子”三步结构'
    ]
  };

  const merged = mergeStageResults({
    scoringEvaluation,
    reviewEvaluation
  });

  assert.strictEqual(merged.contract_version, 'v3');
  assert.strictEqual(merged.review_degraded, false);
  assert.strictEqual(merged.review_status?.degraded, false);
  assert.deepStrictEqual(merged.scorecard, {
    total_score: 6.5,
    task_achievement: 6.0,
    coherence_cohesion: 6.5,
    lexical_resource: 6.5,
    grammatical_range: 6.0
  });
  assert.strictEqual(merged.total_score, 6.5);
  assert.strictEqual(merged.review.overall_feedback, reviewEvaluation.overall_feedback);
  assert.strictEqual(merged.analysis.input_context.prompt_summary, scoringEvaluation.input_context.prompt_summary);
  assert.deepStrictEqual(merged.review.review_blocks, reviewEvaluation.review_blocks);
  assert.deepStrictEqual(merged.improvement_plan, reviewEvaluation.improvement_plan);

  const stored = decorateEvaluationForStorage(merged, {
    task_type: 'task2',
    topic_id: 42,
    topic_source: 'topic_bank',
    topic_text: 'Some people think...',
    word_count: 265
  });

  assert.strictEqual(stored.contract_version, 'v3');
  assert.strictEqual(stored.input_context.topic_text, 'Some people think...');
  assert.strictEqual(stored.input_context.topic_source, 'topic_bank');
  assert.strictEqual(stored.analysis.input_context.topic_id, 42);
  assert.strictEqual(stored.topic_text, 'Some people think...');
  assert.strictEqual(stored.topic_source, 'topic_bank');
  assert.strictEqual(stored.review_degraded, false);

  const repairedReview = validateReviewStage({
    review_blocks: reviewEvaluation.review_blocks,
    sentences: [
      reviewEvaluation.sentences[0],
      {
        index: 'bad-index',
        original: '',
        errors: 'not-array'
      }
    ],
    overall_feedback: reviewEvaluation.overall_feedback,
    improvement_plan: reviewEvaluation.improvement_plan,
    rewrite_suggestions: reviewEvaluation.rewrite_suggestions
  });
  assert.strictEqual(repairedReview.sentences.length, 1, 'invalid review sentences should be dropped instead of poisoning the full review payload');
  assert.strictEqual(repairedReview.sentences[0].errors.length, 1, 'valid review sentence should survive sanitization');

  assert.throws(() => {
    validateEvaluation({
      ...stored,
      review_degraded: false,
      review_status: {
        ...stored.review_status,
        status: 'degraded',
        degraded: true
      }
    });
  }, /review_degraded|review_status/, 'conflicting review state must fail validation');

  const successProbe = await runExecutionProbe({
    scoringEvaluation,
    reviewStageResult: reviewEvaluation
  });
  const eventTypes = successProbe.emitted.map((item) => item.type);
  const scoreIndex = eventTypes.indexOf('score');
  const analysisIndex = eventTypes.indexOf('analysis');
  const reviewIndex = eventTypes.indexOf('review');
  const completeIndex = eventTypes.indexOf('complete');

  assert(scoreIndex >= 0, 'missing score event');
  assert(analysisIndex > scoreIndex, 'analysis event should happen after score');
  assert(reviewIndex > analysisIndex, 'review event should happen after analysis');
  assert(completeIndex > reviewIndex, 'complete event should happen after review');
  assert(
    successProbe.emitted.some((item) => item.type === 'stage' && item.data?.name === 'scoring' && item.data?.status === 'started'),
    'missing scoring started stage event'
  );
  assert(
    successProbe.emitted.some((item) => item.type === 'stage' && item.data?.name === 'review' && item.data?.status === 'completed'),
    'missing review completed stage event'
  );
  const completeEvent = successProbe.emitted[completeIndex];
  assert.strictEqual(completeEvent.data.essay_id, 99);
  assert(Array.isArray(completeEvent.data.provider_path), 'complete.provider_path must be an array');
  assert.strictEqual(completeEvent.data.review_degraded, false);
  assert.strictEqual(completeEvent.data.review_status?.status, 'completed');
  assert.strictEqual(completeEvent.data.review_status?.degraded, false);
  assert.strictEqual(successProbe.persistedPayload.evaluation.contract_version, 'v3');
  assert.strictEqual(successProbe.persistedPayload.evaluation.review_degraded, false);
  assert.strictEqual(successProbe.persistedPayload.evaluation.review_status?.status, 'completed');
  assert.strictEqual(successProbe.persistedPayload.evaluation.review_status?.degraded, false);
  assert.strictEqual(successProbe.finishPayload.status, 'completed');
  assert.strictEqual(successProbe.cleanedUp, true);
  const successProgressEvents = successProbe.emitted
    .filter((item) => item.type === 'progress')
    .map((item) => Number(item.data?.percent || 0));
  assert(successProgressEvents.length > 0, 'success flow should emit progress events');
  for (let i = 1; i < successProgressEvents.length; i++) {
    assert(
      successProgressEvents[i] >= successProgressEvents[i - 1],
      'progress percentage must stay monotonic and never go backwards'
    );
  }
  assert(
    successProbe.emitted.some((item) => item.type === 'progress' && item.data?.step === 'stage_review_block_delivered'),
    'review stage should emit per-block progress updates'
  );
  assert(
    successProbe.emitted.some((item) => item.type === 'progress' && item.data?.step === 'stage_review_sentence_delivered'),
    'review stage should emit per-sentence progress updates'
  );
  assert(
    successProbe.emitted.some((item) => item.type === 'progress' && item.data?.step === 'stage_review_feedback_ready'),
    'review stage should emit overall feedback progress updates'
  );

  const degradedProbe = await runExecutionProbe({
    scoringEvaluation,
    reviewStageResult: reviewEvaluation,
    reviewStageError: new Error('forced review failure')
  });
  const degradedEventTypes = degradedProbe.emitted.map((item) => item.type);
  const degradedCompleteEvent = degradedProbe.emitted.find((item) => item.type === 'complete');

  assert(
    degradedProbe.emitted.some((item) => item.type === 'stage' && item.data?.name === 'review' && item.data?.status === 'degraded'),
    'missing degraded review stage event'
  );
  assert(
    !degradedProbe.emitted.some((item) => item.type === 'stage' && item.data?.name === 'review' && item.data?.status === 'completed'),
    'degraded review should not emit completed stage event'
  );
  assert(degradedEventTypes.indexOf('complete') > degradedEventTypes.indexOf('review'), 'degraded flow should still complete after review event');
  assert.strictEqual(degradedCompleteEvent.data.essay_id, 100);
  assert(Array.isArray(degradedCompleteEvent.data.provider_path), 'degraded complete.provider_path must be an array');
  assert.strictEqual(degradedCompleteEvent.data.review_degraded, true, 'degraded complete should expose review_degraded=true');
  assert.strictEqual(degradedCompleteEvent.data.review_status?.status, 'degraded');
  assert.strictEqual(degradedCompleteEvent.data.review_status?.degraded, true);
  assert(
    degradedCompleteEvent.data.provider_path.some((item) => item && item.stage === 'review'),
    'degraded complete.provider_path should preserve review attempt'
  );
  assert.strictEqual(degradedProbe.persistedPayload.evaluation.total_score, scoringEvaluation.total_score);
  assert.strictEqual(degradedProbe.persistedPayload.evaluation.review_degraded, true);
  assert.strictEqual(degradedProbe.persistedPayload.evaluation.review_status?.status, 'degraded');
  assert.strictEqual(degradedProbe.persistedPayload.evaluation.review_status?.degraded, true);
  assert.strictEqual(degradedProbe.persistedPayload.evaluation.review.sentences.length, 0);
  assert.strictEqual(degradedProbe.persistedPayload.evaluation.review.review_blocks.length, 0);
  assert(
    degradedProbe.persistedPayload.evaluation.overall_feedback.includes('第二阶段详解生成失败'),
    'degraded overall feedback should explain review failure'
  );
  assert.strictEqual(degradedProbe.finishPayload.status, 'completed');
  assert.strictEqual(degradedProbe.finishPayload.errorCode, 'review_degraded');
  assert.strictEqual(degradedProbe.cleanedUp, true);

  const cancelledProbe = await runExecutionProbe({
    scoringEvaluation,
    reviewStageResult: reviewEvaluation,
    reviewStageError: new Error('请求已取消')
  });
  const cancelledEventTypes = cancelledProbe.emitted.map((item) => item.type);
  assert(cancelledEventTypes.includes('error'), 'cancelled review stage should emit error event');
  assert(!cancelledEventTypes.includes('complete'), 'cancelled review stage must not emit complete event');
  assert.strictEqual(cancelledProbe.persistedPayload, null, 'cancelled review stage must not persist a fake completed essay');
  assert.strictEqual(cancelledProbe.finishPayload.status, 'failed', 'cancelled review stage should finish as failed');
  assert.strictEqual(cancelledProbe.finishPayload.errorCode, 'unknown_error', 'cancelled review stage should not degrade into review_degraded');
  assert.strictEqual(cancelledProbe.cleanedUp, true);

  const timeoutProbe = await runExecutionProbe({
    scoringEvaluation,
    reviewStageResult: reviewEvaluation,
    reviewStageError: new Error('Network timeout: 连接超时,请检查网络或 base_url')
  });
  const timeoutEventTypes = timeoutProbe.emitted.map((item) => item.type);
  assert(timeoutEventTypes.includes('error'), 'timeout review stage should emit error event');
  assert(!timeoutEventTypes.includes('complete'), 'timeout review stage must not emit complete event');
  assert.strictEqual(timeoutProbe.persistedPayload, null, 'timeout review stage must not persist a fake completed essay');
  assert.strictEqual(timeoutProbe.finishPayload.status, 'failed', 'timeout review stage should finish as failed');
  assert.strictEqual(timeoutProbe.finishPayload.errorCode, 'timeout', 'timeout review stage should preserve timeout error code');
  assert.strictEqual(timeoutProbe.cleanedUp, true);

  await runProviderOrchestratorProbes();

  const sessionStateProbe = new EvaluateService({}, null);
  sessionStateProbe.sessions.set('state-probe', createSessionState());
  sessionStateProbe._emitProgress('state-probe', 'starting', 0, '正在准备评测...');
  sessionStateProbe._emitLog('state-probe', 'system', '评测任务已创建');
  sessionStateProbe._emitLog('state-probe', 'scoring', '第一阶段开始');
  const sessionState = await sessionStateProbe.getSessionState('state-probe');
  assert.strictEqual(sessionState.active, true, 'session state should expose active running session');
  assert.strictEqual(sessionState.status, 'running', 'session state should expose running status');
  assert.strictEqual(sessionState.lastSequence, 3, 'session state should expose last emitted sequence');
  assert.strictEqual(sessionState.events.length, 3, 'session state should replay cached events for UI hydration');
  assert.strictEqual(sessionState.events[0].type, 'progress', 'cached state should preserve progress event');
  assert.strictEqual(sessionState.events[2].type, 'log', 'cached state should preserve later log events');

  process.stdout.write(JSON.stringify({
    status: 'pass',
    merged_contract_version: merged.contract_version,
    stored_contract_version: stored.contract_version,
    sentence_count: merged.sentences.length,
    review_block_count: merged.review.review_blocks.length,
    event_types: eventTypes,
    complete_essay_id: completeEvent.data.essay_id,
    complete_review_degraded: completeEvent.data.review_degraded,
    degraded_event_types: degradedEventTypes,
    degraded_complete_essay_id: degradedCompleteEvent.data.essay_id,
    degraded_complete_review_degraded: degradedCompleteEvent.data.review_degraded,
    cancelled_event_types: cancelledEventTypes,
    timeout_event_types: timeoutEventTypes,
    session_state_last_sequence: sessionState.lastSequence,
    success_progress_events: successProgressEvents.length
  }));
}

try {
  Promise.resolve(main()).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
