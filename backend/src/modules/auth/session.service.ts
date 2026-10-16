import type { RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { insertRow, queryRows, type SqlExecutor } from '../../utils/sql.js'
import { sessionRotationSeconds, sessionTtlSeconds } from './cookies.js'
import { hashesMatch, randomToken, sha256 } from './tokens.js'

export type PublicUser = {
  id: number
  fullName: string
  email: string
  phone: string | null
  accountStatus: 'active' | 'suspended' | 'deactivated'
}

export type SessionAuth = PublicUser & {
  sessionId: number
}

type SessionRow = RowDataPacket & {
  id: number
  user_id: number
  csrf_hash: string
  expires_at: Date
  revoked_at: Date | null
  created_at: Date
  full_name: string
  email: string
  phone: string | null
  account_status: PublicUser['accountStatus']
}

export type IssuedSession = {
  token: string
  csrf: string
  sessionId: number
}

const invalidSession = new AppError(401, 'UNAUTHENTICATED', 'Necesitas iniciar sesión.')

function asUser(row: SessionRow): PublicUser {
  return {
    id: Number(row.user_id),
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    accountStatus: row.account_status,
  }
}

export async function issueSession(userId: number, executor: SqlExecutor = getPool()): Promise<IssuedSession> {
  const token = randomToken()
  const csrf = randomToken()
  const sessionId = await insertRow(
    executor,
    `INSERT INTO sessions (user_id, token_hash, csrf_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND))`,
    [userId, sha256(token), sha256(csrf), sessionTtlSeconds],
  )

  return { token, csrf, sessionId }
}

export async function revokeSession(sessionId: number, executor: SqlExecutor = getPool()): Promise<void> {
  await executor.query(
    'UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL',
    [sessionId],
  )
}

export async function revokeAllSessions(userId: number, executor: SqlExecutor = getPool()): Promise<void> {
  await executor.query(
    'UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL',
    [userId],
  )
}

export async function authenticateRequest(
  sessionToken: string | null,
  csrfHeader: string | null,
  method: string,
): Promise<{ auth: SessionAuth; replacement: IssuedSession | null }> {
  if (!sessionToken) {
    throw invalidSession
  }

  const rows = await queryRows<SessionRow>(
    getPool(),
    `SELECT s.id, s.user_id, s.csrf_hash, s.expires_at, s.revoked_at, s.created_at,
            u.full_name, u.email, u.phone, u.account_status
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
     LIMIT 1`,
    [sha256(sessionToken)],
  )
  const row = rows[0]
  if (!row) {
    throw invalidSession
  }
  if (row.revoked_at) {
    throw new AppError(401, 'SESSION_REVOKED', 'La sesión ya no es válida. Vuelve a iniciar sesión.')
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, 'SESSION_EXPIRED', 'La sesión venció. Vuelve a iniciar sesión.')
  }
  if (row.account_status !== 'active') {
    throw new AppError(401, 'SESSION_REVOKED', 'La sesión ya no es válida. Vuelve a iniciar sesión.')
  }

  const unsafe = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
  if (unsafe) {
    const provided = csrfHeader ? sha256(csrfHeader) : ''
    if (!hashesMatch(provided, row.csrf_hash)) {
      throw new AppError(403, 'CSRF_REJECTED', 'La solicitud no incluye una verificación válida. Recarga la página e inténtalo de nuevo.')
    }
  }

  await getPool().query('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [row.id])

  const ageMs = Date.now() - new Date(row.created_at).getTime()
  let replacement: IssuedSession | null = null
  if (ageMs > sessionRotationSeconds * 1000) {
    replacement = await issueSession(Number(row.user_id))
    await revokeSession(Number(row.id))
  }

  return {
    auth: {
      ...asUser(row),
      sessionId: replacement?.sessionId ?? Number(row.id),
    },
    replacement,
  }
}
