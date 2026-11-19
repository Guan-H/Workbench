<script setup lang="ts">
import {
  Alert as AAlert, Button as AButton, Input as AInput, InputPassword as AInputPassword,
  Select as ASelect, Spin as ASpin, Textarea as ATextarea, message as antMessage,
} from 'ant-design-vue'
import { Trash2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppDialog from '../../shared/AppDialog.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import AiProviderIcon from './AiProviderIcon.vue'
import { chatModelKey, createAiConnection, deleteAiConnection, discoverAiModels, probeAi, readAiProviderPresets, readAiProviders,
  readDefaultModel, saveAiSettings, saveDefaultModel, type AiDefaultModel, type AiModel, type AiProviderPreset,
  type AiResult, type AiSettings } from './ai-api'

const lifecycle = new AbortController()
const settings = ref<AiSettings>()
const providers = ref<AiSettings[]>([])
const presets = ref<AiProviderPreset[]>([])
const selectedConnection = ref('')
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
const busy = ref<'load' | 'save' | 'probe' | 'delete'>()
const discovered = ref<AiModel[]>([])
const discovering = ref(false)
const discoveryError = ref('')
const AUTO_MODEL = 'auto'
const defaultModel = ref<AiDefaultModel>()
const defaultChoice = ref(AUTO_MODEL)
const defaultSaving = ref(false)
const defaultSaved = ref(false)
const defaultError = ref('')
const creating = ref(false)
const creatingBusy = ref(false)
const createError = ref('')
const newProvider = ref('deepseek')
const newName = ref('')
const newKey = ref('')
const newBaseUrl = ref('')
const deleting = ref<AiSettings>()
const [messages, MessageHolder] = antMessage.useMessage()
let discoveryRequest: AbortController | undefined

const options = computed(() => settings.value?.models.map(item => ({ label: item.name, value: item.modelId })) ?? [])
const canProbe = computed(() => settings.value?.available && settings.value.keyConfigured && settings.value.encryptionReady && modelId.value && prompt.value.trim())
const canDiscover = computed(() => settings.value?.available && (settings.value.providerId === 'openrouter'
  || settings.value.keyConfigured && settings.value.encryptionReady))
const dirty = computed(() => !!settings.value && (apiKey.value !== '' || provider.value !== settings.value.providerName
  || JSON.stringify(models.value) !== JSON.stringify(settings.value.models)))
const configuredDefaults = computed(() => providers.value
  .filter(item => item.available && item.keyConfigured && item.encryptionReady)
  .flatMap(item => item.models.map(model => ({
    value: chatModelKey(item.connectionId, model.modelId),
    label: `${item.providerName} / ${model.name}`,
    providerId: item.providerId, modelId: model.modelId, connectionId: item.connectionId,
  }))))
const savedDefaultChoice = computed(() => {
  const value = defaultModel.value
  return value?.connectionId && value.modelId ? chatModelKey(value.connectionId, value.modelId) : AUTO_MODEL
})
const providerChoices = computed(() => [
  ...presets.value.map(item => ({ value: item.id, label: item.label })),
  { value: 'custom', label: '自定义服务' },
])
const selectedPreset = computed(() => presets.value.find(item => item.id === newProvider.value))
const isCustom = computed(() => newProvider.value === 'custom')
const canCreate = computed(() => !!(newName.value.trim() && newKey.value.trim()
  && (isCustom.value ? newBaseUrl.value.trim() : selectedPreset.value)))
const deletePrompt = computed(() => {
  const item = deleting.value
  if (!item) return ''
  const relevant = defaultModel.value?.connectionId === item.connectionId ? '新会话需要重新选择默认模型。' : ''
  return `删除「${item.providerName}」会移除已保存的 Key 和模型配置，已有聊天记录会保留。${relevant}`
})
const defaultUnavailable = computed(() => savedDefaultChoice.value !== AUTO_MODEL
  && !configuredDefaults.value.some(item => item.value === savedDefaultChoice.value))
const defaultOptions = computed(() => {
  const options: { value: string; label: string; disabled?: boolean }[] = [
    { value: AUTO_MODEL, label: '自动选择第一个已配置模型' }, ...configuredDefaults.value,
  ]
  if (defaultUnavailable.value) options.push({
    value: savedDefaultChoice.value, label: `${defaultModel.value?.modelId}（不可用）`, disabled: true,
  })
  return options
})

function providerStatus(item: AiSettings) {
  if (!item.available) return '服务地址已停用'
  return item.models.length ? `已保存 · ${item.models.length} 个模型` : '已保存 Key · 待添加模型'
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
    const rows = await discoverAiModels(settings.value, request.signal)
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
  const target = providers.value.find(item => item.connectionId === id)
  if (lifecycle.signal.aborted) return
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
  selectedConnection.value = target?.connectionId ?? ''
  if (target) {
    apply(target)
    void discover()
  } else {
    settings.value = undefined
    provider.value = ''
    models.value = []
    apiKey.value = ''
  }
}

function switchProvider(value: unknown) {
  if (typeof value !== 'string' || value === selectedConnection.value || busy.value) return
  if (dirty.value) pendingProvider.value = value
  else openProvider(value)
}

function confirmProvider(accepted: boolean) {
  const destination = pendingProvider.value
  pendingProvider.value = ''
  if (!accepted) return
  if (destination === 'new-connection') openCreate()
  else openProvider(destination)
}

function openCreate() {
  newName.value = ''
  newKey.value = ''
  newBaseUrl.value = ''
  newProvider.value = presets.value.find(item => item.id === settings.value?.providerId)?.id ?? presets.value[0]?.id ?? 'deepseek'
  createError.value = ''
  creating.value = true
}

function beginCreate() {
  if (dirty.value) pendingProvider.value = 'new-connection'
  else openCreate()
}

async function submitConnection() {
  if (creatingBusy.value || !canCreate.value) return
  creatingBusy.value = true
  createError.value = ''
  try {
    const created = await createAiConnection({
      providerId: newProvider.value, name: newName.value, apiKey: newKey.value,
      baseUrl: isCustom.value ? newBaseUrl.value.trim() : undefined,
    }, lifecycle.signal)
    providers.value.push(created)
    closeCreate()
    openProvider(created.connectionId)
    void messages.success('连接已保存')
  } catch (cause) {
    if (!lifecycle.signal.aborted) createError.value = message(cause)
  } finally { creatingBusy.value = false }
}

function closeCreate() {
  newKey.value = ''
  newBaseUrl.value = ''
  creating.value = false
}

async function confirmDelete(accepted: boolean) {
  const item = deleting.value
  deleting.value = undefined
  if (!accepted || !item || busy.value || defaultSaving.value) return
  busy.value = 'delete'
  settingsError.value = ''
  try {
    await deleteAiConnection(item, lifecycle.signal)
    providers.value = providers.value.filter(row => row.connectionId !== item.connectionId)
    if (selectedConnection.value === item.connectionId) openProvider(providers.value[0]?.connectionId ?? '')
    if (defaultChoice.value === savedDefaultChoice.value || !defaultOptions.value.some(row => row.value === defaultChoice.value)) {
      defaultChoice.value = savedDefaultChoice.value
    }
    void messages.success('连接已删除')
  } catch (cause) {
    if (!lifecycle.signal.aborted) settingsError.value = message(cause)
  } finally {
    busy.value = undefined
  }
}

async function load() {
  if (defaultSaving.value) return
  busy.value = 'load'
  settingsError.value = ''
  saved.value = false
  defaultSaved.value = false
  defaultError.value = ''
  try {
    const [catalog, available, preference] = await Promise.all([
      readAiProviders(lifecycle.signal), readAiProviderPresets(lifecycle.signal), readDefaultModel(lifecycle.signal),
    ])
    providers.value = catalog
    presets.value = available
    defaultModel.value = preference
    defaultChoice.value = savedDefaultChoice.value
    const selected = catalog.find(item => item.connectionId === selectedConnection.value) ?? catalog[0]
    openProvider(selected?.connectionId ?? '')
  } catch (cause) {
    if (!lifecycle.signal.aborted) settingsError.value = message(cause)
  } finally {
    busy.value = undefined
  }
}

async function saveDefault() {
  const previous = defaultModel.value
  if (!previous || busy.value || defaultSaving.value || defaultChoice.value === savedDefaultChoice.value) return
  const selected = configuredDefaults.value.find(item => item.value === defaultChoice.value)
  if (!selected && defaultChoice.value !== AUTO_MODEL) {
    defaultError.value = '请选择已配置的模型。'
    return
  }
  defaultSaving.value = true
  defaultSaved.value = false
  defaultError.value = ''
  try {
    defaultModel.value = await saveDefaultModel({
      revision: previous.revision, providerId: selected?.providerId ?? null, modelId: selected?.modelId ?? null,
      connectionId: selected?.connectionId ?? null,
    }, lifecycle.signal)
    defaultChoice.value = savedDefaultChoice.value
    defaultSaved.value = true
  } catch (cause) {
    if (!lifecycle.signal.aborted) defaultError.value = message(cause)
  } finally { defaultSaving.value = false }
}

async function save() {
  if (!settings.value || busy.value || discovering.value) return
  busy.value = 'save'
  saved.value = false
  settingsError.value = ''
  const keyChanged = !!apiKey.value
  try {
    const changed = await saveAiSettings(settings.value, {
      revision: settings.value.revision,
      providerName: provider.value,
      models: models.value,
      apiKey: apiKey.value || undefined,
    }, lifecycle.signal)
    providers.value = providers.value.map(item => item.connectionId === changed.connectionId ? changed : item)
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
  if (!canProbe.value || !settings.value || busy.value) return
  busy.value = 'probe'
  probeError.value = ''
  output.value = ''
  result.value = undefined
  try {
    result.value = await probeAi({
      providerId: settings.value.providerId, connectionId: settings.value.connectionId, modelId: modelId.value, text: prompt.value,
    }, stream, lifecycle.signal,
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
    <MessageHolder />
    <div class="ai-settings-sidebar">
    <section class="home-card ai-card" aria-labelledby="ai-provider-list-title">
      <header class="ai-heading">
        <h2 id="ai-provider-list-title">连接列表</h2>
        <AButton :disabled="!!busy || defaultSaving || !presets.length" @click="beginCreate">新增连接</AButton>
      </header>
      <div v-if="providers.length" class="ai-provider-list" aria-label="AI 连接">
        <div v-for="item in providers" :key="item.connectionId" class="ai-provider-row">
          <AButton class="ai-provider-option" :class="{ 'is-current': item.connectionId === selectedConnection }"
            :aria-pressed="item.connectionId === selectedConnection" :disabled="!!busy" :title="item.providerName"
            @click="switchProvider(item.connectionId)">
            <AiProviderIcon :provider-id="item.providerId" />
            <span class="ai-provider-option-text">
              <span class="ai-provider-option-name">{{ item.providerName }}</span>
              <small>{{ item.providerName === item.providerLabel ? '' : item.providerLabel + ' · ' }}{{ providerStatus(item) }}</small>
            </span>
          </AButton>
          <AButton type="text" danger class="ai-provider-delete" :disabled="!!busy || defaultSaving"
            :aria-label="`删除连接 ${item.providerName}`" title="删除连接" @click="deleting = item">
            <Trash2 :size="16" aria-hidden="true" />
          </AButton>
        </div>
      </div>
      <p v-else-if="busy !== 'load'" class="field-help">暂无连接。新增连接并保存 API Key 后会显示在这里。</p>
    </section>
    <form v-if="defaultModel" class="home-card ai-card" aria-labelledby="ai-default-title" @submit.prevent="saveDefault">
      <header class="ai-heading"><h2 id="ai-default-title">新会话默认模型</h2></header>
      <p class="field-help">只影响新建会话，不会更改已有会话的模型。</p>
      <label for="ai-default-model" @keydown.enter.prevent>默认连接 / 模型
        <ASelect id="ai-default-model" v-model:value="defaultChoice" :options="defaultOptions" :disabled="!!busy || defaultSaving"
          show-search option-filter-prop="label" @change="defaultSaved = false; defaultError = ''" />
      </label>
      <AAlert v-if="defaultUnavailable" type="warning" show-icon message="已保存的默认模型不可用。请重新选择，或改回自动选择。" />
      <AAlert v-if="defaultError" type="error" show-icon :message="defaultError" />
      <div class="ai-actions">
        <AButton html-type="submit" type="primary" :loading="defaultSaving"
          :disabled="!!busy || defaultSaving || defaultChoice === savedDefaultChoice">保存默认模型</AButton>
        <span v-if="defaultSaved" class="field-help" role="status">默认模型已保存</span>
      </div>
    </form>
    </div>
    <div class="ai-settings-detail">
    <form class="home-card ai-card" @submit.prevent="save">
      <header class="ai-heading">
        <h2>{{ settings ? settings.providerName + ' · 连接配置' : 'AI 连接配置' }}</h2>
        <AButton html-type="button" :disabled="!!busy || defaultSaving" @click="load">重新读取</AButton>
      </header>
      <AAlert v-if="settingsError" type="error" show-icon :message="settingsError" />
      <ASpin v-if="!settings && busy === 'load'" aria-label="读取 AI 设置" />
      <p v-else-if="!settings && !settingsError" class="field-help">添加连接后，可在这里管理模型和测试回复。</p>
      <AAlert v-if="settings && !settings.available" type="warning" show-icon
        message="此自定义服务地址已停用。若要改用其他地址，请新增连接。" />
      <template v-if="settings?.available">
        <AAlert v-if="!settings.encryptionReady" type="warning" show-icon message="服务器需要配置 AI 加密密钥，才能保存和使用 API Key。" />
        <div class="ai-config-fields">
          <label for="ai-provider">连接名称
            <AInput id="ai-provider" v-model:value="provider" :maxlength="80" :disabled="!!busy" required />
          </label>
          <label for="ai-key">API Key
            <AInputPassword id="ai-key" v-model:value="apiKey" autocomplete="new-password" :maxlength="512"
              :placeholder="settings.keyConfigured ? '已保存，留空则保留' : '输入 ' + settings.providerLabel + ' API Key'"
              :disabled="!!busy || !settings.encryptionReady" />
          </label>
        </div>
        <p class="field-help">{{ settings.providerLabel }} · {{ settings.baseUrl }}</p>
        <p v-if="settings.keyConfigured" class="field-help">接入不同账号请新增连接。替换此处的 Key 后，续聊发送历史会要求重新确认。</p>
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
    <section v-if="settings?.available" class="home-card ai-card" aria-labelledby="ai-probe-title">
      <header class="ai-heading"><h2 id="ai-probe-title">连接测试</h2></header>
      <p class="field-help">测试使用「{{ settings.providerName }}」连接保存的 Key，只发送下方文字，可能消耗该账号的额度。</p>
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
    </div>
    <ConfirmDialog v-if="pendingProvider" title="当前连接尚未保存" message="离开后会丢弃未保存的修改，是否继续？"
      confirm-label="放弃修改并继续" @answer="confirmProvider" />
    <ConfirmDialog v-if="deleting" title="删除 AI 连接" :message="deletePrompt"
      confirm-label="删除连接" @answer="confirmDelete" />
    <AppDialog v-if="creating" label="新增 AI 连接" :width="440">
      <form class="modal ai-create-dialog" @submit.prevent="submitConnection">
        <header><h2>新增连接</h2></header>
        <div class="ai-card ai-create-fields">
          <label for="ai-new-provider" @keydown.enter.prevent>服务商
            <ASelect id="ai-new-provider" v-model:value="newProvider" :options="providerChoices" :disabled="creatingBusy">
              <template #option="{ label, value }">
                <span class="ai-provider-choice"><AiProviderIcon :provider-id="value" />{{ label }}</span>
              </template>
            </ASelect>
          </label>
          <p v-if="selectedPreset?.custom" class="field-help ai-preset-address">
            服务地址 <span>{{ selectedPreset.baseUrl }}</span>
          </p>
          <label for="ai-new-name">{{ isCustom ? '服务名称' : '连接名称' }}
            <AInput id="ai-new-name" v-model:value="newName" :placeholder="isCustom ? '例如 我的模型网关' : '例如 DeepSeek · 工作'"
              :maxlength="80" :disabled="creatingBusy" autofocus required />
          </label>
          <label v-if="isCustom" for="ai-new-base-url">服务地址（Base URL）
            <AInput id="ai-new-base-url" v-model:value="newBaseUrl" type="url" autocomplete="off"
              placeholder="https://api.example.com/v1" :maxlength="512" :disabled="creatingBusy"
              aria-describedby="ai-new-base-url-help" required />
            <small id="ai-new-base-url-help" class="field-help">填写服务商提供的公网 HTTPS 接口前缀。更换地址时请新建连接。</small>
          </label>
          <label for="ai-new-key">API Key
            <AInputPassword id="ai-new-key" v-model:value="newKey" autocomplete="new-password" :maxlength="512"
              :disabled="creatingBusy" required />
          </label>
          <AAlert v-if="createError" type="error" show-icon :message="createError" />
        </div>
        <footer>
          <AButton html-type="button" :disabled="creatingBusy" @click="closeCreate">取消</AButton>
          <AButton type="primary" html-type="submit" :loading="creatingBusy" :disabled="!canCreate">保存连接</AButton>
        </footer>
      </form>
    </AppDialog>
  </section>
</template>

<style scoped>
.ai-settings { display: grid; gap: 16px; padding-bottom: 16px; align-items: start; grid-template-columns: minmax(216px, 280px) minmax(0, 1fr); }
.ai-settings-sidebar, .ai-settings-detail { display: grid; gap: 16px; min-width: 0; }
.ai-card { display: grid; gap: 14px; min-width: 0; }
.ai-heading, .ai-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.ai-heading { justify-content: space-between; }
.ai-heading h2 { font-size: 17px; margin: 0; }
.ai-card p { margin: 0; }
.ai-provider-list { display: grid; gap: 8px; max-height: min(46vh, 400px); overflow-y: auto; }
.ai-provider-row { display: grid; grid-template-columns: minmax(0, 1fr) 44px; align-items: center; gap: 4px; }
.ai-provider-delete.ant-btn { width: 44px; min-height: 44px; padding: 0; }
.ai-provider-option.ant-btn {
  --ai-provider-icon-size: 28px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  height: auto;
  min-height: 54px;
  min-width: 0;
  padding: 7px 10px;
  text-align: left;
}
.ai-provider-option.is-current { border-color: var(--color-primary); background: var(--color-selection); }
.ai-provider-option-text { display: grid; min-width: 0; gap: 3px; }
.ai-provider-option-name { overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.ai-provider-option small { color: var(--color-text-muted); white-space: normal; line-height: 1.3; }
.ai-provider-choice { display: flex; align-items: center; gap: 8px; }
.ai-preset-address { overflow-wrap: anywhere; }
.ai-card label { display: grid; min-width: 0; gap: 6px; font-size: 13px; }
.ai-config-fields, .ai-model-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: end; }
.ai-model-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
.ai-discover { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: end; }
.ai-models { display: grid; gap: 10px; min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--color-border); border-radius: 8px; }
.ai-models legend { width: auto; margin: 0; padding: 0 5px; font-size: 13px; font-weight: 600; }
.ai-output { max-height: 300px; overflow: auto; padding: 12px; background: var(--color-background); border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ai-create-fields { padding: 16px 24px; }
.ai-create-dialog footer { padding: 0 24px 20px; }
@media (max-width: 1000px) {
  .ai-settings { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 600px) {
  .ai-config-fields, .ai-model-row { grid-template-columns: 1fr; }
  .ai-model-row .ant-btn { justify-self: start; }
  .ai-card .ant-btn { min-height: 44px; }
}
</style>
