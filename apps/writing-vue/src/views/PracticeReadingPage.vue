<template>
  <div class="reading-page" :class="readingPageClassList" :style="readingPageStyle">
    <header class="reading-header header">
      <div class="header-content">
        <h1>{{ pageTitle }}</h1>
        <p>{{ headerSummary }}</p>
      </div>
      <div class="reading-header-actions header-controls">
        <button
          v-if="payload"
          id="timer"
          class="reading-stat reading-timer"
          type="button"
          :class="{ paused: !timerRunning && !reviewMode }"
          :disabled="reviewMode"
          :title="timerRunning ? '暂停计时' : '继续计时'"
          data-reading-timer
          @click="toggleTimer"
        >
          {{ formattedTimer }}
        </button>
        <button
          v-if="payload"
          class="header-btn"
          id="settings-btn"
          title="Settings"
          type="button"
          @click="toggleSettingsPanel"
        >
          ☰
        </button>
        <button
          v-if="payload"
          class="header-btn"
          id="note-btn"
          type="button"
          @click="toggleNotesPanel"
        >
          Note
        </button>
      </div>
    </header>

    <div v-if="error" class="inline-message inline-message-error">
      <span>{{ error }}</span>
      <button class="btn-text" type="button" @click="loadAsset">重试</button>
    </div>

    <div v-if="loading" class="surface loading">正在加载阅读题目...</div>

    <div v-if="submitError" class="inline-message inline-message-error">
      <span>{{ submitError }}</span>
    </div>

    <div
      id="settings-panel"
      class="reading-floating-panel reading-settings-panel"
      v-show="settingsPanelOpen"
    >
      <div class="settings-section">
        <h3 class="settings-title">字号调整</h3>
        <div class="settings-options">
          <button
            v-for="option in fontSizeOptions"
            :key="option.value"
            class="settings-option"
            :class="{ active: readingFontSize === option.value }"
            type="button"
            :data-size="option.value"
            @click="selectReadingFont(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div class="settings-section">
        <h3 class="settings-title">背景颜色</h3>
        <div class="settings-options">
          <button
            v-for="option in themeModeOptions"
            :key="option.value"
            class="settings-option"
            :class="{ active: readingThemeMode === option.value }"
            type="button"
            :data-mode="option.value"
            @click="selectReadingTheme(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div
        v-if="activeSuiteSessionId"
        class="settings-section"
        id="suite-flow-mode-section"
      >
        <h3 class="settings-title">套题流程模式</h3>
        <div class="settings-options">
          <button
            class="settings-option"
            type="button"
            data-suite-flow-mode="auto"
            :class="{ active: suiteAutoAdvance === true }"
            @click="setSuiteAutoAdvance(true)"
          >
            自动跳转下一篇
          </button>
          <button
            class="settings-option"
            type="button"
            data-suite-flow-mode="manual"
            :class="{ active: suiteAutoAdvance === false }"
            @click="setSuiteAutoAdvance(false)"
          >
            提交后停留回看
          </button>
        </div>
      </div>
    </div>

    <div
      id="notes-panel"
      class="reading-floating-panel reading-notes-panel"
      v-show="notesPanelOpen"
    >
      <header>
        <h3>Notes</h3>
        <button id="close-note" type="button" @click="closeFloatingPanels">Close</button>
      </header>
      <textarea v-model="notesText" aria-label="阅读笔记"></textarea>
    </div>
    <div class="overlay" v-show="settingsPanelOpen || notesPanelOpen" @click="closeFloatingPanels"></div>

    <div
      id="selbar"
      class="reading-selection-toolbar"
      v-show="selectionToolbarVisible"
      :style="selectionToolbarStyle"
      @mousedown.prevent="keepSelectionToolbar = true"
      @mouseup="keepSelectionToolbar = false"
    >
      <button type="button" id="btnHL" data-role="highlight" @click="applySelectionHighlight('highlight')">Highlight</button>
      <button type="button" id="btnUH" data-role="remove-highlight" @click="removeSelectionHighlight">Remove</button>
      <button type="button" id="btnNote" data-role="note" @click="applySelectionNote">Note</button>
    </div>

    <div
      v-if="dictionaryBubble.visible"
      id="review-highlight-dictionary-bubble"
      class="review-highlight-dictionary-bubble"
      role="dialog"
      aria-live="polite"
      :style="{ left: `${dictionaryBubble.left}px`, top: `${dictionaryBubble.top}px` }"
    >
      <div class="vocab-bubble-head">
        <div>
          <h4 class="vocab-term">{{ dictionaryBubble.term }}</h4>
          <div v-if="dictionaryBubble.meta" class="vocab-meta">{{ dictionaryBubble.meta }}</div>
        </div>
        <button class="vocab-close" type="button" aria-label="关闭" @click="closeDictionaryBubble">×</button>
      </div>
      <template v-if="dictionaryBubble.parts.length">
        <div
          v-for="part in dictionaryBubble.parts"
          :key="part.term + part.meaning"
          class="vocab-part"
        >
          <div class="vocab-term vocab-part-term">{{ part.term }}</div>
          <div v-if="part.meta" class="vocab-meta">{{ part.meta }}</div>
          <div v-if="part.meaning" class="vocab-section">
            <div class="vocab-label">中文释义</div>
            <div class="vocab-text">{{ part.meaning }}</div>
          </div>
          <div v-if="part.definition" class="vocab-section">
            <div class="vocab-label">英文释义</div>
            <div class="vocab-text">{{ part.definition }}</div>
          </div>
        </div>
      </template>
      <div v-else class="vocab-section">
        <div class="vocab-label">{{ dictionaryBubble.found ? '释义' : '未收录' }}</div>
        <div class="vocab-text">{{ dictionaryBubble.meaning || '未找到该高亮内容。可先加入阅读高亮生词，后续在单词背诵中补充释义。' }}</div>
      </div>
      <div v-if="dictionaryBubble.definition" class="vocab-section">
        <div class="vocab-label">英文释义</div>
        <div class="vocab-text">{{ dictionaryBubble.definition }}</div>
      </div>
      <div v-if="dictionaryBubble.example" class="vocab-section">
        <div class="vocab-label">例句</div>
        <div class="vocab-text">{{ dictionaryBubble.example }}</div>
      </div>
      <div v-if="dictionaryBubble.sourceLine" class="vocab-section">
        <div class="vocab-label">来源</div>
        <div class="vocab-text">{{ dictionaryBubble.sourceLine }}</div>
      </div>
      <div class="vocab-actions">
        <button
          class="vocab-add"
          type="button"
          :disabled="dictionaryBubble.saved"
          @click="saveDictionaryBubbleWord"
        >
          {{ dictionaryBubble.saved ? '已加入' : '加入生词本' }}
        </button>
      </div>
    </div>

    <div v-if="isEndlessMode" class="inline-message endless-message" data-reading-endless-mode>
      <span>{{ endlessStatusText }}</span>
      <div class="endless-actions">
        <button v-if="endlessNextAssetId" class="btn-text" type="button" @click="goToNextEndlessAsset">下一篇</button>
        <button class="btn-text" type="button" @click="stopEndlessMode">退出无尽模式</button>
      </div>
    </div>

    <section
      v-if="!loading && asset && payload"
      class="reading-workspace shell"
      :class="{ 'review-mode': reviewMode, 'memorize-mode': isMemorizeMode }"
      :style="readingWorkspaceStyle"
      data-practice-reading-page
      @click="handleWorkspaceClick"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <main id="left" class="pane reading-pane passage-panel">
        <article class="reading-html passage-html">
          <section
            v-for="block in payload.passage.blocks"
            :key="block.blockId"
            class="passage-block"
            v-html="block.html"
          />
        </article>
        <section
          v-if="officialPassageNotes.length"
          class="reading-explanation-panel reading-passage-explanations"
          data-reading-official-passage-explanations
        >
          <div
            v-for="note in officialPassageNotes"
            :key="note.label + note.text"
            class="reading-explanation-card reading-passage-explanation"
          >
            <div class="reading-explanation-card__label">{{ note.label }}</div>
            <div class="reading-explanation-card__text">{{ note.text }}</div>
          </div>
        </section>
      </main>

      <div
        id="divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整原文和题目宽度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(leftPanePercent)"
        tabindex="0"
        @pointerdown="startDividerDrag"
        @keydown="handleDividerKeydown"
      ></div>

      <section id="right" class="pane reading-pane question-panel" @input="handleQuestionInput" @change="handleQuestionInput">
        <div id="question-groups">
          <article
            v-for="group in payload.questionGroups"
            :key="group.groupId"
            class="unified-group question-group"
            :data-group-id="group.groupId"
            :data-question-group-id="group.groupId"
            :data-question-ids="(group.questionIds || []).join(',')"
            :data-group-kind="group.kind"
            :data-allow-option-reuse="group.allowOptionReuse === true ? 'true' : null"
          >
            <div v-if="group.leadHtml" class="reading-html unified-group__lead group-lead" v-html="group.leadHtml" />
            <div class="reading-html group-body" v-html="group.bodyHtml" />
            <section
              v-if="getGroupOfficialExplanations(group).length"
              class="reading-question-explanation-list"
              data-reading-official-explanations
            >
              <h5>{{ getGroupRange(group) }} 官方解析</h5>
              <article
                v-for="section in getGroupOfficialExplanations(group)"
                :key="group.groupId + ':' + section.sectionTitle"
                class="reading-explanation-section"
              >
                <div
                  v-if="section.text && !section.items.length"
                  class="reading-explanation-card reading-group-explanation"
                >
                  <div class="reading-explanation-card__label">{{ section.sectionTitle }}</div>
                  <div class="reading-explanation-card__text">{{ section.text }}</div>
                </div>
                <template v-else>
                  <div
                    v-for="item in section.items"
                    :key="section.sectionTitle + ':' + item.questionNumber"
                    class="reading-explanation-card reading-question-explanation-item"
                    :data-reading-official-question-explanation="normalizeQuestionId(item.questionId || item.questionNumber)"
                  >
                    <div class="reading-explanation-card__label">Q{{ item.questionNumber }} 讲解</div>
                    <div class="reading-explanation-card__text">{{ item.text }}</div>
                  </div>
                </template>
              </article>
            </section>
          </article>
        </div>

        <section v-if="isMemorizeMode" class="reading-panel memorize-panel" data-reading-memorize-panel>
          <div class="panel-heading">
            <span class="panel-kicker">Memorize</span>
            <strong>背题模式 · {{ payload.questionCount }} 题</strong>
          </div>
          <div class="memorize-answer-grid">
            <div
              v-for="questionId in payload.questionOrder"
              :key="questionId"
              class="memorize-answer-card"
              :data-memorize-answer-question-id="questionId"
            >
              <span>{{ getDisplayLabel(questionId) }}</span>
              <strong>{{ formatReviewAnswer(payload.answerKey?.[questionId]) || '未提供' }}</strong>
            </div>
          </div>
        </section>

        <section v-if="submission" class="reading-panel review-panel" data-reading-review-panel>
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
                @click="runAutomaticReviewCoach"
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
          <table class="review-table">
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
                <td>{{ getReviewLabel(questionId) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="submission" class="coach-panel" data-reading-coach-panel>
          <div class="answer-panel-head">
            <div>
              <span class="panel-kicker">AI Coach</span>
              <h2>阅读教练</h2>
            </div>
            <span
              class="coach-status"
              :class="{ 'is-loading': coachLoading }"
              data-reading-coach-stream-status
            >
              {{ coachLoading ? (coachStreamMessage || '思考中') : `${coachTranscript.length} 条` }}
            </span>
          </div>
          <div v-if="selectedContext" class="coach-selected-context" data-reading-coach-selected-context>
            <span>{{ selectedContext.scope === 'question' ? '已选题目' : '已选原文' }}</span>
            <strong>{{ selectedContext.text }}</strong>
            <button class="btn-text" type="button" @click="clearSelectedContext">清除</button>
          </div>
          <div class="coach-chip-row" data-reading-coach-actions>
            <button
              v-for="action in coachQuickActions"
              :key="action.id"
              class="coach-chip"
              type="button"
              :disabled="coachLoading"
              :data-reading-coach-action="action.id"
              @click="runCoachQuickAction(action.id)"
            >
              {{ action.label }}
            </button>
          </div>
          <div v-if="selectedContext" class="coach-chip-row coach-selection-tools" data-reading-coach-selection-tools>
            <button
              v-for="action in coachSelectionActions"
              :key="action.id"
              class="coach-chip"
              type="button"
              :disabled="coachLoading"
              :data-reading-coach-selection-action="action.id"
              @click="runCoachSelectionAction(action.id)"
            >
              {{ action.label }}
            </button>
          </div>
          <div class="coach-transcript" data-reading-coach-transcript>
            <div v-if="!coachTranscript.length" class="coach-message assistant">
              你可以先问：这题怎么定位证据？
            </div>
            <div
              v-for="entry in coachTranscript"
              :key="entry.id"
              class="coach-message"
              :class="[entry.role, { error: entry.isError }]"
              :data-reading-coach-message="entry.role"
            >
              {{ entry.content }}
            </div>
          </div>
          <div v-if="coachFollowUps.length" class="coach-chip-row coach-followups" data-reading-coach-followups>
            <button
              v-for="text in coachFollowUps"
              :key="text"
              class="coach-chip"
              type="button"
              :disabled="coachLoading"
              @click="askCoachFollowUp(text)"
            >
              {{ text }}
            </button>
          </div>
          <textarea
            v-model="coachQuery"
            rows="3"
            placeholder="针对本次提交提问"
            :disabled="coachLoading"
            @focus="refreshSelectedContext"
          />
          <button class="btn btn-primary" type="button" :disabled="!canAskCoach" @click="askCoach">
            {{ coachLoading ? '分析中...' : '询问教练' }}
          </button>
          <p v-if="coachError" class="coach-error">{{ coachError }}</p>
          <div v-if="coachResponse" class="coach-response" data-reading-coach-answer>
            {{ coachResponse.answer || coachResponse.message || '教练已返回结果。' }}
          </div>
        </section>
      </section>
    </section>

    <nav
      v-if="!loading && asset && payload"
      class="practice-nav answer-panel"
      data-reading-answer-nav
    >
      <div class="title">题目导航</div>

      <div class="questions answer-list" id="question-nav">
        <div
          v-for="questionId in payload.questionOrder"
          :key="questionId"
          class="question-nav-entry"
          :class="[
            { answered: hasAnswer(questionId), marked: isMarkedQuestion(questionId) },
            getReviewClass(questionId),
            getLegacyNavStatus(questionId)
          ]"
          :data-answer-question-id="questionId"
          :data-question-id="questionId"
        >
          <button
            type="button"
            class="q-item answer-item"
            :class="[
              { answered: hasAnswer(questionId), marked: isMarkedQuestion(questionId) },
              getReviewClass(questionId),
              getLegacyNavStatus(questionId)
            ]"
            :data-question-id="questionId"
            @click="scrollToQuestion(questionId)"
          >
            {{ getDisplayLabel(questionId) }}
          </button>
          <button
            type="button"
            class="mark-question-button"
            :class="{ active: isMarkedQuestion(questionId) }"
            :disabled="readOnlyMode"
            :aria-label="`${isMarkedQuestion(questionId) ? '取消标记' : '标记'} Question ${getDisplayLabel(questionId)}`"
            @click.stop="toggleMarkedQuestion(questionId)"
          >
            !
          </button>
        </div>
      </div>

      <div class="controls answer-actions">
        <div v-if="suiteSession" class="suite-progress-mini" data-reading-suite-progress-mini>
          <div>
            <span>套题</span>
            <strong>{{ suiteSession.aggregate.submittedPassages }}/{{ suiteSession.aggregate.totalPassages }} · {{ suiteSession.aggregate.percentage }}%</strong>
          </div>
        </div>
        <span v-if="payload" class="reading-stat reading-progress" data-reading-answer-progress>
          {{ answeredCount }}/{{ payload.questionCount }}
        </span>
        <router-link id="exit-btn" class="header-btn" :to="returnRoute">{{ returnLabel }}</router-link>
        <button id="reset-btn" class="header-btn" type="button" :disabled="resetButtonDisabled" @click="handleResetButton">{{ resetButtonLabel }}</button>
        <button class="header-btn" type="button" :disabled="!asset || loading || submitting" @click="snapshotAnswers">保存作答快照</button>
        <button id="submit-btn" class="submit-btn primary" type="button" :disabled="primaryButtonDisabled" @click="handlePrimaryButton">
          {{ primaryButtonLabel }}
        </button>
      </div>

      <p v-if="snapshotMessage" class="snapshot-message">{{ snapshotMessage }}</p>
    </nav>

    <section v-if="!loading && !asset" class="surface empty-state">
      <strong>未找到阅读题目</strong>
      <span>返回练习库重新选择资源。</span>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { practiceAssets, practiceCoach, practiceReadingSuite, practiceSessions } from '@/api/practice-client.js'

const AUTOMATIC_REVIEW_QUERY = '请复盘我本次错题，按优先级给出训练建议'
const ENDLESS_STATE_KEY = 'practice_reading_endless_state_v1'
const ENDLESS_COUNTDOWN_SEC = 5
const READING_NOTES_STORAGE_PREFIX = 'practice_reading_notes_'
const SUITE_AUTO_ADVANCE_STORAGE_KEY = 'suite_auto_advance_after_submit'
const VOCAB_FALLBACK_STORAGE_KEY = 'exam_system_vocab_list_reading_highlights'
const DICTIONARY_WORDLIST_SCRIPTS = [
  'assets/wordlists/ecdict_reading.bundle.js',
  'assets/wordlists/ielts_core.bundle.js'
]
const DICTIONARY_SERVICE_SCRIPT = 'js/core/dictionaryService.js'
const PRACTICE_TIMER_BRIDGE_KEY = '__IELTS_PRACTICE_TIMER__'
const PRACTICE_TIMER_EVENT = 'practiceTimerStateChange'
const EXPLANATION_SPLIT_KINDS = new Set([
  'single_choice',
  'multi_choice',
  'true_false_not_given',
  'yes_no_not_given'
])
const coachQuickActions = [
  { id: 'hint', label: '给我提示' },
  { id: 'explain', label: '解释这题' },
  { id: 'review', label: '复盘错题' },
  { id: 'similar', label: '推荐同类题' }
]
const coachSelectionActions = [
  { id: 'explain_selection', label: '解释选中' },
  { id: 'locate_evidence', label: '定位证据' },
  { id: 'find_paraphrases', label: '同义替换' }
]
const fontSizeOptions = [
  { value: 'normal', label: 'A' },
  { value: 'large', label: 'A+' },
  { value: 'xlarge', label: 'A++' }
]
const themeModeOptions = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const props = defineProps({
  assetId: {
    type: String,
    required: true
  },
  sessionId: {
    type: String,
    default: ''
  },
  suiteSessionId: {
    type: String,
    default: ''
  }
})

const route = useRoute()
const router = useRouter()
const asset = ref(null)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const submitError = ref('')
const snapshotMessage = ref('')
const submission = ref(null)
const suiteSession = ref(null)
const startedAt = ref('')
const coachQuery = ref('这题怎么定位证据？')
const coachLoading = ref(false)
const coachError = ref('')
const coachResponse = ref(null)
const selectedContext = ref(null)
const coachStreamMessage = ref('')
const llmReviewStatus = ref('idle')
const llmReviewMessage = ref('')
const answers = reactive({})
const answerTimeline = reactive({})
const markedQuestions = ref([])
const interactionCount = ref(0)
const currentDragPayload = ref(null)
const endlessCountdown = ref(0)
const endlessNextAssetId = ref('')
const elapsedSeconds = ref(0)
const timerRunning = ref(false)
const settingsPanelOpen = ref(false)
const notesPanelOpen = ref(false)
const notesText = ref('')
const readingFontSize = ref('normal')
const readingThemeMode = ref('light')
const suiteAutoAdvance = ref(true)
const leftPanePercent = ref(50)
const dividerDragging = ref(false)
const selectionToolbarVisible = ref(false)
const selectionToolbarStyle = reactive({ top: '0px', left: '0px' })
const keepSelectionToolbar = ref(false)
const highlightSnapshot = ref([])
const dictionaryBubble = reactive({
  visible: false,
  term: '',
  meaning: '',
  definition: '',
  example: '',
  meta: '',
  sourceLine: '',
  parts: [],
  phonetic: '',
  partOfSpeech: '',
  sourceLabel: '',
  license: '',
  found: false,
  saved: false,
  left: 0,
  top: 0
})
let endlessTimer = null
let practiceTimer = null
let coachRequestSequence = 0
let lastSelectionRange = null
let currentHighlightNode = null
let dividerPointerId = null
let suppressReadingNotesPersist = false
let practiceTimerBridgeInstalled = false
const practiceTimerBridgeOwner = {}
let reviewDictionaryRuntimePromise = null
const runtimeScriptPromises = new Map()
const activeQuestionVisit = {
  questionId: '',
  startedAtMs: 0
}

const payload = computed(() => asset.value?.payload || null)
const activeSuiteSessionId = computed(() => {
  const fromProp = String(props.suiteSessionId || '').trim()
  const fromQuery = Array.isArray(route.query.suiteSessionId)
    ? route.query.suiteSessionId[0]
    : route.query.suiteSessionId
  return fromProp || String(fromQuery || '').trim()
})
const pageTitle = computed(() => payload.value?.meta?.title || asset.value?.title || '阅读练习')
function readRouteQueryValue(key) {
  const value = route.query?.[key]
  return Array.isArray(value) ? value[0] : value
}

function normalizePracticeModeQueryValue(value) {
  return String(value || '').trim().toLowerCase()
}

function shouldNormalizeLegacyMemorizeQuery() {
  return !String(props.sessionId || route.params.sessionId || '').trim()
    && !activeSuiteSessionId.value
    && normalizePracticeModeQueryValue(readRouteQueryValue('mode')) === 'review'
    && !normalizePracticeModeQueryValue(readRouteQueryValue('practiceMode'))
}

function normalizeLegacyMemorizeQuery() {
  if (!shouldNormalizeLegacyMemorizeQuery()) return false
  router.replace({
    name: route.name || 'PracticeReading',
    params: route.params,
    query: {
      ...route.query,
      mode: 'memorize',
      practiceMode: 'memorize'
    }
  })
  return true
}

const isEndlessMode = computed(() => {
  const mode = normalizePracticeModeQueryValue(readRouteQueryValue('mode'))
  return mode === 'endless' && !activeSuiteSessionId.value
})
const isMemorizeMode = computed(() => {
  const mode = normalizePracticeModeQueryValue(readRouteQueryValue('mode'))
  const practiceMode = normalizePracticeModeQueryValue(readRouteQueryValue('practiceMode'))
  return (mode === 'memorize' || practiceMode === 'memorize') && !props.sessionId
})
const headerSummary = computed(() => {
  if (!payload.value) return '从统一 Practice API 加载阅读题目。'
  const category = payload.value.meta?.category || asset.value?.category || 'Reading'
  const mode = activeSuiteSessionId.value
    ? 'Vue 套题阅读链路'
    : (isEndlessMode.value ? '无尽模式' : (isMemorizeMode.value ? '背题模式' : 'Vue 原生阅读链路'))
  return `${category} · ${payload.value.questionCount} 题 · ${mode}`
})
const returnRoute = computed(() => (
  activeSuiteSessionId.value
    ? { name: 'PracticeReadingSuite', params: { sessionId: activeSuiteSessionId.value } }
    : { name: 'PracticeLibrary' }
))
const returnLabel = computed(() => (activeSuiteSessionId.value ? '返回套题进度' : '返回练习库'))
const answeredCount = computed(() => (
  payload.value?.questionOrder?.filter((questionId) => hasAnswer(questionId)).length || 0
))
const reviewMode = computed(() => Boolean(submission.value))
const readOnlyMode = computed(() => reviewMode.value || isMemorizeMode.value)
const canSubmit = computed(() => Boolean(asset.value && payload.value && !loading.value && !submitting.value && !readOnlyMode.value))
const canAskCoach = computed(() => Boolean(submission.value && coachQuery.value.trim() && !coachLoading.value))
const canRecycleSubmittedAttempt = computed(() => Boolean(
  reviewMode.value
  && !activeSuiteSessionId.value
  && !isEndlessMode.value
  && !String(props.sessionId || route.params.sessionId || '').trim()
  && !submitting.value
))
const suiteTimerState = computed(() => normalizeSuiteTimerState(suiteSession.value?.timer))
const timerDisplaySeconds = computed(() => {
  const timer = suiteTimerState.value
  if (timer?.mode === 'countdown' && Number.isFinite(Number(timer.limitSeconds))) {
    return Math.max(0, Math.floor(Number(timer.limitSeconds)) - Math.max(0, Math.round(Number(elapsedSeconds.value) || 0)))
  }
  return Math.max(0, Math.round(Number(elapsedSeconds.value) || 0))
})
const formattedTimer = computed(() => formatClock(timerDisplaySeconds.value))
const readingPageClassList = computed(() => ({
  [`font-${readingFontSize.value}`]: true,
  'dark-mode': readingThemeMode.value === 'dark',
  'reading-memorize-mode': isMemorizeMode.value,
  'reading-pane-resizing': dividerDragging.value
}))
const readingPageStyle = computed(() => ({
  '--reading-font-scale': readingFontSize.value === 'xlarge' ? '1.18' : (readingFontSize.value === 'large' ? '1.08' : '1')
}))
const readingWorkspaceStyle = computed(() => ({
  '--reading-left-pane-width': `${leftPanePercent.value}%`
}))
const primaryButtonLabel = computed(() => {
  if (submitting.value) return '提交中...'
  if (isMemorizeMode.value) return 'Exit'
  if (reviewMode.value) return '已提交'
  return 'Submit'
})
const primaryButtonDisabled = computed(() => {
  if (isMemorizeMode.value) return false
  return !canSubmit.value
})
const resetButtonLabel = computed(() => {
  if (isMemorizeMode.value) return '重置测试'
  return 'Reset'
})
const resetButtonDisabled = computed(() => {
  if (isMemorizeMode.value) return false
  if (reviewMode.value) return !canRecycleSubmittedAttempt.value
  return submitting.value
})
const coachTranscript = computed(() => normalizeCoachTranscript(submission.value?.readingCoachTranscript))
const coachFollowUps = computed(() => {
  const transcript = coachTranscript.value
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index]
    if (entry.role !== 'assistant') continue
    const followUps = Array.isArray(entry.followUps)
      ? entry.followUps
      : (Array.isArray(entry.snapshot?.followUps) ? entry.snapshot.followUps : [])
    const normalized = followUps.map((item) => String(item || '').trim()).filter(Boolean)
    if (normalized.length) {
      return normalized.slice(0, 3)
    }
  }
  return []
})
const endlessStatusText = computed(() => {
  if (endlessCountdown.value > 0 && endlessNextAssetId.value) {
    return `无尽模式：${endlessCountdown.value} 秒后进入下一篇`
  }
  return '无尽模式进行中，提交后会自动进入下一篇。'
})
const officialReviewExplanations = computed(() => (
  reviewMode.value && payload.value?.reviewExplanations
    ? payload.value.reviewExplanations
    : null
))
const officialPassageNotes = computed(() => {
  const notes = officialReviewExplanations.value?.passageNotes
  return Array.isArray(notes)
    ? notes
        .map((note, index) => ({
          label: String(note?.label || `Paragraph ${index + 1}`).trim(),
          text: String(note?.text || '').trim()
        }))
        .filter((note) => note.text)
    : []
})
const officialQuestionExplanationSections = computed(() => {
  const sections = officialReviewExplanations.value?.questionExplanations
  return Array.isArray(sections)
    ? sections
        .map((section, index) => normalizeOfficialQuestionExplanationSection(section, index))
        .filter(Boolean)
    : []
})
const analysisSignals = computed(() => submission.value?.analysisSignals || submission.value?.analysisArtifacts?.analysisSignals || null)
const singleAttemptAnalysis = computed(() => submission.value?.singleAttemptAnalysis || submission.value?.analysisArtifacts?.singleAttemptAnalysis || null)
const singleAttemptAnalysisLlm = computed(() => (
  submission.value?.singleAttemptAnalysisLlm
  || submission.value?.analysisArtifacts?.singleAttemptAnalysisLlm
  || null
))
const singleAttemptLlmDiagnosis = computed(() => (
  Array.isArray(singleAttemptAnalysisLlm.value?.diagnosis)
    ? singleAttemptAnalysisLlm.value.diagnosis
        .map((entry, index) => ({
          code: String(entry?.code || entry?.type || `coach_diag_${index + 1}`),
          reason: String(entry?.reason || entry?.message || '').trim()
        }))
        .filter((entry) => entry.reason)
    : []
))
const singleAttemptLlmActions = computed(() => (
  Array.isArray(singleAttemptAnalysisLlm.value?.nextActions)
    ? singleAttemptAnalysisLlm.value.nextActions
        .map((entry, index) => ({
          type: String(entry?.type || `coach_action_${index + 1}`),
          target: String(entry?.target || 'reading').trim() || 'reading',
          instruction: String(entry?.instruction || entry?.action || '').trim()
        }))
        .filter((entry) => entry.instruction)
    : []
))
const singleAttemptLlmQuestionAnalyses = computed(() => (
  Array.isArray(singleAttemptAnalysisLlm.value?.reviewQuestionAnalyses)
    ? singleAttemptAnalysisLlm.value.reviewQuestionAnalyses
        .map((entry, index) => {
          const rawQuestionNumber = String(entry?.questionNumber || entry?.questionId || '').replace(/^q/i, '').trim()
          const questionLabel = rawQuestionNumber ? `Q${rawQuestionNumber}` : `Q${index + 1}`
          return {
            questionLabel,
            likelyMistake: String(entry?.likelyMistake || '').trim(),
            whyUserChoseWrong: String(entry?.whyUserChoseWrong || '').trim(),
            whyCorrectAnswerWorks: String(entry?.whyCorrectAnswerWorks || '').trim(),
            whyWrongAnswerFails: String(entry?.whyWrongAnswerFails || '').trim(),
            nextRule: String(entry?.nextRule || '').trim()
          }
        })
        .filter((entry) => (
          entry.likelyMistake
          || entry.whyUserChoseWrong
          || entry.whyCorrectAnswerWorks
          || entry.whyWrongAnswerFails
          || entry.nextRule
        ))
    : []
))
const analysisKindRows = computed(() => {
  const rows = singleAttemptAnalysis.value?.radar?.byQuestionKind
  if (Array.isArray(rows) && rows.length) {
    return rows
  }
  const fallback = submission.value?.questionTypePerformance || {}
  return Object.values(fallback)
})

onMounted(() => {
  initializeReadingPreferences()
  installPracticeTimerBridge()
  document.addEventListener('selectionchange', handleSelectionChange)
  document.addEventListener('click', handleDocumentClick, true)
  loadAsset()
})

onBeforeUnmount(() => {
  flushActiveQuestionVisit()
  clearEndlessTimer()
  stopPracticeTimer()
  removePracticeTimerBridge()
  document.removeEventListener('selectionchange', handleSelectionChange)
  document.removeEventListener('click', handleDocumentClick, true)
  removeDividerDragListeners()
})

watch(() => props.assetId, () => {
  loadAsset()
})

watch(() => props.sessionId, () => {
  loadAsset()
})

watch(() => activeSuiteSessionId.value, () => {
  loadAsset()
})

watch(() => [readRouteQueryValue('mode'), readRouteQueryValue('practiceMode')], () => {
  loadAsset()
})

watch(() => [elapsedSeconds.value, timerRunning.value, startedAt.value, activeSuiteSessionId.value, suiteTimerState.value?.mode, suiteTimerState.value?.limitSeconds], () => {
  emitPracticeTimerStateChange()
})

async function loadAsset() {
  const normalizedAssetId = String(props.assetId || route.params.assetId || '').trim()
  const replaySessionId = String(props.sessionId || route.params.sessionId || '').trim()
  if (!normalizedAssetId) {
    error.value = '缺少阅读资源编号'
    return
  }
  if (normalizeLegacyMemorizeQuery()) {
    return
  }

  loading.value = true
  error.value = ''
  submitError.value = ''
  snapshotMessage.value = ''
  submission.value = null
  suiteSession.value = null
  resetAttemptMetadata()
  coachError.value = ''
  coachResponse.value = null
  coachStreamMessage.value = ''
  coachLoading.value = false
  llmReviewStatus.value = 'idle'
  llmReviewMessage.value = ''
  closeFloatingPanels()
  closeSelectionToolbar()
  closeDictionaryBubble()
  highlightSnapshot.value = []
  suppressReadingNotesPersist = true
  notesText.value = ''
  suppressReadingNotesPersist = false
  clearEndlessTimer()
  stopPracticeTimer()
  elapsedSeconds.value = 0
  timerRunning.value = false
  endlessNextAssetId.value = ''
  startedAt.value = new Date().toISOString()
  try {
    const data = await practiceAssets.get('reading', normalizedAssetId)
    asset.value = data
    initializeAnswers(data?.payload)
    loadReadingNotes()
    if (activeSuiteSessionId.value) {
      try {
        suiteSession.value = await practiceReadingSuite.get(activeSuiteSessionId.value)
        applySuiteTimerState()
      } catch (suiteLoadError) {
        if (!replaySessionId) {
          throw suiteLoadError
        }
        console.warn('加载套题进度失败，继续回放已提交阅读记录:', suiteLoadError)
        suiteSession.value = null
      }
    }
    if (replaySessionId) {
      await loadSubmittedSession(replaySessionId)
    }
  } catch (loadError) {
    console.error('加载阅读资源失败:', loadError)
    asset.value = null
    error.value = loadError?.message
      ? `阅读资源加载失败：${loadError.message}`
      : '阅读资源加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
  if (asset.value && payload.value) {
    await nextTick()
    syncDomAnswers()
    restoreHighlightsFromRecords(highlightSnapshot.value)
    applyMemorizeStudyLayer()
    if (readOnlyMode.value) {
      elapsedSeconds.value = Math.max(0, Number(submission.value?.duration || 0))
      setReadOnlyDomControls(true)
    } else {
      startPracticeTimer()
    }
  }
}

async function loadSubmittedSession(sessionId) {
  const state = await practiceSessions.getState('reading', sessionId)
  const loadedSubmission = state?.submission || null
  if (!loadedSubmission) {
    throw new Error('未找到可回放的阅读提交记录')
  }
  const expectedAssetId = String(asset.value?.id || '').trim()
  const actualAssetId = String(loadedSubmission.assetId || loadedSubmission.examId || '').trim()
  if (expectedAssetId && actualAssetId && expectedAssetId !== actualAssetId) {
    throw new Error('阅读回放记录与当前题目不匹配')
  }
  submission.value = loadedSubmission
  highlightSnapshot.value = normalizeHighlightSnapshot(loadedSubmission.highlights || loadedSubmission.analysisArtifacts?.highlights || [])
  coachResponse.value = loadedSubmission.readingCoachSnapshot || null
  if (loadedSubmission.singleAttemptAnalysisLlm || loadedSubmission.analysisArtifacts?.singleAttemptAnalysisLlm) {
    llmReviewStatus.value = 'success'
    llmReviewMessage.value = 'AI 复盘已载入'
  }
  restoreSubmittedMetadata(loadedSubmission)
  if (loadedSubmission.answers) {
    Object.entries(loadedSubmission.answers).forEach(([questionId, value]) => {
      assignAnswer(questionId, value)
    })
  }
  await nextTick()
  restoreHighlightsFromRecords(highlightSnapshot.value)
  restoreSubmittedViewport(loadedSubmission)
  if (!loadedSubmission.singleAttemptAnalysisLlm && !loadedSubmission.analysisArtifacts?.singleAttemptAnalysisLlm) {
    llmReviewStatus.value = 'idle'
    llmReviewMessage.value = 'AI 复盘待补全'
    queueAutomaticReviewRefresh(loadedSubmission.sessionId)
  }
}

function restoreSubmittedViewport(loadedSubmission) {
  const scrollY = Number(loadedSubmission?.metadata?.scrollY ?? loadedSubmission?.scrollY)
  if (!Number.isFinite(scrollY) || scrollY <= 0 || typeof window === 'undefined') {
    return
  }
  window.requestAnimationFrame(() => {
    window.scrollTo(0, Math.max(0, Math.round(scrollY)))
  })
}

function initializeAnswers(readingPayload) {
  Object.keys(answers).forEach((key) => {
    delete answers[key]
  })
  const order = Array.isArray(readingPayload?.questionOrder) ? readingPayload.questionOrder : []
  order.forEach((questionId) => {
    answers[questionId] = ''
  })
  if (isMemorizeMode.value && readingPayload?.answerKey && typeof readingPayload.answerKey === 'object') {
    order.forEach((questionId) => {
      answers[questionId] = cloneAnswerValue(readingPayload.answerKey[questionId])
    })
  }
}

function resetAttemptMetadata() {
  flushActiveQuestionVisit()
  activeQuestionVisit.questionId = ''
  activeQuestionVisit.startedAtMs = 0
  Object.keys(answerTimeline).forEach((key) => {
    delete answerTimeline[key]
  })
  markedQuestions.value = []
  interactionCount.value = 0
}

function normalizeSuiteTimerState(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  const anchorMs = Number(value.anchorMs ?? value.effectiveStartTimeMs)
  if (!Number.isFinite(anchorMs) || anchorMs <= 0) {
    return null
  }
  const mode = String(value.mode || '').trim().toLowerCase() === 'countdown' ? 'countdown' : 'elapsed'
  const limitSeconds = value.limitSeconds == null ? null : Number(value.limitSeconds)
  const pausedOffsetMs = value.pausedOffsetMs == null ? null : Number(value.pausedOffsetMs)
  const pausedAtMs = value.pausedAtMs == null ? null : Number(value.pausedAtMs)
  return {
    source: 'suite',
    anchorMs: Math.floor(anchorMs),
    effectiveStartTimeMs: Math.floor(anchorMs),
    mode,
    limitSeconds: Number.isFinite(limitSeconds) && limitSeconds >= 0 ? Math.floor(limitSeconds) : null,
    pausedOffsetMs: Number.isFinite(pausedOffsetMs) && pausedOffsetMs >= 0 ? Math.floor(pausedOffsetMs) : 0,
    pausedAtMs: Number.isFinite(pausedAtMs) && pausedAtMs > 0 ? Math.floor(pausedAtMs) : null,
    running: value.running !== false
  }
}

function resolveSuiteElapsedSeconds(referenceMs = Date.now()) {
  const timer = suiteTimerState.value
  if (!activeSuiteSessionId.value || !timer) {
    return null
  }
  let elapsedMs = Math.max(0, referenceMs - timer.anchorMs - timer.pausedOffsetMs)
  if (!timer.running && timer.pausedAtMs && referenceMs > timer.pausedAtMs) {
    elapsedMs = Math.max(0, elapsedMs - (referenceMs - timer.pausedAtMs))
  }
  return Math.max(0, Math.floor(elapsedMs / 1000))
}

function applySuiteTimerState() {
  const timer = suiteTimerState.value
  if (!activeSuiteSessionId.value || !timer) {
    return
  }
  startedAt.value = new Date(timer.anchorMs).toISOString()
  elapsedSeconds.value = resolveSuiteElapsedSeconds(Date.now()) ?? elapsedSeconds.value
}

function resolveTimerAnchorMs() {
  const suiteTimer = suiteTimerState.value
  if (activeSuiteSessionId.value && suiteTimer?.anchorMs) {
    return suiteTimer.anchorMs
  }
  const parsed = Date.parse(startedAt.value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Date.now()
}

function getCurrentScrollY() {
  if (typeof window === 'undefined') return 0
  const numeric = Number(window.scrollY)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0
}

function getPracticeTimerSnapshot() {
  const nowMs = Date.now()
  const durationSeconds = Math.max(0, Math.round(Number(elapsedSeconds.value) || 0))
  const effectiveStartTimeMs = Math.max(0, resolveTimerAnchorMs())
  const elapsedMs = durationSeconds * 1000
  const effectiveEndTimeMs = Math.max(effectiveStartTimeMs, effectiveStartTimeMs + elapsedMs)
  const pausedOffsetMs = Math.max(0, nowMs - effectiveStartTimeMs - elapsedMs)
  const running = Boolean(timerRunning.value && !reviewMode.value)
  const suiteTimer = activeSuiteSessionId.value ? suiteTimerState.value : null
  return {
    running,
    elapsedSeconds: durationSeconds,
    durationSeconds,
    displaySeconds: timerDisplaySeconds.value,
    effectiveStartTimeMs,
    effectiveEndTimeMs,
    anchorMs: effectiveStartTimeMs,
    mode: suiteTimer?.mode || 'elapsed',
    limitSeconds: suiteTimer?.limitSeconds ?? null,
    source: activeSuiteSessionId.value ? 'suite' : 'local',
    actualEndTimeMs: nowMs,
    pausedAtMs: running ? null : nowMs,
    pausedOffsetMs
  }
}

function resolvePracticeTiming(minDurationSeconds = 0, timerSnapshot = null) {
  const snapshot = timerSnapshot && typeof timerSnapshot === 'object'
    ? timerSnapshot
    : getPracticeTimerSnapshot()
  const startTimeMsRaw = Number(snapshot.effectiveStartTimeMs)
  const durationRaw = Number(snapshot.durationSeconds ?? snapshot.elapsedSeconds ?? elapsedSeconds.value)
  const actualEndTimeMsRaw = Number(snapshot.actualEndTimeMs)
  const effectiveEndTimeMsRaw = Number(snapshot.effectiveEndTimeMs)
  const startTimeMs = Number.isFinite(startTimeMsRaw) && startTimeMsRaw > 0
    ? Math.floor(startTimeMsRaw)
    : resolveTimerAnchorMs()
  const duration = Math.max(minDurationSeconds, Math.round(Number.isFinite(durationRaw) ? durationRaw : 0))
  const endTimeMs = Number.isFinite(actualEndTimeMsRaw) && actualEndTimeMsRaw > 0
    ? Math.floor(actualEndTimeMsRaw)
    : Date.now()
  const effectiveEndTimeMs = Number.isFinite(effectiveEndTimeMsRaw) && effectiveEndTimeMsRaw > 0
    ? Math.max(startTimeMs, startTimeMs + duration * 1000, Math.floor(effectiveEndTimeMsRaw))
    : Math.max(startTimeMs, startTimeMs + duration * 1000)
  return {
    duration,
    startTimeMs,
    endTimeMs,
    effectiveEndTimeMs
  }
}

function emitPracticeTimerStateChange() {
  if (typeof window === 'undefined' || !practiceTimerBridgeInstalled) return
  try {
    window.dispatchEvent(new CustomEvent(PRACTICE_TIMER_EVENT, {
      detail: getPracticeTimerSnapshot()
    }))
  } catch (_) {
    // Timer bridge is best-effort for legacy listeners.
  }
}

function installPracticeTimerBridge() {
  if (typeof window === 'undefined') return
  window[PRACTICE_TIMER_BRIDGE_KEY] = {
    eventName: PRACTICE_TIMER_EVENT,
    getSnapshot: getPracticeTimerSnapshot,
    pause: () => stopPracticeTimer(),
    resume: () => {
      if (!reviewMode.value) {
        startPracticeTimer()
      }
    },
    setRunning: (nextRunning) => {
      if (nextRunning === false) {
        stopPracticeTimer()
      } else if (!reviewMode.value) {
        startPracticeTimer()
      }
    },
    __owner: practiceTimerBridgeOwner
  }
  practiceTimerBridgeInstalled = true
  emitPracticeTimerStateChange()
}

function removePracticeTimerBridge() {
  if (typeof window === 'undefined') return
  const bridge = window[PRACTICE_TIMER_BRIDGE_KEY]
  if (bridge && bridge.__owner === practiceTimerBridgeOwner) {
    delete window[PRACTICE_TIMER_BRIDGE_KEY]
  }
  practiceTimerBridgeInstalled = false
}

function startPracticeTimer() {
  stopPracticeTimer()
  timerRunning.value = true
  practiceTimer = window.setInterval(() => {
    elapsedSeconds.value += 1
  }, 1000)
  emitPracticeTimerStateChange()
}

function stopPracticeTimer() {
  if (practiceTimer) {
    window.clearInterval(practiceTimer)
    practiceTimer = null
  }
  timerRunning.value = false
  emitPracticeTimerStateChange()
}

function toggleTimer() {
  if (reviewMode.value) {
    return
  }
  if (timerRunning.value) {
    stopPracticeTimer()
  } else {
    startPracticeTimer()
  }
}

function initializeReadingPreferences() {
  try {
    const storedFont = window.localStorage?.getItem('reading_font_size')
    if (fontSizeOptions.some((option) => option.value === storedFont)) {
      readingFontSize.value = storedFont
    }
  } catch (_) {}
  try {
    const storedTheme = window.localStorage?.getItem('reading_theme_mode')
    if (themeModeOptions.some((option) => option.value === storedTheme)) {
      readingThemeMode.value = storedTheme
    }
  } catch (_) {}
  try {
    const storedSuiteFlow = window.localStorage?.getItem(SUITE_AUTO_ADVANCE_STORAGE_KEY)
    if (storedSuiteFlow === 'true' || storedSuiteFlow === 'false') {
      suiteAutoAdvance.value = storedSuiteFlow === 'true'
    }
  } catch (_) {}
}

function toggleSettingsPanel() {
  const nextVisible = !settingsPanelOpen.value
  closeFloatingPanels()
  settingsPanelOpen.value = nextVisible
}

function toggleNotesPanel() {
  const nextVisible = !notesPanelOpen.value
  closeFloatingPanels()
  notesPanelOpen.value = nextVisible
  if (nextVisible) {
    nextTick(() => {
      document.querySelector('#notes-panel textarea')?.focus?.()
    })
  }
}

function closeFloatingPanels() {
  settingsPanelOpen.value = false
  notesPanelOpen.value = false
}

function selectReadingFont(value) {
  if (!fontSizeOptions.some((option) => option.value === value)) {
    return
  }
  readingFontSize.value = value
  try {
    window.localStorage?.setItem('reading_font_size', value)
  } catch (_) {}
}

function selectReadingTheme(value) {
  if (!themeModeOptions.some((option) => option.value === value)) {
    return
  }
  readingThemeMode.value = value
  try {
    window.localStorage?.setItem('reading_theme_mode', value)
  } catch (_) {}
}

function setSuiteAutoAdvance(value) {
  suiteAutoAdvance.value = Boolean(value)
  try {
    window.localStorage?.setItem(SUITE_AUTO_ADVANCE_STORAGE_KEY, String(suiteAutoAdvance.value))
  } catch (_) {}
}

function loadReadingNotes() {
  if (!asset.value?.id) {
    suppressReadingNotesPersist = true
    notesText.value = ''
    suppressReadingNotesPersist = false
    return
  }
  try {
    suppressReadingNotesPersist = true
    notesText.value = window.localStorage?.getItem(`${READING_NOTES_STORAGE_PREFIX}${asset.value.id}`) || ''
  } catch (_) {
    notesText.value = ''
  } finally {
    suppressReadingNotesPersist = false
  }
}

function persistReadingNotes() {
  if (suppressReadingNotesPersist) {
    return
  }
  if (!asset.value?.id) {
    return
  }
  try {
    window.localStorage?.setItem(`${READING_NOTES_STORAGE_PREFIX}${asset.value.id}`, notesText.value || '')
  } catch (_) {}
}

watch(notesText, persistReadingNotes)

function restoreSubmittedMetadata(loadedSubmission) {
  markedQuestions.value = Array.isArray(loadedSubmission?.markedQuestions)
    ? loadedSubmission.markedQuestions.map(normalizeQuestionId).filter(Boolean)
    : []
  Object.keys(answerTimeline).forEach((key) => {
    delete answerTimeline[key]
  })
  const timeline = Array.isArray(loadedSubmission?.questionTimelineLite) ? loadedSubmission.questionTimelineLite : []
  timeline.forEach((entry) => {
    const questionId = normalizeQuestionId(entry?.questionId)
    if (!questionId) return
    const elapsedMs = Math.max(0, Number(entry.elapsedMs ?? entry.durationMs) || 0)
    answerTimeline[questionId] = {
      firstAnsweredAt: entry.firstAnsweredAt || null,
      lastAnsweredAt: entry.lastAnsweredAt || null,
      changeCount: Math.max(0, Number(entry.changeCount) || 0),
      visitCount: Math.max(0, Number(entry.visitCount) || 0),
      elapsedMs,
      lastFingerprint: getAnswerFingerprint(loadedSubmission.answers?.[questionId])
    }
  })
}

function getInteraction(questionId) {
  return payload.value?.interactionModel?.[questionId] || null
}

function getDisplayLabel(questionId) {
  return payload.value?.questionDisplayMap?.[questionId] || String(questionId).replace(/^q/i, '')
}

function getAnswerValue(questionId) {
  const value = answers[questionId]
  return Array.isArray(value) ? value.join(', ') : String(value || '')
}

function hasAnswer(questionId) {
  const value = answers[questionId]
  return Array.isArray(value) ? value.length > 0 : String(value || '').trim().length > 0
}

function isChoiceControl(questionId) {
  const interaction = getInteraction(questionId)
  return ['radio', 'checkbox', 'select'].includes(interaction?.control)
}

function isDragDropControl(questionId) {
  return getInteraction(questionId)?.control === 'dragdrop'
}

function getOptions(questionId) {
  const interaction = getInteraction(questionId)
  return Array.isArray(interaction?.options) ? interaction.options : []
}

function isMultiValueCheckbox(questionId) {
  const interaction = getInteraction(questionId)
  const correctAnswer = payload.value?.answerKey?.[questionId]
  return interaction?.control === 'checkbox' && Array.isArray(correctAnswer)
}

function isOptionSelected(questionId, optionValue) {
  const value = answers[questionId]
  const normalizedOption = String(optionValue || '').trim()
  return Array.isArray(value)
    ? value.includes(normalizedOption)
    : String(value || '').trim() === normalizedOption
}

function getDragDropGroup(questionId) {
  return payload.value?.questionGroups?.find((group) => (
    Array.isArray(group.questionIds) && group.questionIds.includes(questionId)
  )) || null
}

function getDragDropGroupQuestionIds(questionId) {
  const group = getDragDropGroup(questionId)
  return Array.isArray(group?.questionIds) ? group.questionIds : [questionId]
}

function allowsDragOptionReuse(questionId) {
  const interaction = getInteraction(questionId)
  if (typeof interaction?.allowOptionReuse === 'boolean') {
    return interaction.allowOptionReuse
  }
  return Boolean(getDragDropGroup(questionId)?.allowOptionReuse)
}

function getSelectedOption(questionId) {
  const value = getAnswerValue(questionId)
  return getOptions(questionId).find((option) => String(option.value || '').trim() === value) || null
}

function getSelectedOptionLabel(questionId) {
  const option = getSelectedOption(questionId)
  return option?.label || getAnswerValue(questionId) || '未作答'
}

function findQuestionUsingDragOption(questionId, optionValue) {
  const normalizedOption = String(optionValue || '').trim()
  if (!normalizedOption || allowsDragOptionReuse(questionId)) {
    return ''
  }
  return getDragDropGroupQuestionIds(questionId).find((candidateId) => (
    candidateId !== questionId && String(answers[candidateId] || '').trim() === normalizedOption
  )) || ''
}

function isDragOptionUnavailable(questionId, optionValue) {
  return Boolean(findQuestionUsingDragOption(questionId, optionValue))
}

function isMarkedQuestion(questionId) {
  const normalized = normalizeQuestionId(questionId)
  return Boolean(normalized && markedQuestions.value.includes(normalized))
}

function toggleMarkedQuestion(questionId) {
  if (reviewMode.value) {
    return
  }
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return
  recordInteraction()
  markedQuestions.value = isMarkedQuestion(normalized)
    ? markedQuestions.value.filter((entry) => entry !== normalized)
    : [...markedQuestions.value, normalized]
}

function setDragDropAnswer(questionId, value, options = {}) {
  if (reviewMode.value) {
    return
  }
  const normalizedValue = String(value || '').trim()
  const sourceQuestionId = normalizeQuestionId(options.sourceQuestionId)
  recordQuestionVisit(questionId)
  if (!normalizedValue) {
    assignAnswer(questionId, '', { ...options, track: true })
    return
  }

  const currentValue = getAnswerValue(questionId)
  if (sourceQuestionId && sourceQuestionId !== questionId && isDragDropControl(sourceQuestionId)) {
    assignAnswer(questionId, normalizedValue, { syncNative: true, track: true })
    assignAnswer(sourceQuestionId, currentValue, { syncNative: true, track: true })
    return
  }

  if (findQuestionUsingDragOption(questionId, normalizedValue)) {
    return
  }
  assignAnswer(questionId, normalizedValue, { ...options, track: true })
}

function clearDragDropAnswer(questionId) {
  if (reviewMode.value) {
    return
  }
  assignAnswer(questionId, '', { syncNative: true, track: true })
}

function dropOnAnswerSlot(questionId, event) {
  if (reviewMode.value) {
    return
  }
  const dragPayload = getDragPayloadFromEvent(event)
  if (!dragPayload?.value) {
    return
  }
  setDragDropAnswer(questionId, dragPayload.value, {
    sourceQuestionId: dragPayload.sourceQuestionId,
    syncNative: true
  })
}

function handleWorkspaceClick(event) {
  const clearTarget = event.target?.closest?.('[data-dropzone-clear]')
  if (!clearTarget) {
    return
  }
  const questionId = normalizeQuestionId(clearTarget.dataset.sourceQuestionId)
  if (questionId) {
    clearDragDropAnswer(questionId)
  }
}

function handleDragStart(event) {
  if (reviewMode.value) {
    event.preventDefault()
    return
  }
  const source = event.target?.closest?.('[data-drag-value], [data-answer-value], .drag-item, .draggable-word, .card')
  const dragPayload = buildDragPayloadFromElement(source)
  if (!dragPayload?.value) {
    event.preventDefault()
    return
  }
  currentDragPayload.value = dragPayload
  source?.classList?.add('dragging')
  event.dataTransfer?.setData('text/plain', JSON.stringify(dragPayload))
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
  }
}

function handleDragEnd(event) {
  event.target?.closest?.('.dragging')?.classList?.remove('dragging')
  clearDragHoverState()
  currentDragPayload.value = null
}

function handleDragOver(event) {
  if (reviewMode.value) {
    return
  }
  const dropzone = getNativeDropzoneElement(event.target)
  const pool = getDragPoolElement(event.target)
  if (!dropzone && !pool) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = pool ? 'move' : 'copy'
  }
  ;(dropzone || pool).classList.add('drag-over')
}

function handleDragLeave(event) {
  const target = getNativeDropzoneElement(event.target) || getDragPoolElement(event.target)
  const related = event.relatedTarget
  if (target && related && target.contains(related)) {
    return
  }
  target?.classList?.remove('drag-over')
}

function handleDrop(event) {
  if (reviewMode.value) {
    return
  }
  const dragPayload = getDragPayloadFromEvent(event)
  if (!dragPayload?.value && !dragPayload?.sourceQuestionId) {
    return
  }

  const dropzone = getNativeDropzoneElement(event.target)
  if (dropzone) {
    const questionId = resolveDropzoneQuestionId(dropzone)
    if (!questionId || !isDragDropControl(questionId) || !dragPayload.value) {
      return
    }
    event.preventDefault()
    dropzone.classList.remove('drag-over')
    setDragDropAnswer(questionId, dragPayload.value, {
      sourceQuestionId: dragPayload.sourceQuestionId,
      syncNative: true
    })
    return
  }

  const pool = getDragPoolElement(event.target)
  if (pool && dragPayload.sourceQuestionId) {
    event.preventDefault()
    pool.classList.remove('drag-over')
    clearDragDropAnswer(dragPayload.sourceQuestionId)
  }
}

function getDragPayloadFromEvent(event) {
  const raw = event?.dataTransfer?.getData('text/plain')
  const parsed = parseDragPayload(raw)
  return parsed?.value || parsed?.sourceQuestionId ? parsed : currentDragPayload.value
}

function parseDragPayload(rawValue) {
  if (!rawValue) {
    return null
  }
  try {
    const parsed = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return {
      value: String(parsed.value || '').trim(),
      label: String(parsed.label || parsed.value || '').trim(),
      sourceQuestionId: normalizeQuestionId(parsed.sourceQuestionId)
    }
  } catch (_) {
    const fallback = String(rawValue || '').trim()
    return fallback ? { value: fallback, label: fallback, sourceQuestionId: '' } : null
  }
}

function buildDragPayloadFromElement(element) {
  if (!element) {
    return null
  }
  const dataset = element.dataset || {}
  const sourceDropzone = getNativeDropzoneElement(element)
  const sourceQuestionId = normalizeQuestionId(dataset.sourceQuestionId)
    || (sourceDropzone ? resolveDropzoneQuestionId(sourceDropzone) : '')
  const value = String(
    dataset.dragValue
    || dataset.answerValue
    || dataset.heading
    || dataset.option
    || dataset.word
    || dataset.key
    || dataset.value
    || element.getAttribute?.('value')
    || inferDragValueFromLabel(element.textContent)
    || ''
  ).trim()
  const label = String(
    dataset.dragLabel
    || dataset.answerLabel
    || dataset.word
    || dataset.value
    || element.textContent
    || value
  ).trim()
  return value ? { value, label: label || value, sourceQuestionId } : null
}

function inferDragValueFromLabel(label) {
  const text = String(label || '').trim()
  if (!text) {
    return ''
  }
  const leading = text.match(/^([A-Za-z])(?:[.)])?\s+/)
  if (leading) {
    return leading[1].toUpperCase()
  }
  const roman = text.match(/^([ivxlcdm]+)(?:[.)])?\s+/i)
  return roman ? roman[1].toLowerCase() : text
}

function assignAnswer(questionId, value, options = {}) {
  if (!payload.value?.questionOrder?.includes(questionId)) {
    return
  }
  const previousFingerprint = getAnswerFingerprint(answers[questionId])
  answers[questionId] = Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : String(value || '').trim()
  if (options.track) {
    recordAnswerTimeline(questionId, previousFingerprint, getAnswerFingerprint(answers[questionId]))
  }
  if (options.syncNative) {
    syncNativeControl(questionId)
  }
  snapshotMessage.value = ''
  submitError.value = ''
}

function setAnswer(questionId, value, options = {}) {
  if (reviewMode.value) {
    return
  }
  assignAnswer(questionId, value, { ...options, track: true })
}

function toggleAnswerOption(questionId, optionValue, checked, options = {}) {
  if (reviewMode.value) {
    return
  }
  const normalizedOption = String(optionValue || '').trim()
  const current = Array.isArray(answers[questionId])
    ? answers[questionId].slice()
    : String(answers[questionId] || '').split(',').map((entry) => entry.trim()).filter(Boolean)
  const next = checked
    ? Array.from(new Set([...current, normalizedOption])).sort((left, right) => left.localeCompare(right, 'en'))
    : current.filter((entry) => entry !== normalizedOption)
  assignAnswer(questionId, next, { ...options, track: true })
}

function resetAnswers() {
  if (reviewMode.value) {
    return
  }
  initializeAnswers(payload.value)
  resetAttemptMetadata()
  if (activeSuiteSessionId.value && suiteTimerState.value) {
    applySuiteTimerState()
  } else {
    elapsedSeconds.value = 0
    startedAt.value = new Date().toISOString()
  }
  startPracticeTimer()
  syncDomAnswers()
  snapshotMessage.value = '已清空本页作答。'
}

async function recycleSubmittedAttempt() {
  if (!canRecycleSubmittedAttempt.value) {
    return
  }
  submission.value = null
  clearSubmissionSnapshot()
  coachResponse.value = null
  coachError.value = ''
  coachStreamMessage.value = ''
  coachLoading.value = false
  llmReviewStatus.value = 'idle'
  llmReviewMessage.value = ''
  submitError.value = ''
  snapshotMessage.value = ''
  resetAttemptMetadata()
  initializeAnswers(payload.value)
  highlightSnapshot.value = []
  closeSelectionToolbar()
  closeDictionaryBubble()
  await nextTick()
  Object.values(getHighlightRoots()).forEach((root) => unwrapHighlights(root))
  syncDomAnswers()
  setReadOnlyDomControls(false)
  elapsedSeconds.value = 0
  startedAt.value = new Date().toISOString()
  startPracticeTimer()
  snapshotMessage.value = '已重置本篇练习，可重新作答。'
}

function snapshotAnswers() {
  if (!asset.value?.id) return
  const key = `practice_reading_answers_${asset.value.id}`
  const snapshot = {
    assetId: asset.value.id,
    savedAt: new Date().toISOString(),
    answers: Object.fromEntries(Object.entries(answers)),
    markedQuestions: markedQuestions.value.slice(),
    questionTimelineLite: buildQuestionTimelineLite(),
    highlights: snapshotHighlights(),
    scrollY: getCurrentScrollY(),
    timerSnapshot: getPracticeTimerSnapshot()
  }
  try {
    window.sessionStorage?.setItem(key, JSON.stringify(snapshot))
    snapshotMessage.value = '作答快照已保存到当前会话。'
  } catch (_) {
    snapshotMessage.value = '当前环境无法写入会话缓存。'
  }
}

function handleQuestionInput(event) {
  if (reviewMode.value) {
    return
  }
  const target = event.target
  if (!target || !target.name) {
    return
  }

  if (target.type === 'checkbox') {
    collectCheckboxGroup(target.name)
    return
  }

  const questionId = normalizeQuestionId(target.name)
  if (!questionId) return
  recordQuestionVisit(questionId)

  if (target.type === 'radio') {
    if (target.checked) {
      setAnswer(questionId, target.value)
    }
    return
  }

  setAnswer(questionId, target.value)
}

function collectCheckboxGroup(name) {
  const questionIds = expandQuestionSequence(name)
  if (!questionIds.length) {
    return
  }
  questionIds.forEach((questionId) => recordQuestionVisit(questionId))
  const checkedValues = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${escapeCss(name)}"]`))
    .filter((input) => input.checked)
    .map((input) => String(input.value || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'en'))

  if (questionIds.length === 1 && isMultiValueCheckbox(questionIds[0])) {
    setAnswer(questionIds[0], checkedValues)
    return
  }

  questionIds.forEach((questionId, index) => {
    setAnswer(questionId, checkedValues[index] || '')
  })
}

function syncDomAnswers() {
  Object.entries(answers).forEach(([questionId, value]) => {
    syncNativeControl(questionId, value)
  })
}

function syncNativeControl(questionId, explicitValue = answers[questionId]) {
  if (typeof document === 'undefined') {
    return
  }
  const interaction = getInteraction(questionId)
  if (interaction?.control === 'dragdrop') {
    syncDropzoneControl(questionId, explicitValue)
    return
  }
  const names = new Set(resolveAnswerAliases(questionId))
  if (interaction?.name) {
    names.add(interaction.name)
  }

  if (interaction?.control === 'checkbox' && interaction.name) {
    const groupIds = expandQuestionSequence(interaction.name)
    const selectedValues = new Set()
    groupIds.forEach((id) => {
      const value = answers[id]
      if (Array.isArray(value)) {
        value.map((entry) => String(entry || '').trim()).filter(Boolean).forEach((entry) => selectedValues.add(entry))
        return
      }
      const normalized = String(value || '').trim()
      if (normalized) {
        selectedValues.add(normalized)
      }
    })
    document.querySelectorAll(`input[type="checkbox"][name="${escapeCss(interaction.name)}"]`).forEach((input) => {
      input.checked = selectedValues.has(String(input.value || '').trim())
      input.disabled = reviewMode.value
    })
    return
  }

  names.forEach((name) => {
    const escaped = escapeCss(name)
    document.querySelectorAll(`input[type="radio"][name="${escaped}"]`).forEach((input) => {
      input.checked = String(input.value || '').trim() === String(explicitValue || '').trim()
      input.disabled = reviewMode.value
    })
    document.querySelectorAll(`input[type="text"][name="${escaped}"], textarea[name="${escaped}"]`).forEach((input) => {
      input.value = String(explicitValue || '')
      input.disabled = reviewMode.value
    })
  })
}

function syncDropzoneControl(questionId, explicitValue = answers[questionId]) {
  const dropzone = findNativeDropzoneByQuestionId(questionId)
  if (!dropzone) {
    return
  }
  const value = String(Array.isArray(explicitValue) ? explicitValue[0] || '' : explicitValue || '').trim()
  const option = getOptions(questionId).find((entry) => String(entry.value || '').trim() === value)
  const label = option?.label || value
  dropzone.dataset.answerValue = value
  dropzone.dataset.answerLabel = label
  dropzone.dataset.sourceQuestionId = questionId
  dropzone.setAttribute('data-vue-dropzone', 'true')
  dropzone.classList.toggle('dropzone-filled', Boolean(value))
  dropzone.classList.toggle('dropzone-empty', !value)
  dropzone.setAttribute('aria-disabled', reviewMode.value ? 'true' : 'false')

  const holder = ensureDropzoneHolder(dropzone)
  if (!holder) {
    return
  }
  holder.innerHTML = ''
  if (!value) {
    return
  }

  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = 'drag-item dragdrop-chip dragdrop-chip-assigned'
  chip.textContent = label
  chip.dataset.answerValue = value
  chip.dataset.answerLabel = label
  chip.dataset.sourceQuestionId = questionId
  chip.dataset.dropzoneClear = 'true'
  chip.draggable = !reviewMode.value
  chip.disabled = reviewMode.value
  holder.appendChild(chip)
}

function ensureDropzoneHolder(dropzone) {
  if (!dropzone) {
    return null
  }
  if (dropzone.classList.contains('drop-target-summary')) {
    return dropzone
  }
  let holder = dropzone.querySelector('.dropped-items')
  if (!holder) {
    holder = document.createElement('div')
    holder.className = 'dropped-items'
    dropzone.appendChild(holder)
  }
  return holder
}

function findNativeDropzoneByQuestionId(questionId) {
  const aliases = resolveAnswerAliases(questionId)
  for (const alias of aliases) {
    const escaped = escapeCss(alias)
    const selector = [
      `.paragraph-dropzone[data-question="${escaped}"]`,
      `.paragraph-dropzone[data-question-id="${escaped}"]`,
      `.paragraph-dropzone[data-target="${escaped}"]`,
      `.match-dropzone[data-question="${escaped}"]`,
      `.match-dropzone[data-question-id="${escaped}"]`,
      `.match-dropzone[data-target="${escaped}"]`,
      `.drop-target-summary[data-question="${escaped}"]`,
      `.drop-target-summary[data-question-id="${escaped}"]`,
      `.dropzone[data-question="${escaped}"]`,
      `.dropzone[data-question-id="${escaped}"]`,
      `.dropzone[data-target="${escaped}"]`,
      `#${escaped}-dropzone`,
      `#${escaped}-target`
    ].join(', ')
    const direct = document.querySelector(selector)
    if (direct) {
      return direct
    }
    const anchor = document.getElementById(`${alias}-anchor`)
    const anchored = anchor?.querySelector?.('.paragraph-dropzone, .match-dropzone, .drop-target-summary')
      || anchor?.parentElement?.querySelector?.('.paragraph-dropzone, .match-dropzone, .drop-target-summary')
    if (anchored) {
      return anchored
    }
  }
  return null
}

function getNativeDropzoneElement(target) {
  return target?.closest?.('.paragraph-dropzone, .match-dropzone, .drop-target-summary') || null
}

function getDragPoolElement(target) {
  return target?.closest?.('.headings-pool, .options-pool, .cardpool, .option-pool, .pool-items, #word-options, .dragdrop-options') || null
}

function resolveDropzoneQuestionId(dropzone) {
  if (!dropzone) {
    return ''
  }
  const dataset = dropzone.dataset || {}
  const direct = normalizeQuestionId(dataset.sourceQuestionId || dataset.question || dataset.questionId || dataset.target)
  if (direct) {
    return direct
  }
  const anchor = dropzone.closest?.('[id$="-anchor"]')
  const match = String(anchor?.id || '').match(/q\d+/i)
  return match ? normalizeQuestionId(match[0]) : ''
}

function clearDragHoverState() {
  document.querySelectorAll('.drag-over, .dragging').forEach((element) => {
    element.classList.remove('drag-over', 'dragging')
  })
}

function setReadOnlyDomControls(readOnly) {
  if (typeof document === 'undefined') {
    return
  }
  document.querySelectorAll('.question-panel input, .question-panel textarea, .question-panel select').forEach((control) => {
    control.disabled = Boolean(readOnly)
  })
  payload.value?.questionOrder?.forEach((questionId) => {
    if (isDragDropControl(questionId)) {
      syncDropzoneControl(questionId)
    }
  })
}

function getHighlightRoots() {
  if (typeof document === 'undefined') {
    return {}
  }
  return {
    passage: document.getElementById('left'),
    questions: document.getElementById('question-groups')
  }
}

function isInsideExplanationNode(node) {
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node
  return Boolean(element?.closest?.('.reading-explanation-card, .reading-group-explanation, .reading-question-explanation, .reading-question-explanation-list'))
}

function getTextNodes(root) {
  const nodes = []
  if (!root || typeof document === 'undefined') {
    return nodes
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || isInsideExplanationNode(node)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  let node = walker.nextNode()
  while (node) {
    nodes.push(node)
    node = walker.nextNode()
  }
  return nodes
}

function getText(root) {
  return getTextNodes(root).map((node) => node.textContent || '').join('')
}

function unwrapHighlights(root) {
  if (!root) {
    return
  }
  root.querySelectorAll('.hl, .memorize-locator-highlight').forEach((highlight) => {
    if (isInsideExplanationNode(highlight)) {
      return
    }
    const parent = highlight.parentNode
    if (!parent) return
    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight)
    }
    parent.removeChild(highlight)
    parent.normalize()
  })
}

function resolveRangeFromOffsets(root, start, end) {
  const nodes = getTextNodes(root)
  let offset = 0
  let startNode = null
  let endNode = null
  let startOffset = 0
  let endOffset = 0
  nodes.some((node) => {
    const text = node.textContent || ''
    const nextOffset = offset + text.length
    if (!startNode && start >= offset && start <= nextOffset) {
      startNode = node
      startOffset = Math.max(0, start - offset)
    }
    if (!endNode && end >= offset && end <= nextOffset) {
      endNode = node
      endOffset = Math.max(0, end - offset)
    }
    offset = nextOffset
    return Boolean(startNode && endNode)
  })
  if (!startNode || !endNode) {
    return null
  }
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

function normalizeComparableText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function applyHighlightKind(node, kind = 'highlight') {
  node.classList.add('hl')
  node.classList.add('review-dictionary-highlight')
  node.dataset.hlType = kind === 'note' ? 'note' : 'highlight'
  node.setAttribute('tabindex', '0')
  node.setAttribute('role', 'button')
  node.setAttribute('aria-label', `查看释义：${normalizeComparableText(node.textContent)}`)
}

function normalizeHighlightSnapshot(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const text = normalizeComparableText(entry.text || entry.excerpt)
      if (!text) return null
      const scope = String(entry.scope || '').trim().toLowerCase()
      const startOffset = Number(entry.startOffset ?? entry.start)
      const endOffset = Number(entry.endOffset ?? entry.end)
      return {
        scope: scope === 'passage' || scope === 'questions' ? scope : 'unknown',
        text,
        kind: entry.kind === 'note' ? 'note' : 'highlight',
        questionId: normalizeQuestionId(entry.questionId) || null,
        startOffset: Number.isFinite(startOffset) ? startOffset : null,
        endOffset: Number.isFinite(endOffset) ? endOffset : null,
        before: normalizeComparableText(entry.before),
        after: normalizeComparableText(entry.after),
        occurrence: Number.isFinite(Number(entry.occurrence)) ? Math.max(0, Number(entry.occurrence)) : 0,
        createdAt: entry.createdAt || new Date().toISOString()
      }
    })
    .filter(Boolean)
}

function snapshotHighlights() {
  const roots = getHighlightRoots()
  const records = []
  Object.entries(roots).forEach(([scope, root]) => {
    if (!root) return
    const fullText = getText(root)
    const cursorByText = new Map()
    const seenByText = new Map()
    root.querySelectorAll('.hl').forEach((node) => {
      if (isInsideExplanationNode(node)) return
      const text = normalizeComparableText(node.textContent)
      if (!text) return
      const key = `${scope}::${text}`
      const occurrence = seenByText.get(key) || 0
      seenByText.set(key, occurrence + 1)
      let cursor = cursorByText.get(key) || 0
      let hit = -1
      for (let index = 0; index <= occurrence; index += 1) {
        hit = fullText.indexOf(text, cursor)
        if (hit < 0) break
        cursor = hit + text.length
      }
      if (hit < 0) return
      cursorByText.set(key, cursor)
      const endOffset = hit + text.length
      records.push({
        scope,
        text,
        kind: node.dataset.hlType === 'note' ? 'note' : 'highlight',
        questionId: resolveHighlightQuestionId(node),
        startOffset: hit,
        endOffset,
        before: fullText.slice(Math.max(0, hit - 20), hit),
        after: fullText.slice(endOffset, endOffset + 20),
        occurrence,
        createdAt: node.dataset.createdAt || new Date().toISOString()
      })
    })
  })
  highlightSnapshot.value = records
  return records
}

function resolveHighlightQuestionId(node) {
  const element = node?.closest?.('[data-answer-question-id], [data-review-question-id], [data-question], [data-question-id], [name]')
  return normalizeQuestionId(
    element?.dataset?.answerQuestionId
    || element?.dataset?.reviewQuestionId
    || element?.dataset?.question
    || element?.dataset?.questionId
    || element?.getAttribute?.('name')
  ) || null
}

function restoreHighlightsFromRecords(records = []) {
  const roots = getHighlightRoots()
  Object.values(roots).forEach((root) => unwrapHighlights(root))
  normalizeHighlightSnapshot(records).forEach((record) => {
    const root = roots[record.scope]
    if (root) {
      applyHighlightRecord(root, record)
    }
  })
}

function applyHighlightRecord(root, record) {
  const fullText = getText(root)
  if (!fullText || !record?.text) {
    return false
  }
  const candidates = []
  const start = Number(record.startOffset)
  const end = Number(record.endOffset)
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    candidates.push({ start, end })
  }
  let cursor = 0
  let hit = -1
  for (let index = 0; index <= (Number(record.occurrence) || 0); index += 1) {
    hit = fullText.indexOf(record.text, cursor)
    if (hit < 0) break
    cursor = hit + record.text.length
  }
  if (hit >= 0) {
    candidates.push({ start: hit, end: hit + record.text.length })
  }
  const normalizedNeedle = normalizeComparableText(record.text)
  if (normalizedNeedle && hit < 0) {
    const pattern = new RegExp(normalizedNeedle.split(/\s+/).map(escapeRegExp).join('\\s+'), 'g')
    const matched = pattern.exec(fullText)
    if (matched) {
      candidates.push({ start: matched.index, end: matched.index + matched[0].length })
    }
  }
  for (const candidate of candidates) {
    const range = resolveRangeFromOffsets(root, candidate.start, candidate.end)
    if (!range || range.collapsed) continue
    const span = document.createElement('span')
    applyHighlightKind(span, record.kind)
    span.dataset.createdAt = record.createdAt || new Date().toISOString()
    try {
      range.surroundContents(span)
      return true
    } catch (_) {}
  }
  return false
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function closeSelectionToolbar() {
  selectionToolbarVisible.value = false
  keepSelectionToolbar.value = false
  lastSelectionRange = null
  currentHighlightNode = null
}

function handleSelectionChange() {
  window.setTimeout(() => {
    if (keepSelectionToolbar.value) return
    const selection = window.getSelection?.()
    if (!selection || !selection.rangeCount || selection.isCollapsed) {
      if (!currentHighlightNode) {
        selectionToolbarVisible.value = false
      }
      return
    }
    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer
    const roots = Object.values(getHighlightRoots()).filter(Boolean)
    const insideRoot = roots.some((root) => root.contains(container))
    const highlightNode = container?.closest?.('.hl') || null
    if (!insideRoot && !highlightNode) {
      closeSelectionToolbar()
      return
    }
    lastSelectionRange = range.cloneRange()
    currentHighlightNode = highlightNode
    positionSelectionToolbar(range.getBoundingClientRect())
  }, 10)
}

function positionSelectionToolbar(rect) {
  const top = window.scrollY + rect.top - 44
  const left = window.scrollX + rect.left + (rect.width / 2) - 110
  selectionToolbarStyle.top = `${Math.max(8, Math.round(top > 0 ? top : window.scrollY + rect.bottom + 8))}px`
  selectionToolbarStyle.left = `${Math.max(8, Math.round(left))}px`
  selectionToolbarVisible.value = true
}

function applySelectionHighlight(kind = 'highlight') {
  if (!lastSelectionRange || lastSelectionRange.collapsed || currentHighlightNode) {
    return
  }
  const span = document.createElement('span')
  applyHighlightKind(span, kind)
  span.dataset.createdAt = new Date().toISOString()
  try {
    lastSelectionRange.surroundContents(span)
  } catch (_) {
    return
  }
  window.getSelection?.()?.removeAllRanges()
  snapshotHighlights()
  recordInteraction()
  closeSelectionToolbar()
}

function applySelectionNote() {
  if (currentHighlightNode) {
    applyHighlightKind(currentHighlightNode, 'note')
    appendNoteText(currentHighlightNode.textContent)
    snapshotHighlights()
    recordInteraction()
    closeSelectionToolbar()
    toggleNotesPanel()
    return
  }
  const selectedText = normalizeComparableText(lastSelectionRange?.toString?.())
  applySelectionHighlight('note')
  if (selectedText) {
    appendNoteText(selectedText)
    toggleNotesPanel()
  }
}

function appendNoteText(text) {
  const value = normalizeComparableText(text)
  if (!value) return
  notesText.value += `${notesText.value ? '\n\n' : ''}> ${value}\n`
}

function removeSelectionHighlight() {
  let target = currentHighlightNode
  if (!target && lastSelectionRange) {
    const ancestor = lastSelectionRange.commonAncestorContainer
    target = (ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor)?.closest?.('.hl') || null
  }
  if (target?.parentNode) {
    const parent = target.parentNode
    while (target.firstChild) {
      parent.insertBefore(target.firstChild, target)
    }
    parent.removeChild(target)
    parent.normalize()
    snapshotHighlights()
    recordInteraction()
  }
  window.getSelection?.()?.removeAllRanges()
  closeSelectionToolbar()
}

function handleDocumentClick(event) {
  const target = event.target
  const highlight = target?.closest?.('.hl')
  if (highlight && Object.values(getHighlightRoots()).some((root) => root?.contains(highlight))) {
    openDictionaryBubble(highlight)
    return
  }
  if (target?.closest?.('#selbar, #review-highlight-dictionary-bubble, #settings-panel, #notes-panel, #settings-btn, #note-btn')) {
    return
  }
  if (!keepSelectionToolbar.value) {
    selectionToolbarVisible.value = false
  }
  closeDictionaryBubble()
}

function closeDictionaryBubble() {
  dictionaryBubble.visible = false
  dictionaryBubble.term = ''
  dictionaryBubble.meaning = ''
  dictionaryBubble.definition = ''
  dictionaryBubble.example = ''
  dictionaryBubble.meta = ''
  dictionaryBubble.sourceLine = ''
  dictionaryBubble.parts = []
  dictionaryBubble.phonetic = ''
  dictionaryBubble.partOfSpeech = ''
  dictionaryBubble.sourceLabel = ''
  dictionaryBubble.license = ''
  dictionaryBubble.found = false
  dictionaryBubble.saved = false
  currentHighlightNode = null
}

async function openDictionaryBubble(highlight) {
  const term = normalizeComparableText(highlight?.textContent)
  if (!term) return
  const rect = highlight.getBoundingClientRect()
  dictionaryBubble.term = term
  dictionaryBubble.meaning = '正在加载本地词典...'
  dictionaryBubble.definition = ''
  dictionaryBubble.example = ''
  dictionaryBubble.meta = '本地词典'
  dictionaryBubble.sourceLine = ''
  dictionaryBubble.parts = []
  dictionaryBubble.phonetic = ''
  dictionaryBubble.partOfSpeech = ''
  dictionaryBubble.sourceLabel = ''
  dictionaryBubble.license = ''
  dictionaryBubble.found = false
  dictionaryBubble.saved = false
  dictionaryBubble.left = Math.max(12, Math.round(Math.min(rect.left, window.innerWidth - 360)))
  dictionaryBubble.top = Math.max(12, Math.round(rect.bottom + 8))
  dictionaryBubble.visible = true
  currentHighlightNode = highlight
  try {
    await ensureReviewDictionaryRuntime()
  } catch (error) {
    console.warn('加载阅读高亮词典失败:', error)
  }
  if (currentHighlightNode !== highlight || !dictionaryBubble.visible) {
    return
  }
  const lookup = lookupLocalWord(term)
  applyDictionaryLookupToBubble(lookup, term)
}

function resolveRuntimeAssetUrl(relativePath) {
  const normalized = String(relativePath || '').replace(/^\/+/, '')
  try {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.pathname.includes('/dist/writing/')) {
      return new URL(`../../${normalized}`, currentUrl.href).href
    }
  } catch (_) {}
  return `/${normalized}`
}

function loadRuntimeScript(relativePath) {
  if (runtimeScriptPromises.has(relativePath)) return runtimeScriptPromises.get(relativePath)
  const existing = document.querySelector(`script[data-reading-runtime-script="${relativePath}"]`)
  if (existing) {
    const promise = Promise.resolve()
    runtimeScriptPromises.set(relativePath, promise)
    return promise
  }
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = resolveRuntimeAssetUrl(relativePath)
    script.async = false
    script.dataset.readingRuntimeScript = relativePath
    script.onload = () => resolve()
    script.onerror = () => {
      runtimeScriptPromises.delete(relativePath)
      reject(new Error(`加载阅读运行时脚本失败：${relativePath}`))
    }
    document.head.appendChild(script)
  })
  runtimeScriptPromises.set(relativePath, promise)
  return promise
}

function ensureReviewDictionaryRuntime() {
  if (
    window.DictionaryService?.lookup
    && window.__LOCAL_DICTIONARIES__?.ecdict?.entries?.length
    && window.__EMBEDDED_WORDLISTS__?.ielts_core?.length
  ) {
    return Promise.resolve()
  }
  if (!reviewDictionaryRuntimePromise) {
    reviewDictionaryRuntimePromise = Promise.all(DICTIONARY_WORDLIST_SCRIPTS.map(loadRuntimeScript))
      .then(() => loadRuntimeScript(DICTIONARY_SERVICE_SCRIPT))
      .then(() => {
        window.DictionaryService?.init?.()
      })
      .catch((error) => {
        reviewDictionaryRuntimePromise = null
        throw error
      })
  }
  return reviewDictionaryRuntimePromise
}

function formatDictionaryLookupMeaning(result) {
  if (!result || typeof result !== 'object') {
    return ''
  }
  if (Array.isArray(result.parts) && result.parts.length) {
    return result.parts
      .map((part) => {
        const label = normalizeComparableText(part.term || part.lemma || part.requested)
        const meaning = normalizeComparableText(part.zh || part.meaning || part.en || part.definition)
        return [label, meaning].filter(Boolean).join(': ')
      })
      .filter(Boolean)
      .join('；')
  }
  return normalizeComparableText(result.zh || result.meaning || result.en || result.definition || result.example)
}

function formatDictionaryLookupMeta(result) {
  if (!result || typeof result !== 'object') {
    return ''
  }
  return [
    result.phonetic ? `/${normalizeComparableText(result.phonetic)}/` : '',
    normalizeComparableText(result.pos || result.partOfSpeech),
    normalizeComparableText(result.sourceLabel || (result.source === 'ecdict' ? 'ECDICT' : '本地词典'))
  ].filter(Boolean).join(' · ')
}

function normalizeDictionaryLookupPart(part) {
  if (!part || typeof part !== 'object') {
    return null
  }
  const term = normalizeComparableText(part.term || part.lemma || part.requested)
  const meaning = normalizeComparableText(part.zh || part.meaning)
  const definition = normalizeComparableText(part.en || part.definition)
  if (!term && !meaning && !definition) {
    return null
  }
  return {
    term: term || '高亮词',
    meta: formatDictionaryLookupMeta(part),
    meaning,
    definition
  }
}

function normalizeDictionaryLookupResult(result, fallbackTerm) {
  if (!result || typeof result !== 'object') {
    return {
      found: false,
      term: normalizeComparableText(fallbackTerm),
      meaning: '',
      definition: '',
      example: '',
      meta: '本地词典',
      sourceLine: '',
      parts: [],
      phonetic: '',
      partOfSpeech: '',
      sourceLabel: '本地词典',
      license: ''
    }
  }
  const parts = Array.isArray(result.parts)
    ? result.parts.map(normalizeDictionaryLookupPart).filter(Boolean)
    : []
  const sourceLabel = normalizeComparableText(result.sourceLabel || (result.source === 'ecdict' ? 'ECDICT' : '本地词典'))
  const license = normalizeComparableText(result.license)
  return {
    found: Boolean(result.found),
    term: normalizeComparableText(result.term || result.lemma || result.requested || fallbackTerm),
    meaning: normalizeComparableText(result.zh || result.meaning),
    definition: normalizeComparableText(result.en || result.definition),
    example: normalizeComparableText(result.example),
    meta: parts.length ? '' : formatDictionaryLookupMeta({ ...result, sourceLabel }),
    sourceLine: sourceLabel ? [sourceLabel, license].filter(Boolean).join(' · ') : '',
    parts,
    phonetic: normalizeComparableText(result.phonetic),
    partOfSpeech: normalizeComparableText(result.pos || result.partOfSpeech),
    sourceLabel,
    license
  }
}

function applyDictionaryLookupToBubble(lookup, fallbackTerm) {
  const normalized = normalizeDictionaryLookupResult(lookup, fallbackTerm)
  dictionaryBubble.term = normalized.term || normalizeComparableText(fallbackTerm)
  dictionaryBubble.meaning = normalized.meaning || (normalized.parts.length ? '' : normalized.definition)
  dictionaryBubble.definition = normalized.parts.length ? '' : normalized.definition
  dictionaryBubble.example = normalized.example
  dictionaryBubble.meta = normalized.meta || (normalized.found ? normalized.sourceLabel : '本地词典')
  dictionaryBubble.sourceLine = normalized.sourceLine
  dictionaryBubble.parts = normalized.parts
  dictionaryBubble.phonetic = normalized.phonetic
  dictionaryBubble.partOfSpeech = normalized.partOfSpeech
  dictionaryBubble.sourceLabel = normalized.sourceLabel
  dictionaryBubble.license = normalized.license
  dictionaryBubble.found = normalized.found
}

function lookupLocalWord(term) {
  const normalized = normalizeComparableText(term)
  try {
    const service = window.DictionaryService
    if (service?.lookup) {
      const result = service.lookup(normalized)
      if (result?.found) {
        return normalizeDictionaryLookupResult(result, normalized)
      }
    }
  } catch (_) {}
  const list = readVocabFallbackList()
  const existing = list.words.find((word) => String(word.word || '').trim().toLowerCase() === normalized.toLowerCase())
  return existing
    ? normalizeDictionaryLookupResult({
      found: true,
      term: existing.word,
      meaning: existing.meaning || existing.definition || existing.note || '',
      example: existing.example || '',
      sourceLabel: '本地生词本'
    }, normalized)
    : normalizeDictionaryLookupResult({ found: false, term: normalized }, normalized)
}

function readVocabFallbackList() {
  try {
    const raw = window.localStorage?.getItem(VOCAB_FALLBACK_STORAGE_KEY)
    if (!raw) return { words: [] }
    const parsed = JSON.parse(raw)
    const data = parsed && Object.prototype.hasOwnProperty.call(parsed, 'data') ? parsed.data : parsed
    return data && typeof data === 'object' && Array.isArray(data.words) ? data : { words: [] }
  } catch (_) {
    return { words: [] }
  }
}

function writeVocabFallbackList(list) {
  try {
    window.localStorage?.setItem(VOCAB_FALLBACK_STORAGE_KEY, JSON.stringify({
      data: list,
      timestamp: Date.now(),
      version: '1.0.0',
      compressed: false
    }))
    return true
  } catch (_) {
    return false
  }
}

function saveDictionaryBubbleWord() {
  const word = normalizeComparableText(dictionaryBubble.term)
  if (!word) return
  const now = new Date().toISOString()
  const list = readVocabFallbackList()
  const normalizedKey = word.toLowerCase()
  const existingIndex = list.words.findIndex((entry) => String(entry.word || '').trim().toLowerCase() === normalizedKey)
  const record = {
    id: `reading-highlight-${normalizedKey.replace(/[^a-z0-9]+/g, '-')}`,
    word,
    meaning: dictionaryBubble.meaning || dictionaryBubble.definition || '待补充释义',
    example: dictionaryBubble.example || '',
    note: [
      dictionaryBubble.phonetic ? `音标: ${dictionaryBubble.phonetic}` : '',
      dictionaryBubble.partOfSpeech ? `词性: ${dictionaryBubble.partOfSpeech}` : '',
      dictionaryBubble.sourceLabel ? `来源: ${dictionaryBubble.sourceLabel}` : '来源: 阅读高亮',
      dictionaryBubble.license ? `许可: ${dictionaryBubble.license}` : ''
    ].filter(Boolean).join('；'),
    timestamp: Date.now(),
    source: 'reading-highlight',
    createdAt: existingIndex >= 0 ? list.words[existingIndex].createdAt || now : now,
    updatedAt: now
  }
  if (existingIndex >= 0) {
    list.words.splice(existingIndex, 1, { ...list.words[existingIndex], ...record })
  } else {
    list.words.push(record)
  }
  list.id = list.id || 'reading-highlights'
  list.name = list.name || '阅读高亮生词'
  list.source = list.source || 'reading-highlight'
  list.updatedAt = now
  dictionaryBubble.saved = writeVocabFallbackList(list)
}

async function submitAnswers() {
  if (!canSubmit.value) {
    return
  }
  submitting.value = true
  submitError.value = ''
  snapshotMessage.value = ''
  flushActiveQuestionVisit()
  stopPracticeTimer()
  try {
    const timerSnapshot = getPracticeTimerSnapshot()
    const timing = resolvePracticeTiming(1, timerSnapshot)
    const endTime = new Date(timing.endTimeMs).toISOString()
    const effectiveEndTime = new Date(timing.effectiveEndTimeMs).toISOString()
    const durationSec = timing.duration
    const attempt = {
      answers: Object.fromEntries(Object.entries(answers)),
      markedQuestions: markedQuestions.value.slice(),
      highlights: snapshotHighlights(),
      questionTimelineLite: buildQuestionTimelineLite(),
      interactionCount: interactionCount.value,
      startTime: new Date(timing.startTimeMs).toISOString(),
      endTime,
      durationSec,
      timerSnapshot,
      effectiveEndTime,
      effectiveEndTimeMs: timing.effectiveEndTimeMs,
      scrollY: getCurrentScrollY()
    }
    const result = activeSuiteSessionId.value
      ? await practiceReadingSuite.submitPassage(activeSuiteSessionId.value, asset.value.id, { attempt })
      : await practiceSessions.create({
        activity: 'reading',
        assetId: asset.value.id,
        attempt
      })
    submission.value = result?.submission || null
    suiteSession.value = result?.suiteSession || suiteSession.value
    if (submission.value?.answers) {
      Object.entries(submission.value.answers).forEach(([questionId, value]) => {
        assignAnswer(questionId, value)
      })
    }
    await nextTick()
    syncDomAnswers()
    setReadOnlyDomControls(true)
    restoreHighlightsFromRecords(submission.value?.highlights || submission.value?.analysisArtifacts?.highlights || highlightSnapshot.value)
    elapsedSeconds.value = Math.max(durationSec, Number(submission.value?.duration || 0))
    snapshotSubmission()
    const reviewPromise = runAutomaticReviewCoach({ expectedSessionId: submission.value?.sessionId })
    await reviewPromise
    maybeAdvanceSuitePassage()
    scheduleEndlessNext()
  } catch (submitFailure) {
    console.error('提交阅读练习失败:', submitFailure)
    submitError.value = submitFailure?.message
      ? `阅读提交失败：${submitFailure.message}`
      : '阅读提交失败，请稍后重试'
    if (!reviewMode.value) {
      startPracticeTimer()
    }
  } finally {
    submitting.value = false
  }
}

function snapshotSubmission() {
  if (!asset.value?.id || !submission.value) return
  try {
    window.sessionStorage?.setItem(`practice_reading_submission_${asset.value.id}`, JSON.stringify(submission.value))
  } catch (_) {
    // best-effort session cache
  }
}

function clearSubmissionSnapshot() {
  if (!asset.value?.id) return
  try {
    window.sessionStorage?.removeItem(`practice_reading_submission_${asset.value.id}`)
  } catch (_) {
    // best-effort session cache cleanup
  }
}

function clearEndlessTimer() {
  if (endlessTimer) {
    window.clearInterval(endlessTimer)
    endlessTimer = null
  }
  endlessCountdown.value = 0
}

function readEndlessState() {
  try {
    const parsed = JSON.parse(window.sessionStorage?.getItem(ENDLESS_STATE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function writeEndlessState(patch = {}) {
  const nextState = {
    ...readEndlessState(),
    ...patch,
    active: patch.active !== undefined ? Boolean(patch.active) : true,
    updatedAt: new Date().toISOString()
  }
  try {
    window.sessionStorage?.setItem(ENDLESS_STATE_KEY, JSON.stringify(nextState))
  } catch (_) {
    // best-effort continuity state
  }
  return nextState
}

async function getEndlessPool() {
  const state = readEndlessState()
  const storedPool = Array.isArray(state.pool)
    ? state.pool.filter((entry) => entry?.id)
    : []
  if (storedPool.length) {
    return storedPool
  }

  const result = await practiceAssets.listAll({ activity: 'reading' })
  const pool = Array.isArray(result?.data)
    ? result.data.filter((entry) => entry?.id).map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category
    }))
    : []
  if (pool.length) {
    writeEndlessState({ active: true, pool })
  }
  return pool
}

function pickNextEndlessAsset(pool) {
  const currentAssetId = String(asset.value?.id || route.params.assetId || '').trim()
  const candidates = pool.filter((entry) => String(entry.id || '').trim() && String(entry.id) !== currentAssetId)
  const usablePool = candidates.length ? candidates : pool
  return usablePool[Math.floor(Math.random() * usablePool.length)] || null
}

async function scheduleEndlessNext() {
  if (!isEndlessMode.value || activeSuiteSessionId.value) {
    return
  }
  try {
    const pool = await getEndlessPool()
    const nextAsset = pickNextEndlessAsset(pool)
    if (!nextAsset?.id) {
      stopEndlessMode()
      submitError.value = '无尽模式：题库为空，已退出。'
      return
    }
    endlessNextAssetId.value = String(nextAsset.id)
    writeEndlessState({
      active: true,
      currentAssetId: nextAsset.id,
      lastCompletedAssetId: asset.value?.id || route.params.assetId || '',
      pool
    })
    clearEndlessTimer()
    endlessCountdown.value = ENDLESS_COUNTDOWN_SEC
    endlessTimer = window.setInterval(() => {
      endlessCountdown.value -= 1
      if (endlessCountdown.value <= 0) {
        goToNextEndlessAsset()
      }
    }, 1000)
  } catch (error) {
    console.error('无尽模式续题失败:', error)
    submitError.value = error?.message ? `无尽模式续题失败：${error.message}` : '无尽模式续题失败，请返回总览重试'
  }
}

function findNextSuitePassage() {
  const sequence = Array.isArray(suiteSession.value?.sequence) ? suiteSession.value.sequence : []
  return sequence.find((entry) => entry?.status === 'active' && String(entry.assetId || '').trim() !== String(asset.value?.id || '').trim()) || null
}

function maybeAdvanceSuitePassage() {
  if (!activeSuiteSessionId.value || !suiteAutoAdvance.value) {
    return
  }
  const nextPassage = findNextSuitePassage()
  if (!nextPassage?.assetId) {
    return
  }
  router.push({
    name: 'PracticeReading',
    params: { assetId: nextPassage.assetId },
    query: { suiteSessionId: activeSuiteSessionId.value }
  })
}

function goToNextEndlessAsset() {
  const nextAssetId = String(endlessNextAssetId.value || '').trim()
  if (!nextAssetId) return
  clearEndlessTimer()
  router.push({
    name: 'PracticeReading',
    params: { assetId: nextAssetId },
    query: { mode: 'endless' }
  })
}

function stopEndlessMode() {
  clearEndlessTimer()
  endlessNextAssetId.value = ''
  try {
    window.sessionStorage?.removeItem(ENDLESS_STATE_KEY)
  } catch (_) {}
  router.push({
    name: 'PracticeLibrary'
  })
}

function startDividerDrag(event) {
  if (!event || (Number.isFinite(Number(event.button)) && event.button > 0)) {
    return
  }
  const shell = document.querySelector('.reading-workspace.shell')
  if (!shell) return
  event.preventDefault()
  dividerDragging.value = true
  dividerPointerId = event.pointerId
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  document.addEventListener('pointermove', handleDividerDrag)
  document.addEventListener('pointerup', stopDividerDrag)
  document.addEventListener('pointercancel', stopDividerDrag)
  handleDividerDrag(event)
}

function handleDividerDrag(event) {
  if (!dividerDragging.value || !event) {
    return
  }
  const shell = document.querySelector('.reading-workspace.shell')
  if (!shell) return
  const rect = shell.getBoundingClientRect()
  if (!rect.width) return
  const percent = ((event.clientX - rect.left) / rect.width) * 100
  leftPanePercent.value = Math.max(34, Math.min(66, percent))
}

function stopDividerDrag(event) {
  if (!dividerDragging.value) {
    return
  }
  dividerDragging.value = false
  const divider = document.getElementById('divider')
  try {
    if (divider && dividerPointerId != null) {
      divider.releasePointerCapture?.(dividerPointerId)
    } else if (divider && event?.pointerId != null) {
      divider.releasePointerCapture?.(event.pointerId)
    }
  } catch (_) {}
  dividerPointerId = null
  removeDividerDragListeners()
}

function removeDividerDragListeners() {
  document.removeEventListener('pointermove', handleDividerDrag)
  document.removeEventListener('pointerup', stopDividerDrag)
  document.removeEventListener('pointercancel', stopDividerDrag)
}

function handleDividerKeydown(event) {
  const step = event.shiftKey ? 8 : 3
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    leftPanePercent.value = Math.max(34, leftPanePercent.value - step)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    leftPanePercent.value = Math.min(66, leftPanePercent.value + step)
  } else if (event.key === 'Home') {
    event.preventDefault()
    leftPanePercent.value = 40
  } else if (event.key === 'End') {
    event.preventDefault()
    leftPanePercent.value = 60
  }
}

function handleResetButton() {
  if (isMemorizeMode.value) {
    router.push({
      name: 'PracticeReading',
      params: { assetId: asset.value?.id || props.assetId },
      query: activeSuiteSessionId.value ? { suiteSessionId: activeSuiteSessionId.value } : {}
    })
    return
  }
  if (canRecycleSubmittedAttempt.value) {
    recycleSubmittedAttempt()
    return
  }
  resetAnswers()
  restoreHighlightsFromRecords(highlightSnapshot.value)
}

function handlePrimaryButton() {
  if (isMemorizeMode.value) {
    router.push(returnRoute.value)
    return
  }
  submitAnswers()
}

function cloneAnswerValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean)
  }
  if (value == null) {
    return ''
  }
  return String(value).trim()
}

function applyMemorizeStudyLayer() {
  clearMemorizeLocatorHighlights()
  if (!isMemorizeMode.value || !payload.value?.answerKey) {
    return
  }
  Object.entries(payload.value.answerKey).forEach(([questionId, answer]) => {
    const text = formatReviewAnswer(answer)
    if (text) {
      applyMemorizeLocatorHighlights(questionId, text)
    }
  })
  setReadOnlyDomControls(true)
}

function applyMemorizeLocatorHighlights(questionId, answerText) {
  const root = document.getElementById('left')
  if (!root) return
  const tokens = String(answerText || '')
    .split(/[;,/|]/)
    .map((entry) => entry.replace(/^\s*[A-Z]\.\s*/, '').trim())
    .filter((entry) => entry.length >= 3)
    .slice(0, 3)
  tokens.forEach((token) => {
    wrapTextMatches(root, token, {
      className: 'memorize-locator-highlight',
      attrs: {
        'data-memorize-question-id': questionId
      },
      limit: 1,
      skipSelector: '.hl, .memorize-locator-highlight'
    })
  })
}

function clearMemorizeLocatorHighlights() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('.memorize-locator-highlight').forEach((node) => {
    const parent = node.parentNode
    if (!parent) return
    while (node.firstChild) {
      parent.insertBefore(node.firstChild, node)
    }
    parent.removeChild(node)
    parent.normalize()
  })
}

function wrapTextMatches(root, needle, options = {}) {
  const text = normalizeComparableText(needle)
  if (!root || text.length < 3) {
    return []
  }
  const matches = []
  const className = options.className || 'hl'
  const attrs = options.attrs || {}
  const limit = Math.max(1, Number(options.limit) || 20)
  const skipSelector = options.skipSelector || '.hl'
  const nodes = getTextNodes(root)
  for (let index = 0; index < nodes.length && matches.length < limit; index += 1) {
    let current = nodes[index]
    if (current.parentElement?.closest?.(skipSelector)) {
      continue
    }
    while (current && matches.length < limit) {
      const source = current.nodeValue || ''
      const hit = source.toLowerCase().indexOf(text.toLowerCase())
      if (hit < 0) break
      const matchedNode = current.splitText(hit)
      const remainder = matchedNode.splitText(text.length)
      const span = document.createElement('span')
      span.className = className
      Object.entries(attrs).forEach(([key, value]) => {
        if (value != null) {
          span.setAttribute(key, String(value))
        }
      })
      matchedNode.parentNode.insertBefore(span, matchedNode)
      span.appendChild(matchedNode)
      matches.push(span)
      current = remainder
    }
  }
  return matches
}

function normalizeCoachTranscript(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const snapshot = entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : null
      const content = String(entry.content || entry.text || snapshot?.answer || snapshot?.message || '').trim()
      if (!content) return null
      return {
        id: String(entry.id || entry.createdAt || `coach_${index}`),
        role: entry.role === 'assistant' ? 'assistant' : 'user',
        content,
        isError: Boolean(entry.isError),
        followUps: Array.isArray(entry.followUps)
          ? entry.followUps
          : (Array.isArray(snapshot?.followUps) ? snapshot.followUps : []),
        snapshot
      }
    })
    .filter(Boolean)
    .slice(-40)
}

function refreshSelectedContext() {
  const nextContext = readSelectedContext()
  if (nextContext) {
    selectedContext.value = nextContext
  }
  return selectedContext.value
}

function clearSelectedContext() {
  selectedContext.value = null
}

function readSelectedContext() {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return null
  }
  const selection = window.getSelection()
  const text = selection && typeof selection.toString === 'function'
    ? String(selection.toString() || '').trim()
    : ''
  if (!text) {
    return null
  }
  const element = resolveSelectionElement(selection)
  const questionNumbers = collectSelectedQuestionNumbers(element)
  const paragraphLabels = collectSelectedParagraphLabels(element)
  const scope = element?.closest?.('.question-panel, .question-group, [data-answer-question-id], [data-review-question-id]')
    ? 'question'
    : 'passage'
  return {
    text: text.slice(0, 500),
    scope,
    questionNumbers,
    paragraphLabels
  }
}

function resolveSelectionElement(selection) {
  const nodes = [selection?.anchorNode, selection?.focusNode].filter(Boolean)
  for (const node of nodes) {
    const element = node.nodeType === 3 ? node.parentElement : node
    if (element && typeof element.closest === 'function') {
      return element
    }
  }
  return null
}

function normalizeCoachQuestionNumber(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const exactNumber = raw.match(/^\d+$/)
  const qNumber = raw.match(/\bq(\d+)\b/i) || raw.match(/^q(\d+)/i)
  const numeric = exactNumber?.[0] || qNumber?.[1] || ''
  if (!numeric) return ''
  const questionId = `q${Number(numeric)}`
  return String(getDisplayLabel(questionId) || numeric).replace(/^q/i, '').trim()
}

function collectSelectedQuestionNumbers(element) {
  if (!element || typeof element.closest !== 'function') {
    return []
  }
  const candidates = []
  const direct = element.closest('[data-answer-question-id], [data-review-question-id], [data-question-ids], [data-question], [data-question-id], [name], [id]')
  if (direct?.dataset?.questionIds) {
    candidates.push(...String(direct.dataset.questionIds).split(','))
  }
  if (direct?.dataset?.answerQuestionId) {
    candidates.push(direct.dataset.answerQuestionId)
  }
  if (direct?.dataset?.reviewQuestionId) {
    candidates.push(direct.dataset.reviewQuestionId)
  }
  if (direct?.dataset?.question) {
    candidates.push(direct.dataset.question)
  }
  if (direct?.dataset?.questionId) {
    candidates.push(direct.dataset.questionId)
  }
  const name = direct?.getAttribute?.('name')
  if (name) candidates.push(name)
  if (direct?.id) candidates.push(direct.id)

  const group = element.closest('[data-question-ids]')
  if (group?.dataset?.questionIds) {
    candidates.push(...String(group.dataset.questionIds).split(','))
  }
  return Array.from(new Set(candidates.map(normalizeCoachQuestionNumber).filter(Boolean)))
}

function collectSelectedParagraphLabels(element) {
  if (!element || typeof element.closest !== 'function') {
    return []
  }
  const labels = []
  const paragraph = element.closest('[data-paragraph], [data-paragraph-label], .passage-block, .paragraph-wrapper')
  if (paragraph?.dataset?.paragraph) {
    labels.push(paragraph.dataset.paragraph)
  }
  if (paragraph?.dataset?.paragraphLabel) {
    labels.push(paragraph.dataset.paragraphLabel)
  }
  const text = String(paragraph?.textContent || element.textContent || '').trim()
  const match = text.match(/^(?:paragraph\s*)?([A-H])\b/i)
  if (match?.[1]) {
    labels.push(match[1])
  }
  return Array.from(new Set(labels.map((item) => String(item || '').replace(/^paragraph\s*/i, '').trim().toUpperCase()).filter(Boolean)))
}

function resolveCoachWrongQuestions() {
  const fromCoachContext = Array.isArray(submission.value?.coachContext?.wrongQuestions)
    ? submission.value.coachContext.wrongQuestions
    : []
  if (fromCoachContext.length) {
    return fromCoachContext.map((item) => String(item || '').trim()).filter(Boolean)
  }
  return Object.values(submission.value?.answerComparison || {})
    .filter((entry) => entry?.isCorrect === false)
    .map((entry) => String(entry.displayLabel || getDisplayLabel(entry.questionId)).replace(/^q/i, '').trim())
    .filter(Boolean)
}

function resolveCoachSelectedAnswers() {
  const fromCoachContext = submission.value?.coachContext?.selectedAnswers
  if (fromCoachContext && typeof fromCoachContext === 'object') {
    return Object.fromEntries(
      Object.entries(fromCoachContext)
        .map(([questionNumber, answer]) => [String(questionNumber).replace(/^q/i, '').trim(), formatReviewAnswer(answer)])
        .filter(([questionNumber, answer]) => questionNumber && answer)
    )
  }
  return Object.values(submission.value?.answerComparison || {}).reduce((accumulator, entry) => {
    const questionNumber = String(entry?.displayLabel || getDisplayLabel(entry?.questionId)).replace(/^q/i, '').trim()
    const answer = formatReviewAnswer(entry?.userAnswer)
    if (questionNumber && answer) {
      accumulator[questionNumber] = answer
    }
    return accumulator
  }, {})
}

function resolveCoachFocusQuestionNumbers(context = selectedContext.value) {
  if (Array.isArray(context?.questionNumbers) && context.questionNumbers.length) {
    return context.questionNumbers
  }
  const wrongQuestions = resolveCoachWrongQuestions()
  if (wrongQuestions.length) {
    return wrongQuestions.slice(0, 3)
  }
  if (typeof document !== 'undefined') {
    const active = document.activeElement
    const raw = active?.getAttribute?.('name') || active?.id || ''
    const focused = normalizeCoachQuestionNumber(raw)
    if (focused) return [focused]
  }
  return []
}

function resolveCoachMode() {
  if (activeSuiteSessionId.value) return 'suite'
  if (isEndlessMode.value) return 'endless'
  return props.sessionId || route.params.sessionId ? 'review' : 'single'
}

function buildCoachPayload(query, options = {}) {
  flushActiveQuestionVisit()
  const action = String(options.action || 'chat').trim() || 'chat'
  const surface = String(options.surface || (action === 'review_set' ? 'review_workspace' : 'chat_widget')).trim()
  const promptKind = String(options.promptKind || 'freeform').trim() || 'freeform'
  const context = refreshSelectedContext()
  return {
    examId: submission.value?.examId || asset.value?.id || props.assetId,
    sessionId: submission.value?.sessionId || '',
    mode: resolveCoachMode(),
    query: String(query || '').trim(),
    locale: 'zh',
    surface,
    action,
    promptKind,
    selectedText: context?.text || '',
    selectedContext: context || null,
    focusQuestionNumbers: resolveCoachFocusQuestionNumbers(context),
    history: coachTranscript.value
      .map((entry) => ({ role: entry.role, content: entry.content }))
      .filter((entry) => entry.content.trim())
      .slice(-8),
    attemptContext: {
      submitted: true,
      score: submission.value?.coachContext?.score ?? submission.value?.scoreInfo?.percentage ?? null,
      wrongQuestions: resolveCoachWrongQuestions(),
      selectedAnswers: resolveCoachSelectedAnswers(),
      analysisSignals: submission.value?.analysisSignals || submission.value?.analysisArtifacts?.analysisSignals || null,
      markedQuestions: Array.isArray(submission.value?.markedQuestions) ? submission.value.markedQuestions : [],
      questionTimelineLite: Array.isArray(submission.value?.questionTimelineLite) ? submission.value.questionTimelineLite : [],
      questionTypePerformance: submission.value?.questionTypePerformance || {}
    }
  }
}

function resolveCoachPresetQuery(action) {
  const focusNumbers = resolveCoachFocusQuestionNumbers()
  const focusText = focusNumbers.length ? `（重点看 Q${focusNumbers.join(', Q')}）` : ''
  if (action === 'hint') {
    return `给我当前题目的提示，不要直接给答案${focusText}`.trim()
  }
  if (action === 'explain') {
    return `解释当前题该如何定位证据并排除干扰项${focusText}`.trim()
  }
  if (action === 'review') {
    return `${AUTOMATIC_REVIEW_QUERY}${focusText}`.trim()
  }
  if (action === 'similar') {
    return `推荐与我薄弱题型类似的训练方向${focusText}`.trim()
  }
  return ''
}

function appendLocalCoachError(message) {
  if (!submission.value) return
  const transcript = Array.isArray(submission.value.readingCoachTranscript)
    ? submission.value.readingCoachTranscript.slice()
    : []
  transcript.push({
    role: 'assistant',
    content: String(message || '阅读教练请求失败').trim(),
    createdAt: new Date().toISOString(),
    isError: true
  })
  submission.value = {
    ...submission.value,
    readingCoachTranscript: transcript
  }
}

async function askCoach() {
  if (!canAskCoach.value) {
    return
  }
  const query = coachQuery.value.trim()
  await sendCoachQuery(query, {
    surface: 'chat_widget',
    action: 'chat',
    promptKind: 'freeform'
  })
}

async function askCoachFollowUp(query) {
  await sendCoachQuery(query, {
    surface: 'chat_widget',
    action: 'chat',
    promptKind: 'followup'
  })
}

async function runCoachQuickAction(actionId) {
  const action = String(actionId || '').trim()
  if (action === 'review') {
    await runAutomaticReviewCoach()
    return
  }
  const query = resolveCoachPresetQuery(action)
  if (!query) return
  await sendCoachQuery(query, {
    surface: 'chat_widget',
    action: action === 'similar' ? 'recommend_drills' : 'chat',
    promptKind: 'preset'
  })
}

async function runCoachSelectionAction(actionId) {
  refreshSelectedContext()
  if (!selectedContext.value?.text) {
    coachError.value = '请先选中题干或原文片段。'
    return
  }
  const action = String(actionId || 'explain_selection').trim()
  const queryMap = {
    explain_selection: '解释我选中的内容，并说明它和题目定位有什么关系',
    locate_evidence: '根据我选中的内容定位相关证据',
    find_paraphrases: '找出我选中内容里的同义替换和关键词'
  }
  await sendCoachQuery(queryMap[action] || queryMap.explain_selection, {
    surface: 'selection_popover',
    action,
    promptKind: 'preset'
  })
}

function formatCoachStreamMessage(streamEvent, mode = 'coach') {
  const eventName = String(streamEvent?.event || streamEvent?.type || '').trim()
  const payload = streamEvent?.data && typeof streamEvent.data === 'object' ? streamEvent.data : {}
  const detail = payload.data && typeof payload.data === 'object' ? payload.data : payload
  if (eventName === 'start') return mode === 'review' ? 'AI 复盘已启动...' : '教练已连接...'
  if (eventName === 'cache_hit') return '命中已缓存复盘上下文...'
  if (eventName === 'route') return '正在判断问题意图...'
  if (eventName === 'retrieval') {
    const chunkCount = Number(detail.chunkCount || 0)
    return chunkCount > 0 ? `RAG 已检索 ${chunkCount} 条证据...` : 'RAG 正在检索证据...'
  }
  if (eventName === 'generation_start') return mode === 'review' ? '正在生成错因复盘...' : '正在生成教练回答...'
  if (eventName === 'model_delta') return mode === 'review' ? '正在写入复盘结论...' : '正在组织回答...'
  if (eventName === 'generation_complete') return mode === 'review' ? '复盘生成完成，正在落库...' : '回答生成完成，正在同步记录...'
  if (eventName === 'complete') return mode === 'review' ? 'AI 复盘已更新' : '教练已返回结果'
  if (eventName === 'generation_error' || eventName === 'error') return mode === 'review' ? 'AI 复盘失败' : '教练请求失败'
  return ''
}

function handleCoachStreamEvent(streamEvent, { expectedSessionId, mode = 'coach' } = {}) {
  if (!isCurrentSubmission(expectedSessionId)) return
  const nextMessage = formatCoachStreamMessage(streamEvent, mode)
  if (!nextMessage) return
  if (mode === 'review') {
    llmReviewMessage.value = nextMessage
  } else {
    coachStreamMessage.value = nextMessage
  }
}

async function sendCoachQuery(query, options = {}) {
  const normalizedQuery = String(query || '').trim()
  if (!submission.value?.sessionId || !normalizedQuery || coachLoading.value) {
    return null
  }
  const expectedSessionId = String(submission.value.sessionId || '').trim()
  const requestId = ++coachRequestSequence
  coachLoading.value = true
  coachError.value = ''
  coachResponse.value = null
  coachStreamMessage.value = '教练已连接...'
  try {
    const requestPayload = buildCoachPayload(normalizedQuery, options)
    const response = await practiceCoach.query('reading', requestPayload, expectedSessionId, {
      onEvent: (event) => handleCoachStreamEvent(event, { expectedSessionId, mode: 'coach' })
    })
    if (!isCurrentSubmission(expectedSessionId)) {
      return response
    }
    coachResponse.value = response
    const refreshedSubmission = await refreshSubmissionFromHistory(expectedSessionId)
    if (!refreshedSubmission) {
      mergeCoachResultIntoSubmission(
        response,
        normalizedQuery,
        response?.singleAttemptAnalysisLlm || null,
        requestPayload,
        expectedSessionId
      )
    }
    snapshotSubmission()
    return response
  } catch (coachFailure) {
    console.error('阅读教练请求失败:', coachFailure)
    if (!isCurrentSubmission(expectedSessionId)) {
      return null
    }
    coachError.value = coachFailure?.message
      ? `阅读教练请求失败：${coachFailure.message}`
      : '阅读教练请求失败，请稍后重试'
    const refreshedSubmission = await refreshSubmissionFromHistory(expectedSessionId, { preserveCoachResponse: false })
    if (!refreshedSubmission) {
      appendLocalCoachError(coachError.value)
    }
    snapshotSubmission()
    return null
  } finally {
    if (coachRequestSequence === requestId && isCurrentSubmission(expectedSessionId)) {
      coachLoading.value = false
      coachStreamMessage.value = ''
    }
  }
}

async function runAutomaticReviewCoach(options = {}) {
  const expectedSessionId = String(options.expectedSessionId || submission.value?.sessionId || '').trim()
  if (!expectedSessionId || llmReviewStatus.value === 'running') {
    return
  }
  if (!isCurrentSubmission(expectedSessionId)) {
    return
  }
  if (singleAttemptAnalysisLlm.value && !options.force) {
    llmReviewStatus.value = 'success'
    llmReviewMessage.value = 'AI 复盘已更新'
    return
  }

  llmReviewStatus.value = 'running'
  llmReviewMessage.value = 'AI 正在复盘错题...'
  try {
    const requestPayload = buildCoachPayload(AUTOMATIC_REVIEW_QUERY, {
      surface: 'review_workspace',
      action: 'review_set',
      promptKind: 'preset'
    })
    const response = await practiceCoach.query('reading', requestPayload, expectedSessionId, {
      onEvent: (event) => handleCoachStreamEvent(event, { expectedSessionId, mode: 'review' })
    })
    if (!isCurrentSubmission(expectedSessionId)) {
      return
    }
    const llmPatch = response?.singleAttemptAnalysisLlm || null
    coachResponse.value = response
    const refreshedSubmission = await refreshSubmissionFromHistory(expectedSessionId)
    if (!refreshedSubmission) {
      mergeCoachResultIntoSubmission(response, AUTOMATIC_REVIEW_QUERY, llmPatch, requestPayload, expectedSessionId)
    }
    llmReviewStatus.value = 'success'
    llmReviewMessage.value = 'AI 复盘已更新'
    snapshotSubmission()
  } catch (reviewFailure) {
    console.error('自动阅读复盘失败:', reviewFailure)
    if (!isCurrentSubmission(expectedSessionId)) {
      return
    }
    llmReviewStatus.value = 'failed'
    llmReviewMessage.value = formatLlmFailureStatusMessage(reviewFailure)
    const refreshedSubmission = await refreshSubmissionFromHistory(expectedSessionId, { preserveCoachResponse: false })
    if (!refreshedSubmission) {
      appendLocalCoachError(llmReviewMessage.value)
    }
    snapshotSubmission()
  }
}

function queueAutomaticReviewRefresh(sessionId) {
  const expectedSessionId = String(sessionId || '').trim()
  if (!expectedSessionId) return
  Promise.resolve().then(() => {
    if (!isCurrentSubmission(expectedSessionId) || singleAttemptAnalysisLlm.value || llmReviewStatus.value === 'running') {
      return null
    }
    return runAutomaticReviewCoach({ expectedSessionId })
  }).catch((refreshFailure) => {
    console.warn('补全阅读回放 AI 复盘失败:', refreshFailure)
  })
}

function isCurrentSubmission(expectedSessionId) {
  const normalized = String(expectedSessionId || '').trim()
  return Boolean(normalized && String(submission.value?.sessionId || '').trim() === normalized)
}

async function refreshSubmissionFromHistory(expectedSessionId, options = {}) {
  if (!isCurrentSubmission(expectedSessionId)) {
    return null
  }
  try {
    const state = await practiceSessions.getState('reading', expectedSessionId)
    const refreshedSubmission = state?.submission || null
    if (!refreshedSubmission || !isCurrentSubmission(expectedSessionId)) {
      return null
    }
    submission.value = refreshedSubmission
    coachResponse.value = refreshedSubmission.readingCoachSnapshot || (options.preserveCoachResponse === false ? null : coachResponse.value)
    restoreSubmittedMetadata(refreshedSubmission)
    if (refreshedSubmission.answers) {
      Object.entries(refreshedSubmission.answers).forEach(([questionId, value]) => {
        assignAnswer(questionId, value)
      })
    }
    return refreshedSubmission
  } catch (refreshFailure) {
    console.warn('刷新阅读教练持久化状态失败:', refreshFailure)
    return null
  }
}

function mergeCoachResultIntoSubmission(response, query, llmPatch = null, meta = {}, expectedSessionId = '') {
  if (!submission.value || (expectedSessionId && !isCurrentSubmission(expectedSessionId))) {
    return
  }
  const snapshot = response && typeof response === 'object' ? response : { value: response }
  const now = new Date().toISOString()
  const transcript = Array.isArray(submission.value.readingCoachTranscript)
    ? submission.value.readingCoachTranscript.slice()
    : []
  const normalizedQuery = String(query || '').trim()
  if (normalizedQuery) {
    transcript.push({
      role: 'user',
      content: normalizedQuery,
      createdAt: now,
      surface: String(meta.surface || 'review_workspace'),
      action: String(meta.action || 'review_set')
    })
  }
  transcript.push({
    role: 'assistant',
    content: String(snapshot.answer || snapshot.message || '').trim(),
    createdAt: now,
    snapshot
  })

  const nextSubmission = {
    ...submission.value,
    readingCoachSnapshot: snapshot,
    readingCoachTranscript: transcript
  }
  if (llmPatch && typeof llmPatch === 'object') {
    nextSubmission.singleAttemptAnalysisLlm = llmPatch
    nextSubmission.analysisArtifacts = {
      ...(submission.value.analysisArtifacts || {}),
      singleAttemptAnalysisLlm: llmPatch
    }
  }
  submission.value = nextSubmission
}

function formatLlmFailureStatusMessage(error) {
  const code = String(error?.code || '').trim().toLowerCase()
  const rawMessage = String(error?.message || '').trim()
  if (code === 'coach_locked_until_submit') {
    return 'AI 复盘暂不可用：请先完成并提交本轮作答。'
  }
  if (code === 'local_api_unavailable') {
    return 'AI 复盘暂不可用：未发现本地服务。'
  }
  if (code === 'invalid_response_format') {
    return 'AI 复盘暂不可用：服务返回格式异常。'
  }
  if (rawMessage && rawMessage.length <= 140 && !/failed to fetch|http:|https:|file:/i.test(rawMessage)) {
    return `AI 复盘暂不可用：${rawMessage}`
  }
  return 'AI 复盘暂不可用，请稍后重试。'
}

function getReviewEntry(questionId) {
  return submission.value?.answerComparison?.[questionId] || null
}

function getReviewClass(questionId) {
  const entry = getReviewEntry(questionId)
  if (!entry) return ''
  if (entry.isCorrect === true) return 'review-correct'
  if (entry.isCorrect === false) return 'review-incorrect'
  return 'review-neutral'
}

function getLegacyNavStatus(questionId) {
  const entry = getReviewEntry(questionId)
  if (entry?.isCorrect === true) return 'correct'
  if (entry?.isCorrect === false) return 'incorrect'
  return hasAnswer(questionId) ? 'answered' : ''
}

function scrollToQuestion(questionId) {
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return
  recordQuestionVisit(normalized)
  const aliases = resolveAnswerAliases(normalized).map((entry) => escapeCss(entry))
  const directSelectors = aliases.flatMap((alias) => [
    `#${alias}-anchor`,
    `.question-panel [data-question="${alias}"]`,
    `.question-panel [data-question-id="${alias}"]`,
    `.question-panel [name="${alias}"]`
  ])
  const directTarget = directSelectors
    .map((selector) => document.querySelector(selector))
    .find(Boolean)
  if (directTarget) {
    directTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }
  const groupTarget = Array.from(document.querySelectorAll('.question-panel [data-question-ids]')).find((group) => {
    const ids = String(group.dataset.questionIds || '')
      .split(',')
      .map((entry) => normalizeQuestionId(entry))
      .filter(Boolean)
    return ids.includes(normalized)
  })
  groupTarget?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

function getReviewLabel(questionId) {
  const entry = getReviewEntry(questionId)
  if (!entry) return ''
  if (entry.isCorrect === true) return '正确'
  if (entry.isCorrect === false) return '错误'
  return '未判定'
}

function formatReviewAnswer(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean).join(' / ')
  }
  return String(value == null ? '' : value).trim()
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(totalSeconds / 60)
  const rest = totalSeconds % 60
  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`
}

function formatClock(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(totalSeconds / 60)
  const rest = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function formatDensity(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0'
}

function getSeverityLabel(severity) {
  const labels = {
    high: '高',
    medium: '中',
    low: '低'
  }
  return labels[severity] || '提示'
}

function getAnswerFingerprint(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean).sort().join('|')
  }
  return String(value || '').trim()
}

function getOrCreateQuestionTimelineEntry(questionId) {
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return null
  const current = answerTimeline[normalized] || {
    firstAnsweredAt: null,
    lastAnsweredAt: null,
    changeCount: 0,
    visitCount: 0,
    elapsedMs: 0,
    lastFingerprint: getAnswerFingerprint(answers[normalized])
  }
  current.changeCount = Math.max(0, Number(current.changeCount) || 0)
  current.visitCount = Math.max(0, Number(current.visitCount) || 0)
  current.elapsedMs = Math.max(0, Number(current.elapsedMs) || 0)
  answerTimeline[normalized] = current
  return current
}

function flushActiveQuestionVisit(nowMs = Date.now()) {
  const questionId = activeQuestionVisit.questionId
  const startedAtMs = Number(activeQuestionVisit.startedAtMs) || 0
  if (!questionId || !startedAtMs || nowMs <= startedAtMs) {
    return
  }
  const entry = getOrCreateQuestionTimelineEntry(questionId)
  if (!entry) return
  entry.elapsedMs = Math.max(0, Number(entry.elapsedMs) || 0) + Math.max(0, nowMs - startedAtMs)
  activeQuestionVisit.startedAtMs = nowMs
}

function recordQuestionVisit(questionId) {
  if (reviewMode.value) {
    return
  }
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return
  const nowMs = Date.now()
  if (activeQuestionVisit.questionId && activeQuestionVisit.questionId !== normalized) {
    flushActiveQuestionVisit(nowMs)
  }
  const entry = getOrCreateQuestionTimelineEntry(normalized)
  if (!entry) return
  if (activeQuestionVisit.questionId !== normalized) {
    entry.visitCount += 1
    activeQuestionVisit.questionId = normalized
  }
  activeQuestionVisit.startedAtMs = nowMs
}

function recordInteraction() {
  if (!reviewMode.value) {
    interactionCount.value += 1
  }
}

function recordAnswerTimeline(questionId, previousFingerprint, nextFingerprint) {
  const changed = previousFingerprint !== nextFingerprint
  if (!changed) {
    return
  }
  recordInteraction()
  const now = new Date().toISOString()
  recordQuestionVisit(questionId)
  const current = getOrCreateQuestionTimelineEntry(questionId)
  if (!current) return
  if (nextFingerprint && !current.firstAnsweredAt) {
    current.firstAnsweredAt = now
  }
  if (nextFingerprint) {
    current.lastAnsweredAt = now
  }
  if (current.lastFingerprint && current.lastFingerprint !== nextFingerprint) {
    current.changeCount += 1
  }
  current.lastFingerprint = nextFingerprint
  answerTimeline[questionId] = current
}

function buildQuestionTimelineLite() {
  flushActiveQuestionVisit()
  const order = Array.isArray(payload.value?.questionOrder) ? payload.value.questionOrder : []
  return order.map((questionId) => {
    const entry = answerTimeline[questionId] || {}
    const elapsedMs = Math.max(0, Math.round(Number(entry.elapsedMs) || 0))
    return {
      questionId,
      displayLabel: getDisplayLabel(questionId),
      firstAnsweredAt: entry.firstAnsweredAt || null,
      lastAnsweredAt: entry.lastAnsweredAt || null,
      changeCount: Math.max(0, Number(entry.changeCount) || 0),
      visitCount: Math.max(0, Number(entry.visitCount) || 0),
      elapsedMs,
      durationMs: elapsedMs
    }
  })
}

function normalizeOfficialQuestionExplanationSection(section, index) {
  const rawItems = Array.isArray(section?.items) ? section.items : []
  const items = rawItems
    .map((item) => {
      const questionNumber = Number(item?.questionNumber)
      const text = String(item?.text || '').trim()
      if (!Number.isFinite(questionNumber) || !text) return null
      return {
        questionNumber,
        questionId: normalizeQuestionId(item?.questionId || questionNumber),
        text
      }
    })
    .filter(Boolean)
  const text = String(section?.text || '').trim()
  if (!items.length && !text) return null
  return {
    sectionTitle: String(section?.sectionTitle || `题目讲解 ${index + 1}`).trim(),
    mode: String(section?.mode || '').trim(),
    questionRange: normalizeOfficialQuestionRange(section?.questionRange),
    text,
    items
  }
}

function normalizeOfficialQuestionRange(range) {
  const start = Number(range?.start)
  const end = Number(range?.end)
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null
}

function getQuestionOfficialNumber(questionId) {
  const normalized = normalizeQuestionId(questionId)
  const displayNumber = Number(String(payload.value?.questionDisplayMap?.[normalized] || '').match(/\d+/)?.[0])
  if (Number.isFinite(displayNumber)) return displayNumber
  const internalNumber = Number(String(normalized || '').replace(/^q/i, ''))
  return Number.isFinite(internalNumber) ? internalNumber : null
}

function getGroupOfficialQuestionNumbers(group) {
  return (Array.isArray(group?.questionIds) ? group.questionIds : [])
    .map((questionId) => getQuestionOfficialNumber(questionId))
    .filter((value) => Number.isFinite(value))
}

function sectionOverlapsOfficialNumbers(section, questionNumbers) {
  if (!questionNumbers.length) return false
  const itemNumbers = new Set((section.items || []).map((item) => Number(item.questionNumber)).filter((value) => Number.isFinite(value)))
  if (questionNumbers.some((value) => itemNumbers.has(value))) return true
  const range = section.questionRange
  if (!range) return false
  return questionNumbers.some((value) => value >= range.start && value <= range.end)
}

function getGroupOfficialExplanations(group) {
  if (!reviewMode.value) return []
  const questionNumbers = getGroupOfficialQuestionNumbers(group)
  if (!questionNumbers.length) return []
  const splitMode = EXPLANATION_SPLIT_KINDS.has(String(group?.kind || ''))
  return officialQuestionExplanationSections.value
    .filter((section) => sectionOverlapsOfficialNumbers(section, questionNumbers))
    .map((section) => {
      const matchedItems = (section.items || []).filter((item) => questionNumbers.includes(Number(item.questionNumber)))
      const groupMode = section.mode === 'group' || (!splitMode && section.text)
      return {
        ...section,
        text: groupMode || (!matchedItems.length && section.text) ? section.text : '',
        items: groupMode ? [] : matchedItems
      }
    })
    .filter((section) => section.text || section.items.length)
}

function resolveAnswerAliases(questionId) {
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return []
  const numeric = normalized.replace(/^q/i, '')
  const displayLabel = String(payload.value?.questionDisplayMap?.[normalized] || '').trim()
  return Array.from(new Set([
    normalized,
    numeric,
    `question${numeric}`,
    displayLabel,
    displayLabel ? `q${displayLabel}` : ''
  ].filter(Boolean)))
}

function normalizeQuestionId(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  const direct = raw.match(/^q(\d+)$/)
  if (direct) return `q${Number(direct[1])}`
  const numeric = raw.match(/^(\d+)$/)
  return numeric ? `q${Number(numeric[1])}` : raw
}

function expandQuestionSequence(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase()
  const numbers = (value.match(/\d+/g) || []).map((entry) => Number(entry))
  if ((value.includes('-') || value.includes('–')) && numbers.length === 2 && numbers[1] >= numbers[0]) {
    const ids = []
    for (let current = numbers[0]; current <= numbers[1]; current += 1) {
      ids.push(`q${current}`)
    }
    return ids
  }
  if ((value.includes('_') || value.includes('-') || value.includes('–')) && numbers.length >= 2) {
    return numbers.map((entry) => `q${entry}`)
  }
  const normalized = normalizeQuestionId(value)
  return normalized ? [normalized] : []
}

function escapeCss(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(String(value))
  }
  return String(value).replace(/["\\]/g, '\\$&')
}

function getGroupRange(group) {
  const ids = Array.isArray(group.questionIds) ? group.questionIds : []
  if (!ids.length) return 'Questions'
  const labels = ids.map((questionId) => getDisplayLabel(questionId)).filter(Boolean)
  if (labels.length <= 1) return `Question ${labels[0] || ''}`
  return `Questions ${labels[0]}-${labels[labels.length - 1]}`
}

function getQuestionKindLabel(kind) {
  const labels = {
    matching: '匹配题',
    table_completion: '表格题',
    summary_completion: '摘要填空',
    multi_choice: '多选题',
    true_false_not_given: '判断题'
  }
  return labels[kind] || kind || '题组'
}

</script>

<style scoped>
.reading-page {
  display: grid;
  gap: 20px;
  animation: rise-in 0.45s var(--ease-smooth);
}

.reading-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 10px 2px 4px;
}

.reading-header h1 {
  margin-top: 6px;
  font-size: clamp(1.85rem, 2.6vw, 3rem);
}

.reading-header p {
  max-width: 760px;
  margin-top: 8px;
  color: var(--text-secondary);
}

.eyebrow,
.panel-kicker {
  color: var(--primary-color);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.reading-header-actions,
.answer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.reading-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 0.28fr);
  gap: 20px;
  align-items: start;
}

.reading-main {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.reading-panel,
.answer-panel {
  padding: 22px;
}

.panel-heading,
.answer-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.panel-heading strong,
.answer-count {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.reading-html {
  color: var(--text-primary);
}

.reading-html :deep(h2),
.reading-html :deep(h3),
.reading-html :deep(h4),
.reading-html :deep(h5) {
  margin: 18px 0 10px;
  font-family: var(--font-family-display);
}

.reading-html :deep(p) {
  margin: 10px 0;
}

.reading-html :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0;
  background: rgba(255, 255, 255, 0.46);
}

.reading-html :deep(th),
.reading-html :deep(td) {
  padding: 9px 10px;
  border: 1px solid rgba(41, 39, 56, 0.12);
  vertical-align: top;
}

.reading-html :deep(input[type="radio"]),
.reading-html :deep(input[type="checkbox"]) {
  width: 18px;
  height: 18px;
  accent-color: var(--primary-color);
}

.reading-html :deep(.paragraph-dropzone),
.reading-html :deep(.match-dropzone),
.reading-html :deep(.drop-target-summary) {
  min-height: 36px;
  margin: 8px 0;
  padding: 8px 10px;
  border: 1px dashed rgba(201, 100, 66, 0.42);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.38);
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.reading-html :deep(.dropzone-filled) {
  border-style: solid;
  border-color: rgba(35, 143, 91, 0.46);
  background: rgba(35, 143, 91, 0.12);
}

.reading-html :deep(.drag-over),
.dragdrop-slot.drag-over {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(201, 100, 66, 0.13);
}

.reading-html :deep(.pool-items),
.reading-html :deep(.options-pool),
.reading-html :deep(.headings-pool) {
  transition: background 0.16s ease, box-shadow 0.16s ease;
}

.reading-html :deep(.pool-items.drag-over),
.reading-html :deep(.options-pool.drag-over),
.reading-html :deep(.headings-pool.drag-over) {
  background: rgba(201, 100, 66, 0.08);
  box-shadow: inset 0 0 0 1px rgba(201, 100, 66, 0.26);
}

.question-group {
  padding: 18px 0;
  border-top: 1px solid var(--lg-border-subtle);
}

.question-group:first-of-type {
  padding-top: 0;
  border-top: 0;
}

.group-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.snapshot-message {
  margin-top: 12px;
  color: var(--warning-color);
  font-size: 0.86rem;
}

.answer-panel {
  position: sticky;
  top: 92px;
  display: grid;
  gap: 16px;
}

.answer-panel h2 {
  font-size: 1.25rem;
}

.answer-status {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.answer-status > div {
  padding: 10px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.34);
}

.answer-status span {
  display: block;
  color: var(--text-muted);
  font-size: 0.74rem;
}

.answer-status strong {
  display: block;
  margin-top: 2px;
  overflow-wrap: anywhere;
  font-size: 0.92rem;
}

.suite-progress-mini {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid rgba(49, 95, 103, 0.22);
  border-radius: var(--radius-md);
  background: rgba(106, 204, 199, 0.1);
}

.suite-progress-mini span {
  color: var(--text-muted);
  font-size: 0.74rem;
}

.suite-progress-mini strong {
  color: var(--text-primary);
  font-size: 0.92rem;
}

.answer-list {
  display: grid;
  gap: 8px;
  max-height: min(62vh, 720px);
  overflow: auto;
  padding-right: 4px;
}

.answer-item {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.mark-question-button {
  min-height: 22px;
  border: 1px solid rgba(41, 39, 56, 0.14);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.38);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 800;
}

.mark-question-button.active {
  border-color: rgba(201, 100, 66, 0.42);
  background: rgba(201, 100, 66, 0.14);
  color: var(--primary-color);
}

.mark-question-button:disabled {
  cursor: default;
  opacity: 0.7;
}

.answer-checkbox-list {
  display: grid;
  gap: 6px;
}

.answer-checkbox-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.answer-checkbox-option input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary-color);
}

.answer-dragdrop {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.dragdrop-slot {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 5px 7px;
  border: 1px dashed rgba(41, 39, 56, 0.2);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.32);
  font-size: 0.84rem;
}

.dragdrop-slot.filled {
  border-style: solid;
  border-color: rgba(35, 143, 91, 0.36);
  background: rgba(35, 143, 91, 0.1);
}

.dragdrop-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dragdrop-chip,
.reading-html :deep(.dragdrop-chip) {
  min-height: 30px;
  max-width: 100%;
  padding: 5px 9px;
  border: 1px solid rgba(41, 39, 56, 0.14);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.62);
  color: var(--text-secondary);
  cursor: grab;
  font: inherit;
  font-size: 0.82rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
  text-align: left;
}

.dragdrop-chip:disabled,
.reading-html :deep(.dragdrop-chip:disabled) {
  cursor: default;
  opacity: 0.76;
}

.dragdrop-chip-assigned,
.reading-html :deep(.dragdrop-chip-assigned) {
  border-color: rgba(35, 143, 91, 0.36);
  background: rgba(35, 143, 91, 0.14);
  color: var(--text-primary);
}

.dragdrop-option.selected {
  border-color: rgba(35, 143, 91, 0.42);
  background: rgba(35, 143, 91, 0.14);
}

.dragdrop-option:disabled:not(.selected) {
  cursor: not-allowed;
  opacity: 0.38;
}

.dragdrop-chip.dragging,
.reading-html :deep(.dragging) {
  opacity: 0.58;
}

.dragdrop-select {
  width: 100%;
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}

.score-grid > div {
  padding: 12px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.38);
}

.score-grid span {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.score-grid strong {
  display: block;
  margin-top: 4px;
  font-size: 1.1rem;
}

.review-analysis {
  display: grid;
  gap: 16px;
  margin: 4px 0 20px;
  padding: 16px 0 2px;
  border-top: 1px solid var(--lg-border-subtle);
  border-bottom: 1px solid var(--lg-border-subtle);
}

.llm-review-status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}

.llm-review-status > strong {
  min-width: 0;
  flex: 1;
}

.llm-review-retry {
  flex: 0 0 auto;
}

.analysis-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.analysis-strip > div {
  min-width: 0;
  padding: 10px 0;
}

.analysis-strip span {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.analysis-strip strong {
  display: block;
  margin-top: 3px;
  color: var(--text-primary);
  font-size: 1.05rem;
}

.analysis-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.llm-analysis-body {
  align-items: start;
}

.llm-question-analysis-list {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
  min-width: 0;
}

.llm-question-analysis {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--lg-border-subtle);
  color: var(--text-secondary);
  font-size: 0.86rem;
}

.llm-question-analysis > strong {
  color: var(--text-primary);
}

.llm-question-analysis dl {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px 10px;
  margin: 0;
}

.llm-question-analysis dt {
  color: var(--text-muted);
}

.llm-question-analysis dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.analysis-body h3 {
  margin-bottom: 8px;
  font-size: 0.94rem;
}

.analysis-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.analysis-list li {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.analysis-list strong {
  color: var(--text-primary);
}

.analysis-kind-bars {
  display: grid;
  gap: 8px;
  padding-bottom: 14px;
}

.kind-bar-row {
  display: grid;
  grid-template-columns: minmax(92px, 0.24fr) minmax(0, 1fr) 54px;
  gap: 10px;
  align-items: center;
  color: var(--text-secondary);
  font-size: 0.86rem;
}

.kind-bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(41, 39, 56, 0.1);
}

.kind-bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--success-color);
}

.review-table {
  width: 100%;
  border-collapse: collapse;
  overflow-wrap: anywhere;
}

.review-table th,
.review-table td {
  padding: 10px;
  border-bottom: 1px solid var(--lg-border-subtle);
  text-align: left;
  vertical-align: top;
}

.review-table th {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.review-correct td:last-child {
  color: var(--success-color);
  font-weight: 700;
}

.review-incorrect td:last-child {
  color: var(--danger-color);
  font-weight: 700;
}

.coach-panel {
  display: grid;
  gap: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--lg-border-subtle);
}

.coach-status {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.coach-status.is-loading {
  color: var(--primary-color);
}

.coach-selected-context {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid rgba(49, 95, 103, 0.2);
  border-radius: var(--radius-md);
  background: rgba(106, 204, 199, 0.1);
}

.coach-selected-context span {
  color: var(--text-muted);
  font-size: 0.74rem;
  font-weight: 700;
}

.coach-selected-context strong {
  max-height: 4.8em;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.86rem;
  font-weight: 600;
  line-height: 1.6;
}

.coach-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.coach-chip {
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid rgba(41, 39, 56, 0.14);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.5);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
}

.coach-chip:hover:not(:disabled) {
  border-color: rgba(201, 100, 66, 0.34);
  color: var(--primary-color);
}

.coach-chip:disabled {
  cursor: default;
  opacity: 0.55;
}

.coach-transcript {
  display: grid;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.28);
}

.coach-message {
  max-width: 92%;
  padding: 9px 10px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.56);
  font-size: 0.86rem;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.coach-message.user {
  justify-self: end;
  color: var(--text-inverse);
  background: var(--primary-color);
}

.coach-message.assistant {
  justify-self: start;
}

.coach-message.error {
  border: 1px solid rgba(194, 77, 77, 0.28);
  color: var(--danger-color);
}

.coach-panel textarea {
  width: 100%;
  resize: vertical;
}

.coach-error {
  color: var(--danger-color);
  font-size: 0.86rem;
}

.coach-response {
  padding: 12px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.4);
  color: var(--text-secondary);
  line-height: 1.6;
}

@media (max-width: 1100px) {
  .reading-header,
  .reading-workspace {
    grid-template-columns: 1fr;
  }

  .reading-header {
    align-items: stretch;
    flex-direction: column;
  }

  .answer-panel {
    position: static;
  }

  .score-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analysis-strip,
  .analysis-body {
    grid-template-columns: 1fr;
  }
}

/* Legacy opensource reading exam shell: compact header, split panes, bottom question nav. */
.reading-page {
  --reading-line: #d7dde5;
  --reading-panel: #ffffff;
  --reading-panel-alt: #edf2f9;
  --reading-text: #1f2937;
  --reading-muted: #64748b;
  --reading-accent: #2563eb;
  --reading-success: #15803d;
  --reading-danger: #b91c1c;
  --reading-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
  --reading-nav-height: 72px;
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
  padding-bottom: 0;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  color: var(--reading-text);
  font-family: "SF Pro Text", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
}

.reading-page *,
.reading-page *::before,
.reading-page *::after {
  box-sizing: border-box;
}

.reading-header.header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 67px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--reading-line);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.header-content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.reading-header h1 {
  margin: 0;
  color: var(--reading-text);
  font-family: inherit;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.4;
}

.reading-header p {
  max-width: none;
  margin: 0;
  color: var(--reading-muted);
  font-size: 0.92rem;
}

.header-controls,
.reading-header-actions,
.answer-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.reading-stat,
.header-btn,
.practice-nav .controls button,
.submit-btn {
  min-height: 36px;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: var(--reading-panel);
  color: var(--reading-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.92rem;
  line-height: 1.2;
  padding: 8px 12px;
  text-decoration: none;
}

.reading-stat {
  cursor: default;
  font-weight: 700;
}

.header-btn:hover:not(:disabled),
.practice-nav .controls button:hover:not(:disabled) {
  background: #f1f5f9;
}

.header-btn:disabled,
.practice-nav .controls button:disabled,
.submit-btn:disabled {
  cursor: default;
  opacity: 0.56;
}

.submit-btn {
  border-color: var(--reading-accent);
  background: var(--reading-accent);
  color: #ffffff;
  font-weight: 600;
}

.overlay {
  position: fixed;
  inset: 0;
  z-index: 2500;
  background: rgba(15, 23, 42, 0.18);
}

.reading-floating-panel {
  position: fixed;
  z-index: 2600;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: #ffffff;
  color: var(--reading-text);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
}

.reading-settings-panel {
  top: 78px;
  right: 22px;
  display: grid;
  width: min(320px, calc(100vw - 28px));
  gap: 14px;
  padding: 14px;
}

.settings-title {
  margin: 0 0 8px;
  color: var(--reading-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.settings-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.settings-option {
  min-height: 32px;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: #f8fafc;
  color: var(--reading-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.86rem;
  padding: 6px 10px;
}

.settings-option.active {
  border-color: #93c5fd;
  background: #dbeafe;
  color: #1d4ed8;
  font-weight: 700;
}

.reading-notes-panel {
  top: 86px;
  right: 22px;
  display: flex;
  width: min(420px, calc(100vw - 28px));
  max-height: min(520px, calc(100vh - 120px));
  flex-direction: column;
  padding: 14px;
}

.reading-notes-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.reading-notes-panel h3 {
  margin: 0;
  font-size: 1rem;
}

.reading-notes-panel textarea {
  min-height: 280px;
  resize: vertical;
}

.reading-selection-toolbar {
  position: absolute;
  z-index: 2700;
  display: flex;
  gap: 6px;
  padding: 6px;
  border: 1px solid rgba(15, 23, 42, 0.16);
  border-radius: 8px;
  background: #111827;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.24);
}

.reading-selection-toolbar button {
  min-height: 30px;
  border: 0;
  border-radius: 6px;
  background: #ffffff;
  color: #111827;
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 5px 9px;
}

.reading-html :deep(.hl),
.review-dictionary-highlight {
  border-radius: 3px;
  background: rgba(253, 224, 71, 0.7);
  box-shadow: inset 0 -2px 0 rgba(234, 179, 8, 0.42);
  cursor: pointer;
}

.reading-html :deep(.hl[data-hl-type="note"]) {
  background: rgba(191, 219, 254, 0.76);
  box-shadow: inset 0 -2px 0 rgba(37, 99, 235, 0.34);
}

.reading-html :deep(.memorize-locator-highlight) {
  border-radius: 3px;
  background: rgba(187, 247, 208, 0.85);
  box-shadow: inset 0 -2px 0 rgba(22, 163, 74, 0.36);
}

.review-highlight-dictionary-bubble {
  position: fixed;
  z-index: 2800;
  width: min(340px, calc(100vw - 24px));
  max-height: min(420px, calc(100vh - 24px));
  overflow: auto;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
}

.vocab-bubble-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.vocab-term {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 1rem;
  font-weight: 700;
}

.vocab-part {
  border-top: 1px solid rgba(148, 163, 184, 0.25);
  padding-top: 7px;
  margin-top: 7px;
}

.vocab-part:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.vocab-part-term {
  font-size: 0.94rem;
}

.vocab-meta,
.vocab-label {
  color: var(--reading-muted);
  font-size: 0.78rem;
}

.vocab-meta {
  margin-top: 2px;
  overflow-wrap: anywhere;
}

.vocab-label {
  font-weight: 700;
}

.vocab-section {
  margin-top: 8px;
}

.vocab-text {
  color: #334155;
  font-size: 0.88rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.vocab-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.vocab-close,
.vocab-add {
  border: 1px solid var(--reading-line);
  border-radius: 6px;
  background: #ffffff;
  color: var(--reading-text);
  cursor: pointer;
  font: inherit;
  padding: 6px 10px;
}

.vocab-add {
  border-color: var(--reading-accent);
  background: var(--reading-accent);
  color: #ffffff;
  font-weight: 700;
}

.vocab-add:disabled {
  cursor: default;
  opacity: 0.78;
}

.reading-workspace.shell {
  flex: 1 1 auto;
  display: flex;
  width: 100%;
  min-height: 0;
  height: auto;
  gap: 0;
  align-items: stretch;
}

.pane {
  overflow: auto;
  background: var(--reading-panel);
  padding: 22px;
}

#left {
  width: 50%;
  min-width: 320px;
  flex: 0 0 50%;
}

#divider {
  flex: 0 0 8px;
  border-right: 1px solid var(--reading-line);
  border-left: 1px solid var(--reading-line);
  background: linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%);
  cursor: ew-resize;
}

#right {
  min-width: 320px;
  flex: 1;
  background: var(--reading-panel-alt);
  padding: 16px 20px;
}

.reading-html {
  color: var(--reading-text);
}

.reading-html :deep(h2),
.reading-html :deep(h3),
.reading-html :deep(h4),
.reading-html :deep(h5) {
  margin: 18px 0 10px;
  color: var(--reading-text);
  font-family: inherit;
}

.reading-html :deep(p),
#left :deep(p),
#right :deep(p) {
  margin: 0 0 14px;
  line-height: 1.7;
}

.reading-html :deep(label) {
  display: block;
  margin: 8px 0;
  line-height: 1.55;
}

.reading-html :deep(input[type="text"]),
.reading-html :deep(textarea),
.reading-html :deep(select),
.practice-nav select,
.practice-nav input[type="text"] {
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: #ffffff;
  color: var(--reading-text);
  font: inherit;
  min-height: 32px;
  padding: 6px 8px;
}

.reading-html :deep(input[type="radio"]),
.reading-html :deep(input[type="checkbox"]),
.practice-nav input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--reading-accent);
  vertical-align: middle;
}

.reading-html :deep(table) {
  width: 100%;
  margin: 14px 0;
  border-collapse: collapse;
  background: #ffffff;
}

.reading-html :deep(th),
.reading-html :deep(td) {
  padding: 8px 10px;
  border: 1px solid var(--reading-line);
  vertical-align: top;
}

.unified-group.question-group {
  margin-bottom: 18px;
  padding: 0;
  border: 0;
}

.unified-group__lead {
  margin-bottom: 12px;
}

.reading-html :deep(.group),
.review-panel,
.coach-panel {
  margin-bottom: 24px;
  padding: 24px 32px;
  border: 1px solid var(--reading-line);
  border-radius: 12px;
  background: var(--reading-panel);
  box-shadow: var(--reading-shadow);
}

.reading-explanation-panel {
  display: grid;
  gap: 10px;
  margin: 14px 0 22px;
}

.reading-explanation-card {
  margin: 10px 0 14px;
  padding: 10px 12px;
  border: 1px solid rgba(37, 99, 235, 0.22);
  border-left: 4px solid rgba(37, 99, 235, 0.9);
  border-radius: 8px;
  background: rgba(239, 246, 255, 0.75);
}

.reading-explanation-card__label {
  margin-bottom: 6px;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
}

.reading-explanation-card__text {
  color: #1f2937;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.reading-group-explanation,
.reading-question-explanation {
  margin-top: 10px;
}

.reading-question-explanation-list {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
}

.reading-question-explanation-list h5 {
  margin: 0 0 8px;
  color: #1d4ed8;
  font-size: 13px;
  font-weight: 700;
}

.reading-question-explanation-item {
  margin: 8px 0;
}

.reading-html :deep(.question-item),
.reading-html :deep(.match-question-item),
.reading-html :deep(.choice-item) {
  margin-bottom: 12px;
}

.reading-html :deep(.paragraph-dropzone),
.reading-html :deep(.match-dropzone),
.reading-html :deep(.drop-target-summary),
.dragdrop-slot {
  display: flex;
  min-height: 40px;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 2px dashed #93c5fd;
  border-radius: 10px;
  background: #eff6ff;
  color: var(--reading-muted);
  transition: border-color 0.16s ease, background 0.16s ease;
}

.reading-html :deep(.paragraph-dropzone.drag-over),
.reading-html :deep(.match-dropzone.drag-over),
.reading-html :deep(.drop-target-summary.drag-over),
.reading-html :deep(.drag-over),
.dragdrop-slot.drag-over {
  border-color: var(--reading-accent);
  background: #dbeafe;
  box-shadow: none;
}

.reading-html :deep(.paragraph-dropzone.dropzone-filled),
.reading-html :deep(.match-dropzone.dropzone-filled),
.reading-html :deep(.drop-target-summary.dropzone-filled),
.dragdrop-slot.filled {
  border-style: solid;
}

.reading-html :deep(.paragraph-label) {
  color: var(--reading-muted);
  font-size: 0.9rem;
  font-weight: 700;
  white-space: nowrap;
}

.reading-html :deep(.pool-items),
.reading-html :deep(.options-pool),
.reading-html :deep(.headings-pool),
.reading-html :deep(.dropped-items),
.dragdrop-options {
  display: flex;
  min-height: 40px;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
}

.reading-html :deep(.pool-items.drag-over),
.reading-html :deep(.options-pool.drag-over),
.reading-html :deep(.headings-pool.drag-over) {
  border-color: var(--reading-accent);
  background: rgba(37, 99, 235, 0.08);
  box-shadow: none;
}

.reading-html :deep(.dropped-items:empty::after) {
  content: "拖到这里";
  color: #7b8a98;
  font-size: 0.82rem;
}

.reading-html :deep(.drag-item),
.dragdrop-chip,
.reading-html :deep(.dragdrop-chip) {
  min-height: 32px;
  max-width: 100%;
  padding: 6px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  color: var(--reading-text);
  cursor: grab;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
  text-align: left;
  user-select: none;
}

.reading-html :deep(.drag-item.dragging),
.dragdrop-chip.dragging,
.reading-html :deep(.dragging) {
  opacity: 0.55;
}

.reading-html :deep(.drag-item--assigned),
.dragdrop-chip-assigned,
.reading-html :deep(.dragdrop-chip-assigned) {
  border-style: solid;
  border-color: #bfdbfe;
  background: #eff6ff;
}

.dragdrop-option.selected {
  border-color: #93c5fd;
  background: #dbeafe;
}

.dragdrop-option:disabled:not(.selected) {
  cursor: not-allowed;
  opacity: 0.38;
}

.practice-nav {
  position: relative;
  top: auto;
  z-index: 2000;
  flex: 0 0 var(--reading-nav-height);
  display: flex;
  align-items: center;
  gap: 16px;
  height: var(--reading-nav-height);
  min-height: var(--reading-nav-height);
  padding: 12px 18px;
  border-top: 1px solid var(--reading-line);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.06);
  overflow: visible;
}

.practice-nav .title {
  flex: 0 0 auto;
  color: var(--reading-muted);
  font-weight: 700;
  white-space: nowrap;
}

.practice-nav .questions {
  display: flex;
  max-height: none;
  flex: 1 1 auto;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  overflow-y: visible;
  padding: 0;
}

.practice-nav .question-nav-entry {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}

.practice-nav .q-item {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  min-width: 42px;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: var(--reading-panel);
  color: var(--reading-text);
  cursor: pointer;
  font-size: 0.9rem;
}

.practice-nav .controls {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 8px;
  margin-left: auto;
}

.practice-nav .q-item:hover {
  background: #f1f5f9;
}

.practice-nav .q-item.answered {
  border-color: #93c5fd;
  background: #dbeafe;
}

.practice-nav .q-item.correct,
.practice-nav .q-item.review-correct {
  border-color: var(--reading-success);
  background: #dcfce7;
  color: var(--reading-success);
}

.practice-nav .q-item.incorrect,
.practice-nav .q-item.review-incorrect {
  border-color: var(--reading-danger);
  background: #fee2e2;
  color: var(--reading-danger);
}

.practice-nav .q-item.marked::after {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 10px;
  height: 10px;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: #f59e0b;
  content: "";
}

.mark-question-button {
  min-width: 18px;
  min-height: 18px;
  margin-left: -4px;
  padding: 0 4px;
  border: 1px solid rgba(100, 116, 139, 0.45);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.7);
  color: var(--reading-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
}

.mark-question-button.active {
  border-color: #f59e0b;
  background: #fffbeb;
  color: #b45309;
}

.mark-question-button:disabled {
  cursor: default;
  opacity: 0.62;
}

.dragdrop-select {
  width: 100%;
}

.suite-progress-mini {
  display: grid;
  min-height: 36px;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}

.suite-progress-mini span {
  display: block;
  color: var(--reading-muted);
  font-size: 0.72rem;
}

.suite-progress-mini strong {
  display: block;
  color: var(--reading-text);
  font-size: 0.86rem;
}

.snapshot-message {
  position: absolute;
  right: 18px;
  bottom: calc(100% + 8px);
  margin: 0;
  padding: 8px 10px;
  border: 1px solid #fde68a;
  border-radius: 8px;
  background: #fffbeb;
  color: #92400e;
  font-size: 0.86rem;
  box-shadow: var(--reading-shadow);
}

.panel-kicker {
  color: var(--reading-accent);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.panel-heading,
.answer-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}

.score-grid > div,
.analysis-strip > div {
  padding: 10px 12px;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: #f8fafc;
}

.score-grid span,
.analysis-strip span {
  display: block;
  color: var(--reading-muted);
  font-size: 0.75rem;
}

.score-grid strong,
.analysis-strip strong {
  display: block;
  margin-top: 3px;
  color: var(--reading-text);
}

.review-analysis {
  display: grid;
  gap: 16px;
  margin: 4px 0 20px;
  padding: 16px 0 2px;
  border-top: 1px solid var(--reading-line);
  border-bottom: 1px solid var(--reading-line);
}

.llm-review-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.llm-review-status > strong {
  min-width: 0;
  flex: 1;
}

.analysis-strip,
.analysis-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.llm-question-analysis-list {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
}

.llm-question-analysis {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--reading-line);
  color: #475569;
  font-size: 0.86rem;
}

.llm-question-analysis > strong {
  color: var(--reading-text);
}

.llm-question-analysis dl {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px 10px;
  margin: 0;
}

.llm-question-analysis dt {
  color: var(--reading-muted);
}

.llm-question-analysis dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.analysis-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.analysis-list li {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  color: #475569;
  font-size: 0.88rem;
}

.kind-bar-row {
  display: grid;
  grid-template-columns: minmax(92px, 0.24fr) minmax(0, 1fr) 54px;
  gap: 10px;
  align-items: center;
  color: #475569;
  font-size: 0.86rem;
}

.kind-bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}

.kind-bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--reading-success);
}

.review-table {
  width: 100%;
  border-collapse: collapse;
  overflow-wrap: anywhere;
  font-size: 0.92rem;
}

.review-table th,
.review-table td {
  padding: 8px 10px;
  border: 1px solid var(--reading-line);
  text-align: center;
  vertical-align: top;
}

.review-correct td:last-child {
  color: var(--reading-success);
  font-weight: 700;
}

.review-incorrect td:last-child {
  color: var(--reading-danger);
  font-weight: 700;
}

.coach-panel {
  display: grid;
  gap: 12px;
}

.coach-status {
  flex: 0 0 auto;
  color: var(--reading-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.coach-status.is-loading {
  color: var(--reading-accent);
}

.coach-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.coach-chip {
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
}

.coach-chip:hover:not(:disabled) {
  border-color: #93c5fd;
  background: #eff6ff;
  color: var(--reading-accent);
}

.coach-transcript {
  display: grid;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: #f8fafc;
}

.coach-message {
  max-width: 92%;
  padding: 9px 10px;
  border-radius: 8px;
  background: #ffffff;
  color: #334155;
  font-size: 0.86rem;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.coach-message.user {
  justify-self: end;
  background: var(--reading-accent);
  color: #ffffff;
}

.coach-selected-context,
.coach-response {
  padding: 10px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
  color: #334155;
}

.coach-selected-context {
  display: grid;
  gap: 6px;
}

.coach-selected-context span,
.coach-error {
  font-size: 0.86rem;
}

.coach-selected-context strong {
  max-height: 4.8em;
  overflow: hidden;
  color: #334155;
  font-size: 0.86rem;
  font-weight: 600;
  line-height: 1.6;
}

.coach-panel textarea {
  width: 100%;
  resize: vertical;
}

.coach-error {
  color: var(--reading-danger);
}

@media (max-width: 980px) {
  .reading-page {
    --reading-nav-height: 112px;
    min-height: 100vh;
    height: 100vh;
    overflow: hidden;
    padding-bottom: 0;
  }

  .reading-header.header {
    align-items: flex-start;
    flex-direction: column;
  }

  .reading-workspace.shell {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  #left,
  #right {
    width: 100%;
    min-width: 0;
    flex: none;
  }

  #divider {
    display: none;
  }

  .practice-nav {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 10px;
    height: var(--reading-nav-height);
    overflow-y: auto;
  }

  .practice-nav .questions {
    order: 3;
    flex-basis: 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
  }

  .practice-nav .controls {
    margin-left: 0;
  }

  .score-grid,
  .analysis-strip,
  .analysis-body {
    grid-template-columns: 1fr;
  }
}
</style>
