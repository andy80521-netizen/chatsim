import type { TNode } from './types'

export type Nodes = Record<string, TNode>
export type ChildMap = Record<string, string[]> // key: 父節點 id，根節點用 'ROOT'

export const STAGES = [
  { min: 0, name: '初識' },
  { min: 10, name: '試探' },
  { min: 30, name: '拉扯' },
  { min: 55, name: '心動' },
  { min: 80, name: '羈絆' },
]

export function stageOf(affection: number) {
  let s = STAGES[0]
  for (const st of STAGES) if (affection >= st.min) s = st
  return s
}

// 從根走到 leaf 的那條路徑
export function pathTo(nodes: Nodes, leaf: string | null): TNode[] {
  const out: TNode[] = []
  let cur = leaf ? nodes[leaf] : undefined
  while (cur) {
    out.push(cur)
    cur = cur.parentId ? nodes[cur.parentId] : undefined
  }
  return out.reverse()
}

export function childMap(nodes: Nodes): ChildMap {
  const m: ChildMap = {}
  for (const n of Object.values(nodes).sort((a, b) => a.ts - b.ts)) {
    ;(m[n.parentId ?? 'ROOT'] ??= []).push(n.id)
  }
  return m
}

// 沿著「最新的子節點」一路往下走到底
export function latestLeaf(cm: ChildMap, id: string): string {
  let cur = id
  for (;;) {
    const ch = cm[cur]
    if (!ch || !ch.length) return cur
    cur = ch[ch.length - 1]
  }
}

export function descendants(cm: ChildMap, id: string): string[] {
  const out: string[] = []
  const stack = [...(cm[id] ?? [])]
  while (stack.length) {
    const cur = stack.pop()!
    out.push(cur)
    stack.push(...(cm[cur] ?? []))
  }
  return out
}

// 這條路徑上「最近一次摘要」之後才需要原文送進 prompt
export function context(path: TNode[]) {
  let idx = -1
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].memory) {
      idx = i
      break
    }
  }
  return {
    memory: idx >= 0 ? (path[idx].memory as string) : '',
    memoryNodeId: idx >= 0 ? path[idx].id : null,
    history: path.slice(idx + 1),
  }
}

export function affectionOf(path: TNode[]): number {
  for (let i = path.length - 1; i >= 0; i--) {
    const a = path[i].affection
    if (typeof a === 'number') return a
  }
  return 0
}

export function moodOf(path: TNode[]): string {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].mood) return path[i].mood as string
  }
  return ''
}
