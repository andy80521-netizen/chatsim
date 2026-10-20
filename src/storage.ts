import { useEffect, useState } from 'react'

// 簡單的 localStorage 持久化 hook
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* 儲存失敗就忽略 */
    }
  }, [key, value])

  return [value, setValue] as const
}
