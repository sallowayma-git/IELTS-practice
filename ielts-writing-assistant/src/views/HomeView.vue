<template>
  <div class="home-container">
    <h1>🎓 雅思AI作文评判助手</h1>
    <p>智能评估 · 实时反馈 · 精准提分</p>

    <div class="action-section">
      <el-row :gutter="20">
        <el-col :span="8">
          <el-card class="action-card" @click="goToWriting">
            <div class="card-content">
              <div class="icon">✏️</div>
              <h3>开始写作</h3>
              <p>选择题目开始练习</p>
            </div>
          </el-card>
        </el-col>

        <el-col :span="8">
          <el-card class="action-card" @click="goToLegacyIndex">
            <div class="card-content">
              <div class="icon">📚</div>
              <h3>听力与阅读</h3>
              <p>提升听力理解和阅读分析能力</p>
            </div>
          </el-card>
        </el-col>

        <el-col :span="8">
          <el-card class="action-card" @click="goToHistory">
            <div class="card-content">
              <div class="icon">⏰</div>
              <h3>历史记录</h3>
              <p>查看练习历史和进度分析</p>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 第二行功能卡片 -->
    <div class="secondary-section">
      <el-row :gutter="20">
        <el-col :span="12">
          <el-card class="action-card" @click="goToDiagnostic">
            <div class="card-content">
              <div class="icon">🔧</div>
              <h3>系统诊断</h3>
              <p>查看系统状态和日志信息</p>
            </div>
          </el-card>
        </el-col>

        <el-col :span="12">
          <el-card class="action-card" @click="goToSettings">
            <div class="card-content">
              <div class="icon">⚙️</div>
              <h3>设置</h3>
              <p>配置系统参数和个人偏好</p>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

const goToWriting = () => {
  try {
    router.push('/writing')
  } catch (error) {
    console.error('路由跳转失败:', error)
  }
}

const goToHistory = () => {
  try {
    router.push('/history')
  } catch (error) {
    console.error('路由跳转失败:', error)
  }
}

const goToLegacyIndex = () => {
  try {
    window.location.href = '/index.html'
  } catch (error) {
    console.error('跳转失败:', error)
  }
}

const goToDiagnostic = () => {
  try {
    router.push('/diagnostic')
  } catch (error) {
    console.error('路由跳转失败:', error)
  }
}

const goToSettings = () => {
  try {
    router.push('/settings')
  } catch (error) {
    console.error('路由跳转失败:', error)
  }
}
</script>

<style scoped>
.home-container {
  padding: 2rem;
  text-align: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  color: white;
}

.home-container h1 {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.home-container p {
  font-size: 1.2rem;
  margin-bottom: 2rem;
  opacity: 0.9;
}

.action-section {
  max-width: 1200px;
  margin: 0 auto;
}

.secondary-section {
  max-width: 1200px;
  margin: 20px auto 0;
}

.action-card {
  cursor: pointer;
  transition: all 0.3s ease;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  margin-bottom: 1rem;
}

.action-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
}

.card-content {
  text-align: center;
  padding: 1rem;
}

.icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.card-content h3 {
  margin: 1rem 0 0.5rem 0;
  color: #2c3e50;
  font-size: 1.2rem;
}

.card-content p {
  color: #7f8c8d;
  margin: 0;
  font-size: 0.9rem;
}
</style>