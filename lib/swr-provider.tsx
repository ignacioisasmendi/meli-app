'use client'

import { SWRConfig, type SWRConfiguration } from 'swr'

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (r.status === 401) {
      window.dispatchEvent(new CustomEvent('session-expired'))
      throw new Error('session_expired')
    }
    if (!r.ok) throw new Error(r.statusText)
    return r.json()
  })

const swrConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,
  dedupingInterval: 5000,
  errorRetryCount: 2,
  onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
    if (error.message === 'session_expired') return
    if (retryCount >= 2) return
    setTimeout(() => revalidate({ retryCount }), 5000)
  },
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={swrConfig}>{children}</SWRConfig>
}
