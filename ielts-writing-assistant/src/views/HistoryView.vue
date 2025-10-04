<template>
  <div class="history-container">
    <el-container>
      <el-header class="history-header">
        <div class="header-left">
          <el-button @click="goBack" :icon="ArrowLeft">返回</el-button>
          <h2>练习历史</h2>
        </div>
        <div class="header-right">
          <el-button @click="showExportDialog" :icon="Download">导出记录</el-button>
        </div>
      </el-header>

      <el-main class="history-main">
        <!-- 统计卡片 -->
        <div class="stats-cards">
          <el-row :gutter="20">
            <el-col :span="6">
              <el-card class="stat-card">
                <el-statistic title="总练习次数" :value="statistics.totalCount" />
              </el-card>
            </el-col>
            <el-col :span="6">
              <el-card class="stat-card">
                <el-statistic title="平均分数" :value="statistics.averageScore" :precision="1" suffix="分" />
              </el-card>
            </el-col>
            <el-col :span="6">
              <el-card class="stat-card">
                <el-statistic title="最高分数" :value="statistics.highestScore" :precision="1" suffix="分" />
              </el-card>
            </el-col>
            <el-col :span="6">
              <el-card class="stat-card">
                <el-statistic title="本月练习" :value="statistics.monthlyCount" />
              </el-card>
            </el-col>
          </el-row>
        </div>

        <!-- 评分分析面板 (Phase 2) -->
        <el-card class="analysis-card">
          <template #header>
            <div class="analysis-header">
              <span>评分趋势分析</span>
              <el-switch
                v-model="showAnalysis"
                active-text="显示"
                inactive-text="隐藏"
              />
            </div>
          </template>
          <ScoreAnalysisPanel v-if="showAnalysis" />
        </el-card>

        <!-- 筛选和搜索 -->
        <el-card class="filter-card">
          <el-row :gutter="20">
            <el-col :span="6">
              <el-select v-model="filters.type" placeholder="题目类型" clearable>
                <el-option label="全部" value="" />
                <el-option label="Task 1" value="task1" />
                <el-option label="Task 2" value="task2" />
              </el-select>
            </el-col>
            <el-col :span="6">
              <el-select v-model="filters.scoreRange" placeholder="分数范围" clearable>
                <el-option label="全部" value="" />
                <el-option label="6.0分以下" value="below6" />
                <el-option label="6.0-6.5分" value="6to6.5" />
                <el-option label="7.0分以上" value="above7" />
              </el-select>
            </el-col>
            <el-col :span="6">
              <el-date-picker
                v-model="filters.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                format="YYYY-MM-DD"
                value-format="YYYY-MM-DD"
              />
            </el-col>
            <el-col :span="6">
              <el-input
                v-model="filters.keyword"
                placeholder="搜索题目关键词"
                :prefix-icon="Search"
                clearable
              />
            </el-col>
          </el-row>
        </el-card>

        <!-- 历史记录列表 -->
        <el-card class="history-list-card">
          <template #header>
            <div class="list-header">
              <span>历史记录 ({{ filteredHistory.length }}条)</span>
              <el-button type="text" @click="refreshHistory" :icon="Refresh">刷新</el-button>
            </div>
          </template>

          <el-table
            :data="paginatedHistory"
            v-loading="loading"
            style="width: 100%"
            @row-click="viewDetail"
          >
            <el-table-column prop="date" label="日期" width="120">
              <template #default="scope">
                {{ formatDate(scope.row.date) }}
              </template>
            </el-table-column>
            <el-table-column prop="topic" label="题目" min-width="200">
              <template #default="scope">
                <div class="topic-cell">
                  <span class="topic-title">{{ scope.row.topic }}</span>
                  <el-tag size="small" :type="getTypeTagType(scope.row.type)">
                    {{ scope.row.type }}
                  </el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="wordCount" label="字数" width="80" />
            <el-table-column prop="score" label="总分" width="100">
              <template #default="scope">
                <el-tag :type="getScoreTagType(scope.row.score)">
                  {{ scope.row.score }}分
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="timeSpent" label="用时" width="100">
              <template #default="scope">
                {{ formatTime(scope.row.timeSpent) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150">
              <template #default="scope">
                <el-button type="text" @click.stop="viewDetail(scope.row)">查看详情</el-button>
                <el-button type="text" @click.stop="deleteRecord(scope.row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 分页 -->
          <div class="pagination-wrapper">
            <el-pagination
              v-model:current-page="pagination.currentPage"
              v-model:page-size="pagination.pageSize"
              :page-sizes="[10, 20, 50, 100]"
              :total="filteredHistory.length"
              layout="total, sizes, prev, pager, next, jumper"
              @size-change="handleSizeChange"
              @current-change="handleCurrentChange"
            />
          </div>
        </el-card>
      </el-main>
    </el-container>

    <!-- 导出对话框 -->
    <ExportDialog
      v-model="exportDialogVisible"
      :current-filters="filters"
      @export-completed="handleExportCompleted"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Download, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ScoreAnalysisPanel from '@/components/ScoreAnalysisPanel.vue'
import ExportDialog from '@/components/ExportDialog.vue'

const router = useRouter()

const loading = ref(false)
const historyData = ref([])
const showAnalysis = ref(true) // Phase 2: 评分分析面板显示状态
const exportDialogVisible = ref(false) // P2-3: 导出对话框显示状态

const statistics = ref({
  totalCount: 0,
  averageScore: 0,
  highestScore: 0,
  monthlyCount: 0
})

const filters = ref({
  type: '',
  scoreRange: '',
  dateRange: null,
  keyword: ''
})

const pagination = ref({
  currentPage: 1,
  pageSize: 20
})

const filteredHistory = computed(() => {
  let result = historyData.value

  // 类型筛选
  if (filters.value.type) {
    result = result.filter(item => item.type.toLowerCase().includes(filters.value.type))
  }

  // 分数筛选
  if (filters.value.scoreRange) {
    switch (filters.value.scoreRange) {
      case 'below6':
        result = result.filter(item => item.score < 6)
        break
      case '6to6.5':
        result = result.filter(item => item.score >= 6 && item.score <= 6.5)
        break
      case 'above7':
        result = result.filter(item => item.score >= 7)
        break
    }
  }

  // 日期筛选
  if (filters.value.dateRange && filters.value.dateRange.length === 2) {
    const [startDate, endDate] = filters.value.dateRange
    result = result.filter(item => {
      const itemDate = item.date.split(' ')[0]
      return itemDate >= startDate && itemDate <= endDate
    })
  }

  // 关键词搜索
  if (filters.value.keyword) {
    const keyword = filters.value.keyword.toLowerCase()
    result = result.filter(item =>
      item.topic.toLowerCase().includes(keyword)
    )
  }

  return result
})

const paginatedHistory = computed(() => {
  const start = (pagination.value.currentPage - 1) * pagination.value.pageSize
  const end = start + pagination.value.pageSize
  return filteredHistory.value.slice(start, end)
})

const goBack = () => {
  router.push('/')
}

const showExportDialog = () => {
  exportDialogVisible.value = true
}

const handleExportCompleted = (result) => {
  ElMessage.success(`导出完成: ${result.filename} (${result.count}条记录)`)
}

const refreshHistory = () => {
  loadHistory()
}

const viewDetail = (record) => {
  router.push(`/assessment/${record.id}`)
}

const deleteRecord = async (record) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除"${record.topic}"这条记录吗？`,
      '删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    // TODO: 调用后端API删除记录
    const index = historyData.value.findIndex(item => item.id === record.id)
    if (index > -1) {
      historyData.value.splice(index, 1)
      ElMessage.success('删除成功')
    }
  } catch (error) {
    // 用户取消删除
  }
}

const handleSizeChange = (val) => {
  pagination.value.pageSize = val
  pagination.value.currentPage = 1
}

const handleCurrentChange = (val) => {
  pagination.value.currentPage = val
}

const formatDate = (dateStr) => {
  return dateStr.split(' ')[0]
}

const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}分${remainingSeconds}秒`
}

const getTypeTagType = (type) => {
  return type.toLowerCase().includes('task 1') ? 'primary' : 'success'
}

const getScoreTagType = (score) => {
  if (score >= 7) return 'success'
  if (score >= 6) return 'warning'
  return 'danger'
}

const loadHistory = async () => {
  loading.value = true

  try {
    // TODO: 从后端加载历史记录
    // 模拟数据
    await new Promise(resolve => setTimeout(resolve, 1000))

    historyData.value = [
      {
        id: '1',
        date: '2024-10-04 14:30:00',
        topic: '环境问题与个人责任',
        type: 'Task 2',
        wordCount: 285,
        score: 6.5,
        timeSpent: 2400 // 40分钟
      },
      {
        id: '2',
        date: '2024-10-03 16:45:00',
        topic: '教育投资分析',
        type: 'Task 2',
        wordCount: 312,
        score: 7.0,
        timeSpent: 2700 // 45分钟
      },
      {
        id: '3',
        date: '2024-10-02 10:20:00',
        topic: '城市人口增长图表',
        type: 'Task 1',
        wordCount: 198,
        score: 6.0,
        timeSpent: 1800 // 30分钟
      }
    ]

    // 计算统计数据
    const totalCount = historyData.value.length
    const totalScore = historyData.value.reduce((sum, item) => sum + item.score, 0)
    const averageScore = totalCount > 0 ? totalScore / totalCount : 0
    const highestScore = totalCount > 0 ? Math.max(...historyData.value.map(item => item.score)) : 0

    const currentMonth = new Date().getMonth()
    const monthlyCount = historyData.value.filter(item => {
      const itemMonth = new Date(item.date).getMonth()
      return itemMonth === currentMonth
    }).length

    statistics.value = {
      totalCount,
      averageScore,
      highestScore,
      monthlyCount
    }

  } catch (error) {
    ElMessage.error('加载历史记录失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadHistory()
})
</script>

<style scoped>
.history-container {
  height: 100vh;
  background: #f5f7fa;
}

.history-header {
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-left h2 {
  margin: 0;
  color: #2c3e50;
}

.history-main {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.stats-cards {
  margin-bottom: 1.5rem;
}

.stat-card {
  text-align: center;
}

.analysis-card {
  margin-bottom: 1.5rem;
}

.analysis-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.filter-card {
  margin-bottom: 1.5rem;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.topic-cell {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.topic-title {
  font-weight: 500;
  color: #2c3e50;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 1.5rem;
}
</style>