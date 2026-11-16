import type { Article, Word } from './types'
export interface CourseSummary {
  id: string; title: string; focus: string; source: string; revision: string
  position: string; completed: boolean; answered: number; reviewCount: number; favorite: boolean; kind: string
}
export interface CoursePage { items: CourseSummary[]; total: number; page: number }
export interface SentenceEntry { courseId: string; title: string; sentenceIndex: number; text: string; marked: boolean }
export interface SentencePage { items: SentenceEntry[]; total: number; page: number }
export interface CourseSentence { text: string; translation: string; vocabulary: string; forms: string; structure: string }
export interface CourseQuestion {
  prompt: string; options: string[]; selected: number | null
  answer: number | null; explanation: string | null; evidence: string | null
}
export interface CourseDetail {
  summary: CourseSummary; article: Article; sentences: CourseSentence[]; words: Word[]
  questions: CourseQuestion[]; marked: number[]; wrong: number[]
  origin: { kind: string; url: string | null; publishedAt: string | null; provider: string; licenseUrl: string | null } | null
}
export interface CourseChange {
  baseRevision: string; action: 'position' | 'answer' | 'mark' | 'finish' | 'favorite'
  position?: string; index?: number; choice?: number; marked?: boolean; favorite?: boolean
}
