import { randomBytes } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import type { PoolConnection } from 'mysql2/promise'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { insertRow, queryRows, withTransaction, type SqlExecutor } from '../../utils/sql.js'
import { markNeedMatchesStale, markProjectMatchesStale } from '../matching/invalidate.js'
import { canWriteMaterials } from '../materials/permissions.js'
import { isMemberRole, type MemberRole } from '../organizations/permissions.js'
import {
  canTransitionNeed,
  canTransitionProject,
  datesAreOrdered,
  isNeedContentEditable,
  isNeedStatus,
  isOpenNeed,
  isProjectEditable,
  isProjectStatus,
  needDateFitsProject,
  needStatusLabel,
  projectStatusLabel,
  type NeedStatus,
  type ProjectStatus,
} from './states.js'

type Specification = { name: string; value: string }

type ProjectRow = RowDataPacket & {
  id: number
  public_code: string | null
  organization_id: number
  organization_name: string
  created_by_user_id: number
  responsible_user_id: number | null
  responsible_name: string | null
  title: string
  description: string | null
  project_type: string
  city: string
  department: string
  address: string | null
  visibility: 'private' | 'public'
  status: string
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
  role_name: string | null
  open_needs: number
}

type NeedRow = RowDataPacket & {
  id: number
  public_code: string | null
  project_id: number
  category_id: number
  category_name: string
  unit_id: number
  unit_code: string
  unit_name: string
  unit_dimension: string
  title: string | null
  description: string
  specifications_json: unknown
  observations: string | null
  city: string | null
  department: string | null
  location_description: string | null
  required_quantity: string
  required_condition: string | null
  needed_by: string | null
  priority: string
  status: string
  visibility: 'private' | 'public'
  created_at: string
  updated_at: string
}

export type ProjectInput = {
  organizationId: number
  title: string
  description?: string | null
  projectType: string
  city: string
  department: string
  address?: string | null
  startDate?: string | null
  endDate?: string | null
  visibility?: 'private' | 'public'
  responsibleUserId?: number | null
  status?: 'draft' | 'active'
}

export type NeedInput = {
  categoryId: number
  unitId: number
  title: string
  description: string
  requiredQuantity: string
  requiredCondition?: string | null
  priority?: string
  neededBy?: string | null
  city?: string | null
  department?: string | null
  locationDescription?: string | null
  observations?: string | null
  specifications?: Specification[]
  visibility?: 'private' | 'public'
  status?: 'draft' | 'open'
}

function projectCode(): string {
  return `prj_${randomBytes(10).toString('hex')}`
}

function needCode(): string {
  return `nd_${randomBytes(10).toString('hex')}`
}

function isDuplicate(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && String(error.code) === 'ER_DUP_ENTRY'
}

function specificationsOf(value: unknown): Specification[] {
  const raw = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as Record<string, unknown>
    if (typeof record.name !== 'string' || typeof record.value !== 'string') {
      return []
    }
    return [{ name: record.name, value: record.value }]
  })
}

function assertProjectDates(start: string | null, end: string | null): void {
  if (!datesAreOrdered(start, end)) {
    throw new AppError(400, 'INVALID_INPUT', 'La fecha de finalización no puede ser anterior al inicio.')
  }
}

async function recordEvent(
  executor: SqlExecutor,
  input: {
    projectId: number
    needId?: number | null
    actorUserId: number
    organizationId: number
    eventType: string
    description: string
    operationKey: string
  },
): Promise<'recorded' | 'duplicate'> {
  try {
    await insertRow(
      executor,
      `INSERT INTO project_events (
         project_id, need_id, actor_user_id, organization_id, event_type, description, operation_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.projectId,
        input.needId ?? null,
        input.actorUserId,
        input.organizationId,
        input.eventType,
        input.description,
        input.operationKey,
      ],
    )
    return 'recorded'
  } catch (error) {
    if (isDuplicate(error)) {
      return 'duplicate'
    }
    throw error
  }
}

async function operationUsed(operationKey: string): Promise<number | null> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    'SELECT project_id FROM project_events WHERE operation_key = ?',
    [operationKey],
  )
  const id = rows[0]?.project_id
  return typeof id === 'number' || typeof id === 'string' ? Number(id) : null
}

async function activeRole(userId: number, organizationId: number): Promise<MemberRole | null> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT role FROM organization_members
     WHERE user_id = ? AND organization_id = ? AND membership_status = 'active'`,
    [userId, organizationId],
  )
  const role = rows[0]?.role
  return typeof role === 'string' && isMemberRole(role) ? role : null
}

async function assertResponsible(organizationId: number, userId: number): Promise<void> {
  const role = await activeRole(userId, organizationId)
  if (!role) {
    throw new AppError(400, 'INVALID_REFERENCE', 'El responsable debe ser un miembro activo de la organización.')
  }
}

async function unitDimension(unitId: number): Promise<string> {
  const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT dimension FROM measurement_units WHERE id = ?', [unitId])
  const dimension = rows[0]?.dimension
  if (typeof dimension !== 'string') {
    throw new AppError(400, 'INVALID_REFERENCE', 'La unidad no existe.')
  }
  return dimension
}

const projectSelect = `
  SELECT p.id, p.public_code, p.organization_id, o.name AS organization_name,
         p.created_by_user_id, p.responsible_user_id, ru.full_name AS responsible_name,
         p.title, p.description, p.project_type, p.city, p.department, p.address, p.visibility, p.status,
         DATE_FORMAT(p.start_date, '%Y-%m-%d') AS start_date,
         DATE_FORMAT(p.end_date, '%Y-%m-%d') AS end_date,
         DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
         mem.role AS role_name,
         (SELECT COUNT(*) FROM project_material_needs n
           WHERE n.project_id = p.id AND n.status IN ('open', 'partially_covered')) AS open_needs
`

const projectFrom = `
  FROM projects p
  INNER JOIN organizations o ON o.id = p.organization_id
  LEFT JOIN users ru ON ru.id = p.responsible_user_id
  LEFT JOIN organization_members mem
    ON mem.organization_id = p.organization_id
   AND mem.user_id = ?
   AND mem.membership_status = 'active'
`

function roleOf(row: ProjectRow): MemberRole | null {
  return row.role_name && isMemberRole(row.role_name) ? row.role_name : null
}

function isPublicProject(row: ProjectRow): boolean {
  return row.visibility === 'public' && row.status === 'active'
}

async function loadProject(userId: number | null, where: string, params: unknown[]): Promise<ProjectRow | null> {
  const rows = await queryRows<ProjectRow>(getPool(), `${projectSelect} ${projectFrom} WHERE ${where}`, [userId ?? 0, ...params])
  return rows[0] ?? null
}

async function requireVisibleProject(userId: number | null, projectId: number): Promise<ProjectRow> {
  const row = await loadProject(userId, 'p.id = ?', [projectId])
  if (!row || (!roleOf(row) && !isPublicProject(row))) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el proyecto.')
  }
  return row
}

async function requireWriter(userId: number, projectId: number): Promise<ProjectRow> {
  const row = await requireVisibleProject(userId, projectId)
  const role = roleOf(row)
  if (!role) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el proyecto.')
  }
  if (!canWriteMaterials(role)) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para modificar este proyecto.')
  }
  return row
}

function presentProject(row: ProjectRow, member: boolean) {
  const role = roleOf(row)
  const shared = {
    id: member ? row.id : undefined,
    publicCode: row.public_code,
    organizationName: row.organization_name,
    title: row.title,
    description: row.description,
    projectType: row.project_type,
    city: row.city,
    department: row.department,
    status: row.status,
    visibility: member ? row.visibility : 'public',
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openNeeds: Number(row.open_needs),
    audience: member ? 'private' : 'public',
    canEdit: member && role !== null && canWriteMaterials(role) && isProjectStatus(row.status) && isProjectEditable(row.status),
  }
  if (!member) {
    return { ...shared, address: null, responsibleName: null, organizationId: undefined }
  }
  return {
    ...shared,
    organizationId: row.organization_id,
    address: row.address,
    responsibleUserId: row.responsible_user_id,
    responsibleName: row.responsible_name,
  }
}

function presentNeed(row: NeedRow, member: boolean) {
  return {
    id: member ? row.id : undefined,
    publicCode: row.public_code,
    projectId: member ? row.project_id : undefined,
    categoryId: row.category_id,
    categoryName: row.category_name,
    unitId: row.unit_id,
    unitCode: row.unit_code,
    unitName: row.unit_name,
    title: row.title ?? row.description,
    description: row.description,
    requiredQuantity: String(row.required_quantity),
    requiredCondition: row.required_condition,
    priority: row.priority,
    neededBy: row.needed_by,
    status: row.status,
    visibility: member ? row.visibility : 'public',
    city: row.city,
    department: row.department,
    locationDescription: member ? row.location_description : null,
    observations: member ? row.observations : null,
    specifications: specificationsOf(row.specifications_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const needSelect = `
  SELECT n.id, n.public_code, n.project_id, n.category_id, c.name AS category_name,
         n.unit_id, u.code AS unit_code, u.name AS unit_name, u.dimension AS unit_dimension,
         n.title, n.description, n.specifications_json, n.observations, n.city, n.department, n.location_description,
         n.required_quantity, n.required_condition,
         DATE_FORMAT(n.needed_by, '%Y-%m-%d') AS needed_by,
         n.priority, n.status, n.visibility,
         DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(n.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
  FROM project_material_needs n
  INNER JOIN material_categories c ON c.id = n.category_id
  INNER JOIN measurement_units u ON u.id = n.unit_id
`

export async function listProjects(userId: number, query: { q?: string; status?: string; page: number; pageSize: number }) {
  const params: unknown[] = [userId]
  const filters: string[] = []
  if (query.status) {
    filters.push('p.status = ?')
    params.push(query.status)
  }
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
    filters.push(`(p.title LIKE ? ESCAPE '\\\\' OR p.city LIKE ? ESCAPE '\\\\' OR p.public_code = ?)`)
    params.push(pattern, pattern, query.q)
  }
  const where = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : ''
  const memberJoin = `
    FROM projects p
    INNER JOIN organizations o ON o.id = p.organization_id
    INNER JOIN organization_members mem
      ON mem.organization_id = p.organization_id
     AND mem.user_id = ?
     AND mem.membership_status = 'active'
  `
  const totals = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total,
            SUM(p.status = 'active') AS active_total
     ${memberJoin}`,
    [userId],
  )
  const openNeeds = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total
     FROM project_material_needs n
     INNER JOIN projects p ON p.id = n.project_id
     INNER JOIN organization_members mem
       ON mem.organization_id = p.organization_id
      AND mem.user_id = ?
      AND mem.membership_status = 'active'
     WHERE n.status IN ('open', 'partially_covered')`,
    [userId],
  )
  const filtered = await queryRows<RowDataPacket>(getPool(), `SELECT COUNT(*) AS total ${memberJoin} WHERE 1 = 1${where}`, params)
  const offset = (query.page - 1) * query.pageSize
  const rows = await queryRows<ProjectRow>(
    getPool(),
    `${projectSelect} ${memberJoin}
     LEFT JOIN users ru ON ru.id = p.responsible_user_id
     WHERE 1 = 1${where}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, query.pageSize, offset],
  )
  return {
    summary: {
      total: Number(totals[0]?.total ?? 0),
      active: Number(totals[0]?.active_total ?? 0),
      openNeeds: Number(openNeeds[0]?.total ?? 0),
    },
    projects: rows.map((row) => presentProject({ ...row, role_name: row.role_name }, true)),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(filtered[0]?.total ?? 0),
  }
}

export async function getProject(userId: number | null, projectId: number) {
  const row = await requireVisibleProject(userId, projectId)
  const member = roleOf(row) !== null
  const needs = await listNeedRows(row.id, member ? null : 'public')
  const events = member ? await listEventRows(row.id) : []
  return { project: presentProject(row, member), needs: needs.map((need) => presentNeed(need, member)), events }
}

export async function getPublicProject(userId: number | null, publicCode: string) {
  const row = await loadProject(userId, 'p.public_code = ?', [publicCode])
  if (!row || (!roleOf(row) && !isPublicProject(row))) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el proyecto.')
  }
  const member = roleOf(row) !== null
  const needs = await listNeedRows(row.id, member ? null : 'public')
  return { project: presentProject(row, member), needs: needs.map((need) => presentNeed(need, member)) }
}

async function listNeedRows(projectId: number, visibility: 'public' | null): Promise<NeedRow[]> {
  const extra = visibility === 'public' ? ` AND n.visibility = 'public'` : ''
  return queryRows<NeedRow>(getPool(), `${needSelect} WHERE n.project_id = ?${extra} ORDER BY n.id ASC`, [projectId])
}

async function listEventRows(projectId: number) {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT e.id, e.event_type, e.description, e.need_id,
            DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            u.full_name AS actor_name
     FROM project_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.project_id = ?
     ORDER BY e.created_at ASC, e.id ASC
     LIMIT 100`,
    [projectId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    eventType: String(row.event_type),
    description: String(row.description),
    needId: row.need_id === null ? null : Number(row.need_id),
    createdAt: String(row.created_at),
    actorName: row.actor_name === null ? 'No registrado' : String(row.actor_name),
  }))
}

async function insertProject(connection: PoolConnection, userId: number, input: ProjectInput, operationKey: string): Promise<number> {
  const status = input.status ?? 'draft'
  const visibility = input.visibility ?? 'private'
  if (visibility === 'public' && status !== 'active') {
    throw new AppError(409, 'NOT_ACTIVE', 'Solo un proyecto activo puede consultarse sin sesión.')
  }
  const start = input.startDate ?? null
  const end = input.endDate ?? null
  assertProjectDates(start, end)
  const responsible = input.responsibleUserId ?? userId
  await assertResponsible(input.organizationId, responsible)
  let publicCode = ''
  let id = 0
  for (let attempt = 0; attempt < 5; attempt += 1) {
    publicCode = projectCode()
    try {
      id = await insertRow(
        connection,
        `INSERT INTO projects (
           public_code, organization_id, created_by_user_id, responsible_user_id, title, description,
           project_type, city, department, visibility, address, status, start_date, end_date
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicCode,
          input.organizationId,
          userId,
          responsible,
          input.title,
          input.description ?? null,
          input.projectType,
          input.city,
          input.department,
          visibility,
          input.address ?? null,
          status,
          start,
          end,
        ],
      )
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (isDuplicate(error) && message.includes('public_code') && attempt < 4) {
        continue
      }
      throw error
    }
  }
  const recorded = await recordEvent(connection, {
    projectId: id,
    actorUserId: userId,
    organizationId: input.organizationId,
    eventType: 'project_created',
    description: 'Se creó el proyecto.',
    operationKey,
  })
  if (recorded === 'duplicate') {
    throw new AppError(409, 'DUPLICATE_OPERATION', 'Esta operación ya quedó registrada.')
  }
  return id
}

export async function createProject(userId: number, input: ProjectInput, operationKey: string) {
  const role = await activeRole(userId, input.organizationId)
  if (!role) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la organización.')
  }
  if (!canWriteMaterials(role)) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para crear proyectos en esta organización.')
  }
  const existing = await operationUsed(operationKey)
  if (existing) {
    return getProject(userId, existing)
  }
  try {
    const id = await withTransaction((connection) => insertProject(connection, userId, input, operationKey))
    return getProject(userId, id)
  } catch (error) {
    if (error instanceof AppError && error.code === 'DUPLICATE_OPERATION') {
      const replay = await operationUsed(operationKey)
      if (replay) {
        return getProject(userId, replay)
      }
    }
    if (isDuplicate(error)) {
      const replay = await operationUsed(operationKey)
      if (replay) {
        return getProject(userId, replay)
      }
    }
    if (error instanceof AppError) {
      throw error
    }
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if (code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
      throw new AppError(400, 'INVALID_INPUT', 'Las fechas o los datos del proyecto no son válidos.')
    }
    throw error
  }
}

export async function updateProject(userId: number, projectId: number, input: Partial<ProjectInput>, operationKey: string) {
  if (await operationUsed(`${operationKey}-project`)) {
    return getProject(userId, projectId)
  }
  const current = await requireWriter(userId, projectId)
  if (!isProjectStatus(current.status) || !isProjectEditable(current.status)) {
    throw new AppError(409, 'PROJECT_LOCKED', 'Este proyecto no admite ediciones. Puedes restaurarlo si está archivado.')
  }
  const start = input.startDate === undefined ? current.start_date : input.startDate
  const end = input.endDate === undefined ? current.end_date : input.endDate
  assertProjectDates(start, end)
  const visibility = input.visibility ?? current.visibility
  if (visibility === 'public' && current.status !== 'active') {
    throw new AppError(409, 'NOT_ACTIVE', 'Solo un proyecto activo puede consultarse sin sesión.')
  }
  if (input.responsibleUserId) {
    await assertResponsible(current.organization_id, input.responsibleUserId)
  }
  await withTransaction(async (connection) => {
    await connection.query(
      `UPDATE projects
       SET title = ?, description = ?, project_type = ?, city = ?, department = ?, address = ?,
           visibility = ?, start_date = ?, end_date = ?, responsible_user_id = ?
       WHERE id = ?`,
      [
        input.title ?? current.title,
        input.description === undefined ? current.description : input.description,
        input.projectType ?? current.project_type,
        input.city ?? current.city,
        input.department ?? current.department,
        input.address === undefined ? current.address : input.address,
        visibility,
        start,
        end,
        input.responsibleUserId === undefined ? current.responsible_user_id : input.responsibleUserId,
        projectId,
      ],
    )
    await recordEvent(connection, {
      projectId,
      actorUserId: userId,
      organizationId: current.organization_id,
      eventType: visibility !== current.visibility ? 'visibility_changed' : 'project_updated',
      description:
        visibility !== current.visibility
          ? visibility === 'public'
            ? 'Se habilitó la consulta pública del proyecto. La dirección exacta sigue siendo privada.'
            : 'Se retiró la consulta pública del proyecto.'
          : 'Se actualizó la información del proyecto.',
      operationKey: `${operationKey}-project`,
    })
  })
  await markProjectMatchesStale(getPool(), projectId)
  return getProject(userId, projectId)
}

export async function changeProjectStatus(userId: number, projectId: number, status: ProjectStatus, operationKey: string) {
  if (await operationUsed(`${operationKey}-status`)) {
    return getProject(userId, projectId)
  }
  const current = await requireWriter(userId, projectId)
  if (!isProjectStatus(current.status)) {
    throw new AppError(409, 'INVALID_TRANSITION', 'Ese cambio de estado no está permitido.')
  }
  if (!canTransitionProject(current.status, status)) {
    throw new AppError(409, 'INVALID_TRANSITION', 'Ese cambio de estado no está permitido.')
  }
  const previousStatus = current.status
  await withTransaction(async (connection) => {
    const visibility = status === 'active' ? current.visibility : 'private'
    await connection.query('UPDATE projects SET status = ?, visibility = ? WHERE id = ?', [status, visibility, projectId])
    await recordEvent(connection, {
      projectId,
      actorUserId: userId,
      organizationId: current.organization_id,
      eventType: 'project_status_changed',
      description: `El estado del proyecto pasó de ${projectStatusLabel(previousStatus)} a ${projectStatusLabel(status)}.`,
      operationKey: `${operationKey}-status`,
    })
    if (visibility !== current.visibility) {
      await recordEvent(connection, {
        projectId,
        actorUserId: userId,
        organizationId: current.organization_id,
        eventType: 'visibility_changed',
        description: 'La consulta pública se retiró porque el proyecto ya no está activo.',
        operationKey: `${operationKey}-visibility`,
      })
    }
  })
  await markProjectMatchesStale(getPool(), projectId)
  return getProject(userId, projectId)
}

export async function listNeeds(
  userId: number,
  projectId: number,
  query: { q?: string; status?: string; priority?: string; page: number; pageSize: number },
) {
  const project = await requireVisibleProject(userId, projectId)
  const member = roleOf(project) !== null
  const params: unknown[] = [projectId]
  const filters = ['n.project_id = ?']
  if (!member) {
    filters.push(`n.visibility = 'public'`)
  }
  if (query.status) {
    filters.push('n.status = ?')
    params.push(query.status)
  }
  if (query.priority) {
    filters.push('n.priority = ?')
    params.push(query.priority)
  }
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
    filters.push(`(n.title LIKE ? ESCAPE '\\\\' OR n.description LIKE ? ESCAPE '\\\\' OR c.name LIKE ? ESCAPE '\\\\')`)
    params.push(pattern, pattern, pattern)
  }
  const where = filters.join(' AND ')
  const totals = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total ${needSelect.replace(/^[\s\S]*FROM/, 'FROM')} WHERE ${where}`,
    params,
  )
  const offset = (query.page - 1) * query.pageSize
  const rows = await queryRows<NeedRow>(getPool(), `${needSelect} WHERE ${where} ORDER BY n.id ASC LIMIT ? OFFSET ?`, [
    ...params,
    query.pageSize,
    offset,
  ])
  return {
    needs: rows.map((row) => presentNeed(row, member)),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totals[0]?.total ?? 0),
  }
}

async function loadNeed(needId: number): Promise<NeedRow | null> {
  const rows = await queryRows<NeedRow>(getPool(), `${needSelect} WHERE n.id = ?`, [needId])
  return rows[0] ?? null
}

export async function getNeed(userId: number | null, needId: number) {
  const need = await loadNeed(needId)
  if (!need) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la necesidad.')
  }
  const project = await requireVisibleProject(userId, need.project_id)
  const member = roleOf(project) !== null
  if (!member && need.visibility !== 'public') {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la necesidad.')
  }
  return {
    need: presentNeed(need, member),
    project: { id: member ? project.id : undefined, title: project.title, publicCode: project.public_code, status: project.status },
    canEdit:
      member &&
      roleOf(project) !== null &&
      canWriteMaterials(roleOf(project) as MemberRole) &&
      isProjectStatus(project.status) &&
      isProjectEditable(project.status) &&
      isNeedStatus(need.status) &&
      isNeedContentEditable(need.status),
  }
}

async function assertNeedDates(project: ProjectRow, neededBy: string | null): Promise<void> {
  if (!needDateFitsProject(neededBy, project.start_date, project.end_date)) {
    throw new AppError(400, 'INVALID_INPUT', 'La fecha requerida queda fuera del periodo del proyecto.')
  }
}

export async function createNeed(userId: number, projectId: number, input: NeedInput, operationKey: string) {
  if (await operationUsed(operationKey)) {
    const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT need_id FROM project_events WHERE operation_key = ?', [operationKey])
    const needId = Number(rows[0]?.need_id)
    if (Number.isSafeInteger(needId) && needId > 0) {
      return getNeed(userId, needId)
    }
  }
  const project = await requireWriter(userId, projectId)
  if (!isProjectStatus(project.status) || !isProjectEditable(project.status)) {
    throw new AppError(409, 'PROJECT_LOCKED', 'Este proyecto no admite necesidades nuevas.')
  }
  await unitDimension(input.unitId)
  const category = await queryRows<RowDataPacket>(getPool(), 'SELECT id FROM material_categories WHERE id = ?', [input.categoryId])
  if (!category[0]) {
    throw new AppError(400, 'INVALID_REFERENCE', 'La categoría no existe.')
  }
  const neededBy = input.neededBy ?? null
  await assertNeedDates(project, neededBy)
  const status = input.status ?? 'open'
  const id = await withTransaction(async (connection) => {
    let publicCode = ''
    let needId = 0
    for (let attempt = 0; attempt < 5; attempt += 1) {
      publicCode = needCode()
      try {
        needId = await insertRow(
          connection,
          `INSERT INTO project_material_needs (
             public_code, project_id, category_id, unit_id, title, description, specifications_json, observations,
             city, department, location_description, required_quantity, required_condition, needed_by, priority, status, visibility
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            publicCode,
            projectId,
            input.categoryId,
            input.unitId,
            input.title,
            input.description,
            input.specifications && input.specifications.length > 0 ? JSON.stringify(input.specifications) : null,
            input.observations ?? null,
            input.city ?? null,
            input.department ?? null,
            input.locationDescription ?? null,
            input.requiredQuantity,
            input.requiredCondition ?? null,
            neededBy,
            input.priority ?? 'medium',
            status,
            input.visibility ?? 'private',
          ],
        )
        break
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (isDuplicate(error) && message.includes('public_code') && attempt < 4) {
          continue
        }
        throw error
      }
    }
    await recordEvent(connection, {
      projectId,
      needId,
      actorUserId: userId,
      organizationId: project.organization_id,
      eventType: 'need_created',
      description: 'Se registró una necesidad de material. No reserva inventario ni implica una entrega.',
      operationKey,
    })
    return needId
  })
  return getNeed(userId, id)
}

export async function updateNeed(userId: number, needId: number, input: Partial<NeedInput>, operationKey: string) {
  if (await operationUsed(`${operationKey}-need`)) {
    return getNeed(userId, needId)
  }
  const current = await loadNeed(needId)
  if (!current || !isNeedStatus(current.status)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la necesidad.')
  }
  const project = await requireWriter(userId, current.project_id)
  if (!isProjectStatus(project.status) || !isProjectEditable(project.status) || !isNeedContentEditable(current.status)) {
    throw new AppError(409, 'NEED_LOCKED', 'Esta necesidad no admite ediciones.')
  }
  const nextUnit = input.unitId ?? current.unit_id
  if (input.unitId && input.unitId !== current.unit_id) {
    const nextDimension = await unitDimension(input.unitId)
    if (nextDimension !== current.unit_dimension) {
      throw new AppError(409, 'INCOMPATIBLE_UNIT', 'La unidad nueva mide otra magnitud. No se convierte la cantidad de forma automática.')
    }
  }
  if (input.categoryId) {
    const category = await queryRows<RowDataPacket>(getPool(), 'SELECT id FROM material_categories WHERE id = ?', [input.categoryId])
    if (!category[0]) {
      throw new AppError(400, 'INVALID_REFERENCE', 'La categoría no existe.')
    }
  }
  const neededBy = input.neededBy === undefined ? current.needed_by : input.neededBy
  await assertNeedDates(project, neededBy)
  await withTransaction(async (connection) => {
    await connection.query(
      `UPDATE project_material_needs
       SET category_id = ?, unit_id = ?, title = ?, description = ?, specifications_json = ?, observations = ?,
           city = ?, department = ?, location_description = ?, required_quantity = ?, required_condition = ?,
           needed_by = ?, priority = ?, visibility = ?
       WHERE id = ?`,
      [
        input.categoryId ?? current.category_id,
        nextUnit,
        input.title ?? current.title ?? current.description,
        input.description ?? current.description,
        input.specifications === undefined
          ? current.specifications_json === null
            ? null
            : JSON.stringify(specificationsOf(current.specifications_json))
          : input.specifications.length > 0
            ? JSON.stringify(input.specifications)
            : null,
        input.observations === undefined ? current.observations : input.observations,
        input.city === undefined ? current.city : input.city,
        input.department === undefined ? current.department : input.department,
        input.locationDescription === undefined ? current.location_description : input.locationDescription,
        input.requiredQuantity ?? current.required_quantity,
        input.requiredCondition === undefined ? current.required_condition : input.requiredCondition,
        neededBy,
        input.priority ?? current.priority,
        input.visibility ?? current.visibility,
        needId,
      ],
    )
    await recordEvent(connection, {
      projectId: current.project_id,
      needId,
      actorUserId: userId,
      organizationId: project.organization_id,
      eventType: 'need_updated',
      description: 'Se actualizó una necesidad de material.',
      operationKey: `${operationKey}-need`,
    })
  })
  await markNeedMatchesStale(getPool(), needId)
  return getNeed(userId, needId)
}

export async function changeNeedStatus(userId: number, needId: number, status: NeedStatus, operationKey: string) {
  if (await operationUsed(`${operationKey}-need-status`)) {
    return getNeed(userId, needId)
  }
  const current = await loadNeed(needId)
  if (!current || !isNeedStatus(current.status)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la necesidad.')
  }
  const project = await requireWriter(userId, current.project_id)
  if (!canTransitionNeed(current.status, status)) {
    throw new AppError(409, 'INVALID_TRANSITION', 'Ese cambio de estado no está permitido.')
  }
  if (status === 'satisfied' && !isOpenNeed(current.status) && current.status !== 'paused') {
    throw new AppError(409, 'INVALID_TRANSITION', 'Solo una necesidad abierta o pausada puede marcarse como satisfecha.')
  }
  const eventType = status === 'satisfied' ? 'need_closed' : status === 'cancelled' ? 'need_cancelled' : 'need_updated'
  const description =
    status === 'satisfied'
      ? 'Una persona autorizada marcó la necesidad como satisfecha. Eso no descuenta inventario ni registra una entrega.'
      : status === 'cancelled'
        ? 'Se canceló la necesidad. El inventario no cambia.'
        : `El estado de la necesidad pasó de ${needStatusLabel(current.status)} a ${needStatusLabel(status)}.`
  await withTransaction(async (connection) => {
    await connection.query('UPDATE project_material_needs SET status = ? WHERE id = ?', [status, needId])
    await recordEvent(connection, {
      projectId: current.project_id,
      needId,
      actorUserId: userId,
      organizationId: project.organization_id,
      eventType,
      description,
      operationKey: `${operationKey}-need-status`,
    })
  })
  await markNeedMatchesStale(getPool(), needId)
  return getNeed(userId, needId)
}
