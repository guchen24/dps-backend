export type RuntimeRequestBody = Record<string, unknown> | undefined

/** Requests rejected at the BFF boundary before reaching a Harness Runtime. */
export function blockedRuntimeRequest(pathname: string, body: RuntimeRequestBody): string | null {
  if (pathname === '/api/credentials.set' || pathname === '/api/credentials.unset') return '平台统一管理模型凭据。'
  if (pathname === '/api/permissionPresets.set' && body?.name === 'danger-full-access') return '平台不允许完全访问权限。'
  if (pathname === '/api/settings.update' && body?.ns === 'llm-deepseek') return '平台统一管理 DeepSeek 模型配置。'
  return null
}
