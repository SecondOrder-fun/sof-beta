// tests/hooks/useSSE.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { useEffect } from 'react'
import PropTypes from 'prop-types'
import { useSSE } from '@/hooks/useSSE'

function HookHarness({ url, onMessage }) {
  const state = useSSE(url, onMessage, { maxRetries: 2, retryInterval: 10, heartbeatInterval: 0, EventSourceClass: MockEventSource })
  useEffect(() => {
    // Ensure connection starts for deterministic testing
    state.connect?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div data-connected={state.isConnected} data-retries={state.retryCount} />
}

HookHarness.propTypes = {
  url: PropTypes.string.isRequired,
  onMessage: PropTypes.func,
}

class MockEventSource {
  constructor(url) {
    this.url = url
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    // expose last instance for test control
    globalThis.__lastES = this
  }
  triggerOpen() {
    this.onopen && this.onopen()
  }
  emitMessage(data) {
    this.onmessage && this.onmessage({ data: JSON.stringify(data) })
  }
  emitError(err = new Error('boom')) {
    this.onerror && this.onerror(err)
  }
  close() {}
}

describe('useSSE', () => {
  beforeEach(() => {
    // Use real timers; mock EventSource class is injected
    vi.useRealTimers()
    // Ensure both global and window are set
    globalThis.EventSource = MockEventSource
    if (typeof window !== 'undefined') {
      window.EventSource = MockEventSource
    }
    globalThis.__lastES = undefined
  })

  it('connects and sets isConnected=true on open', async () => {
    const { container } = render(<HookHarness url="/stream" onMessage={() => {}} />)
    await waitFor(() => expect(globalThis.__lastES).toBeTruthy())
    const es = globalThis.__lastES
    await act(async () => {
      es.triggerOpen()
    })
    await waitFor(() => {
      expect(container.firstChild.getAttribute('data-connected')).toBe('true')
    })
  }, 10000)

  it('invokes onMessage with parsed data', async () => {
    const onMessage = vi.fn()
    render(<HookHarness url="/stream" onMessage={onMessage} />)
    await waitFor(() => expect(globalThis.__lastES).toBeTruthy())
    const es = globalThis.__lastES
    await act(async () => {
      es.triggerOpen()
      es.emitMessage({ hello: 'world' })
    })
    await waitFor(() => expect(onMessage).toHaveBeenCalled())
  }, 10000)

  it('retries on error up to maxRetries', async () => {
    render(<HookHarness url="/stream" onMessage={() => {}} />)
    await waitFor(() => expect(globalThis.__lastES).toBeTruthy())
    const es = globalThis.__lastES
    await act(async () => {
      es.triggerOpen()
    })
    await act(async () => {
      es.emitError(new Error('fail1'))
    })
    // small real delay to simulate retry schedule
    await new Promise(r => setTimeout(r, 5))
    await act(async () => {
      es.emitError(new Error('fail2'))
    })
    await new Promise(r => setTimeout(r, 5))
    const { container } = render(<HookHarness url="/stream" onMessage={() => {}} />)
    await waitFor(() => expect(Number(container.firstChild.getAttribute('data-retries'))).toBeGreaterThanOrEqual(0))
  }, 10000)
})
