import { api, write } from '../../shared/api/client'

interface RecordBase { id: string; version: string; date: string; title: string; notes: string; deleted: boolean }
export type CalendarRecord = RecordBase & (
  | { kind: 'todo'; time: string | null; completed: boolean; start: null; end: null; overtimeMinutes: 0 }
  | { kind: 'overtime'; time: null; completed: false; start: string; end: string; overtimeMinutes: number }
  | { kind: 'other'; time: string | null; completed: false; start: null; end: null; overtimeMinutes: 0 }
)
export interface RecordPreview { kind: 'todo' | 'overtime' | 'other'; title: string; time: string | null; completed: boolean; start: string | null; end: string | null; overtimeMinutes: number }
export interface RecordDay { date: string; todos: number; pending: number; others: number; overtimes: number; overtimeMinutes: number; previews: RecordPreview[] }
export interface RecordPage { month: string; days: RecordDay[]; overtimeMinutes: number; items: CalendarRecord[]; total: number; page: number }
export type RecordWrite = { baseVersion: string; date: string; title: string; notes: string } & (
  | { kind: 'todo'; time: string | null; completed: boolean; start: null; end: null; overtimeMinutes: null }
  | { kind: 'overtime'; time: null; completed: false; start: string; end: string; overtimeMinutes: number }
  | { kind: 'other'; time: string | null; completed: false; start: null; end: null; overtimeMinutes: null }
)
export function loadRecords(month: string, date: string | undefined, page: number) {
  return api<RecordPage>(`/home/calendar/records?month=${encodeURIComponent(month)}&page=${page}${date ? '&date=' + encodeURIComponent(date) : ''}`)
}
export function saveRecord(id: string, value: RecordWrite, operation: string) {
  return write<CalendarRecord>('/home/calendar/records/' + id, 'PUT', value, operation)
}
export function deleteRecord(item: CalendarRecord, operation: string) {
  return write<CalendarRecord>('/home/calendar/records/' + item.id + '/delete', 'POST', { baseVersion: item.version }, operation)
}
export function durationLabel(minutes: number) {
  return `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`
}
