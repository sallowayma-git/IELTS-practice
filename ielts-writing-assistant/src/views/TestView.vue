<template>
  <div class="test-container">
    <h1>测试页面</h1>
    <p>如果你能看到这个页面，说明前端路由正常工作</p>
    <el-button type="primary" @click="showMessage">测试 Element Plus</el-button>
    <el-date-picker v-model="date" type="date" placeholder="选择日期" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const date = ref('')

const showMessage = () => {
  ElMessage.success('Element Plus 正常工作！')
}
</script>

<style scoped>
.test-container {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
}

h1 {
  color: #409EFF;
  margin-bottom: 1rem;
}

p {
  margin-bottom: 1rem;
  font-size: 16px;
}
</style>