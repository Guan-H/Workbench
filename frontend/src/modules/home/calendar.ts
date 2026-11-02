import { api } from '../../shared/api/client'

export interface CalendarDay {
  date: string
  day: number
  weekday: number
  kind: 'holiday' | 'makeup' | 'weekend' | 'weekday'
  holiday: string | null
}

export interface HomeCalendar {
  month: string
  today: string
  timeZone: string
  available: boolean
  source: { title: string; url: string; checkedOn: string } | null
  days: CalendarDay[]
  nextHoliday: { name: string; start: string; end: string; daysUntil: number } | null
  notice: string
}

export function loadCalendar(month?: string) {
  return api<HomeCalendar>('/home/calendar' + (month ? '?month=' + encodeURIComponent(month) : ''))
}

export function moveMonth(month: string, offset: number) {
  const date = new Date(month + '-01T00:00:00Z')
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}
