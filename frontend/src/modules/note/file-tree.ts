import type { TreeItem } from '../../shared/api/client'

export interface FileNode<T extends TreeItem> { key: string; title: string; isLeaf: boolean; item: T; children: FileNode<T>[] }

/** Build from paths without mutating the catalog; filtered search results stay flat. */
export function fileNodes<T extends TreeItem>(items: T[], parent = '', flat = false): FileNode<T>[] {
  const children = new Map<string, FileNode<T>[]>()
  for (const item of items) {
    const directory = flat ? parent : item.path.split('/').slice(0, -1).join('/')
    const siblings = children.get(directory) ?? []
    siblings.push({ key: item.id, isLeaf: item.type !== 'folder', title: flat ? item.path : item.path.split('/').at(-1) ?? item.path, item, children: [] })
    children.set(directory, siblings)
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => Number(b.item.type === 'folder') - Number(a.item.type === 'folder') || a.title.localeCompare(b.title, 'zh-CN'))
    if (!flat) for (const node of siblings) node.children = children.get(node.item.path) ?? []
  }
  return children.get(parent) ?? []
}
