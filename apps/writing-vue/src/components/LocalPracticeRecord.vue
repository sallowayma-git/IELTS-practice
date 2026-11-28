<template>
  <section class="local-practice-record" aria-label="本地作答" data-local-practice-record>
    <h2>{{ record.titleSnapshot || '本地作答' }}</h2>
    <p v-if="record.status === 'completed' && record.correctCount != null">
      答对 {{ record.correctCount }} / {{ record.questionCount }}
    </p>
    <p v-else-if="record.status !== 'completed'">未提交草稿 · 已保存的作答</p>
    <ul v-if="record.answers?.length">
      <li v-for="row in record.answers" :key="row.questionId">
        {{ row.questionId }}：{{ formatAnswer(row.answer) }}
        <span v-if="row.isCorrect === true"> · 正确</span>
        <span v-else-if="row.isCorrect === false"> · 错误</span>
      </li>
    </ul>
    <p v-else>暂无已保存的答案。</p>
  </section>
</template>

<script setup>
defineProps({ record: { type: Object, required: true } })

function formatAnswer(answer) {
  if (answer == null || answer === '' || (Array.isArray(answer) && !answer.length)) return '未作答'
  return Array.isArray(answer) ? answer.join('、') : String(answer)
}
</script>

<style scoped>
.local-practice-record { padding: .75rem 1rem; overflow: auto; max-height: 55vh; }
.local-practice-record li { margin-block: .35rem; overflow-wrap: anywhere; }
</style>
