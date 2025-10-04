<template>
  <el-dialog
    v-model="visible"
    title="AI配置"
    width="600px"
    :before-close="handleClose"
  >
    <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
      <el-form-item label="AI提供商" prop="provider">
        <el-select v-model="form.provider" @change="handleProviderChange" placeholder="选择AI提供商">
          <el-option
            v-for="provider in providers"
            :key="provider.value"
            :label="provider.label"
            :value="provider.value"
          />
        </el-select>
      </el-form-item>

      <!-- OpenAI配置 -->
      <template v-if="form.provider === 'openai'">
        <el-form-item label="API密钥" prop="apiKey">
          <el-input
            v-model="form.apiKey"
            type="password"
            placeholder="请输入OpenAI API密钥"
            show-password
          />
        </el-form-item>
        <el-form-item label="模型" prop="model">
          <el-select v-model="form.model" placeholder="选择模型">
            <el-option label="GPT-4" value="gpt-4" />
            <el-option label="GPT-3.5 Turbo" value="gpt-3.5-turbo" />
            <el-option label="GPT-4o" value="gpt-4o" />
            <el-option label="GPT-4o Mini" value="gpt-4o-mini" />
          </el-select>
        </el-form-item>
        <el-form-item label="响应速度" prop="speed">
          <el-radio-group v-model="form.speed">
            <el-radio label="fast">快速</el-radio>
            <el-radio label="balanced">平衡</el-radio>
            <el-radio label="quality">高质量</el-radio>
          </el-radio-group>
        </el-form-item>
      </template>

      <!-- Azure OpenAI配置 -->
      <template v-if="form.provider === 'azure'">
        <el-form-item label="API密钥" prop="apiKey">
          <el-input
            v-model="form.apiKey"
            type="password"
            placeholder="请输入Azure OpenAI API密钥"
            show-password
          />
        </el-form-item>
        <el-form-item label="部署名称" prop="deployment">
          <el-input v-model="form.deployment" placeholder="Azure部署名称" />
        </el-form-item>
        <el-form-item label="端点" prop="endpoint">
          <el-input v-model="form.endpoint" placeholder="https://your-resource.openai.azure.com" />
        </el-form-item>
        <el-form-item label="API版本" prop="apiVersion">
          <el-input v-model="form.apiVersion" placeholder="2024-02-15-preview" />
        </el-form-item>
      </template>

      <!-- OpenRouter配置 -->
      <template v-if="form.provider === 'openrouter'">
        <el-form-item label="API密钥" prop="apiKey">
          <el-input
            v-model="form.apiKey"
            type="password"
            placeholder="请输入OpenRouter API密钥"
            show-password
          />
        </el-form-item>
        <el-form-item label="模型" prop="model">
          <el-select v-model="form.model" placeholder="选择模型">
            <el-option label="OpenAI GPT-4o" value="openai/gpt-4o" />
            <el-option label="OpenAI GPT-4o Mini" value="openai/gpt-4o-mini" />
            <el-option label="OpenAI GPT-4" value="openai/gpt-4" />
            <el-option label="OpenAI GPT-3.5 Turbo" value="openai/gpt-3.5-turbo" />
            <el-option label="Anthropic Claude 3.5 Sonnet" value="anthropic/claude-3.5-sonnet" />
            <el-option label="Google Gemini Pro" value="google/gemini-pro" />
          </el-select>
        </el-form-item>
        <el-form-item label="应用名称" prop="appName">
          <el-input v-model="form.appName" placeholder="IELTS Writing Assistant" />
        </el-form-item>
        <el-form-item label="网站URL" prop="siteUrl">
          <el-input v-model="form.siteUrl" placeholder="https://your-website.com" />
        </el-form-item>
        <el-form-item label="响应速度" prop="speed">
          <el-radio-group v-model="form.speed">
            <el-radio label="fast">快速</el-radio>
            <el-radio label="balanced">平衡</el-radio>
            <el-radio label="quality">高质量</el-radio>
          </el-radio-group>
        </el-form-item>
      </template>

      <!-- Mock配置 -->
      <template v-if="form.provider === 'mock'">
        <el-form-item label="响应时间" prop="responseTime">
          <el-input-number
            v-model="form.responseTime"
            :min="500"
            :max="10000"
            :step="500"
            placeholder="模拟响应时间(毫秒)"
          />
          <span style="margin-left: 8px; color: #909399;">毫秒</span>
        </el-form-item>
        <el-form-item label="错误率" prop="errorRate">
          <el-input-number
            v-model="form.errorRate"
            :min="0"
            :max="100"
            :step="5"
            placeholder="模拟错误率(%)"
          />
          <span style="margin-left: 8px; color: #909399;">%</span>
        </el-form-item>
      </template>

      <el-form-item label="流式响应">
        <el-switch v-model="form.streaming" />
        <div style="margin-top: 8px; color: #909399; font-size: 12px;">
          启用后可以看到AI评估的实时进度
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="testConnection" :loading="testing">
          测试连接
        </el-button>
        <el-button @click="handleClose">取消</el-button>
        <el-button type="primary" @click="handleConfirm" :loading="saving">
          确认
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const emit = defineEmits(['update:modelValue', 'success'])

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const visible = ref(false)
const testing = ref(false)
const saving = ref(false)
const formRef = ref()

const providers = ref([
  { label: 'OpenAI GPT', value: 'openai' },
  { label: 'Azure OpenAI', value: 'azure' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: '模拟服务', value: 'mock' }
])

const form = reactive({
  provider: 'mock',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  deployment: '',
  endpoint: '',
  apiVersion: '2024-02-15-preview',
  speed: 'balanced',
  responseTime: 2000,
  errorRate: 0,
  streaming: true
})

const rules = {
  provider: [
    { required: true, message: '请选择AI提供商', trigger: 'change' }
  ],
  apiKey: [
    { required: true, message: '请输入API密钥', trigger: 'blur' }
  ],
  model: [
    { required: true, message: '请选择模型', trigger: 'change' }
  ],
  deployment: [
    { required: true, message: '请输入部署名称', trigger: 'blur' }
  ],
  endpoint: [
    { required: true, message: '请输入端点', trigger: 'blur' },
    { type: 'url', message: '请输入有效的URL', trigger: 'blur' }
  ]
}

// 监听visible变化
watch(() => props.modelValue, (val) => {
  visible.value = val
  if (val) {
    loadCurrentConfig()
  }
})

// 监听visible变化
watch(visible, (val) => {
  emit('update:modelValue', val)
})

const loadCurrentConfig = async () => {
  try {
    const response = await axios.get('/api/settings/')
    if (response.data.success) {
      const aiSettings = response.data.data.ai || {}
      Object.assign(form, aiSettings)
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
}

const handleProviderChange = () => {
  // 重置表单验证
  if (formRef.value) {
    formRef.value.clearValidate()
  }
}

const testConnection = async () => {
  try {
    await formRef.value.validate()
    testing.value = true

    const response = await axios.post('/api/assessment/test-connection', {
      provider: form.provider,
      config: form
    })

    if (response.data.success) {
      if (response.data.data.connected) {
        ElMessage.success('连接测试成功！')
      } else {
        ElMessage.error('连接测试失败，请检查配置')
      }
    }
  } catch (error) {
    console.error('测试连接失败:', error)
    ElMessage.error(error.response?.data?.message || '连接测试失败')
  } finally {
    testing.value = false
  }
}

const handleConfirm = async () => {
  try {
    await formRef.value.validate()
    saving.value = true

    // 保存AI配置
    await axios.post('/api/assessment/configure', {
      provider: form.provider,
      config: form
    })

    // 保存到用户设置
    await axios.put('/api/settings/', {
      category: 'ai',
      settings: form
    })

    ElMessage.success('AI配置保存成功！')
    emit('success')
    handleClose()
  } catch (error) {
    console.error('保存配置失败:', error)
    ElMessage.error(error.response?.data?.message || '保存配置失败')
  } finally {
    saving.value = false
  }
}

const handleClose = () => {
  visible.value = false
}

onMounted(() => {
  loadCurrentConfig()
})
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>