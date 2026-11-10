import type { Note } from '../../shared/api/client'
export interface NovelFolder { id: string; parentId: string; name: string }
export interface NovelBook { fileId: string; folderId: string; sourcePath: string; file: Note | null }
export interface NovelLibrary { revision: string; folders: NovelFolder[]; books: NovelBook[] }
export interface LibraryChange { baseRevision: string; action: 'create-folder' | 'update-folder' | 'delete-folder' | 'add-book' | 'move-book' | 'remove-book'; id?: string; parentId?: string; name?: string }
export function folderPath(id: string, folders: NovelFolder[]): string {
  const names: string[] = [], seen = new Set<string>()
  while (id && !seen.has(id)) { seen.add(id); const item = folders.find(folder => folder.id === id); if (!item) break; names.unshift(item.name); id = item.parentId }
  return names.join('/')
}
export function folderOptions(folders: NovelFolder[]) { return [{value:'',label:'书籍根目录 /'}, ...folders.map(item => ({value:item.id,label:folderPath(item.id,folders)})).sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'))] }
