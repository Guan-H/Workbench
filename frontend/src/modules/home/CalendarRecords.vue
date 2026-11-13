<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Checkbox as ACheckbox, Input as AInput, InputNumber as AInputNumber, RadioButton as ARadioButton, RadioGroup as ARadioGroup, Tag as ATag } from 'ant-design-vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { CheckCheck, Clock3, Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import AppDialog from '../../shared/AppDialog.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import { ApiError } from '../../shared/api/client'
import { deleteRecord, durationLabel, loadRecords, saveRecord, type CalendarRecord, type RecordDay, type RecordPage, type RecordWrite } from './calendar-records'

const props = defineProps<{ month: string; date: string }>()
const emit = defineEmits<{ days: [days: RecordDay[]] }>()
const records = ref<RecordPage>(), loading = ref(false), loadError = ref(''), page = ref(1), allMonth = ref(false)
const recordList = ref<HTMLElement>()
const appendError = ref('')
interface EditorBase { id: string; baseVersion: string; title: string; notes: string }
type RecordEditor = EditorBase & (
  | { kind: 'todo'; date: string; time: string; completed: boolean }
  | { kind: 'other'; date: string; time: string }
  | { kind: 'overtime'; start: string; end: string; overtimeHours: number }
)
const editor = ref<RecordEditor>()
const pending = ref<{ id: string; value: RecordWrite; operation: string }>(), saving = ref(false), error = ref(''), conflict = ref(false)
const deleting = ref<CalendarRecord>(), workingId = ref(''), notice = ref<Notice>()
let serial = 0, disposed = false, noticeTimer: ReturnType<typeof setTimeout> | undefined
function onScroll(event: Event) {
  const list = event.currentTarget as HTMLElement
  if (!loading.value && !appendError.value && records.value && page.value * 10 < records.value.total &&
      list.scrollHeight - list.scrollTop - list.clientHeight < 40) void refresh(true)
}
const elapsedMinutes = computed(() => {
  const value = editor.value
  if (!value || value.kind !== 'overtime') return 0
  return Math.max(0, Math.floor((Date.parse(value.end + '+08:00') - Date.parse(value.start + '+08:00')) / 60000))
})
function notify(text: string, kind: Notice['kind'] = 'success') {
  clearTimeout(noticeTimer); notice.value = { text, kind }; noticeTimer = setTimeout(() => { notice.value = undefined }, 2000)
}
async function refresh(append = false) {
  const current = ++serial; loading.value = true; loadError.value = ''; appendError.value = ''
  try {
    const nextPage = append ? page.value + 1 : 1
    const result = await loadRecords(props.month, allMonth.value ? undefined : props.date, nextPage)
    if (current !== serial || disposed) return
    if (append && records.value) result.items = [...new Map([...records.value.items, ...result.items].map(item => [item.id, item])).values()]
    page.value = nextPage
    records.value = result; emit('days', result.days)
  } catch (cause) {
    if (current === serial && !disposed) {
      const message = cause instanceof Error ? cause.message : '记录读取失败，请重试。'
      if (append) appendError.value = message
      else loadError.value = message
    }
  } finally {
    if (current === serial && !disposed) {
      loading.value = false
      await nextTick()
      const list = recordList.value
      if (!loadError.value && !appendError.value && list && records.value &&
          page.value * 10 < records.value.total && list.scrollHeight <= list.clientHeight) void refresh(true)
    }
  }
}
watch(() => [props.month, props.date], () => { records.value = undefined; page.value = 1; allMonth.value = false; void refresh() }, { immediate: true })
watch(allMonth, () => { void refresh() })
function open(item?: CalendarRecord) {
  pending.value = undefined; error.value = ''; conflict.value = false
  if (!item) editor.value = { id: crypto.randomUUID(), baseVersion: '0', kind: 'todo', date: props.date, title: '', notes: '', time: '', completed: false }
  else if (item.kind === 'overtime') editor.value = { id: item.id, baseVersion: item.version, kind: item.kind, title: item.title, notes: item.notes, start: item.start, end: item.end, overtimeHours: item.overtimeMinutes / 60 }
  else if (item.kind === 'todo') editor.value = { id: item.id, baseVersion: item.version, kind: item.kind, title: item.title, notes: item.notes, date: item.date, time: item.time ?? '', completed: item.completed }
  else editor.value = { id: item.id, baseVersion: item.version, kind: item.kind, title: item.title, notes: item.notes, date: item.date, time: item.time ?? '' }
}
function changeKind(kind: string) {
  const value = editor.value
  if (!value || value.baseVersion !== '0' || !['todo', 'overtime', 'other'].includes(kind)) return
  const common = { id: value.id, baseVersion: value.baseVersion, title: value.title, notes: value.notes }
  if (kind === 'overtime') editor.value = { ...common, kind, start: props.date + 'T18:00', end: props.date + 'T20:00', overtimeHours: 2 }
  else if (kind === 'todo') editor.value = { ...common, kind, date: props.date, time: '', completed: false }
  else if (kind === 'other') editor.value = { ...common, kind, date: props.date, time: '' }
}
async function submit() {
  const value = editor.value
  if (!value || saving.value || conflict.value) return
  error.value = ''
  if (!pending.value) {
    if (!value.title.trim()) { error.value = '请填写标题。'; return }
    if (value.kind === 'overtime') {
      const overtimeMinutes = Math.round(value.overtimeHours * 60)
      if (!Number.isFinite(value.overtimeHours) || overtimeMinutes <= 0 || elapsedMinutes.value <= 0 || overtimeMinutes > elapsedMinutes.value) { error.value = '结束时间须晚于开始时间，加班时长须大于 0 且不能超过开始至结束的时间跨度。'; return }
      pending.value = { id: value.id, operation: crypto.randomUUID(), value: { baseVersion: value.baseVersion, kind: value.kind, date: value.start.slice(0, 10), title: value.title, notes: value.notes, time: null, completed: false, start: value.start, end: value.end, overtimeMinutes } }
    } else if (value.kind === 'todo') {
      pending.value = { id: value.id, operation: crypto.randomUUID(), value: { baseVersion: value.baseVersion, kind: value.kind, date: value.date, title: value.title, notes: value.notes, time: value.time || null, completed: value.completed, start: null, end: null, overtimeMinutes: null } }
    } else {
      pending.value = { id: value.id, operation: crypto.randomUUID(), value: { baseVersion: value.baseVersion, kind: value.kind, date: value.date, title: value.title, notes: value.notes, time: value.time || null, completed: false, start: null, end: null, overtimeMinutes: null } }
    }
  }
  saving.value = true
  try {
    const request = pending.value
    await saveRecord(request.id, request.value, request.operation)
    if (disposed) return
    editor.value = undefined; pending.value = undefined; notify('日历记录已保存。'); await refresh()
  } catch (cause) {
    if (disposed) return
    conflict.value = cause instanceof ApiError && cause.status === 409
    if (cause instanceof ApiError && cause.status < 500) pending.value = undefined
    error.value = cause instanceof Error ? cause.message : '保存结果未确认，请重试；原输入保留。'
  } finally { saving.value = false }
}
async function toggle(item: CalendarRecord) {
  if (item.kind !== 'todo' || workingId.value) return
  workingId.value = item.id
  try {
    await saveRecord(item.id, { baseVersion: item.version, kind: item.kind, date: item.date, title: item.title, notes: item.notes, time: item.time, completed: !item.completed, start: null, end: null, overtimeMinutes: null }, crypto.randomUUID())
    if (!disposed) { notify(item.completed ? '待办已标记为未完成。' : '待办已完成。'); await refresh() }
  } catch (cause) { if (!disposed) { notify(cause instanceof Error ? cause.message : '完成状态未确认，请重新读取核对。', 'error'); await refresh() } }
  finally { workingId.value = '' }
}
async function remove(accepted: boolean) {
  const item = deleting.value; deleting.value = undefined
  if (!accepted || !item) return
  workingId.value = item.id
  try { await deleteRecord(item, crypto.randomUUID()); if (!disposed) { notify('日历记录已删除。'); await refresh() } }
  catch (cause) { if (!disposed) notify(cause instanceof Error ? cause.message : '删除结果未确认，请重新读取核对。', 'error') }
  finally { workingId.value = '' }
}
onBeforeUnmount(() => { disposed = true; serial++; clearTimeout(noticeTimer) })
</script>

<template>
  <section class="calendar-records" aria-label="日历记录" :aria-busy="loading">
    <header class="calendar-records-heading"><h3><CheckCheck :size="16" aria-hidden="true" />日历记录</h3><AButton size="small" @click="open()"><Plus :size="14" aria-hidden="true" />添加记录</AButton></header>
    <p class="calendar-month-summary" data-testid="overtime-summary"><Clock3 :size="14" aria-hidden="true" />{{ month }} 加班合计 <strong>{{ records?.month === month ? durationLabel(records.overtimeMinutes) : '—' }}</strong></p>
    <div class="calendar-records-filter"><span>{{ allMonth ? '本月全部记录' : date }}</span><AButton type="link" size="small" @click="page = 1; allMonth = !allMonth">{{ allMonth ? '查看当天' : '本月记录' }}</AButton></div>
    <AAlert v-if="loadError" type="error" :message="loadError" show-icon><template #action><AButton size="small" @click="refresh()">重试</AButton></template></AAlert>
    <div v-else ref="recordList" class="calendar-record-list" tabindex="0" aria-label="日历记录列表" @scroll="onScroll">
      <p v-if="loading && !records" role="status">正在读取记录…</p>
      <p v-else-if="!records?.items.length" class="calendar-record-empty">{{ allMonth ? '本月暂无记录' : '当天暂无记录' }}</p>
      <article v-for="item in records?.items" :key="item.id" class="calendar-record" :data-record-id="item.id">
        <div class="calendar-record-title"><ACheckbox v-if="item.kind === 'todo'" :checked="item.completed" :disabled="!!workingId || loading" :aria-label="`${item.completed ? '取消完成' : '完成'} ${item.title}`" @change="toggle(item)" /><ATag v-else-if="item.kind === 'overtime'" color="blue">加班</ATag><ATag v-else>其他</ATag><strong :class="{ completed: item.kind === 'todo' && item.completed }">{{ item.title }}</strong><AButton type="text" size="small" :aria-label="`编辑 ${item.title}`" :title="`编辑 ${item.title}`" :disabled="!!workingId || loading" @click="open(item)"><Pencil :size="14" aria-hidden="true" /></AButton><AButton type="text" size="small" :aria-label="`删除 ${item.title}`" :title="`删除 ${item.title}`" :disabled="!!workingId || loading" @click="deleting = item"><Trash2 :size="14" aria-hidden="true" /></AButton></div>
        <p v-if="item.kind === 'overtime'">{{ item.start.replace('T', ' ') }} → {{ item.end.replace('T', ' ') }}<br />加班 {{ durationLabel(item.overtimeMinutes) }}</p>
        <p v-else>{{ item.date }}{{ item.time ? ' · ' + item.time : ' · 全天' }}<template v-if="item.kind === 'todo'"> · {{ item.completed ? '已完成' : '待完成' }}</template></p>
        <p v-if="item.notes" class="calendar-record-notes">{{ item.notes }}</p>
      </article>
      <p v-if="loading && records" class="calendar-record-empty" role="status">正在读取更多记录…</p>
      <AAlert v-if="appendError" type="error" :message="appendError" show-icon><template #action><AButton size="small" @click="refresh(true)">重试</AButton></template></AAlert>
    </div>
  </section>
  <AppDialog v-if="editor" label="日历记录" :width="560"><form class="modal calendar-record-dialog" novalidate @submit.prevent="submit"><header><h2>{{ editor.baseVersion === '0' ? '添加记录' : '编辑记录' }}</h2><AButton type="text" class="icon-button" aria-label="关闭日历记录" :disabled="saving" @click="editor = undefined"><X :size="18" /></AButton></header>
    <div class="calendar-record-form"><fieldset :disabled="saving || !!pending"><legend class="sr-only">记录内容</legend><ARadioGroup :value="editor.kind" :disabled="editor.baseVersion !== '0' || saving || !!pending" aria-label="记录类型" @update:value="changeKind"><ARadioButton value="todo">待办</ARadioButton><ARadioButton value="overtime">加班</ARadioButton><ARadioButton value="other">其他</ARadioButton></ARadioGroup>
      <label for="calendar-record-title">标题</label><AInput id="calendar-record-title" v-model:value="editor.title" :maxlength="200" required />
      <template v-if="editor.kind !== 'overtime'"><label for="calendar-record-date">日期</label><AInput id="calendar-record-date" v-model:value="editor.date" type="date" min="1900-01-01" max="2100-12-31" required /><label for="calendar-record-time">时间（可选）</label><AInput id="calendar-record-time" v-model:value="editor.time" type="time" /><ACheckbox v-if="editor.kind === 'todo'" v-model:checked="editor.completed">已完成</ACheckbox></template>
      <template v-else><label for="calendar-record-start">开始时间（北京时间）</label><AInput id="calendar-record-start" v-model:value="editor.start" type="datetime-local" min="1900-01-01T00:00" max="2100-12-31T23:59" required /><label for="calendar-record-end">结束时间（可选次日）</label><AInput id="calendar-record-end" v-model:value="editor.end" type="datetime-local" min="1900-01-01T00:00" max="2100-12-31T23:59" required /><label for="calendar-record-overtime">加班时长（小时）</label><AInputNumber id="calendar-record-overtime" v-model:value="editor.overtimeHours" :min="0.25" :step="0.5" :precision="2" inputmode="decimal" /><p class="field-help">开始至结束共 {{ durationLabel(elapsedMinutes) }}。整条记录归开始日，计入开始日所在月份。</p></template>
      <label for="calendar-record-notes">备注（可选）</label><AInput.TextArea id="calendar-record-notes" v-model:value="editor.notes" :maxlength="4000" :rows="3" /></fieldset>
      <AAlert v-if="error" type="error" :message="error" show-icon role="alert" /><p v-if="pending && !saving" class="field-help">保存结果未确认，重试会提交同一操作。关闭前请保留输入以便核对。</p><AButton v-if="conflict" @click="refresh()">重新读取列表（保留当前输入）</AButton>
    </div><footer><AButton :disabled="saving" @click="editor = undefined">关闭</AButton><AButton type="primary" html-type="submit" :loading="saving" :disabled="conflict">{{ pending ? '重试保存' : '保存记录' }}</AButton></footer></form></AppDialog>
  <ConfirmDialog v-if="deleting" title="删除日历记录" :message="`确定删除“${deleting.title}”？删除后不再计入列表和加班汇总。`" confirm-label="删除" @answer="remove" />
  <AppMessage :notice="notice" @close="notice = undefined" />
</template>

<style scoped>
.calendar-records { display: flex; flex-direction: column; flex: 1; min-height: 0; margin-top: 16px; padding: 14px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-paper-tint); }
.calendar-records > :not(.calendar-record-list) { flex-shrink: 0; }
.calendar-records-heading, .calendar-records-heading h3, .calendar-month-summary, .calendar-records-filter, .calendar-record-title { display: flex; align-items: center; gap: 8px; }
.calendar-records-heading { justify-content: space-between; flex-wrap: wrap; }
.calendar-records-heading h3 { margin: 0; font-size: 14px; }
.calendar-month-summary { flex-wrap: wrap; margin: 14px 0 8px; color: var(--color-text-muted); font-size: 12px; }
.calendar-month-summary strong { color: var(--color-text); }
.calendar-records-filter { justify-content: space-between; font-size: 12px; color: var(--color-text-muted); }
.calendar-record-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-text-muted) 28%, transparent) transparent;
  padding-right: 2px;
}
.calendar-record-list::-webkit-scrollbar { width: 6px; }
.calendar-record-list::-webkit-scrollbar-track { background: transparent; }
.calendar-record-list::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: color-mix(in srgb, var(--color-text-muted) 30%, transparent); background-clip: content-box; }
.calendar-record-list:hover::-webkit-scrollbar-thumb { background-color: color-mix(in srgb, var(--color-text-muted) 50%, transparent); }
.calendar-record { margin-bottom: 10px; padding: 12px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface); }
.calendar-record:last-child { margin-bottom: 0; }
.calendar-record-title { gap: 5px; }
.calendar-record-title strong { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.calendar-record-title .completed { text-decoration: line-through; color: var(--color-text-muted); }
.calendar-record p { margin: 6px 0 0; font-size: 12px; color: var(--color-text-muted); line-height: 1.7; overflow-wrap: anywhere; }
.calendar-record .calendar-record-notes { white-space: pre-wrap; color: var(--color-text); }
.calendar-record-empty { padding: 12px 0; color: var(--color-text-muted); font-size: 13px; }
.calendar-record-form { padding: 20px 24px; max-height: 65dvh; overflow-y: auto; }
.calendar-record-form fieldset { display: grid; gap: 10px; border: 0; margin: 0; padding: 0; min-width: 0; }
.calendar-record-form label { font-size: 13px; }
.calendar-record-dialog .calendar-record-form :deep(label.ant-radio-button-wrapper) { display: inline-block; margin: 0; }
.calendar-record-dialog > footer { margin-top: 0; padding: 16px 24px; border-top: 1px solid var(--color-border); }
.calendar-record-form .ant-input-number { width: 100%; }
.calendar-record-form > .ant-alert { margin-top: 12px; }
@media (max-width: 900px) { .calendar-records { flex: none; } .calendar-record-list { flex: none; max-height: 330px; } }
@media (max-width: 600px) { .calendar-record-form { padding: 16px; } .calendar-record-dialog input { min-height: 40px; } .calendar-record-title .ant-btn { min-height: 36px; min-width: 32px; } }
</style>
