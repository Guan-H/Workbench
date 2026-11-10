<script setup lang="ts">
import { Calendar as ACalendar, Button as AButton, Tooltip as ATooltip } from 'ant-design-vue'

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Clock3, FileText, Star } from 'lucide-vue-next'
import dayjs, { type Dayjs } from 'dayjs'
import 'dayjs/locale/zh-cn'
import type { Note } from '../../shared/api/client'
import { loadCalendar, moveMonth, type CalendarDay, type HomeCalendar } from './calendar'
import DailyEnglishCard from '../english/DailyEnglishCard.vue'

const props = defineProps<{ items: Note[]; loading: boolean; error: string }>()
const emit = defineEmits<{ notes: []; favorites: []; open: [note: Note]; refresh: [] }>()
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
        <h1 id="home-title">工作台</h1>
        <p v-if="calendar"><time :datetime="calendar.today">{{ todayLabel }}</time><span>北京时间</span></p>
      </header>

      <div class="home-columns">
        <section class="home-card home-calendar" aria-labelledby="home-calendar-title" :aria-busy="calendarLoading">
          <header class="home-card-heading">
            <h2 id="home-calendar-title"><CalendarDays :size="18" aria-hidden="true" />日期与假期
              <ATooltip v-if="calendar && !calendarError" :trigger="['hover', 'focus', 'click']">
                <template #title><div>{{ calendar.notice }}</div><div class="home-calendar-tooltip-legend">休：放假；班：调休上班；灰底为周末。</div></template>
                <AButton type="text" class="home-calendar-info" aria-label="日期与假期说明"><CircleAlert :size="15" aria-hidden="true" /></AButton>
              </ATooltip>
            </h2><span>北京时间</span>
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
          <p v-else class="home-list-message" role="status">正在读取日期与节假日…</p>
        </section>

        <div class="home-side">
        <DailyEnglishCard />
        <section class="home-card home-documents" aria-label="文档速览">
          <header class="home-document-heading">
            <div class="home-document-tabs" role="tablist" aria-label="文档列表类型">
              <AButton id="home-tab-recent" role="tab" aria-controls="home-document-panel" :aria-selected="documentTab === 'recent'" :tabindex="documentTab === 'recent' ? 0 : -1" @click="documentTab = 'recent'" @keydown="documentTabKey"><Clock3 :size="16" aria-hidden="true" />最近编辑</AButton>
              <AButton id="home-tab-favorites" role="tab" aria-controls="home-document-panel" :aria-selected="documentTab === 'favorites'" :tabindex="documentTab === 'favorites' ? 0 : -1" @click="documentTab = 'favorites'" @keydown="documentTabKey"><Star :size="16" aria-hidden="true" />常用收藏</AButton>
            </div>
            <AButton type="text" class="home-document-all" @click="documentTab === 'recent' ? emit('notes') : emit('favorites')">{{ documentTab === 'recent' ? '进入笔记' : '全部收藏' }}<ArrowRight :size="14" aria-hidden="true" /></AButton>
          </header>
          <div id="home-document-panel" role="tabpanel" :aria-labelledby="'home-tab-' + documentTab" tabindex="0">
            <p v-if="loading" class="home-list-message" role="status">正在读取文档…</p>
            <div v-else-if="error" class="home-list-message" role="alert"><p>{{ error }}</p><AButton @click="emit('refresh')">重新加载笔记</AButton></div>
            <ul v-else-if="documentList.length" class="home-note-list">
              <li v-for="note in documentList" :key="note.id">
                <AButton :data-home-note="documentTab === 'recent' ? note.id : undefined" :data-home-favorite="documentTab === 'favorites' ? note.id : undefined" :title="note.path" @click="emit('open', note)">
                  <FileText :size="16" aria-hidden="true" />
                  <span class="home-note-info"><strong>{{ name(note) }}</strong></span>
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
