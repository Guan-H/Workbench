<script setup lang="ts">
import { Calendar as ACalendar, Button as AButton, Tooltip as ATooltip } from 'ant-design-vue'

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Clock3, FileText, Star } from 'lucide-vue-next'
import dayjs, { type Dayjs } from 'dayjs'
import 'dayjs/locale/zh-cn'
import type { Note } from '../../shared/api/client'
import { loadCalendar, moveMonth, type CalendarDay, type HomeCalendar } from './calendar'
import LearningSummary from '../english/LearningSummary.vue'
import ContentLoading from '../../shared/ContentLoading.vue'
import { vContentMotion } from '../../shared/content-motion'

const props = defineProps<{ username: string; items: Note[]; loading: boolean; error: string }>()
const emit = defineEmits<{ notes: []; favorites: []; open: [note: Note]; refresh: []; learning: [] }>()
const notes = computed(() => props.items.filter(note => !note.deleted && note.type === 'note'))
const recent = computed(() => [...notes.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.path.localeCompare(b.path)).slice(0, 3))
const favorites = computed(() => notes.value.filter(note => note.favorite).sort((a, b) => a.path.localeCompare(b.path)).slice(0, 3))
const documentTab = ref<'recent' | 'favorites'>('recent')
const documentList = computed(() => documentTab.value === 'recent' ? recent.value : favorites.value)
const calendar = ref<HomeCalendar>()
const calendarError = ref('')
const calendarLoading = ref(false)
const requestedMonth = ref<string>()
const selectedDate = ref('')
let requestSerial = 0
let dayTimer: ReturnType<typeof setInterval> | undefined
const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Shanghai' })
const updatedFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })
const todayLabel = computed(() => calendar.value ? dateFormat.format(new Date(calendar.value.today + 'T12:00:00+08:00')) : '正在读取日期…')
const todayNumber = computed(() => calendar.value?.today.slice(-2) ?? '—')
const todayMonth = computed(() => calendar.value?.today.slice(0, 7).replace('-', ' / ') ?? '')
const monthLabel = computed(() => calendar.value ? calendar.value.month.replace('-', ' 年 ') + ' 月' : '')
const calendarDate = computed(() => dayjs(selectedDate.value || (calendar.value?.month ?? '2000-01') + '-01').locale('zh-cn'))
const calendarDays = computed(() => new Map(calendar.value?.days.map(day => [day.date, day]) ?? []))
const selectedDay = computed(() => calendarDays.value.get(selectedDate.value))
const selectedDayLabel = computed(() => selectedDay.value ? dateFormat.format(new Date(selectedDay.value.date + 'T12:00:00+08:00')) : '')

function name(note: Note) { return note.path.split('/').at(-1) ?? note.path }
function updated(note: Note) { return updatedFormat.format(new Date(note.updatedAt)) }
async function documentTabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  documentTab.value = event.key === 'Home' ? 'recent' : event.key === 'End' ? 'favorites' : documentTab.value === 'recent' ? 'favorites' : 'recent'
  await nextTick()
  document.getElementById('home-tab-' + documentTab.value)?.focus()
}
function dayLabel(day: CalendarDay) {
  return `${day.date} ${dayKind(day)}${day.date === calendar.value?.today ? ' 今天' : ''}${calendar.value?.available ? '' : '，放假调休安排待确认'}`
}
function dayKind(day: CalendarDay) {
  return { holiday: day.holiday ? `${day.holiday}放假` : '放假', makeup: '调休上班', weekend: '周末', weekday: '平日' }[day.kind]
}
function selectDate(date: string) {
  if (!calendarLoading.value && calendarDays.value.has(date)) selectedDate.value = date
}
function calendarSelect(date: Dayjs) { selectDate(date.format('YYYY-MM-DD')) }
async function refreshCalendar(month?: string, resetSelection = false) {
  const serial = ++requestSerial
  requestedMonth.value = month
  calendarLoading.value = true
  calendarError.value = ''
  try {
    const result = await loadCalendar(month)
    if (serial === requestSerial) {
      calendar.value = result
      if (resetSelection || !result.days.some(day => day.date === selectedDate.value)) {
        selectedDate.value = result.today.startsWith(result.month + '-') ? result.today : result.month + '-01'
      }
    }
  } catch (cause) {
    if (serial === requestSerial) calendarError.value = cause instanceof Error ? cause.message : '日期信息加载失败，请重试。'
  } finally {
    if (serial === requestSerial) calendarLoading.value = false
  }
}
function changeMonth(offset: number) {
  if (calendar.value) void refreshCalendar(moveMonth(calendar.value.month, offset))
}
function checkDay() {
  const now = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date())
  if (calendar.value && now !== calendar.value.today && !calendarLoading.value) void refreshCalendar(requestedMonth.value)
}
onMounted(() => {
  void refreshCalendar()
  dayTimer = setInterval(checkDay, 60_000)
  window.addEventListener('focus', checkDay)
})
onBeforeUnmount(() => { requestSerial++; clearInterval(dayTimer); window.removeEventListener('focus', checkDay) })
</script>

<template>
  <section class="home-content" aria-labelledby="home-title">
    <div class="home-dashboard">
      <header class="home-heading">
        <div class="home-heading-copy"><span class="home-kicker">我的空间 / 每日一览</span><h1 id="home-title">工作台<span class="home-heading-dot">.</span></h1><p>欢迎回来，{{ username }}。</p></div>
        <div v-if="calendar" class="home-date-signature"><span class="home-date-number" aria-hidden="true">{{ todayNumber }}</span><div><span class="home-date-month" aria-hidden="true">{{ todayMonth }}</span><time :datetime="calendar.today">{{ todayLabel }}</time><span class="home-date-zone">北京时间</span></div></div>
      </header>

      <div class="home-columns">
        <section class="home-card home-calendar" aria-labelledby="home-calendar-title" :aria-busy="calendarLoading">
          <header class="home-card-heading">
            <h2 id="home-calendar-title"><CalendarDays :size="18" aria-hidden="true" />日期与假期
              <ATooltip v-if="calendar && !calendarError" :trigger="['hover', 'focus', 'click']">
                <template #title><div>{{ calendar.notice }}</div><div class="home-calendar-tooltip-legend">休：放假；班：调休上班；灰底为周末。</div></template>
                <AButton type="text" class="home-calendar-info" aria-label="日期与假期说明"><CircleAlert :size="15" aria-hidden="true" /></AButton>
              </ATooltip>
            </h2>
          </header>
          <div v-if="calendarError" class="home-list-message" role="alert"><p>{{ calendarError }}</p><AButton @click="refreshCalendar(requestedMonth)">重试日期信息</AButton></div>
          <template v-else-if="calendar">
            <div class="home-holiday-summary" data-testid="holiday-summary">
              <template v-if="calendar.nextHoliday"><span>{{ calendar.nextHoliday.daysUntil === 0 ? '假期进行中' : '下个假期' }}</span><strong>{{ calendar.nextHoliday.name }}<small>{{ calendar.nextHoliday.daysUntil === 0 ? '好好休息，慢慢记录。' : `还有 ${calendar.nextHoliday.daysUntil} 天` }}</small></strong><p>{{ calendar.nextHoliday.start }} 至 {{ calendar.nextHoliday.end }}</p></template>
              <template v-else><strong>后续假期安排待补充</strong><p>已收录安排中暂无后续假期，不推算调休。</p></template>
            </div>
            <div class="home-month-controls"><AButton type="text" class="icon-button" aria-label="上个月" title="上个月" :disabled="calendarLoading || calendar.month === '1900-01'" @click="changeMonth(-1)"><ChevronLeft :size="18" /></AButton><h3 aria-live="polite">{{ monthLabel }}</h3><AButton type="text" class="icon-button" aria-label="下个月" title="下个月" :disabled="calendarLoading || calendar.month === '2100-12'" @click="changeMonth(1)"><ChevronRight :size="18" /></AButton><AButton :disabled="calendarLoading" @click="refreshCalendar(undefined, true)">本月</AButton></div>
            <ACalendar :value="calendarDate" :fullscreen="false" class="home-month" :valid-range="[dayjs(calendar.month + '-01'), dayjs(calendar.month + '-01').endOf('month')]" :aria-label="monthLabel + '月历'" @select="calendarSelect">
              <template #headerRender><span class="sr-only">{{ monthLabel }}</span></template>
              <template #dateFullCellRender="{ current: date }">
                <template v-for="day in [calendarDays.get(date.format('YYYY-MM-DD'))]" :key="date.format('YYYY-MM-DD')">
                  <AButton v-if="day" type="text" :class="['home-calendar-day', day.kind, { today: day.date === calendar.today, selected: day.date === selectedDate }]" :aria-label="dayLabel(day)" :aria-pressed="day.date === selectedDate" :aria-current="day.date === calendar.today ? 'date' : undefined" :title="dayLabel(day)" :data-calendar-date="day.date" :disabled="calendarLoading" @click="selectDate(day.date)" @keydown.enter.stop @keydown.space.stop><span>{{ day.day }}</span><small v-if="day.kind === 'holiday'">休</small><small v-else-if="day.kind === 'makeup'">班</small></AButton>
                </template>
              </template>
            </ACalendar>
            <div v-if="selectedDay" class="home-selected-date" role="status" aria-live="polite" aria-atomic="true" data-testid="selected-calendar-date">
              <strong><time :datetime="selectedDay.date">{{ selectedDayLabel }}</time></strong><span>{{ dayKind(selectedDay) }}</span>
              <small v-if="!calendar.available">放假与调休安排待确认</small>
            </div>
          </template>
          <ContentLoading v-else skeleton label="正在读取日期与节假日…" />
        </section>

        <div class="home-side">
        <LearningSummary @open="emit('learning')" />
        <section class="home-card home-documents" aria-label="文档速览">
          <div class="home-section-label"><span>文档速览</span><span>接着上次的记录</span></div>
          <header class="home-document-heading">
            <div class="home-document-tabs" role="tablist" aria-label="文档列表类型">
              <AButton id="home-tab-recent" role="tab" aria-controls="home-document-panel" :aria-selected="documentTab === 'recent'" :tabindex="documentTab === 'recent' ? 0 : -1" @click="documentTab = 'recent'" @keydown="documentTabKey"><Clock3 :size="16" aria-hidden="true" />最近编辑</AButton>
              <AButton id="home-tab-favorites" role="tab" aria-controls="home-document-panel" :aria-selected="documentTab === 'favorites'" :tabindex="documentTab === 'favorites' ? 0 : -1" @click="documentTab = 'favorites'" @keydown="documentTabKey"><Star :size="16" aria-hidden="true" />常用收藏</AButton>
            </div>
            <AButton type="text" class="home-document-all" @click="documentTab === 'recent' ? emit('notes') : emit('favorites')">{{ documentTab === 'recent' ? '进入笔记' : '全部收藏' }}<ArrowRight :size="14" aria-hidden="true" /></AButton>
          </header>
          <div id="home-document-panel" role="tabpanel" :aria-labelledby="'home-tab-' + documentTab" tabindex="0">
            <ContentLoading v-if="loading && !items.length" label="正在读取文档…" />
            <div v-else-if="error" class="home-list-message" role="alert"><p>{{ error }}</p><AButton @click="emit('refresh')">重新加载笔记</AButton></div>
            <ul v-else-if="documentList.length" v-content-motion="documentTab" class="home-note-list">
              <li v-for="note in documentList" :key="note.id">
                <AButton :data-home-note="documentTab === 'recent' ? note.id : undefined" :data-home-favorite="documentTab === 'favorites' ? note.id : undefined" :title="note.path" @click="emit('open', note)">
                  <FileText :size="16" aria-hidden="true" />
                  <span class="home-note-info"><strong>{{ name(note) }}</strong><small>{{ note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '根目录' }}</small></span>
                  <time :datetime="note.updatedAt">{{ updated(note) }}</time>
                  <ChevronRight :size="14" aria-hidden="true" />
                </AButton>
              </li>
            </ul>
            <p v-else class="home-list-message">{{ documentTab === 'recent' ? '还没有笔记，可从左侧笔记页面开始记录。' : '还没有收藏，可在笔记页面收藏常用文档。' }}</p>
          </div>
        </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-content { padding: 28px 32px 36px; background: #f7f8fa; }
.home-heading { align-items: center; margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--color-border); }
.home-kicker { display: block; color: var(--color-text-muted); font-size: 12px; letter-spacing: 2px; }
.home-heading-copy h1 { margin: 8px 0 6px; font-size: 32px; font-weight: 650; letter-spacing: -1px; line-height: 1.2; }
.home-heading-dot { color: var(--color-primary); }
.home-heading-copy p { font-size: 13px; }
.home-date-signature { display: flex; align-items: center; gap: 16px; }
.home-date-number { font-family: Georgia, 'Times New Roman', serif; font-size: 72px; line-height: 1; letter-spacing: -4px; color: var(--color-text); }
.home-date-signature > div { display: grid; gap: 4px; }
.home-date-month { font-size: 12px; font-variant-numeric: tabular-nums; letter-spacing: 2px; }
.home-date-signature time { font-size: 12px; color: var(--color-text-muted); }
.home-date-zone { font-size: 11px; color: var(--color-text-muted); }
.home-columns { grid-template-columns: minmax(0, 1fr) 360px; gap: 24px; }
.home-calendar { grid-column: 2; grid-row: 1; }
.home-side { grid-column: 1; grid-row: 1; gap: 20px; }
.home-card { border-radius: 12px; padding: 22px; box-shadow: 0 2px 8px #18263b03; }
.home-calendar .home-card-heading h2 { font-size: 15px; gap: 7px; }
.home-calendar .home-card-heading h2 > svg { color: var(--color-text-muted); }
.home-holiday-summary { background: #f5f7f6; border: 1px solid #e9edea; padding: 12px 14px; border-radius: 8px; }
.home-holiday-summary strong { font-size: 14px; line-height: 1.7; }
.home-holiday-summary p { margin-top: 4px; }
.home-month-controls { margin-top: 16px; }
.home-month-controls h3 { font-size: 13px; }
.home-selected-date { border: 0; border-top: 1px solid var(--color-border); border-radius: 0; padding: 14px 0 0; font-size: 12px; gap: 4px 8px; }
.home-section-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 16px; font-size: 14px; font-weight: 600; }
.home-section-label > span:last-child { color: var(--color-text-muted); font-size: 12px; font-weight: 400; }
.home-document-heading { margin-bottom: 4px; }
.home-document-tabs { gap: 4px; }
.home-document-tabs button { border-radius: 6px; font-size: 12px; }
.home-document-all { min-height: 36px; }
.home-note-list button { min-height: 62px; padding: 10px 8px; border-radius: 6px; background: transparent; box-shadow: none; }
.home-note-list button > svg:first-child { width: 32px; height: 36px; padding: 8px; border: 1px solid var(--color-border); border-radius: 6px; color: var(--color-text-muted); background: #fafbfc; }
.home-note-info { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; flex: 1; gap: 4px; }
.home-note-info strong { display: block; font-size: 13px; font-weight: 500; }
.home-note-info small { font-size: 11px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-note-list time { font-size: 11px; }
@media (min-width: 1600px) { .home-columns { grid-template-columns: minmax(0, 1fr) 400px; } }
@media (max-width: 1120px) {
  .home-content { padding: 24px; }
  .home-columns { grid-template-columns: minmax(0, 1fr) 332px; gap: 16px; }
  .home-card { padding: 18px; }
}
@media (max-width: 900px) {
  .home-columns { grid-template-columns: minmax(0, 1fr); }
  .home-calendar { grid-column: 1; grid-row: 2; }
  .home-side { grid-column: 1; grid-row: 1; }
  .home-calendar :deep(.ant-picker-content) { max-width: 460px; margin-inline: auto; }
}
@media (max-width: 480px) {
  .home-content { padding: 20px 16px 28px; }
  .home-heading { flex-direction: row; align-items: center; gap: 12px; padding-bottom: 20px; margin-bottom: 20px; }
  .home-kicker { font-size: 10px; letter-spacing: 1px; }
  .home-heading-copy h1 { font-size: 26px; }
  .home-heading-copy p { max-width: 140px; overflow-wrap: anywhere; font-size: 12px; }
  .home-date-signature { gap: 8px; flex-shrink: 0; }
  .home-date-number { font-size: 46px; letter-spacing: -2px; }
  .home-date-month { font-size: 10px; letter-spacing: 1px; }
  .home-date-signature time { max-width: 100px; font-size: 10px; line-height: 1.6; }
  .home-date-zone { font-size: 10px; }
  .home-card { padding: 16px; }
  .home-section-label > span:last-child { font-size: 11px; }
  .home-note-list button { gap: 8px; }
  .home-document-tabs button { padding-inline: 7px; }
}
</style>
