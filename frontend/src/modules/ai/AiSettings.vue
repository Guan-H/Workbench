<script setup lang="ts">
import {
  Alert as AAlert, Button as AButton, Input as AInput, InputPassword as AInputPassword,
  Select as ASelect, Spin as ASpin, Textarea as ATextarea,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import { discoverAiModels, probeAi, readAiProviders, saveAiSettings, type AiModel, type AiResult, type AiSettings } from './ai-api'

const lifecycle = new AbortController()
const settings = ref<AiSettings>()
const providers = ref<AiSettings[]>([])
const selectedProvider = ref('deepseek')
const pendingProvider = ref('')
const provider = ref('')
const models = ref<AiModel[]>([])
const apiKey = ref('')
const modelId = ref('')
const prompt = ref('')
const output = ref('')
const result = ref<AiResult>()
const settingsError = ref('')
const probeError = ref('')
const saved = ref(false)
const busy = ref<'load' | 'save' | 'probe'>()
const discovered = ref<AiModel[]>([])
const discovering = ref(false)
const discoveryError = ref('')
let discoveryRequest: AbortController | undefined

const options = computed(() => settings.value?.models.map(item => ({ label: item.name, value: item.modelId })) ?? [])
const canProbe = computed(() => settings.value?.keyConfigured && settings.value.encryptionReady && modelId.value && prompt.value.trim())
const canDiscover = computed(() => settings.value?.providerId === 'openrouter'
  || settings.value?.keyConfigured && settings.value.encryptionReady)
const dirty = computed(() => !!settings.value && (apiKey.value !== '' || provider.value !== settings.value.providerName
  || JSON.stringify(models.value) !== JSON.stringify(settings.value.models)))

function providerStatus(item: AiSettings) {
  if (item.keyConfigured && item.models.length) return `已保存 · ${item.models.length} 个模型`
  if (item.keyConfigured) return '已保存 Key · 待添加模型'
  return item.revision > 0 ? '已保存配置 · 缺少 Key' : '未配置'
}
const availableOptions = computed(() => {
  const added = new Set(models.value.map(model => model.modelId.trim()))
  return discovered.value.filter(model => !added.has(model.modelId)).map(model => ({
    value: model.modelId,
    label: model.name === model.modelId ? model.modelId : `${model.name} · ${model.modelId}`,
  }))
})

async function discover() {
  discoveryError.value = ''
  if (!settings.value || !canDiscover.value || discovering.value) return
  const request = new AbortController()
  discoveryRequest = request
  discovering.value = true
  try {
    const rows = await discoverAiModels(settings.value.providerId, request.signal)
    if (!request.signal.aborted) discovered.value = rows
  } catch (cause) {
    if (!request.signal.aborted) {
      discovered.value = []
      discoveryError.value = message(cause)
    }
  } finally {
    if (!request.signal.aborted) discovering.value = false
  }
}

function addDiscovered(id: unknown) {
  if (typeof id !== 'string') return
  const item = discovered.value.find(model => model.modelId === id)
  if (!item || models.value.length >= 20 || models.value.some(model => model.modelId.trim() === id)) return
  models.value.push({ ...item })
  saved.value = false
}

function apply(value: AiSettings) {
  settings.value = value
  provider.value = value.providerName
  models.value = value.models.map(item => ({ ...item }))
  apiKey.value = ''
  if (!value.models.some(item => item.modelId === modelId.value)) modelId.value = value.models[0]?.modelId ?? ''
}

function openProvider(id: string) {
  const target = providers.value.find(item => item.providerId === id)
  if (!target || lifecycle.signal.aborted) return
  discoveryRequest?.abort()
  discovering.value = false
  discovered.value = []
  discoveryError.value = ''
  settingsError.value = ''
  probeError.value = ''
  saved.value = false
  prompt.value = ''
  output.value = ''
  result.value = undefined
  modelId.value = ''
  selectedProvider.value = id
  apply(target)
  void discover()
}

function switchProvider(value: unknown) {
  if (typeof value !== 'string' || value === selectedProvider.value || busy.value) return
  if (dirty.value) pendingProvider.value = value
  else openProvider(value)
}

function confirmProvider(accepted: boolean) {
  const destination = pendingProvider.value
  pendingProvider.value = ''
  if (accepted) openProvider(destination)
}

async function load() {
  busy.value = 'load'
  settingsError.value = ''
  saved.value = false
  try {
    providers.value = await readAiProviders(lifecycle.signal)
    openProvider(selectedProvider.value)
  } catch (cause) {
    if (!lifecycle.signal.aborted) settingsError.value = message(cause)
  } finally {
    busy.value = undefined
  }
}

async function save() {
  if (!settings.value || busy.value || discovering.value) return
  busy.value = 'save'
  saved.value = false
  settingsError.value = ''
  const keyChanged = !!apiKey.value
  try {
    const changed = await saveAiSettings(selectedProvider.value, {
      revision: settings.value.revision,
      providerName: provider.value,
      models: models.value,
      apiKey: apiKey.value || undefined,
    }, lifecycle.signal)
    providers.value = providers.value.map(item => item.providerId === changed.providerId ? changed : item)
    apply(changed)
    saved.value = true
    if (keyChanged || !discovered.value.length) {
      discovered.value = []
      void discover()
    }
  } catch (cause) {
    if (!lifecycle.signal.aborted) settingsError.value = message(cause)
  } finally {
    busy.value = undefined
  }
}

async function probe(stream: boolean) {
  if (!canProbe.value || busy.value) return
  busy.value = 'probe'
  probeError.value = ''
  output.value = ''
  result.value = undefined
  try {
    result.value = await probeAi({ providerId: selectedProvider.value, modelId: modelId.value, text: prompt.value }, stream, lifecycle.signal,
      text => { output.value += text })
    output.value = result.value.text
  } catch (cause) {
    if (!lifecycle.signal.aborted) probeError.value = message(cause)
  } finally {
    busy.value = undefined
  }
}

function message(cause: unknown) {
  return cause instanceof Error && !(cause instanceof TypeError) ? cause.message : '无法连接服务，请稍后重试。'
}

onMounted(() => { void load() })
onBeforeUnmount(() => { discoveryRequest?.abort(); lifecycle.abort() })
</script>

<template>
  <section class="ai-settings" aria-label="AI 服务设置">
    <section v-if="providers.length" class="home-card ai-card" aria-labelledby="ai-provider-list-title">
      <header class="ai-heading">
        <h2 id="ai-provider-list-title">服务商列表</h2>
        <AButton :disabled="!!busy" @click="load">重新读取</AButton>
      </header>
      <p class="field-help">每家服务商的配置独立保存。保存 Key 和至少一个模型后，就能在聊天输入框选择该服务商。</p>
      <div class="ai-provider-list">
        <AButton v-for="item in providers" :key="item.providerId" class="ai-provider-option"
          :class="{ 'is-current': item.providerId === selectedProvider }"
          :aria-pressed="item.providerId === selectedProvider" :disabled="!!busy" @click="switchProvider(item.providerId)">
          <span class="ai-provider-option-name">{{ item.providerName }}</span>
          <small>{{ providerStatus(item) }}</small>
        </AButton>
      </div>
    </section>
    <form class="home-card ai-card" @submit.prevent="save">
      <header class="ai-heading">
        <h2>{{ settings ? settings.providerLabel + ' 配置' : 'AI 服务商配置' }}</h2>
        <AButton v-if="!providers.length && settingsError" html-type="button" :disabled="!!busy" @click="load">重新读取</AButton>
      </header>
      <AAlert v-if="settingsError" type="error" show-icon :message="settingsError" />
      <ASpin v-if="!settings && busy === 'load'" aria-label="读取 AI 设置" />
      <template v-if="settings">
        <AAlert v-if="!settings.encryptionReady" type="warning" show-icon message="服务器需要配置 AI 加密密钥，才能保存和使用 API Key。" />
        <div class="ai-config-fields">
          <label for="ai-provider">服务商名称
            <AInput id="ai-provider" v-model:value="provider" :maxlength="80" :disabled="!!busy" required />
          </label>
          <label for="ai-key">API Key
            <AInputPassword id="ai-key" v-model:value="apiKey" autocomplete="new-password" :maxlength="512"
              :placeholder="settings.keyConfigured ? '已保存，留空则保留' : '输入 ' + settings.providerLabel + ' API Key'"
              :disabled="!!busy || !settings.encryptionReady" />
          </label>
        </div>
        <p class="field-help">服务地址 {{ settings.baseUrl }}</p>
        <fieldset class="ai-models" :disabled="!!busy">
          <legend>模型</legend>
          <div v-if="canDiscover" class="ai-discover">
            <label for="ai-discovered-model">从服务商模型列表添加
              <ASelect id="ai-discovered-model" :value="undefined" :options="availableOptions" show-search
                option-filter-prop="label" :loading="discovering" :disabled="discovering || !availableOptions.length || models.length >= 20"
                :placeholder="discovering ? '正在读取…' : availableOptions.length ? '选择后自动填入模型 ID 和名称' : '暂无可添加的模型'"
                @select="addDiscovered" />
            </label>
            <AButton html-type="button" :loading="discovering" :disabled="!!busy || discovering" @click="discover">刷新列表</AButton>
          </div>
          <AAlert v-if="discoveryError" type="warning" show-icon :message="discoveryError" />
          <p v-if="!canDiscover && !models.length" class="field-help">保存 API Key 后会自动读取模型列表。也可以手填模型 ID。</p>
          <div v-for="(model, index) in models" :key="index" class="ai-model-row">
            <label :for="'ai-model-id-' + index">模型 ID
              <AInput :id="'ai-model-id-' + index" v-model:value="model.modelId" :maxlength="160" placeholder="填写服务商提供的模型 ID" required />
            </label>
            <label :for="'ai-model-name-' + index">显示名称
              <AInput :id="'ai-model-name-' + index" v-model:value="model.name" :maxlength="80" required />
            </label>
            <AButton html-type="button" :aria-label="'移除第 ' + (index + 1) + ' 个模型'" @click="models.splice(index, 1)">移除</AButton>
          </div>
        </fieldset>
        <div class="ai-actions">
          <AButton html-type="button" :disabled="!!busy || models.length >= 20" @click="models.push({ modelId: '', name: '' })">手动添加</AButton>
          <AButton html-type="submit" type="primary" :loading="busy === 'save'" :disabled="!!busy || discovering">保存设置</AButton>
          <span v-if="saved" class="field-help" role="status">{{ settings.providerName }} 的配置已保存</span>
        </div>
      </template>
    </form>
    <section v-if="settings" class="home-card ai-card" aria-labelledby="ai-probe-title">
      <header class="ai-heading"><h2 id="ai-probe-title">连接测试</h2></header>
      <p class="field-help">测试仅将下方文字发送给 {{ settings.providerLabel }}，可能消耗账户额度。</p>
      <label for="ai-probe-model">已保存的模型
        <ASelect id="ai-probe-model" v-model:value="modelId" :options="options" :disabled="!!busy" />
      </label>
      <label for="ai-probe-text">测试文字
        <ATextarea id="ai-probe-text" v-model:value="prompt" :rows="3" :maxlength="4000" :disabled="!!busy" placeholder="例如：用一句话问好。" />
      </label>
      <div class="ai-actions">
        <AButton :disabled="!canProbe || !!busy" @click="probe(false)">测试普通回复</AButton>
        <AButton type="primary" :disabled="!canProbe || !!busy" @click="probe(true)">测试流式回复</AButton>
        <span v-if="busy === 'probe'" class="field-help" role="status">正在等待回复…</span>
      </div>
      <AAlert v-if="probeError" type="error" show-icon :message="probeError" />
      <p v-if="output" class="ai-output">{{ output }}</p>
      <p v-if="result" class="field-help" role="status">
        {{ result.finishReason === 'length' ? '回复达到输出上限' : '已收到完整回复' }} · {{ result.provider }} · {{ result.model }}
        · {{ result.elapsedMs }} 毫秒 · Token 总量 {{ result.usage?.totalTokens ?? '未知' }}
      </p>
    </section>
    <ConfirmDialog v-if="pendingProvider" title="切换服务商" message="当前修改尚未保存。切换后会丢弃这些修改，是否继续？"
      confirm-label="放弃修改并切换" @answer="confirmProvider" />
  </section>
</template>

<style scoped>
.ai-settings { display: grid; gap: 16px; max-width: 880px; padding-bottom: 16px; }
.ai-card { display: grid; gap: 14px; min-width: 0; }
.ai-heading, .ai-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.ai-heading { justify-content: space-between; }
.ai-heading h2 { font-size: 17px; margin: 0; }
.ai-card p { margin: 0; }
.ai-provider-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr)); gap: 8px; }
.ai-provider-option.ant-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; height: auto; min-height: 54px; min-width: 0; padding: 7px 10px; text-align: left; }
.ai-provider-option.is-current { border-color: var(--color-primary); background: var(--color-selection); }
.ai-provider-option-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.ai-provider-option small { color: var(--color-text-muted); white-space: normal; line-height: 1.3; }
.ai-card label { display: grid; min-width: 0; gap: 6px; font-size: 13px; }
.ai-config-fields, .ai-model-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: end; }
.ai-model-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
.ai-discover { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: end; }
.ai-models { display: grid; gap: 10px; min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--color-border); border-radius: 8px; }
.ai-models legend { width: auto; margin: 0; padding: 0 5px; font-size: 13px; font-weight: 600; }
.ai-output { max-height: 300px; overflow: auto; padding: 12px; background: var(--color-background); border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .ai-provider-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ai-config-fields, .ai-model-row { grid-template-columns: 1fr; }
  .ai-model-row .ant-btn { justify-self: start; }
  .ai-card .ant-btn { min-height: 44px; }
}
</style>
