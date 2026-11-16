import { api, write } from '../../shared/api/client'
export interface TimeTotals { overtimeMinutes: number; timeOffMinutes: number }
export interface OpeningBalance { version: number; startDate: string | null; openingMinutes: number | null }
export interface LedgerSummary { month: string; monthly: TimeTotals; cumulative: TimeTotals; opening: OpeningBalance; recordsRevision: string; netMinutes: number }
export interface LedgerHistory { items: (TimeTotals & { month: string })[]; total: number; page: number }
export interface OpeningChange { baseVersion: string; recordsRevision: string; startDate: string; openingMinutes: number }
export interface OpeningProjection { request: OpeningChange; overtimeMinutes: number; timeOffMinutes: number; netMinutes: number }
const root='/home/calendar/ledger'
export const loadLedger=(month:string)=>api<LedgerSummary>(`${root}?month=${encodeURIComponent(month)}`)
export const loadLedgerHistory=(page:number)=>api<LedgerHistory>(`${root}/history?page=${page}`)
export const previewOpening=(value:OpeningChange)=>write<OpeningProjection>(`${root}/opening-preview`,'POST',value)
export const saveOpening=(value:OpeningChange,operation:string)=>write<OpeningBalance>(`${root}/opening`,'PUT',value,operation)
export function timeLabel(minutes:number) {
  const value=Math.abs(minutes),hours=Math.floor(value/60),rest=value%60
  return `${minutes<0?'-':''}${hours}小时${rest?`${rest}分钟`:''}`
}
export function dayLabel(minutes:number) {
  const value=Math.abs(minutes),days=Math.floor(value/480),rest=value%480
  return `${minutes<0?'-':''}${days?`${days}天`:''}${rest||!days?timeLabel(rest):''}`
}
