export type ModelUsage = { input: number | null; output: number | null; total: number | null }

/** Extracts provider-supplied token usage without retaining prompts or responses. */
export function usageFromText(text: string): ModelUsage {
  const candidates = text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())
  for (const candidate of [...candidates].reverse()) {
    try {
      const usage = (JSON.parse(candidate) as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage
      if (usage) return { input: usage.prompt_tokens ?? null, output: usage.completion_tokens ?? null, total: usage.total_tokens ?? null }
    } catch { /* stream frames may be incomplete or [DONE] */ }
  }
  try {
    const usage = (JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage
    if (usage) return { input: usage.prompt_tokens ?? null, output: usage.completion_tokens ?? null, total: usage.total_tokens ?? null }
  } catch { /* unavailable usage remains explicit */ }
  return { input: null, output: null, total: null }
}
