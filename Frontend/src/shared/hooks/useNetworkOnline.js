import { useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'

export function useNetworkOnline() {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
    () => true,
  )
}
