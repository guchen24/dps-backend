import { createHash, randomBytes, randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import cookie from '@fastify/cookie'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import httpProxy from 'http-proxy'
import { Pool } from 'pg'
import { blockedRuntimeRequest } from './runtime-policy.js'

const SESSION_COOKIE = 'dps_platform_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8
const SESSION_IDLE_SECONDS = 60 * 30
const PLATFORM_PREFIX = '/_platform'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const config = {
  port: Number(process.env.PORT ?? '3000'),
  sessionSecret: required('PLATFORM_SESSION_SECRET'),
  database: {
    host: process.env.DATABASE_HOST ?? 'postgres',
    port: Number(process.env.DATABASE_PORT ?? '5432'),
    user: process.env.DATABASE_USER ?? 'dps_platform',
    password: required('DATABASE_PASSWORD'),
    database: process.env.DATABASE_NAME ?? 'dps_platform',
  },
}

if (config.sessionSecret.length < 32) throw new Error('PLATFORM_SESSION_SECRET must contain at least 32 characters')

type Role = 'platform_admin' | 'user'
type User = { id: string; email: string; displayName: string; role: Role; active: boolean; mustChangePassword: boolean; createdAt: string; runtimeSlot: number | null }
type SessionUser = User & { sessionId: string; tokenHash: string }
type Body = Record<string, unknown>
type Query = Record<string, unknown>

const pool = new Pool(config.database)
const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: false, xfwd: true })
const app = Fastify({ logger: true, trustProxy: true })

function tokenHash(token: string): string {
  return createHash('sha256').update(`${config.sessionSecret}:${token}`).digest('hex')
}

function value(body: Body, key: string): string {
  const item = body[key]
  return typeof item === 'string' ? item.trim() : ''
}

function email(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null
}

function passwordError(password: string): string | null {
  if (password.length < 12) return '密码至少需要 12 位。'
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return '密码必须包含大写、小写、数字和特殊字符。'
  }
  return null
}

function queryText(query: Query, key: string): string | null {
  const item = query[key]
  return typeof item === 'string' && item.trim() ? item.trim() : null
}

function queryTimestamp(query: Query, key: string): string | null {
  const item = queryText(query, key)
  if (!item) return null
  const date = new Date(item)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function auditWhere(query: Query): { where: string; values: string[] } {
  const values: string[] = []
  const conditions: string[] = []
  const add = (condition: string, item: string | null) => {
    if (!item) return
    values.push(item)
    conditions.push(condition.replace('?', `$${values.length}`))
  }
  add('a.event_type = ?', queryText(query, 'eventType'))
  add('actor.email ILIKE ?', queryText(query, 'actor') ? `%${queryText(query, 'actor')}%` : null)
  add('a.created_at >= ?::timestamptz', queryTimestamp(query, 'from'))
  add('a.created_at <= ?::timestamptz', queryTimestamp(query, 'to'))
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values }
}

function usageWhere(query: Query): { where: string; values: string[] } {
  const values: string[] = []
  const conditions: string[] = []
  const add = (condition: string, item: string | null) => {
    if (!item) return
    values.push(item)
    conditions.push(condition.replace('?', `$${values.length}`))
  }
  add('u.email ILIKE ?', queryText(query, 'email') ? `%${queryText(query, 'email')}%` : null)
  add('COALESCE(e.model, \'unknown\') ILIKE ?', queryText(query, 'model') ? `%${queryText(query, 'model')}%` : null)
  add('e.created_at >= ?::timestamptz', queryTimestamp(query, 'from'))
  add('e.created_at <= ?::timestamptz', queryTimestamp(query, 'to'))
  if (!conditions.length) conditions.push("e.created_at > NOW() - INTERVAL '30 days'")
  return { where: `WHERE ${conditions.join(' AND ')}`, values }
}

function toUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id), email: String(row.email), displayName: String(row.display_name), role: row.role as Role,
    active: Boolean(row.active), mustChangePassword: Boolean(row.must_change_password), createdAt: new Date(String(row.created_at)).toISOString(), runtimeSlot: row.runtime_slot === null || row.runtime_slot === undefined ? null : Number(row.runtime_slot),
  }
}

async function recordAudit(eventType: string, input: { actorId?: string; subjectId?: string; ip?: string; metadata?: Record<string, string> } = {}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events (id, event_type, actor_id, subject_id, ip, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [randomUUID(), eventType, input.actorId ?? null, input.subjectId ?? null, input.ip ?? null, JSON.stringify(input.metadata ?? {})],
  )
}

async function sessionForToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  const result = await pool.query(
    `SELECT s.id AS session_id, s.token_hash, u.id, u.email, u.display_name, u.role, u.active, u.must_change_password, u.created_at, r.slot AS runtime_slot
     FROM sessions s JOIN users u ON u.id = s.user_id
     LEFT JOIN user_runtimes r ON r.user_id = u.id AND r.released_at IS NULL
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.last_seen_at > NOW() - INTERVAL '30 minutes'`, [tokenHash(token)],
  )
  if (!result.rowCount) return null
  const row = result.rows[0] as Record<string, unknown>
  if (!Boolean(row.active)) return null
  await pool.query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id])
  return { ...toUser(row), sessionId: String(row.session_id), tokenHash: String(row.token_hash) }
}

async function currentUser(request: FastifyRequest): Promise<SessionUser | null> {
  return sessionForToken(request.cookies[SESSION_COOKIE])
}

function jsonUnauthorized(reply: FastifyReply) { return reply.code(401).send({ error: '请先登录。' }) }
function jsonForbidden(reply: FastifyReply) { return reply.code(403).send({ error: '没有执行此操作的权限。' }) }

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const user = await currentUser(request)
  if (!user) { jsonUnauthorized(reply); return null }
  return user
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const user = await requireUser(request, reply)
  if (!user) return null
  if (user.role !== 'platform_admin') { jsonForbidden(reply); return null }
  return user
}

async function createSession(reply: FastifyReply, user: User): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at) VALUES ($1, $2, $3, NOW() + INTERVAL '8 hours', NOW())`,
    [randomUUID(), user.id, tokenHash(token)],
  )
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: SESSION_MAX_AGE_SECONDS })
}

async function bootstrapAdmin(): Promise<void> {
  const count = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users')
  if (Number(count.rows[0].count) > 0) return
  const adminEmail = email(required('PLATFORM_BOOTSTRAP_ADMIN_EMAIL'))
  const adminPassword = required('PLATFORM_BOOTSTRAP_ADMIN_PASSWORD')
  if (!adminEmail) throw new Error('PLATFORM_BOOTSTRAP_ADMIN_EMAIL must be a valid email address')
  const error = passwordError(adminPassword)
  if (error) throw new Error(`PLATFORM_BOOTSTRAP_ADMIN_PASSWORD: ${error}`)
  const id = randomUUID()
  await pool.query(
    `INSERT INTO users (id, email, display_name, password_hash, role, active, must_change_password)
     VALUES ($1, $2, $3, $4, 'platform_admin', true, false)`,
    [id, adminEmail, '平台管理员', await argon2.hash(adminPassword, { type: argon2.argon2id })],
  )
  await recordAudit('bootstrap_admin_created', { actorId: id, subjectId: id })
  await assignFirstSlot(id)
  app.log.info({ email: adminEmail }, 'bootstrap administrator created')
}

async function assignExistingAdmin(): Promise<void> {
  const result = await pool.query<{ id: string }>(`SELECT u.id FROM users u LEFT JOIN user_runtimes r ON r.user_id = u.id AND r.released_at IS NULL WHERE r.user_id IS NULL ORDER BY CASE WHEN u.role = 'platform_admin' THEN 0 ELSE 1 END, u.created_at LIMIT 1`)
  if (result.rowCount) await assignFirstSlot(result.rows[0].id)
}

async function waitForDatabase(): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await pool.query('SELECT 1'); return } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 1000)) }
  }
  throw lastError
}

async function migratePlatform(): Promise<void> {
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`CREATE TABLE IF NOT EXISTS runtime_slots (slot SMALLINT PRIMARY KEY CHECK (slot BETWEEN 1 AND 3), service_name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await pool.query(`INSERT INTO runtime_slots (slot, service_name) VALUES (1, 'harness-01'), (2, 'harness-02'), (3, 'harness-03') ON CONFLICT (slot) DO UPDATE SET service_name = EXCLUDED.service_name`)
  await pool.query(`CREATE TABLE IF NOT EXISTS user_runtimes (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, slot SMALLINT NOT NULL UNIQUE REFERENCES runtime_slots(slot), assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), released_at TIMESTAMPTZ)`)
  await pool.query(`CREATE TABLE IF NOT EXISTS model_usage_events (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, slot SMALLINT NOT NULL REFERENCES runtime_slots(slot), model TEXT, status_code INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, duration_ms INTEGER NOT NULL, usage_available BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  await pool.query(`CREATE INDEX IF NOT EXISTS model_usage_events_user_created_idx ON model_usage_events(user_id, created_at DESC)`)
}

async function assignFirstSlot(userId: string): Promise<number | null> {
  const result = await pool.query<{ slot: number }>(
    `WITH candidate AS (SELECT slot FROM runtime_slots WHERE slot NOT IN (SELECT slot FROM user_runtimes WHERE released_at IS NULL) ORDER BY slot LIMIT 1)
     INSERT INTO user_runtimes (user_id, slot) SELECT $1, slot FROM candidate ON CONFLICT DO NOTHING RETURNING slot`, [userId],
  )
  return result.rowCount ? Number(result.rows[0].slot) : null
}

function runtimeOrigin(slot: number | null): string | null {
  return slot && slot >= 1 && slot <= 3 ? `http://harness-0${slot}:3080` : null
}

proxy.on('proxyReq', (proxyReq, request) => {
  proxyReq.removeHeader('x-platform-user-id')
  proxyReq.removeHeader('x-platform-user-role')
  const body = (request as typeof request & { body?: unknown }).body
  if (body === undefined || !['POST', 'PUT', 'PATCH'].includes(request.method ?? '')) return
  const serialized = JSON.stringify(body)
  proxyReq.setHeader('content-type', 'application/json')
  proxyReq.setHeader('content-length', Buffer.byteLength(serialized))
  proxyReq.write(serialized)
})
proxy.on('proxyReqWs', proxyReq => {
  proxyReq.removeHeader('x-platform-user-id')
  proxyReq.removeHeader('x-platform-user-role')
})
proxy.on('error', (error, _request, response) => {
  app.log.error(error, 'harness proxy failed')
  const target = response as { writeHead?: (status: number, headers: Record<string, string>) => void; end?: (body?: string) => void; headersSent?: boolean }
  if (!target.headersSent) target.writeHead?.(502, { 'content-type': 'application/json' })
  target.end?.('{"error":"Harness 服务暂不可用。"}')
})

await app.register(cookie)

app.get('/healthz', async () => { await pool.query('SELECT 1'); return { status: 'ok' } })

// Injected by Gateway into the Harness HTML shell. It keeps an expired platform
// session from surfacing as a confusing internal Harness transport error.
app.get('/dps-session-guard.js', async (_request, reply) => reply
  .header('cache-control', 'no-store')
  .type('application/javascript; charset=utf-8')
  .send(`(() => {
  let redirecting = false;
  const login = () => {
    if (redirecting || location.pathname.startsWith('/_platform/')) return;
    redirecting = true;
    const returnTo = location.pathname + location.search + location.hash;
    location.replace('/_platform/login?returnTo=' + encodeURIComponent(returnTo));
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (response.status === 401) login();
    return response;
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('loadend', () => { if (this.status === 401) login(); }, { once: true });
    return originalSend.apply(this, args);
  };
})();`))

app.post(`${PLATFORM_PREFIX}/api/auth/login`, async (request, reply) => {
  const body = (request.body ?? {}) as Body
  const requestedEmail = email(value(body, 'email'))
  const password = value(body, 'password')
  if (!requestedEmail || !password) return reply.code(401).send({ error: '邮箱或密码错误。' })
  const result = await pool.query(
    `SELECT id, email, display_name, password_hash, role, active, must_change_password, created_at FROM users WHERE email = $1`, [requestedEmail],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  const valid = row && Boolean(row.active) && await argon2.verify(String(row.password_hash), password)
  if (!valid) {
    const attempts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_events
       WHERE event_type = 'login_failed' AND ip = $1 AND metadata->>'email' = $2 AND created_at > NOW() - INTERVAL '15 minutes'`,
      [request.ip, requestedEmail],
    )
    if (Number(attempts.rows[0].count) >= 5) return reply.code(429).send({ error: '登录尝试过于频繁，请 15 分钟后再试。' })
    await recordAudit('login_failed', { ip: request.ip, metadata: { email: requestedEmail } })
    return reply.code(401).send({ error: '邮箱或密码错误。' })
  }
  const user = toUser(row)
  await createSession(reply, user)
  await recordAudit('login_succeeded', { actorId: user.id, subjectId: user.id, ip: request.ip })
  return { user }
})

app.post(`${PLATFORM_PREFIX}/api/auth/logout`, async (request, reply) => {
  const user = await currentUser(request)
  const token = request.cookies[SESSION_COOKIE]
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)])
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
  if (user) await recordAudit('logout', { actorId: user.id, subjectId: user.id, ip: request.ip })
  return { ok: true }
})

app.get(`${PLATFORM_PREFIX}/api/auth/me`, async (request, reply) => {
  const user = await requireUser(request, reply)
  return user ? { user: user } : undefined
})

app.post(`${PLATFORM_PREFIX}/api/auth/change-password`, async (request, reply) => {
  const user = await requireUser(request, reply); if (!user) return
  const body = (request.body ?? {}) as Body
  const nextPassword = value(body, 'password')
  const error = passwordError(nextPassword)
  if (error) return reply.code(400).send({ error })
  const stored = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id])
  const currentPassword = value(body, 'currentPassword')
  if (!user.mustChangePassword && (!currentPassword || !await argon2.verify(stored.rows[0].password_hash, currentPassword))) {
    return reply.code(400).send({ error: '当前密码错误。' })
  }
  await pool.query('UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2', [await argon2.hash(nextPassword, { type: argon2.argon2id }), user.id])
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [user.id, user.sessionId])
  await recordAudit('password_changed', { actorId: user.id, subjectId: user.id, ip: request.ip })
  return { ok: true }
})

app.get(`${PLATFORM_PREFIX}/api/admin/users`, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return
  const result = await pool.query('SELECT u.id, u.email, u.display_name, u.role, u.active, u.must_change_password, u.created_at, r.slot AS runtime_slot FROM users u LEFT JOIN user_runtimes r ON r.user_id = u.id AND r.released_at IS NULL ORDER BY u.created_at ASC')
  return { users: result.rows.map(row => toUser(row as Record<string, unknown>)) }
})

app.post(`${PLATFORM_PREFIX}/api/admin/users`, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return
  const body = (request.body ?? {}) as Body
  const userEmail = email(value(body, 'email')); const displayName = value(body, 'displayName'); const initialPassword = value(body, 'password')
  const role = body.role === 'platform_admin' ? 'platform_admin' : body.role === 'user' ? 'user' : null
  const passwordIssue = passwordError(initialPassword)
  if (!userEmail || !displayName || !role || passwordIssue) return reply.code(400).send({ error: passwordIssue ?? '请填写有效的名称、邮箱和角色。' })
  const id = randomUUID()
  try {
    await pool.query('BEGIN')
    const available = await pool.query<{ slot: number }>(`SELECT slot FROM runtime_slots s WHERE NOT EXISTS (SELECT 1 FROM user_runtimes r WHERE r.slot = s.slot AND r.released_at IS NULL) ORDER BY slot LIMIT 1 FOR UPDATE`)
    if (!available.rowCount) {
      await pool.query('ROLLBACK')
      return reply.code(409).send({ error: '没有可用运行槽位；当前平台最多支持 3 位用户。' })
    }
    await pool.query(`INSERT INTO users (id, email, display_name, password_hash, role, active, must_change_password) VALUES ($1,$2,$3,$4,$5,true,true)`, [id, userEmail, displayName, await argon2.hash(initialPassword, { type: argon2.argon2id }), role])
    await pool.query(`INSERT INTO user_runtimes (user_id, slot) VALUES ($1, $2)`, [id, available.rows[0].slot])
    await pool.query('COMMIT')
  } catch (error: unknown) {
    await pool.query('ROLLBACK').catch(() => undefined)
    if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: '该邮箱已存在。' })
    throw error
  }
  await recordAudit('user_created', { actorId: admin.id, subjectId: id, ip: request.ip, metadata: { role } })
  return reply.code(201).send({ ok: true, id })
})

app.patch(`${PLATFORM_PREFIX}/api/admin/users/:id`, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return
  const targetId = (request.params as { id: string }).id
  const body = (request.body ?? {}) as Body
  const active = typeof body.active === 'boolean' ? body.active : undefined
  const role = body.role === 'platform_admin' || body.role === 'user' ? body.role : undefined
  if (active === undefined && !role) return reply.code(400).send({ error: '没有可更新的字段。' })
  const targetResult = await pool.query('SELECT id, role, active FROM users WHERE id = $1', [targetId])
  if (!targetResult.rowCount) return reply.code(404).send({ error: '用户不存在。' })
  const target = targetResult.rows[0] as { id: string; role: Role; active: boolean }
  if (target.id === admin.id && active === false) return reply.code(400).send({ error: '不能停用当前管理员账号。' })
  if (active === true) {
    const runtime = await pool.query('SELECT 1 FROM user_runtimes WHERE user_id = $1 AND released_at IS NULL', [target.id])
    if (!runtime.rowCount) return reply.code(409).send({ error: '该用户的运行槽位已被释放；请新建账号分配空闲槽位。' })
  }
  if (target.role === 'platform_admin' && target.active && (active === false || role === 'user')) {
    const admins = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users WHERE role = 'platform_admin' AND active = true`)
    if (Number(admins.rows[0].count) <= 1) return reply.code(400).send({ error: '平台必须保留至少一个启用的管理员。' })
  }
  await pool.query('UPDATE users SET active = COALESCE($1, active), role = COALESCE($2, role), updated_at = NOW() WHERE id = $3', [active ?? null, role ?? null, targetId])
  if (active === false) await pool.query('DELETE FROM sessions WHERE user_id = $1', [targetId])
  await recordAudit(active === false ? 'user_disabled' : 'user_updated', { actorId: admin.id, subjectId: targetId, ip: request.ip })
  return { ok: true }
})

app.post(`${PLATFORM_PREFIX}/api/admin/users/:id/reset-password`, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return
  const targetId = (request.params as { id: string }).id
  const nextPassword = value((request.body ?? {}) as Body, 'password')
  const error = passwordError(nextPassword)
  if (error) return reply.code(400).send({ error })
  const result = await pool.query('UPDATE users SET password_hash = $1, must_change_password = true, updated_at = NOW() WHERE id = $2 RETURNING id', [await argon2.hash(nextPassword, { type: argon2.argon2id }), targetId])
  if (!result.rowCount) return reply.code(404).send({ error: '用户不存在。' })
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [targetId])
  await recordAudit('password_reset', { actorId: admin.id, subjectId: targetId, ip: request.ip })
  return { ok: true }
})

app.get(`${PLATFORM_PREFIX}/api/admin/audit`, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return
  const filters = auditWhere(request.query as Query)
  const result = await pool.query(
    `SELECT a.id, a.event_type, actor.email AS actor_email, subject.email AS subject_email, a.ip, a.created_at
     FROM audit_events a LEFT JOIN users actor ON actor.id = a.actor_id LEFT JOIN users subject ON subject.id = a.subject_id
     ${filters.where} ORDER BY a.created_at DESC LIMIT 500`, filters.values,
  )
  return { events: result.rows.map(row => ({ id: row.id, eventType: row.event_type, actorEmail: row.actor_email, subjectEmail: row.subject_email, ip: row.ip, createdAt: new Date(row.created_at).toISOString() })) }
})

app.get(`${PLATFORM_PREFIX}/api/admin/audit.csv`, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return
  const filters = auditWhere(request.query as Query)
  const result = await pool.query(`SELECT a.event_type, actor.email AS actor_email, subject.email AS subject_email, a.created_at FROM audit_events a LEFT JOIN users actor ON actor.id = a.actor_id LEFT JOIN users subject ON subject.id = a.subject_id ${filters.where} ORDER BY a.created_at DESC LIMIT 5000`, filters.values)
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = ['time,event,actor,subject', ...result.rows.map(row => [new Date(row.created_at).toISOString(), row.event_type, row.actor_email, row.subject_email].map(quote).join(','))].join('\n')
  return reply.header('content-disposition', 'attachment; filename="dps-audit.csv"').type('text/csv; charset=utf-8').send(csv)
})

app.get(`${PLATFORM_PREFIX}/api/admin/status`, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return
  const checks = await Promise.all(['postgres', 'portal', 'platform-bff', 'model-gateway', 'harness-01', 'harness-02', 'harness-03'].map(async service => {
    if (service === 'platform-bff') return { service, healthy: true }
    const url = service === 'postgres' ? null : service === 'portal' ? 'http://portal:8080/healthz' : service === 'model-gateway' ? 'http://model-gateway:4000/healthz' : `http://${service}:3080/`
    if (!url) { try { await pool.query('SELECT 1'); return { service, healthy: true } } catch { return { service, healthy: false } } }
    try { const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); return { service, healthy: response.ok } } catch { return { service, healthy: false } }
  }))
  const bindings = await pool.query(`SELECT r.slot, u.email FROM runtime_slots r LEFT JOIN user_runtimes ur ON ur.slot = r.slot AND ur.released_at IS NULL LEFT JOIN users u ON u.id = ur.user_id ORDER BY r.slot`)
  const errors = await pool.query(`SELECT u.email, e.slot, COALESCE(e.model, 'unknown') AS model, e.status_code, e.created_at FROM model_usage_events e JOIN users u ON u.id = e.user_id WHERE e.status_code >= 400 ORDER BY e.created_at DESC LIMIT 10`)
  return { checks, runtimes: bindings.rows.map(row => ({ slot: Number(row.slot), email: row.email ?? null })), recentErrors: errors.rows.map(row => ({ email: row.email, slot: Number(row.slot), model: row.model, statusCode: Number(row.status_code), createdAt: new Date(row.created_at).toISOString() })) }
})

app.get(`${PLATFORM_PREFIX}/api/admin/usage`, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return
  const filters = usageWhere(request.query as Query)
  const result = await pool.query(`SELECT u.email, COALESCE(e.model, 'unknown') AS model, COUNT(*)::int AS requests, COALESCE(SUM(e.input_tokens), 0)::int AS input_tokens, COALESCE(SUM(e.output_tokens), 0)::int AS output_tokens, COALESCE(SUM(e.total_tokens), 0)::int AS total_tokens, BOOL_OR(e.usage_available) AS usage_available FROM model_usage_events e JOIN users u ON u.id = e.user_id ${filters.where} GROUP BY u.email, e.model ORDER BY total_tokens DESC, requests DESC`, filters.values)
  return { items: result.rows }
})

app.get(`${PLATFORM_PREFIX}/api/admin/usage.csv`, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return
  const filters = usageWhere(request.query as Query)
  const result = await pool.query(`SELECT u.email, COALESCE(e.model, 'unknown') AS model, COUNT(*)::int AS requests, COALESCE(SUM(e.input_tokens), 0)::int AS input_tokens, COALESCE(SUM(e.output_tokens), 0)::int AS output_tokens, COALESCE(SUM(e.total_tokens), 0)::int AS total_tokens, BOOL_OR(e.usage_available) AS usage_available FROM model_usage_events e JOIN users u ON u.id = e.user_id ${filters.where} GROUP BY u.email, e.model ORDER BY total_tokens DESC, requests DESC`, filters.values)
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = ['user,model,requests,input_tokens,output_tokens,total_tokens,usage_available', ...result.rows.map(row => [row.email, row.model, row.requests, row.input_tokens, row.output_tokens, row.total_tokens, row.usage_available].map(quote).join(','))].join('\n')
  return reply.header('content-disposition', 'attachment; filename="dps-usage.csv"').type('text/csv; charset=utf-8').send(csv)
})

app.all('/*', async (request, reply) => {
  const user = await currentUser(request)
  if (!user) {
    if (request.method === 'GET' || request.method === 'HEAD') return reply.redirect(`${PLATFORM_PREFIX}/login?returnTo=${encodeURIComponent(request.url)}`).code(302)
    return jsonUnauthorized(reply)
  }
  if (user.mustChangePassword) {
    if (request.method === 'GET' || request.method === 'HEAD') return reply.redirect(`${PLATFORM_PREFIX}/profile`).code(302)
    return reply.code(403).send({ error: '请先修改初始密码。' })
  }
  const rejected = blockedRuntimeRequest(new URL(request.url, 'http://localhost').pathname, request.body as Body | undefined)
  if (rejected) return reply.code(403).send({ error: rejected })
  const target = runtimeOrigin(user.runtimeSlot)
  if (!target) return reply.code(503).send({ error: '当前账号尚未分配运行槽位。' })
  reply.hijack()
  const rawRequest = request.raw as typeof request.raw & { body?: unknown }
  rawRequest.body = request.body
  proxy.web(rawRequest, reply.raw, { target, headers: { host: request.headers.host ?? '127.0.0.1:3080' } })
})

app.server.on('upgrade', (request, socket, head) => {
  void (async () => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname.startsWith(PLATFORM_PREFIX)) { socket.destroy(); return }
    const parsed = app.parseCookie(request.headers.cookie ?? '')
    const user = await sessionForToken(parsed[SESSION_COOKIE])
    const target = runtimeOrigin(user?.runtimeSlot ?? null)
    if (!user || user.mustChangePassword || !target) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
    proxy.ws(request, socket, head, { target, headers: { host: request.headers.host ?? '127.0.0.1:3080' } })
  })().catch(error => { app.log.error(error, 'websocket authentication failed'); socket.destroy() })
})

await waitForDatabase()
await migratePlatform()
await bootstrapAdmin()
await assignExistingAdmin()
await app.listen({ port: config.port, host: '0.0.0.0' })
