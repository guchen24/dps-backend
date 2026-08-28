import test from 'node:test'
import assert from 'node:assert/strict'
import { usageFromText } from './usage.js'

test('records usage from a non-streaming provider response', () => {
  assert.deepEqual(usageFromText('{"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}'), { input: 11, output: 7, total: 18 })
})

test('uses the final usage frame from an SSE response', () => {
  const sse = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\ndata: [DONE]\n\n'
  assert.deepEqual(usageFromText(sse), { input: 3, output: 2, total: 5 })
})

test('marks usage unavailable when the upstream does not send it', () => {
  assert.deepEqual(usageFromText('data: {"choices":[]}\n\ndata: [DONE]\n'), { input: null, output: null, total: null })
})
