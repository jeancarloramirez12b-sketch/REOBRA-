import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { insertRow, queryRows, withTransaction, type SqlExecutor } from '../../utils/sql.js'
import { randomToken, sha256 } from '../auth/tokens.js'
import { canChangeMember, canInvite, canManageOrganization, isMemberRole, type InviteRole, type MemberRole } from './permissions.js'

export type OrganizationInput = {
  name: string
  organizationType: string
  contactEmail: string
  city: string
  department: string
  country?: string
  taxIdentifier?: string | null
}

export type OrganizationView = {
  id: number
  name: string
  organizationType: string
  taxIdentifier: string | null
  contactEmail: string
  city: string
  department: string
  country: string
  verificationStatus: string
  membership: {
    id: number
    role: MemberRole
    membershipStatus: string
  }
}

export type MemberView = {
  id: number
  userId: number
  fullName: string
  email: string
  role: MemberRole
  membershipStatus: string
}

export type InvitationView = {
  id: number
  email: string
  role: InviteRole
  expiresAt: string
  createdAt: string
}

type MembershipRow = RowDataPacket & {
  member_id: number
  role: string
  membership_status: string
  id: number
  name: string
  organization_type: string
  tax_identifier: string | null
  contact_email: string
  city: string
  department: string
  country: string
  verification_status: string
}

const notFound = new AppError(404, 'NOT_FOUND', 'No se encontró la organización.')
const forbidden = new AppError(403, 'FORBIDDEN', 'No tienes permiso para esta operación.')
const lastOwner = new AppError(
  409,
  'LAST_OWNER',
  'La organización debe conservar al menos un responsable principal activo.',
)

function asRole(value: string): MemberRole {
  if (!isMemberRole(value)) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.')
  }
  return value
}

function toView(row: MembershipRow): OrganizationView {
  return {
    id: Number(row.id),
    name: row.name,
    organizationType: row.organization_type,
    taxIdentifier: row.tax_identifier,
    contactEmail: row.contact_email,
    city: row.city,
    department: row.department,
    country: row.country,
    verificationStatus: row.verification_status,
    membership: {
      id: Number(row.member_id),
      role: asRole(row.role),
      membershipStatus: row.membership_status,
    },
  }
}

async function loadMembership(userId: number, organizationId: number, executor: SqlExecutor = getPool()): Promise<OrganizationView | null> {
  const rows = await queryRows<MembershipRow>(
    executor,
    `SELECT m.id AS member_id, m.role, m.membership_status,
            o.id, o.name, o.organization_type, o.tax_identifier, o.contact_email,
            o.city, o.department, o.country, o.verification_status
     FROM organizations o
     INNER JOIN organization_members m ON m.organization_id = o.id AND m.user_id = ?
     WHERE o.id = ?
     LIMIT 1`,
    [userId, organizationId],
  )
  const row = rows[0]
  return row ? toView(row) : null
}

function requireActive(organization: OrganizationView | null): OrganizationView {
  if (!organization) {
    throw notFound
  }
  if (organization.membership.membershipStatus !== 'active') {
    throw new AppError(403, 'MEMBERSHIP_INACTIVE', 'Tu participación en esta organización no está activa.')
  }
  return organization
}

async function otherActiveOwners(executor: SqlExecutor, organizationId: number, memberId: number): Promise<number> {
  const rows = await queryRows<RowDataPacket>(
    executor,
    `SELECT COUNT(*) AS total
     FROM organization_members
     WHERE organization_id = ? AND id <> ? AND role = 'owner' AND membership_status = 'active'`,
    [organizationId, memberId],
  )
  return Number(rows[0]?.total ?? 0)
}

function assertKeepsOwner(
  currentRole: MemberRole,
  currentStatus: string,
  nextRole: MemberRole,
  nextStatus: string,
  others: number,
): void {
  const wasOwner = currentRole === 'owner' && currentStatus === 'active'
  const staysOwner = nextRole === 'owner' && nextStatus === 'active'
  if (wasOwner && !staysOwner && others === 0) {
    throw lastOwner
  }
}

function duplicateMessage(error: unknown, fallback: string): AppError | null {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
    return new AppError(409, 'CONFLICT', fallback)
  }
  return null
}

export async function createOrganization(userId: number, input: OrganizationInput): Promise<OrganizationView> {
  try {
    const organizationId = await withTransaction(async (connection) => {
      const id = await insertRow(
        connection,
        `INSERT INTO organizations (
           name, organization_type, tax_identifier, contact_email, city, department, country, verification_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unverified')`,
        [
          input.name,
          input.organizationType,
          input.taxIdentifier ?? null,
          input.contactEmail,
          input.city,
          input.department,
          input.country ?? 'CO',
        ],
      )
      await insertRow(
        connection,
        `INSERT INTO organization_members (organization_id, user_id, role, membership_status)
         VALUES (?, ?, 'owner', 'active')`,
        [id, userId],
      )
      return id
    })

    const created = await loadMembership(userId, organizationId)
    if (!created) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.')
    }
    return created
  } catch (error) {
    const conflict = duplicateMessage(error, 'Ese identificador tributario ya está registrado.')
    if (conflict) {
      throw conflict
    }
    throw error
  }
}

export async function listOrganizations(userId: number): Promise<OrganizationView[]> {
  const rows = await queryRows<MembershipRow>(
    getPool(),
    `SELECT m.id AS member_id, m.role, m.membership_status,
            o.id, o.name, o.organization_type, o.tax_identifier, o.contact_email,
            o.city, o.department, o.country, o.verification_status
     FROM organization_members m
     INNER JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = ?
     ORDER BY o.name ASC, o.id ASC`,
    [userId],
  )
  return rows.map(toView)
}

export async function getOrganization(userId: number, organizationId: number): Promise<OrganizationView> {
  return requireActive(await loadMembership(userId, organizationId))
}

export async function updateOrganization(
  userId: number,
  organizationId: number,
  input: Partial<OrganizationInput>,
): Promise<OrganizationView> {
  const current = requireActive(await loadMembership(userId, organizationId))
  if (!canManageOrganization(current.membership.role)) {
    throw forbidden
  }

  const next = {
    name: input.name ?? current.name,
    organizationType: input.organizationType ?? current.organizationType,
    taxIdentifier: input.taxIdentifier === undefined ? current.taxIdentifier : input.taxIdentifier,
    contactEmail: input.contactEmail ?? current.contactEmail,
    city: input.city ?? current.city,
    department: input.department ?? current.department,
    country: input.country ?? current.country,
  }

  try {
    await getPool().query(
      `UPDATE organizations
       SET name = ?, organization_type = ?, tax_identifier = ?, contact_email = ?, city = ?, department = ?, country = ?
       WHERE id = ?`,
      [
        next.name,
        next.organizationType,
        next.taxIdentifier,
        next.contactEmail,
        next.city,
        next.department,
        next.country,
        organizationId,
      ],
    )
  } catch (error) {
    const conflict = duplicateMessage(error, 'Ese identificador tributario ya está registrado.')
    if (conflict) {
      throw conflict
    }
    throw error
  }

  return requireActive(await loadMembership(userId, organizationId))
}

export async function listMembers(userId: number, organizationId: number): Promise<MemberView[]> {
  requireActive(await loadMembership(userId, organizationId))
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT m.id, m.user_id, m.role, m.membership_status, u.full_name, u.email
     FROM organization_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = ?
     ORDER BY u.full_name ASC, m.id ASC`,
    [organizationId],
  )

  return rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    fullName: String(row.full_name),
    email: String(row.email),
    role: asRole(String(row.role)),
    membershipStatus: String(row.membership_status),
  }))
}

async function loadMember(organizationId: number, memberId: number, executor: SqlExecutor): Promise<MemberView | null> {
  const rows = await queryRows<RowDataPacket>(
    executor,
    `SELECT m.id, m.user_id, m.role, m.membership_status, u.full_name, u.email
     FROM organization_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = ? AND m.id = ?
     LIMIT 1`,
    [organizationId, memberId],
  )
  const row = rows[0]
  if (!row) {
    return null
  }
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    fullName: String(row.full_name),
    email: String(row.email),
    role: asRole(String(row.role)),
    membershipStatus: String(row.membership_status),
  }
}

export async function updateMember(
  actorUserId: number,
  organizationId: number,
  memberId: number,
  input: { role?: MemberRole; membershipStatus?: 'active' | 'suspended' },
): Promise<MemberView> {
  const actor = requireActive(await loadMembership(actorUserId, organizationId))
  const member = await loadMember(organizationId, memberId, getPool())
  if (!member) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el miembro.')
  }

  const nextRole = input.role ?? member.role
  const nextStatus = input.membershipStatus ?? member.membershipStatus
  if (nextStatus !== 'active' && nextStatus !== 'suspended') {
    throw new AppError(400, 'INVALID_INPUT', 'El estado de la participación no es válido.')
  }
  if (!canChangeMember(actor.membership.role, member.role, nextRole)) {
    throw forbidden
  }

  const others = await otherActiveOwners(getPool(), organizationId, member.id)
  assertKeepsOwner(member.role, member.membershipStatus, nextRole, nextStatus, others)

  await getPool().query('UPDATE organization_members SET role = ?, membership_status = ? WHERE id = ? AND organization_id = ?', [
    nextRole,
    nextStatus,
    member.id,
    organizationId,
  ])
  const updated = await loadMember(organizationId, memberId, getPool())
  if (!updated) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el miembro.')
  }
  return updated
}

export async function removeMember(actorUserId: number, organizationId: number, memberId: number): Promise<void> {
  const actor = requireActive(await loadMembership(actorUserId, organizationId))
  const member = await loadMember(organizationId, memberId, getPool())
  if (!member) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el miembro.')
  }

  const leaving = member.userId === actorUserId
  if (!leaving && !canChangeMember(actor.membership.role, member.role, member.role)) {
    throw forbidden
  }

  const others = await otherActiveOwners(getPool(), organizationId, member.id)
  assertKeepsOwner(member.role, member.membershipStatus, 'viewer', 'suspended', others)
  await getPool().query('DELETE FROM organization_members WHERE id = ? AND organization_id = ?', [member.id, organizationId])
}

export async function createInvitation(
  actorUserId: number,
  actorEmail: string,
  organizationId: number,
  input: { email: string; role: InviteRole },
): Promise<{ invitation: InvitationView; token: string }> {
  const actor = requireActive(await loadMembership(actorUserId, organizationId))
  if (!canInvite(actor.membership.role, input.role)) {
    throw forbidden
  }
  if (input.email === actorEmail) {
    throw new AppError(409, 'CONFLICT', 'Ya participas en esta organización.')
  }

  const existing = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT m.id
     FROM organization_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = ? AND u.email = ?
     LIMIT 1`,
    [organizationId, input.email],
  )
  if (existing.length > 0) {
    throw new AppError(409, 'CONFLICT', 'Esa persona ya participa en la organización.')
  }

  const token = randomToken()
  try {
    const id = await insertRow(
      getPool(),
      `INSERT INTO organization_invitations (
         organization_id, email, role, token_hash, invited_by_user_id, expires_at
       ) VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY))`,
      [organizationId, input.email, input.role, sha256(token), actorUserId],
    )
    const invitation = await findInvitation(organizationId, id)
    if (!invitation) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.')
    }
    return { invitation, token }
  } catch (error) {
    const conflict = duplicateMessage(error, 'Ya hay una invitación pendiente para ese correo.')
    if (conflict) {
      throw conflict
    }
    throw error
  }
}

async function findInvitation(organizationId: number, invitationId: number): Promise<InvitationView | null> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, email, role, expires_at, created_at
     FROM organization_invitations
     WHERE organization_id = ? AND id = ? AND accepted_at IS NULL AND revoked_at IS NULL
     LIMIT 1`,
    [organizationId, invitationId],
  )
  const row = rows[0]
  if (!row) {
    return null
  }
  return mapInvitation(row)
}

function mapInvitation(row: RowDataPacket): InvitationView {
  return {
    id: Number(row.id),
    email: String(row.email),
    role: row.role as InviteRole,
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }
}

export async function listInvitations(userId: number, organizationId: number): Promise<InvitationView[]> {
  const actor = requireActive(await loadMembership(userId, organizationId))
  if (!canManageOrganization(actor.membership.role)) {
    throw forbidden
  }
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, email, role, expires_at, created_at
     FROM organization_invitations
     WHERE organization_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
     ORDER BY created_at ASC`,
    [organizationId],
  )
  return rows.map(mapInvitation)
}

export async function revokeInvitation(userId: number, organizationId: number, invitationId: number): Promise<void> {
  const actor = requireActive(await loadMembership(userId, organizationId))
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, role, accepted_at, revoked_at
     FROM organization_invitations
     WHERE organization_id = ? AND id = ?
     LIMIT 1`,
    [organizationId, invitationId],
  )
  const invitation = rows[0]
  if (!invitation || invitation.accepted_at || invitation.revoked_at) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la invitación pendiente.')
  }
  if (!canInvite(actor.membership.role, invitation.role as InviteRole)) {
    throw forbidden
  }

  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE organization_invitations
     SET revoked_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    [invitationId],
  )
  if (Number(result.affectedRows) !== 1) {
    throw new AppError(409, 'CONFLICT', 'La invitación ya no se puede revocar.')
  }
}

export async function acceptInvitation(userId: number, email: string, token: string): Promise<OrganizationView> {
  const tokenHash = sha256(token.trim())

  const organizationId = await withTransaction(async (connection) => {
    const rows = await queryRows<RowDataPacket>(
      connection,
      `SELECT id, organization_id, email, role, expires_at, accepted_at, revoked_at
       FROM organization_invitations
       WHERE token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    )
    const invitation = rows[0]
    if (!invitation) {
      throw new AppError(400, 'INVITATION_INVALID', 'La invitación no es válida.')
    }
    if (invitation.revoked_at) {
      throw new AppError(409, 'INVITATION_REVOKED', 'La invitación fue revocada.')
    }
    if (invitation.accepted_at) {
      throw new AppError(409, 'INVITATION_USED', 'La invitación ya fue utilizada.')
    }
    if (new Date(String(invitation.expires_at)).getTime() <= Date.now()) {
      throw new AppError(409, 'INVITATION_EXPIRED', 'La invitación venció.')
    }
    if (String(invitation.email) !== email) {
      throw new AppError(403, 'INVITATION_FORBIDDEN', 'Esta invitación corresponde a otro correo.')
    }

    try {
      await insertRow(
        connection,
        `INSERT INTO organization_members (organization_id, user_id, role, membership_status)
         VALUES (?, ?, ?, 'active')`,
        [invitation.organization_id, userId, invitation.role],
      )
    } catch (error) {
      const conflict = duplicateMessage(error, 'Ya participas en esta organización.')
      if (conflict) {
        throw conflict
      }
      throw error
    }

    await connection.query(
      'UPDATE organization_invitations SET accepted_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [invitation.id],
    )
    return Number(invitation.organization_id)
  })

  return requireActive(await loadMembership(userId, organizationId))
}
