import { randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import Fastify from 'fastify'
import { Pool } from 'pg'

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const config = {
  port: Number(process.env.PORT ?? '4000'),
  key: required('DEEPSEEK_API_KEY'),
  upstream: (process.env.DEEPSEEK_UPSTREAM_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, ''),
  database: {
    host: process.env.DATABASE_HOST ?? 'postgres', port: Number(process.env.DATABASE_PORT ?? '5432'),
    database: process.env.DATABASE_NAME ?? 'dps_platform', user: process.env.DATABASE_USER ?? 'dps_platform', password: required('DATABASE_PASSWORD'),
  },
}
const pool = new Pool(config.database)
const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 })

function slotForHost(host: string | undefined): number | null {
  const match = /model-gateway-slot-(0[1-3])(?::\d+)?$/i.exec(host ?? '')
  return match ? Number(match[1]) : null
}

function usageFromText(text: string): { input: number | null; output: number | null; total: number | null } {
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

app.get('/healthz', async () => { await pool.query('SELECT 1'); return { status: 'ok' } })

app.all('/*', async (request, reply) => {
  const slot = slotForHost(request.headers.host)
  if (!slot) return reply.code(403).send({ error: 'Unknown runtime identity.' })
  const binding = await pool.query<{ user_id: string }>('SELECT user_id FROM user_runtimes WHERE slot = $1 AND released_at IS NULL', [slot])
  if (!binding.rowCount) return reply.code(503).send({ error: 'Runtime is not assigned.' })
  const requestBody = request.body === undefined ? undefined : JSON.stringify(request.body)
  const headers = new Headers()
  for (const [name, raw] of Object.entries(request.headers)) {
    if (raw && !['host', 'authorization', 'content-length', 'connection'].includes(name.toLowerCase())) headers.set(name, Array.isArray(raw) ? raw.join(',') : raw)
  }
  headers.set('authorization', `Bearer ${config.key}`)
  if (requestBody) headers.set('content-type', 'application/json')
  const startedAt = Date.now()
  const upstream = await fetch(`${config.upstream}${request.url}`, { method: request.method, headers, body: requestBody })
  reply.hijack()
  reply.raw.statusCode = upstream.status
  upstream.headers.forEach((value, key) => { if (!['connection', 'transfer-encoding'].includes(key.toLowerCase())) reply.raw.setHeader(key, value) })
  const captured: Buffer[] = []
  const capture = new Transform({ transform(chunk: Buffer, _encoding, callback) { captured.push(Buffer.from(chunk)); callback(null, chunk) } })
  const finish = async () => {
    const usage = usageFromText(Buffer.concat(captured).toString('utf8'))
    await pool.query(
      `INSERT INTO model_usage_events (id, user_id, slot, model, status_code, input_tokens, output_tokens, total_tokens, duration_ms, usage_available)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), binding.rows[0].user_id, slot, typeof (request.body as { model?: unknown } | undefined)?.model === 'string' ? (request.body as { model: string }).model : null, upstream.status, usage.input, usage.output, usage.total, Date.now() - startedAt, usage.total !== null],
    )
  }
  capture.on('finish', () => { void finish().catch(error => app.log.error(error, 'usage recording failed')) })
  if (!upstream.body) return reply.raw.end()
  Readable.fromWeb(upstream.body as never).pipe(capture).pipe(reply.raw)
})

await pool.query('SELECT 1')
await app.listen({ port: config.port, host: '0.0.0.0' })
