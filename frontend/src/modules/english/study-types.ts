import type { Word } from './types'
export interface StudySettings { revision: string; newLimit: number; reviewLimit: number; sentenceLimit: number }
export interface StudySource { batchId: string; date: string; articleIndex: number }
export interface StudyProgress { mode: string; stage: number; mistakes: number; nextDate: string | null }
export interface StudyItem { id: string; kind: string; name: string; meaning: string; word: Word | null; sources: StudySource[]; progress: StudyProgress[] }
export interface StudyItems { items: StudyItem[]; total: number; page: number }
export interface StudyTask { id: string; itemId: string; mode: string; kind: string; completed: boolean; revision: string; prompt: string; reference: string | null; answer: string; submitted: boolean; rating: string | null; gameId: string | null; sources: StudySource[] }
export interface StudyPlan { id: string; date: string; batchId: string | null; newLimit: number; reviewLimit: number; sentenceLimit: number; tasks: StudyTask[]; vocabulary: Word[]; matchingGame: string | null; spellingGame: string | null }
export interface StudyDashboard { settings: StudySettings; words: number; sentences: number; wrongWords: number; due: number; plan: StudyPlan | null }
