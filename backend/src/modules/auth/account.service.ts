import type { RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { insertRow, queryRows, withTransaction } from '../../utils/sql.js'
import { consumePasswordCheck, hashPassword, passwordProblem, verifyPassword } from './passwords.js'
import { issueSession, revokeAllSessions, type IssuedSession, type PublicUser } from './session.service.js'
import { sha256 } from './tokens.js'

const genericCredentials = 'Correo o contraseña incorrectos.'
const loginEmailLimit = 8
const loginIpLimit = 40
const registerIpLimit = 40

type UserRow = RowDataPacket & {
  id: number
  full_name: string
  email: string
  phone: string | null
  password_hash: string
  account_status: PublicUser['accountStatus']
}

export type MembershipSummary = {
  organizationId: number
  organizationName: string
  role: string
  membershipStatus: string
}

type MembershipRow = RowDataPacket & MembershipSummary & {
  organization_id: number
  organization_name: string
  membership_status: string
}

function clientIp(value: string): string {
  const ip = value.replace(/^::ffff:/, '')
  return ip.slice(0, 45) || 'desconocida'
}

function publicUser(row: UserRow): PublicUser {
  return {
    id: Number(row.id),
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    accountStatus: row.account_status,
  }
}

async function countAttempts(kind: 'login' | 'register', column: 'email_hash' | 'ip_address', value: string): Promise<number> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total
     FROM login_attempts
     WHERE attempt_kind = ? AND ${column} = ? AND attempted_at > (NOW(3) - INTERVAL 15 MINUTE)`,
    [kind, value],
  )
  return Number(rows[0]?.total ?? 0)
}

async function recordAttempt(kind: 'login' | 'register', email: string, ip: string): Promise<void> {
  await insertRow(
    getPool(),
    `INSERT INTO login_attempts (attempt_kind, email_hash, ip_address) VALUES (?, ?, ?)`,
    [kind, sha256(email), ip],
  )
  await getPool().query('DELETE FROM login_attempts WHERE attempted_at < (NOW(3) - INTERVAL 1 DAY)')
}

async function assertLoginAllowed(email: string, ip: string): Promise<void> {
  const [byEmail, byIp] = await Promise.all([
    countAttempts('login', 'email_hash', sha256(email)),
    countAttempts('login', 'ip_address', ip),
  ])
  if (byEmail >= loginEmailLimit || byIp >= loginIpLimit) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.')
  }
}

async function assertRegisterAllowed(ip: string): Promise<void> {
  const total = await countAttempts('register', 'ip_address', ip)
  if (total >= registerIpLimit) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados registros desde esta red. Espera unos minutos e inténtalo de nuevo.')
  }
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await queryRows<UserRow>(
    getPool(),
    `SELECT id, full_name, email, phone, password_hash, account_status
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email],
  )
  return rows[0] ?? null
}

export async function listMemberships(userId: number): Promise<MembershipSummary[]> {
  const rows = await queryRows<MembershipRow>(
    getPool(),
    `SELECT o.id AS organization_id, o.name AS organization_name, m.role, m.membership_status
     FROM organization_members m
     INNER JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = ?
     ORDER BY o.name ASC, o.id ASC`,
    [userId],
  )

  return rows.map((row) => ({
    organizationId: Number(row.organization_id),
    organizationName: row.organization_name,
    role: row.role,
    membershipStatus: row.membership_status,
  }))
}

export async function registerAccount(input: {
  fullName: string
  email: string
  password: string
  ip: string
}): Promise<{ user: PublicUser; session: IssuedSession; memberships: MembershipSummary[] }> {
  const problem = passwordProblem(input.password, input.email)
  if (problem) {
    throw new AppError(400, 'WEAK_PASSWORD', problem)
  }

  const ip = clientIp(input.ip)
  await assertRegisterAllowed(ip)
  await recordAttempt('register', input.email, ip)
  const passwordHash = await hashPassword(input.password)

  try {
    const userId = await insertRow(
      getPool(),
      `INSERT INTO users (full_name, email, password_hash, account_status, terms_accepted_at)
       VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP(3))`,
      [input.fullName, input.email, passwordHash],
    )
    const session = await issueSession(userId)
    const user = await findUserByEmail(input.email)
    if (!user) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.')
    }
    return { user: publicUser(user), session, memberships: [] }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
      throw new AppError(409, 'EMAIL_IN_USE', 'No se pudo crear la cuenta con ese correo.')
    }
    throw error
  }
}

export async function loginAccount(input: {
  email: string
  password: string
  ip: string
}): Promise<{ user: PublicUser; session: IssuedSession; memberships: MembershipSummary[] }> {
  const ip = clientIp(input.ip)
  await assertLoginAllowed(input.email, ip)
  const user = await findUserByEmail(input.email)

  if (!user) {
    await consumePasswordCheck(input.password)
    await recordAttempt('login', input.email, ip)
    throw new AppError(401, 'INVALID_CREDENTIALS', genericCredentials)
  }

  const matches = await verifyPassword(user.password_hash, input.password)
  if (!matches || user.account_status !== 'active') {
    await recordAttempt('login', input.email, ip)
    throw new AppError(401, 'INVALID_CREDENTIALS', genericCredentials)
  }

  const session = await issueSession(Number(user.id))
  const memberships = await listMemberships(Number(user.id))
  return { user: publicUser(user), session, memberships }
}

export async function updateProfile(
  userId: number,
  input: { fullName: string; phone?: string | null },
): Promise<PublicUser> {
  if (input.phone === undefined) {
    await getPool().query('UPDATE users SET full_name = ? WHERE id = ?', [input.fullName, userId])
  } else {
    await getPool().query('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [input.fullName, input.phone, userId])
  }
  const rows = await queryRows<UserRow>(
    getPool(),
    `SELECT id, full_name, email, phone, password_hash, account_status FROM users WHERE id = ?`,
    [userId],
  )
  const user = rows[0]
  if (!user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Necesitas iniciar sesión.')
  }
  return publicUser(user)
}

export async function changePassword(input: {
  userId: number
  email: string
  currentPassword: string
  newPassword: string
}): Promise<IssuedSession> {
  const problem = passwordProblem(input.newPassword, input.email)
  if (problem) {
    throw new AppError(400, 'WEAK_PASSWORD', problem)
  }

  const rows = await queryRows<UserRow>(
    getPool(),
    'SELECT id, password_hash, account_status, full_name, email, phone FROM users WHERE id = ?',
    [input.userId],
  )
  const user = rows[0]
  if (!user || user.account_status !== 'active') {
    throw new AppError(401, 'UNAUTHENTICATED', 'Necesitas iniciar sesión.')
  }

  const matches = await verifyPassword(user.password_hash, input.currentPassword)
  if (!matches) {
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'La contraseña actual no es correcta.')
  }

  const nextHash = await hashPassword(input.newPassword)
  return withTransaction(async (connection) => {
    await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [nextHash, input.userId])
    await revokeAllSessions(input.userId, connection)
    return issueSession(input.userId, connection)
  })
}

export function requestIp(value: string | undefined): string {
  return clientIp(value ?? '')
}
