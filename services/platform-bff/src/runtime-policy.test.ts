import assert from 'node:assert/strict'
import test from 'node:test'
import { blockedRuntimeRequest } from './runtime-policy.js'

test('blocks browser attempts to replace platform credentials', () => {
  assert.match(blockedRuntimeRequest('/api/credentials.set', {}) ?? '', /统一管理模型凭据/)
  assert.match(blockedRuntimeRequest('/api/credentials.unset', {}) ?? '', /统一管理模型凭据/)
})

test('blocks unsafe permissions and DeepSeek configuration changes', () => {
  assert.match(blockedRuntimeRequest('/api/permissionPresets.set', { name: 'danger-full-access' }) ?? '', /不允许完全访问/)
  assert.match(blockedRuntimeRequest('/api/settings.update', { ns: 'llm-deepseek' }) ?? '', /统一管理 DeepSeek/)
})

test('allows unrelated Harness RPC calls through the BFF', () => {
  assert.equal(blockedRuntimeRequest('/api/host.describe', {}), null)
  assert.equal(blockedRuntimeRequest('/api/permissionPresets.set', { name: 'workspace-write' }), null)
})
