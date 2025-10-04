<template>
  <div class="home-container">
    <el-container>
      <el-header class="header">
        <div class="header-content">
          <h1>🎓 雅思AI作文评判助手</h1>
          <p>智能评估 · 实时反馈 · 精准提分</p>
        </div>
      </el-header>

      <el-main class="main-content">
        <div class="welcome-section">
          <el-card class="welcome-card">
            <h2>欢迎使用AI作文评判系统</h2>
            <p>基于先进的人工智能技术，为您提供专业的雅思写作评估服务</p>
          </el-card>
        </div>

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
              <el-card class="action-card" @click="goToLegacy('vocabulary')">
                <div class="card-content">
                  <div class="icon">📝</div>
                  <h3>词汇练习</h3>
                  <p>扩充词汇量</p>
                </div>
              </el-card>
            </el-col>
          </el-row>
        </div>

        <div class="secondary-section">
          <el-row :gutter="20">
            <el-col :span="12">
              <el-card class="action-card" @click="goToHistory">
                <div class="card-content">
                  <div class="icon">⏰</div>
                  <h3>历史记录</h3>
                  <p>查看练习历史和进度分析</p>
                </div>
              </el-card>
            </el-col>

            <el-col :span="8">
              <el-card class="action-card" @click="goToDiagnostic">
                <div class="card-content">
                  <div class="icon">🔧</div>
                  <h3>系统诊断</h3>
                  <p>查看系统状态和日志信息</p>
                </div>
              </el-card>
            </el-col>
            <el-col :span="8">
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

        <div class="stats-section">
          <el-card>
            <el-row :gutter="20">
              <el-col :span="6">
                <el-statistic title="总练习次数" :value="statistics.totalPractices" />
              </el-col>
              <el-col :span="6">
                <el-statistic title="平均分数" :value="statistics.averageScore" suffix="分" />
              </el-col>
              <el-col :span="6">
                <el-statistic title="最高分数" :value="statistics.highestScore" suffix="分" />
              </el-col>
              <el-col :span="6">
                <el-statistic title="练习天数" :value="statistics.practiceDays" suffix="天" />
              </el-col>
            </el-row>
          </el-card>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const statistics = ref({
  totalPractices: 0,
  averageScore: 0,
  highestScore: 0,
  practiceDays: 0
})

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

const goToLegacy = (module) => {
  try {
    router.push(`/legacy/${module}`)
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

const loadStatistics = async () => {
  try {
    // TODO: 从后端加载统计数据
    statistics.value = {
      totalPractices: 12,
      averageScore: 6.5,
      highestScore: 7.5,
      practiceDays: 8
    }
  } catch (error) {
    console.error('加载统计数据失败:', error)
  }
}

onMounted(() => {
  console.log('HomeView 组件已挂载')
  loadStatistics()
})
</script>

<style scoped>
.home-container {
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.header {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  color: white;
  text-align: center;
  line-height: 1.2;
  height: auto;
  padding: 1rem;
}

.header-content h1 {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.main-content {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.welcome-section {
  margin-bottom: 2rem;
}

.welcome-card {
  text-align: center;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.welcome-card h2 {
  color: #2c3e50;
  margin-bottom: 1rem;
  font-size: 1.8rem;
}

.action-section {
  margin-bottom: 2rem;
}

.secondary-section {
  margin-bottom: 2rem;
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

.stats-section {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .header-content h1 {
    font-size: 2rem;
  }

  .main-content {
    padding: 1rem;
  }
}
</style>