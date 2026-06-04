<template>
  <section
    id="results"
    class="reading-panel review-panel"
    :data-reading-review-panel="submission ? '' : null"
    :hidden="!submission"
  >
    <template v-if="submission">
      <div class="panel-heading">
        <span class="panel-kicker">Review</span>
        <strong>{{ submission.scoreInfo.correct }} / {{ submission.scoreInfo.totalQuestions }} · {{ submission.scoreInfo.percentage }}%</strong>
      </div>
      <div class="score-grid">
        <div>
          <span>正确</span>
          <strong>{{ submission.scoreInfo.correct }}</strong>
        </div>
        <div>
          <span>总分</span>
          <strong>{{ submission.scoreInfo.totalQuestions }}</strong>
        </div>
        <div>
          <span>正确率</span>
          <strong>{{ submission.scoreInfo.percentage }}%</strong>
        </div>
        <div>
          <span>耗时</span>
          <strong>{{ formatDuration(submission.duration) }}</strong>
        </div>
      </div>
      <section
        v-if="analysisSignals || singleAttemptAnalysis || singleAttemptAnalysisLlm || llmReviewStatus !== 'idle'"
        class="review-analysis"
        data-reading-analysis-panel
      >
        <div
          v-if="llmReviewStatus !== 'idle'"
          class="llm-review-status"
          :data-reading-llm-review-status="llmReviewStatus"
        >
          <span>AI 复盘</span>
          <strong>{{ llmReviewMessage }}</strong>
          <button
            v-if="llmReviewStatus === 'failed'"
            class="btn-text llm-review-retry"
            type="button"
            data-reading-llm-review-retry
            @click="$emit('retry-review')"
          >
            重新复盘
          </button>
        </div>
        <div v-if="analysisSignals" class="analysis-strip" data-reading-analysis-signals>
          <div>
            <span>未作答</span>
            <strong>{{ analysisSignals.unansweredCount }}</strong>
          </div>
          <div>
            <span>改答</span>
            <strong>{{ analysisSignals.changedAnswerCount }}</strong>
          </div>
          <div>
            <span>标记</span>
            <strong>{{ analysisSignals.markedQuestionCount }}</strong>
          </div>
          <div>
            <span>交互密度</span>
            <strong>{{ formatDensity(analysisSignals.interactionDensity) }}</strong>
          </div>
        </div>
        <div v-if="singleAttemptAnalysis" class="analysis-body">
          <div>
            <h3>复盘判断</h3>
            <ul class="analysis-list">
              <li
                v-for="item in singleAttemptAnalysis.diagnosis"
                :key="item.type + item.message"
                :data-analysis-diagnosis-type="item.type"
              >
                <strong>{{ getSeverityLabel(item.severity) }}</strong>
                <span>{{ item.message }}</span>
              </li>
            </ul>
          </div>
          <div>
            <h3>下一步</h3>
            <ul class="analysis-list">
              <li
                v-for="item in singleAttemptAnalysis.nextActions"
                :key="item.type + item.target"
                :data-analysis-action-type="item.type"
              >
                <strong>{{ item.target }}</strong>
                <span>{{ item.instruction }}</span>
              </li>
            </ul>
          </div>
        </div>
        <div v-if="singleAttemptAnalysisLlm" class="analysis-body llm-analysis-body" data-reading-llm-review-panel>
          <div>
            <h3>AI 错因复盘</h3>
            <ul class="analysis-list">
              <li
                v-for="item in singleAttemptLlmDiagnosis"
                :key="item.code + item.reason"
                :data-reading-llm-diagnosis="item.code"
              >
                <strong>AI</strong>
                <span>{{ item.reason }}</span>
              </li>
            </ul>
          </div>
          <div>
            <h3>AI 下一步训练</h3>
            <ul class="analysis-list">
              <li
                v-for="item in singleAttemptLlmActions"
                :key="item.type + item.target + item.instruction"
                :data-reading-llm-action="item.type"
              >
                <strong>{{ item.target }}</strong>
                <span>{{ item.instruction }}</span>
              </li>
            </ul>
          </div>
          <section
            v-if="singleAttemptLlmQuestionAnalyses.length"
            class="llm-question-analysis-list"
            data-reading-llm-question-analyses
          >
            <h3>逐题复盘</h3>
            <article
              v-for="item in singleAttemptLlmQuestionAnalyses"
              :key="item.questionLabel + item.likelyMistake + item.nextRule"
              class="llm-question-analysis"
              :data-reading-llm-question-analysis="item.questionLabel"
            >
              <strong>{{ item.questionLabel }}</strong>
              <dl>
                <template v-if="item.likelyMistake">
                  <dt>错因</dt>
                  <dd>{{ item.likelyMistake }}</dd>
                </template>
                <template v-if="item.whyUserChoseWrong">
                  <dt>误选原因</dt>
                  <dd>{{ item.whyUserChoseWrong }}</dd>
                </template>
                <template v-if="item.whyCorrectAnswerWorks">
                  <dt>正确依据</dt>
                  <dd>{{ item.whyCorrectAnswerWorks }}</dd>
                </template>
                <template v-if="item.whyWrongAnswerFails">
                  <dt>排除理由</dt>
                  <dd>{{ item.whyWrongAnswerFails }}</dd>
                </template>
                <template v-if="item.nextRule">
                  <dt>下次规则</dt>
                  <dd>{{ item.nextRule }}</dd>
                </template>
              </dl>
            </article>
          </section>
        </div>
        <div v-if="analysisKindRows.length" class="analysis-kind-bars" data-reading-kind-performance>
          <div
            v-for="kind in analysisKindRows"
            :key="kind.kind"
            class="kind-bar-row"
            :data-analysis-kind="kind.kind"
          >
            <span>{{ getQuestionKindLabel(kind.kind) }}</span>
            <div class="kind-bar-track">
              <i :style="{ width: `${Math.round(kind.accuracy * 100)}%` }" />
            </div>
            <strong>{{ kind.correct }}/{{ kind.total }}</strong>
          </div>
        </div>
      </section>
      <table class="review-table results-table">
        <thead>
          <tr>
            <th>题号</th>
            <th>你的答案</th>
            <th>正确答案</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="questionId in payload.questionOrder"
            :key="questionId"
            :class="getReviewClass(questionId)"
            :data-review-question-id="questionId"
          >
            <td>{{ getDisplayLabel(questionId) }}</td>
            <td>{{ formatReviewAnswer(submission.answerComparison[questionId]?.userAnswer) || '未作答' }}</td>
            <td>{{ formatReviewAnswer(submission.answerComparison[questionId]?.correctAnswer) }}</td>
            <td :class="getLegacyResultClass(questionId)">{{ getReviewLabel(questionId) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script setup>
defineProps({
  submission: { type: Object, default: null },
  payload: { type: Object, required: true },
  analysisSignals: { type: Object, default: null },
  singleAttemptAnalysis: { type: Object, default: null },
  singleAttemptAnalysisLlm: { type: Object, default: null },
  llmReviewStatus: { type: String, default: 'idle' },
  llmReviewMessage: { type: String, default: '' },
  singleAttemptLlmDiagnosis: { type: Array, default: () => [] },
  singleAttemptLlmActions: { type: Array, default: () => [] },
  singleAttemptLlmQuestionAnalyses: { type: Array, default: () => [] },
  analysisKindRows: { type: Array, default: () => [] },
  formatDuration: { type: Function, required: true },
  formatDensity: { type: Function, required: true },
  getSeverityLabel: { type: Function, required: true },
  getQuestionKindLabel: { type: Function, required: true },
  getReviewClass: { type: Function, required: true },
  getDisplayLabel: { type: Function, required: true },
  formatReviewAnswer: { type: Function, required: true },
  getLegacyResultClass: { type: Function, required: true },
  getReviewLabel: { type: Function, required: true }
})

defineEmits(['retry-review'])
</script>
