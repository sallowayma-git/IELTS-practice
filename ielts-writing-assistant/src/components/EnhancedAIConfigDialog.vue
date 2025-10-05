<template>
  <el-dialog
    v-model="visible"
    title="AI配置"
    width="700px"
    :before-close="handleClose"
  >
    <div class="ai-config-container">
      <!-- 供应商选择 -->
      <div class="provider-section">
        <h3>选择AI提供商</h3>
        <el-radio-group v-model="selectedProvider" @change="handleProviderChange">
          <el-radio label="openai" :disabled="!apiKeys.openai.hasKey">
            <span class="provider-item">
              OpenAI GPT
              <el-tag v-if="apiKeys.openai.hasKey" type="success" size="small">已配置</el-tag>
              <el-tag v-else type="info" size="small">未配置</el-tag>
            </span>
          </el-radio>
          <el-radio label="gemini" :disabled="!apiKeys.gemini.hasKey">
            <span class="provider-item">
              Google Gemini
              <el-tag v-if="apiKeys.gemini.hasKey" type="success" size="small">已配置</el-tag>
              <el-tag v-else type="info" size="small">未配置</el-tag>
            </span>
          </el-radio>
          <el-radio label="deepseek" :disabled="!apiKeys.deepseek.hasKey">
            <span class="provider-item">
              DeepSeek
              <el-tag v-if="apiKeys.deepseek.hasKey" type="success" size="small">已配置</el-tag>
              <el-tag v-else type="info" size="small">未配置</el-tag>
            </span>
          </el-radio>
          <el-radio label="openrouter" :disabled="!apiKeys.openrouter.hasKey">
            <span class="provider-item">
              OpenRouter
              <el-tag v-if="apiKeys.openrouter.hasKey" type="success" size="small">已配置</el-tag>
              <el-tag v-else type="info" size="small">未配置</el-tag>
            </span>
          </el-radio>
          <el-radio label="mock">
            <span class="provider-item">
              模拟服务
              <el-tag type="warning" size="small">测试用</el-tag>
            </span>
          </el-radio>
        </el-radio-group>
      </div>

      <!-- API密钥管理 -->
      <div class="api-keys-section">
        <h3>API密钥管理</h3>
        <el-tabs v-model="activeApiKeyTab" type="card">
          <el-tab-pane label="OpenAI" name="openai">
            <div class="api-key-form">
              <el-form :model="apiKeyForms.openai" label-width="120px">
                <el-form-item label="API密钥">
                  <div class="key-input-group">
                    <el-input
                      v-model="apiKeyForms.openai.apiKey"
                      type="password"
                      placeholder="请输入OpenAI API密钥"
                      show-password
                    />
                    <el-button
                      type="primary"
                      @click="saveApiKey('openai')"
                      :loading="saving.openai"
                      :disabled="!apiKeyForms.openai.apiKey"
                    >
                      保存
                    </el-button>
                    <el-button
                      v-if="apiKeys.openai.hasKey"
                      type="danger"
                      @click="deleteApiKey('openai')"
                      :loading="deleting.openai"
                    >
                      删除
                    </el-button>
                  </div>
                  <div v-if="apiKeys.openai.hasKey" class="key-status">
                    <el-text type="success">已保存: {{ apiKeys.openai.keyPreview }}</el-text>
                  </div>
                </el-form-item>
              </el-form>
            </div>
          </el-tab-pane>

          <el-tab-pane label="Gemini" name="gemini">
            <div class="api-key-form">
              <el-form :model="apiKeyForms.gemini" label-width="120px">
                <el-form-item label="API密钥">
                  <div class="key-input-group">
                    <el-input
                      v-model="apiKeyForms.gemini.apiKey"
                      type="password"
                      placeholder="请输入Gemini API密钥"
                      show-password
                    />
                    <el-button
                      type="primary"
                      @click="saveApiKey('gemini')"
                      :loading="saving.gemini"
                      :disabled="!apiKeyForms.gemini.apiKey"
                    >
                      保存
                    </el-button>
                    <el-button
                      v-if="apiKeys.gemini.hasKey"
                      type="danger"
                      @click="deleteApiKey('gemini')"
                      :loading="deleting.gemini"
                    >
                      删除
                    </el-button>
                  </div>
                  <div v-if="apiKeys.gemini.hasKey" class="key-status">
                    <el-text type="success">已保存: {{ apiKeys.gemini.keyPreview }}</el-text>
                  </div>
                </el-form-item>
              </el-form>
            </div>
          </el-tab-pane>

          <el-tab-pane label="DeepSeek" name="deepseek">
            <div class="api-key-form">
              <el-form :model="apiKeyForms.deepseek" label-width="120px">
                <el-form-item label="API密钥">
                  <div class="key-input-group">
                    <el-input
                      v-model="apiKeyForms.deepseek.apiKey"
                      type="password"
                      placeholder="请输入DeepSeek API密钥"
                      show-password
                    />
                    <el-button
                      type="primary"
                      @click="saveApiKey('deepseek')"
                      :loading="saving.deepseek"
                      :disabled="!apiKeyForms.deepseek.apiKey"
                    >
                      保存
                    </el-button>
                    <el-button
                      v-if="apiKeys.deepseek.hasKey"
                      type="danger"
                      @click="deleteApiKey('deepseek')"
                      :loading="deleting.deepseek"
                    >
                      删除
                    </el-button>
                  </div>
                  <div v-if="apiKeys.deepseek.hasKey" class="key-status">
                    <el-text type="success">已保存: {{ apiKeys.deepseek.keyPreview }}</el-text>
                  </div>
                </el-form-item>
              </el-form>
            </div>
          </el-tab-pane>

          <el-tab-pane label="OpenRouter" name="openrouter">
            <div class="api-key-form">
              <el-form :model="apiKeyForms.openrouter" label-width="120px">
                <el-form-item label="API密钥">
                  <div class="key-input-group">
                    <el-input
                      v-model="apiKeyForms.openrouter.apiKey"
                      type="password"
                      placeholder="请输入OpenRouter API密钥"
                      show-password
                    />
                    <el-button
                      type="primary"
                      @click="saveApiKey('openrouter')"
                      :loading="saving.openrouter"
                      :disabled="!apiKeyForms.openrouter.apiKey"
                    >
                      保存
                    </el-button>
                    <el-button
                      v-if="apiKeys.openrouter.hasKey"
                      type="danger"
                      @click="deleteApiKey('openrouter')"
                      :loading="deleting.openrouter"
                    >
                      删除
                    </el-button>
                  </div>
                  <div v-if="apiKeys.openrouter.hasKey" class="key-status">
                    <el-text type="success">已保存: {{ apiKeys.openrouter.keyPreview }}</el-text>
                  </div>
                </el-form-item>
              </el-form>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>

      <!-- 模型配置 -->
      <div v-if="selectedProvider && selectedProvider !== 'mock'" class="model-config-section">
        <h3>模型配置</h3>
        <el-form :model="form" label-width="120px">
          <el-form-item label="模型">
            <el-select v-model="form.model" placeholder="选择模型" filterable>
              <el-option
                v-for="model in getCurrentProviderModels()"
                :key="model.value"
                :label="model.label"
                :value="model.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="响应速度">
            <el-radio-group v-model="form.speed">
              <el-radio label="fast">快速</el-radio>
              <el-radio label="balanced">平衡</el-radio>
              <el-radio label="quality">高质量</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="流式输出">
            <el-switch v-model="form.streaming" />
          </el-form-item>
        </el-form>
      </div>

      <!-- 连接测试 -->
      <div class="test-section">
        <el-button
          type="primary"
          @click="testConnection"
          :loading="testing"
          :disabled="selectedProvider === 'mock'"
        >
          测试连接
        </el-button>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          @click="handleConfirm"
          :loading="saving"
        >
          保存配置
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useApiKeys } from '@/composables/useApiKeys'
import axios from 'axios'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'success'])

const { apiKeys, fetchApiKeysStatus, saveApiKey: saveApiKeyToServer, deleteApiKey: deleteApiKeyFromServer } = useApiKeys()

const visible = ref(false)
const selectedProvider = ref('mock')
const activeApiKeyTab = ref('openai')
const testing = ref(false)
const saving = ref(false)
const deleting = reactive({
  openai: false,
  gemini: false,
  deepseek: false,
  openrouter: false
})

const form = reactive({
  provider: 'mock',
  model: 'gpt-3.5-turbo',
  speed: 'balanced',
  streaming: true
})

const apiKeyForms = reactive({
  openai: { apiKey: '' },
  gemini: { apiKey: '' },
  deepseek: { apiKey: '' },
  openrouter: { apiKey: '' }
})

const providerModels = {
  openai: [
    { label: 'GPT-4o', value: 'gpt-4o' },
    { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
    { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
    { label: 'GPT-4', value: 'gpt-4' },
    { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' }
  ],
  gemini: [
    { label: 'Gemini 2.0 Flash Exp', value: 'gemini-2.0-flash-exp' },
    { label: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro' },
    { label: 'Gemini 1.5 Flash', value: 'gemini-1.5-flash' },
    { label: 'Gemini Pro', value: 'gemini-pro' }
  ],
  deepseek: [
    { label: 'DeepSeek Chat', value: 'deepseek-chat' },
    { label: 'DeepSeek Coder', value: 'deepseek-coder' }
  ],
  openrouter: [
    { label: 'OpenAI GPT-4o', value: 'openai/gpt-4o' },
    { label: 'OpenAI GPT-4o Mini', value: 'openai/gpt-4o-mini' },
    { label: 'Claude 3.5 Sonnet', value: 'anthropic/claude-3.5-sonnet' },
    { label: 'DeepSeek Chat', value: 'deepseek/deepseek-chat' },
    { label: 'Gemini 2.0 Flash Exp', value: 'google/gemini-2.0-flash-exp' }
  ]
}

const getCurrentProviderModels = () => {
  return providerModels[selectedProvider.value] || []
}

// 监听visible变化
watch(() => props.modelValue, (val) => {
  visible.value = val
  if (val) {
    fetchApiKeysStatus()
    loadCurrentConfig()
  }
})

watch(visible, (val) => {
  emit('update:modelValue', val)
})

const loadCurrentConfig = async () => {
  try {
    const response = await axios.get('/api/settings/')
    if (response.data.success) {
      const aiSettings = response.data.data.ai || {}
      Object.assign(form, aiSettings)
      selectedProvider.value = aiSettings.provider || 'mock'
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
}

const handleProviderChange = () => {
  form.provider = selectedProvider.value
  // 设置默认模型
  if (getCurrentProviderModels().length > 0) {
    form.model = getCurrentProviderModels()[0].value
  }
}

const saveApiKey = async (provider) => {
  try {
    deleting[provider] = true
    const apiKey = apiKeyForms[provider].apiKey
    await saveApiKeyToServer(provider, apiKey)

    ElMessage.success(`${provider} API密钥保存成功`)
    apiKeyForms[provider].apiKey = ''

    // 如果当前选中的是这个供应商，启用它
    if (selectedProvider.value === provider) {
      // 供应商已经可以使用了
    }
  } catch (error) {
    console.error('保存API密钥失败:', error)
    ElMessage.error('保存API密钥失败')
  } finally {
    deleting[provider] = false
  }
}

const deleteApiKey = async (provider) => {
  try {
    deleting[provider] = true
    await deleteApiKeyFromServer(provider)

    ElMessage.success(`${provider} API密钥删除成功`)

    // 如果当前选中的是这个供应商，切换到mock
    if (selectedProvider.value === provider) {
      selectedProvider.value = 'mock'
    }
  } catch (error) {
    console.error('删除API密钥失败:', error)
    ElMessage.error('删除API密钥失败')
  } finally {
    deleting[provider] = false
  }
}

const testConnection = async () => {
  try {
    testing.value = true

    const response = await axios.post('/api/assessment/test-connection', {
      provider: selectedProvider.value,
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
  fetchApiKeysStatus()
})
</script>

<style scoped>
.ai-config-container {
  max-height: 600px;
  overflow-y: auto;
}

.provider-section {
  margin-bottom: 24px;
}

.provider-section h3 {
  margin-bottom: 12px;
  color: #303133;
}

.provider-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.api-keys-section {
  margin-bottom: 24px;
}

.api-keys-section h3 {
  margin-bottom: 12px;
  color: #303133;
}

.api-key-form {
  padding: 16px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
}

.key-input-group {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.key-input-group .el-input {
  flex: 1;
}

.key-status {
  margin-top: 8px;
  font-size: 12px;
}

.model-config-section {
  margin-bottom: 24px;
}

.model-config-section h3 {
  margin-bottom: 12px;
  color: #303133;
}

.test-section {
  display: flex;
  justify-content: center;
  padding-top: 16px;
  border-top: 1px solid #e4e7ed;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

:deep(.el-radio) {
  margin-right: 16px;
  margin-bottom: 12px;
}

:deep(.el-radio__label) {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>