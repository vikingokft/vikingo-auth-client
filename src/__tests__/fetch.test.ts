import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isTransientNetworkError, resilientFetch } from '../core/fetch'

/** undici-stílusú "fetch failed" hiba egy adott kapcsolati hibakóddal a cause-ban. */
function connError(code: string): TypeError {
  const err = new TypeError('fetch failed')
  ;(err as { cause?: unknown }).cause = Object.assign(new Error('socket'), { code })
  return err
}

describe('isTransientNetworkError', () => {
  it('detects ECONNRESET in cause.code', () => {
    expect(isTransientNetworkError(connError('ECONNRESET'))).toBe(true)
  })

  it('detects code directly on the error', () => {
    expect(isTransientNetworkError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true)
  })

  it('detects AbortError / TimeoutError by name', () => {
    expect(isTransientNetworkError({ name: 'TimeoutError' })).toBe(true)
    expect(isTransientNetworkError({ name: 'AbortError' })).toBe(true)
  })

  it('treats ENOTFOUND as non-transient', () => {
    expect(isTransientNetworkError(connError('ENOTFOUND'))).toBe(false)
  })

  it('treats a plain error as non-transient', () => {
    expect(isTransientNetworkError(new Error('boom'))).toBe(false)
  })
})

describe('resilientFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the response on first success (single fetch call)', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await resilientFetch('https://x.test/a')
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('passes an AbortSignal in init', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await resilientFetch('https://x.test/a', { method: 'POST' })
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const init = calls[0]![1]
    expect(init.method).toBe('POST')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('retries on a transient error then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(connError('ECONNRESET'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await resilientFetch('https://x.test/a', {}, { retries: 1 })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting retries and throws the last error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(connError('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(resilientFetch('https://x.test/a', {}, { retries: 2 })).rejects.toThrow(/fetch failed/)
    expect(fetchMock).toHaveBeenCalledTimes(3) // 1 + 2 retries
  })

  it('does NOT retry on a non-transient error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(connError('ENOTFOUND'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(resilientFetch('https://x.test/a', {}, { retries: 2 })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on an HTTP error status (returns the response)', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await resilientFetch('https://x.test/a', {}, { retries: 2 })
    expect(res.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
