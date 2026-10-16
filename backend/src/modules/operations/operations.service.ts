import { randomBytes } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import type { PoolConnection } from 'mysql2/promise'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { insertRow, queryRows, withTransaction, type SqlExecutor } from '../../utils/sql.js'
import { canWriteMaterials } from '../materials/permissions.js'
import { isMemberRole, type MemberRole } from '../organizations/permissions.js'
import { isDuplicateKey, recordTraceEvent } from '../passports/trace.js'
import { openDocumentFile, removeDocumentFile, safeOriginalName, sha256Hex, writeDocumentFile } from '../passports/document-storage.js'
import { markMaterialMatchesStale } from '../matching/invalidate.js'
import { lockAvailability } from './inventory.js'
import {
  canTransition,
  canTransitionLogistics,
  coveragePercent,
  requestStatusLabel,
  reservingStatuses,
  type LogisticsMode,
  type LogisticsStatus,
  type RequestStatus,
} from './states.js'

type Party = 'requester' | 'supplier' | null

type RequestRow = RowDataPacket & {
  id: number
  public_code: string | null
  material_id: number
  material_title: string
  material_city: string
  material_department: string
  owner_organization_id: number
  owner_name: string
  requesting_organization_id: number
  requester_name: string
  project_id: number | null
  project_title: string | null
  project_need_id: number | null
  need_title: string | null
  required_quantity: string | null
  requested_quantity: string
  unit_code: string
  unit_name: string
  status: RequestStatus
  message: string | null
  proposal_version: number
  requester_confirmed_by_user_id: number | null
  supplier_confirmed_by_user_id: number | null
  confirmed_at: Date | null
  logistics_mode: LogisticsMode
  logistics_status: LogisticsStatus
  origin_city: string | null
  origin_department: string | null
  destination_city: string | null
  destination_department: string | null
  pickup_place: string | null
  scheduled_date: string | null
  time_window: string | null
  logistics_notes: string | null
  created_at: Date
  updated_at: Date
  requester_role: string | null
  supplier_role: string | null
  availability_status: string
}

const detailSql = `
  SELECT r.id, r.public_code, r.material_id, m.title AS material_title, m.city AS material_city, m.department AS material_department,
         m.organization_id AS owner_organization_id, owner.name AS owner_name, m.availability_status,
         r.requesting_organization_id, requester.name AS requester_name, r.project_id, p.title AS project_title,
         r.project_need_id, n.title AS need_title, n.required_quantity, r.requested_quantity, u.code AS unit_code, u.name AS unit_name,
         r.status, r.message, r.proposal_version, r.requester_confirmed_by_user_id, r.supplier_confirmed_by_user_id, r.confirmed_at,
         r.logistics_mode, r.logistics_status, r.origin_city, r.origin_department, r.destination_city, r.destination_department,
         r.pickup_place, DATE_FORMAT(r.scheduled_date, '%Y-%m-%d') AS scheduled_date, r.time_window, r.logistics_notes,
         r.requested_at AS created_at, r.updated_at, req_mem.role AS requester_role, sup_mem.role AS supplier_role
  FROM material_requests r
  INNER JOIN materials m ON m.id = r.material_id
  INNER JOIN organizations owner ON owner.id = m.organization_id
  INNER JOIN organizations requester ON requester.id = r.requesting_organization_id
  INNER JOIN measurement_units u ON u.id = m.unit_id
  LEFT JOIN projects p ON p.id = r.project_id
  LEFT JOIN project_material_needs n ON n.id = r.project_need_id
  LEFT JOIN organization_members req_mem
    ON req_mem.organization_id = r.requesting_organization_id AND req_mem.user_id = ? AND req_mem.membership_status = 'active'
  LEFT JOIN organization_members sup_mem
    ON sup_mem.organization_id = m.organization_id AND sup_mem.user_id = ? AND sup_mem.membership_status = 'active'
`

function decimal(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) {
    throw new AppError(500, 'INVALID_QUANTITY', 'Hay una cantidad que no se puede leer.')
  }
  return Math.round(number * 1000) / 1000
}

function code(prefix: 'req' | 'shp'): string {
  return `${prefix}_${randomBytes(10).toString('hex')}`
}

function partyOf(row: RequestRow): Party {
  if (isMemberRole(row.requester_role ?? '')) {
    return 'requester'
  }
  if (isMemberRole(row.supplier_role ?? '')) {
    return 'supplier'
  }
  return null
}

function writer(role: string | null): boolean {
  return isMemberRole(role ?? '') && canWriteMaterials(role as MemberRole)
}

async function loadRequest(userId: number, requestId: number, executor = getPool()): Promise<RequestRow> {
  const rows = await queryRows<RequestRow>(executor, `${detailSql} WHERE r.id = ?`, [userId, userId, requestId])
  const row = rows[0]
  if (!row || partyOf(row) === null) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la solicitud.')
  }
  return row
}

async function replay(operationKey: string): Promise<number | null> {
  const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT request_id FROM request_operations WHERE operation_key = ?', [operationKey])
  const id = Number(rows[0]?.request_id)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function remember(connection: PoolConnection, operationKey: string, requestId: number, action: string): Promise<void> {
  await connection.query('INSERT INTO request_operations (operation_key, request_id, action_name) VALUES (?, ?, ?)', [operationKey, requestId, action])
}

function fitKey(base: string, suffix: string): string {
  const tail = suffix.replace(/[^a-z0-9]/gi, '').slice(0, 18)
  const head = base.replace(/[^a-z0-9:_-]/gi, '').slice(0, 79 - tail.length)
  const key = `${head}-${tail}`
  return key.length >= 8 ? key : `op${head}${tail}`.slice(0, 80)
}

async function timeline(
  connection: PoolConnection,
  requestId: number,
  userId: number,
  organizationId: number,
  eventType: string,
  description: string,
  operationKey: string,
): Promise<void> {
  await connection.query(
    `INSERT INTO request_events (request_id, actor_user_id, organization_id, event_type, description, operation_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [requestId, userId, organizationId, eventType, description, fitKey(operationKey, eventType)],
  )
}

async function notify(connection: PoolConnection, organizationId: number, requestId: number, kind: string, message: string): Promise<void> {
  await connection.query(
    'INSERT INTO operation_notifications (organization_id, request_id, kind, message) VALUES (?, ?, ?, ?)',
    [organizationId, requestId, kind, message],
  )
}

async function trace(connection: PoolConnection, materialId: number, userId: number, organizationId: number, eventType: 'request_created' | 'request_updated' | 'delivery_recorded' | 'availability_changed' | 'evidence_added', description: string, operationKey: string): Promise<void> {
  await recordTraceEvent(connection, { materialId, actorUserId: userId, organizationId, eventType, description, operationKey: fitKey(operationKey, `trace${eventType}`) })
}

function present(row: RequestRow, dispatched: number, received: number, available: number) {
  const requested = decimal(row.requested_quantity)
  const required = row.required_quantity === null ? null : decimal(row.required_quantity)
  const role = partyOf(row)
  const canRequester = writer(row.requester_role)
  const canSupplier = writer(row.supplier_role)
  const negotiating = row.status === 'draft' || row.status === 'submitted' || row.status === 'under_review' || row.status === 'counter_proposed'
  return {
    id: row.id,
    publicCode: row.public_code,
    materialId: row.material_id,
    materialTitle: row.material_title,
    city: row.material_city,
    department: row.material_department,
    ownerOrganizationId: row.owner_organization_id,
    ownerName: row.owner_name,
    requesterOrganizationId: row.requesting_organization_id,
    requesterName: row.requester_name,
    projectId: row.project_id,
    projectTitle: row.project_title,
    needId: row.project_need_id,
    needTitle: row.need_title,
    unitCode: row.unit_code,
    unitName: row.unit_name,
    status: row.status,
    statusLabel: requestStatusLabel(row.status),
    message: row.message,
    requestedQuantity: requested,
    dispatchedQuantity: dispatched,
    receivedQuantity: received,
    availableQuantity: available,
    requiredQuantity: required,
    receivedCoveragePercent: required === null ? null : coveragePercent(received, required),
    proposalVersion: Number(row.proposal_version),
    requesterConfirmed: row.requester_confirmed_by_user_id !== null,
    supplierConfirmed: row.supplier_confirmed_by_user_id !== null,
    confirmedAt: row.confirmed_at,
    logisticsMode: row.logistics_mode,
    logisticsStatus: row.logistics_status,
    originCity: row.origin_city,
    originDepartment: row.origin_department,
    destinationCity: row.destination_city,
    destinationDepartment: row.destination_department,
    pickupPlace: row.pickup_place,
    scheduledDate: row.scheduled_date,
    timeWindow: row.time_window,
    logisticsNotes: row.logistics_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    party: role,
    actions: {
      submit: canRequester && row.status === 'draft',
      review: canSupplier && row.status === 'submitted',
      counter: canSupplier && (row.status === 'submitted' || row.status === 'under_review' || row.status === 'counter_proposed'),
      accept: (canSupplier && (row.status === 'submitted' || row.status === 'under_review')) || (canRequester && row.status === 'counter_proposed'),
      reject: canSupplier && negotiating && row.status !== 'draft',
      cancel: (canRequester && negotiating) || ((canRequester || canSupplier) && row.status === 'accepted' && dispatched === 0),
      expire: canSupplier && (row.status === 'submitted' || row.status === 'under_review'),
      logistics: (canRequester || canSupplier) && reservingStatuses.has(row.status),
      dispatch: canSupplier && reservingStatuses.has(row.status),
      incident: canRequester || canSupplier,
    },
    agreementNotice: 'La confirmación de las dos organizaciones reserva la cantidad. No es un contrato con firma electrónica.',
  }
}

async function movementTotals(requestId: number, executor: SqlExecutor = getPool()): Promise<{ dispatched: number; received: number }> {
  const rows = await queryRows<RowDataPacket>(
    executor,
    `SELECT COALESCE(SUM(CASE WHEN status = 'delivered' THEN delivered_quantity ELSE 0 END), 0) AS dispatched,
            COALESCE(SUM(received_quantity), 0) AS received
     FROM deliveries WHERE request_id = ?`,
    [requestId],
  )
  return { dispatched: decimal(rows[0]?.dispatched ?? 0), received: decimal(rows[0]?.received ?? 0) }
}

async function detail(userId: number, requestId: number) {
  const row = await loadRequest(userId, requestId)
  const totals = await movementTotals(requestId)
  const availability = await queryRows<RowDataPacket>(getPool(), 'SELECT available_quantity FROM material_quantity_summary WHERE material_id = ?', [row.material_id])
  const proposals = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, version_number, quantity, conditions_text, author_organization_id, created_at
     FROM request_proposals WHERE request_id = ? ORDER BY version_number ASC`,
    [requestId],
  )
  const deliveries = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, public_code, status, delivered_quantity, delivered_at, received_quantity, received_at, receipt_condition, receipt_notes, delivery_notes
     FROM deliveries WHERE request_id = ? ORDER BY id ASC`,
    [requestId],
  )
  const incidents = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, delivery_id, incident_type, description, status, resolution, created_at, resolved_at
     FROM logistics_incidents WHERE request_id = ? ORDER BY id ASC`,
    [requestId],
  )
  const events = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, event_type, description, created_at FROM request_events WHERE request_id = ? ORDER BY id ASC`,
    [requestId],
  )
  const documents = await queryRows<RowDataPacket>(
    getPool(),
    'SELECT id, original_name, created_at FROM operation_documents WHERE request_id = ? ORDER BY id ASC',
    [requestId],
  )
  const receivedForNeed = row.project_need_id
    ? decimal(
        (
          await queryRows<RowDataPacket>(
            getPool(),
            `SELECT COALESCE(SUM(d.received_quantity), 0) AS total
             FROM deliveries d
             INNER JOIN material_requests r ON r.id = d.request_id
             WHERE r.project_need_id = ?`,
            [row.project_need_id],
          )
        )[0]?.total ?? 0,
      )
    : totals.received
  const card = present(row, totals.dispatched, totals.received, decimal(availability[0]?.available_quantity ?? 0))
  if (row.required_quantity !== null) {
    card.receivedCoveragePercent = coveragePercent(receivedForNeed, decimal(row.required_quantity))
    card.receivedQuantity = receivedForNeed
  }
  return {
    request: card,
    proposals: proposals.map((item) => ({
      id: Number(item.id),
      version: Number(item.version_number),
      quantity: decimal(item.quantity),
      conditions: item.conditions_text === null ? null : String(item.conditions_text),
      authorOrganizationId: Number(item.author_organization_id),
      createdAt: item.created_at,
    })),
    deliveries: deliveries.map((item) => ({
      id: Number(item.id),
      publicCode: item.public_code === null ? null : String(item.public_code),
      status: String(item.status),
      dispatchedQuantity: item.delivered_quantity === null ? null : decimal(item.delivered_quantity),
      dispatchedAt: item.delivered_at,
      receivedQuantity: item.received_quantity === null ? null : decimal(item.received_quantity),
      receivedAt: item.received_at,
      receiptCondition: item.receipt_condition === null ? null : String(item.receipt_condition),
      notes: item.delivery_notes === null ? null : String(item.delivery_notes),
      receiptNotes: item.receipt_notes === null ? null : String(item.receipt_notes),
      canReceive: writer(row.requester_role) && item.status === 'delivered' && item.received_at === null,
    })),
    incidents: incidents.map((item) => ({
      id: Number(item.id),
      deliveryId: item.delivery_id === null ? null : Number(item.delivery_id),
      type: String(item.incident_type),
      description: String(item.description),
      status: String(item.status),
      resolution: item.resolution === null ? null : String(item.resolution),
      createdAt: item.created_at,
      resolvedAt: item.resolved_at,
    })),
    events: events.map((item) => ({ id: Number(item.id), type: String(item.event_type), description: String(item.description), createdAt: item.created_at })),
    documents: documents.map((item) => ({
      id: Number(item.id),
      name: String(item.original_name),
      createdAt: item.created_at,
      verified: false,
    })),
  }
}

async function ensureVisibleMaterial(userId: number, materialId: number, connection?: PoolConnection) {
  const executor = connection ?? getPool()
  const rows = await queryRows<RowDataPacket>(
    executor,
    `SELECT m.id, m.organization_id, m.title, m.availability_status, m.city, m.department, m.unit_id, u.name AS unit_name, u.code AS unit_code,
            o.name AS owner_name, p.visibility AS passport_visibility, qs.available_quantity
     FROM materials m
     INNER JOIN organizations o ON o.id = m.organization_id
     INNER JOIN measurement_units u ON u.id = m.unit_id
     INNER JOIN material_quantity_summary qs ON qs.material_id = m.id
     LEFT JOIN material_passports p ON p.material_id = m.id
     LEFT JOIN organization_members mem
       ON mem.organization_id = m.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
     WHERE m.id = ?`,
    [userId, materialId],
  )
  const material = rows[0]
  if (!material) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
  }
  const sameOrganization = await queryRows<RowDataPacket>(
    executor,
    `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND membership_status = 'active'`,
    [material.organization_id, userId],
  )
  const visible = sameOrganization[0] || material.passport_visibility === 'public'
  if (!visible || material.availability_status !== 'published') {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
  }
  return material
}

async function loadNeedForWriter(userId: number, needId: number) {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT n.id, n.project_id, n.title, n.status, n.required_quantity, p.status AS project_status, p.organization_id, mem.role
     FROM project_material_needs n
     INNER JOIN projects p ON p.id = n.project_id
     INNER JOIN organization_members mem
       ON mem.organization_id = p.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
     WHERE n.id = ?`,
    [userId, needId],
  )
  const need = rows[0]
  if (!need) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la necesidad.')
  }
  if (!writer(String(need.role))) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para solicitar en esta necesidad.')
  }
  if (need.project_status !== 'active' || (need.status !== 'open' && need.status !== 'partially_covered')) {
    throw new AppError(409, 'NEED_NOT_OPEN', 'La necesidad no admite una solicitud nueva.')
  }
  return need
}

export async function requestContext(userId: number, materialId: number, needId: number) {
  const material = await ensureVisibleMaterial(userId, materialId)
  const need = await loadNeedForWriter(userId, needId)
  if (Number(material.organization_id) === Number(need.organization_id)) {
    throw new AppError(409, 'SAME_ORGANIZATION', 'Una organización no se solicita material a sí misma.')
  }
  return {
    material: {
      id: Number(material.id),
      title: String(material.title),
      availableQuantity: decimal(material.available_quantity),
      unitName: String(material.unit_name),
      unitCode: String(material.unit_code),
      ownerName: String(material.owner_name),
      city: String(material.city),
      department: String(material.department),
    },
    need: {
      id: Number(need.id),
      title: need.title === null ? 'Necesidad' : String(need.title),
      requiredQuantity: decimal(need.required_quantity),
      projectId: Number(need.project_id),
    },
  }
}

export async function createRequest(
  userId: number,
  input: { materialId: number; needId: number; quantity: number; message?: string; submit?: boolean },
  operationKey: string,
) {
  const existing = await replay(operationKey)
  if (existing) {
    return detail(userId, existing)
  }
  await requestContext(userId, input.materialId, input.needId)
  const status: RequestStatus = input.submit === false ? 'draft' : 'submitted'
  try {
    const requestId = await withTransaction(async (connection) => {
      let publicCode = ''
      let id = 0
      for (let attempt = 0; attempt < 5; attempt += 1) {
        publicCode = code('req')
        try {
          id = await insertRow(
            connection,
            `INSERT INTO material_requests (
               public_code, material_id, requesting_organization_id, project_id, project_need_id, requested_quantity, message,
               created_by_user_id, status, proposal_version, requester_confirmed_by_user_id, requester_confirmed_at
             )
             SELECT ?, m.id, p.organization_id, p.id, n.id, ?, ?, ?, ?, 1, CASE WHEN ? = 'submitted' THEN ? ELSE NULL END,
                    CASE WHEN ? = 'submitted' THEN CURRENT_TIMESTAMP(3) ELSE NULL END
             FROM project_material_needs n
             INNER JOIN projects p ON p.id = n.project_id
             INNER JOIN materials m ON m.id = ?
             WHERE n.id = ?`,
            [publicCode, input.quantity, input.message ?? null, userId, status, status, userId, status, input.materialId, input.needId],
          )
          break
        } catch (error) {
          if (!isDuplicateKey(error) || attempt === 4) {
            throw error
          }
        }
      }
      if (!id) {
        throw new AppError(409, 'NOT_CREATED', 'No se pudo crear la solicitud.')
      }
      const requesterOrganizationId = await organizationOfNeed(connection, input.needId)
      await connection.query(
        `INSERT INTO request_proposals (request_id, version_number, quantity, conditions_text, author_user_id, author_organization_id)
         VALUES (?, 1, ?, ?, ?, ?)`,
        [id, input.quantity, input.message ?? null, userId, requesterOrganizationId],
      )
      await remember(connection, operationKey, id, 'create')
      await timeline(connection, id, userId, requesterOrganizationId, 'created', 'Se creó la solicitud. Todavía no reserva inventario.', `${operationKey}-created`)
      if (status === 'submitted') {
        await timeline(connection, id, userId, requesterOrganizationId, 'submitted', 'La organización solicitante envió la propuesta inicial.', `${operationKey}-submitted`)
      }
      const ownerId = Number((await queryRows<RowDataPacket>(connection, 'SELECT organization_id FROM materials WHERE id = ?', [input.materialId]))[0]?.organization_id)
      await notify(connection, ownerId, id, 'request_received', 'Hay una solicitud nueva de material. Todavía no hay reserva.')
      await trace(connection, input.materialId, userId, requesterOrganizationId, 'request_created', 'Se registró una solicitud de material. No reserva inventario.', `${operationKey}-trace`)
      return id
    })
    return detail(userId, requestId)
  } catch (error) {
    if (isDuplicateKey(error)) {
      const again = await replay(operationKey)
      if (again) {
        return detail(userId, again)
      }
    }
    throw error
  }
}

async function organizationOfNeed(connection: PoolConnection, needId: number): Promise<number> {
  const rows = await queryRows<RowDataPacket>(
    connection,
    'SELECT p.organization_id FROM project_material_needs n INNER JOIN projects p ON p.id = n.project_id WHERE n.id = ?',
    [needId],
  )
  return Number(rows[0]?.organization_id)
}

function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_TRANSITION', 'Ese cambio de estado no está permitido.')
  }
}

async function reserveIfReady(connection: PoolConnection, row: RequestRow, userId: number, operationKey: string): Promise<void> {
  const fresh = await queryRows<RowDataPacket>(
    connection,
    `SELECT status, requested_quantity, proposal_version, requester_confirmed_by_user_id, supplier_confirmed_by_user_id, material_id
     FROM material_requests WHERE id = ? FOR UPDATE`,
    [row.id],
  )
  const current = fresh[0]
  if (!current) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la solicitud.')
  }
  if (current.requester_confirmed_by_user_id === null || current.supplier_confirmed_by_user_id === null) {
    return
  }
  if (Number(current.requester_confirmed_by_user_id) === Number(current.supplier_confirmed_by_user_id)) {
    throw new AppError(409, 'SAME_USER', 'La misma persona no puede confirmar por las dos organizaciones.')
  }
  if (current.status === 'accepted' || current.status === 'partially_fulfilled' || current.status === 'fulfilled') {
    return
  }
  const proposal = await queryRows<RowDataPacket>(
    connection,
    'SELECT quantity FROM request_proposals WHERE request_id = ? AND version_number = ?',
    [row.id, current.proposal_version],
  )
  const agreed = decimal(proposal[0]?.quantity ?? current.requested_quantity)
  assertTransition(current.status as RequestStatus, 'accepted')
  const availability = await lockAvailability(connection, Number(current.material_id))
  if (availability.available + 0.0001 < agreed) {
    throw new AppError(409, 'INSUFFICIENT_STOCK', 'La cantidad acordada supera la disponibilidad libre.')
  }
  await connection.query(
    `UPDATE material_requests
     SET requested_quantity = ?, status = 'accepted', confirmed_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = ?`,
    [agreed, row.id, current.status],
  )
  const requesterOrg = row.requesting_organization_id
  await timeline(connection, row.id, userId, requesterOrg, 'accepted', 'Las dos organizaciones confirmaron las mismas condiciones.', `${operationKey}-accepted`)
  await timeline(connection, row.id, userId, requesterOrg, 'reserved', `Se reservaron ${agreed} ${row.unit_name}. La existencia declarada no se descontó.`, `${operationKey}-reserved`)
  await trace(connection, row.material_id, userId, requesterOrg, 'availability_changed', 'Una reserva redujo la disponibilidad para nuevos acuerdos. La existencia declarada no cambió.', `${operationKey}-reserve-trace`)
  await markMaterialMatchesStale(connection, row.material_id)
}

export async function submitRequest(userId: number, requestId: number, operationKey: string) {
  return mutate(userId, requestId, operationKey, 'submit', async (connection, row) => {
    if (!writer(row.requester_role)) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes enviar esta solicitud.')
    }
    if (row.status === 'submitted') {
      return
    }
    assertTransition(row.status, 'submitted')
    await connection.query(
      `UPDATE material_requests
       SET status = 'submitted', requester_confirmed_by_user_id = ?, requester_confirmed_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [userId, row.id],
    )
    await timeline(connection, row.id, userId, row.requesting_organization_id, 'submitted', 'La solicitud fue enviada. No reserva inventario.', `${operationKey}-event`)
    await notify(connection, row.owner_organization_id, row.id, 'request_received', 'Una solicitud fue enviada y espera revisión.')
  })
}

export async function reviewRequest(userId: number, requestId: number, operationKey: string) {
  return mutate(userId, requestId, operationKey, 'review', async (connection, row) => {
    if (!writer(row.supplier_role)) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes revisar esta solicitud.')
    }
    if (row.status === 'under_review') {
      return
    }
    assertTransition(row.status, 'under_review')
    await connection.query(`UPDATE material_requests SET status = 'under_review' WHERE id = ?`, [row.id])
    await timeline(connection, row.id, userId, row.owner_organization_id, 'reviewed', 'La organización oferente empezó la revisión.', `${operationKey}-event`)
  })
}

export async function counterRequest(userId: number, requestId: number, input: { quantity: number; conditions?: string }, operationKey: string) {
  return mutate(userId, requestId, operationKey, 'counter', async (connection, row) => {
    if (!writer(row.supplier_role)) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes proponer cambios en esta solicitud.')
    }
    assertTransition(row.status, 'counter_proposed')
    const version = Number(row.proposal_version) + 1
    await connection.query(
      `INSERT INTO request_proposals (request_id, version_number, quantity, conditions_text, author_user_id, author_organization_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, version, input.quantity, input.conditions ?? null, userId, row.owner_organization_id],
    )
    await connection.query(
      `UPDATE material_requests
       SET status = 'counter_proposed', proposal_version = ?, requester_confirmed_by_user_id = NULL, requester_confirmed_at = NULL,
           supplier_confirmed_by_user_id = ?, supplier_confirmed_at = CURRENT_TIMESTAMP(3), confirmed_at = NULL
       WHERE id = ?`,
      [version, userId, row.id],
    )
    await timeline(connection, row.id, userId, row.owner_organization_id, 'counter_proposed', `La oferente propuso ${input.quantity} ${row.unit_name}. La propuesta anterior se conserva.`, `${operationKey}-event`)
    await notify(connection, row.requesting_organization_id, row.id, 'counteroffer', 'Hay una contraoferta. Aún no hay reserva.')
    await trace(connection, row.material_id, userId, row.owner_organization_id, 'request_updated', 'Se registró una contraoferta. No cambia el inventario.', `${operationKey}-trace`)
  })
}

export async function acceptRequest(userId: number, requestId: number, operationKey: string) {
  return mutate(userId, requestId, operationKey, 'accept', async (connection, row) => {
    const locked = await queryRows<RequestRow>(connection, `${detailSql} WHERE r.id = ? FOR UPDATE`, [userId, userId, row.id])
    const current = locked[0] ?? row
    if (reservingStatuses.has(current.status) || current.status === 'fulfilled') {
      return
    }
    if (current.status === 'counter_proposed') {
      if (!writer(current.requester_role)) {
        throw new AppError(403, 'FORBIDDEN', 'La organización solicitante debe responder la contraoferta.')
      }
      if (Number(current.supplier_confirmed_by_user_id) === userId) {
        throw new AppError(409, 'SAME_USER', 'La misma persona no puede confirmar por las dos organizaciones.')
      }
      await connection.query(
        `UPDATE material_requests SET requester_confirmed_by_user_id = ?, requester_confirmed_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [userId, current.id],
      )
    } else if (current.status === 'submitted' || current.status === 'under_review') {
      if (!writer(current.supplier_role)) {
        throw new AppError(403, 'FORBIDDEN', 'La organización oferente debe aceptar la propuesta.')
      }
      if (Number(current.requester_confirmed_by_user_id) === userId) {
        throw new AppError(409, 'SAME_USER', 'La misma persona no puede confirmar por las dos organizaciones.')
      }
      await connection.query(
        `UPDATE material_requests SET supplier_confirmed_by_user_id = ?, supplier_confirmed_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [userId, current.id],
      )
    } else {
      throw new AppError(409, 'INVALID_TRANSITION', 'Esa solicitud no se puede aceptar.')
    }
    await reserveIfReady(connection, current, userId, operationKey)
    await notify(connection, current.requesting_organization_id, current.id, 'accepted', 'La solicitud cambió de estado. Revisa si la reserva ya quedó confirmada.')
    await notify(connection, current.owner_organization_id, current.id, 'accepted', 'La solicitud cambió de estado. Revisa si la reserva ya quedó confirmada.')
  })
}

export async function rejectRequest(userId: number, requestId: number, operationKey: string) {
  return mutate(userId, requestId, operationKey, 'reject', async (connection, row) => {
    if (!writer(row.supplier_role)) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes rechazar esta solicitud.')
    }
    if (row.status === 'rejected') {
      return
    }
    assertTransition(row.status, 'rejected')
    await connection.query(`UPDATE material_requests SET status = 'rejected' WHERE id = ?`, [row.id])
    await timeline(connection, row.id, userId, row.owner_organization_id, 'rejected', 'La organización oferente rechazó la solicitud. No hubo reserva.', `${operationKey}-event`)
    await notify(connection, row.requesting_organization_id, row.id, 'rejected', 'La solicitud fue rechazada.')
  })
}

export async function expireRequest(userId: number, requestId: number, operationKey: string) {
  return mutate(userId, requestId, operationKey, 'expire', async (connection, row) => {
    if (!writer(row.supplier_role)) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes marcar esta solicitud como vencida.')
    }
    assertTransition(row.status, 'expired')
    await connection.query(`UPDATE material_requests SET status = 'expired' WHERE id = ?`, [row.id])
    await timeline(connection, row.id, userId, row.owner_organization_id, 'expired', 'La oferente marcó la solicitud como vencida. No se inventó una fecha automática.', `${operationKey}-event`)
  })
}

export async function cancelRequest(userId: number, requestId: number, operationKey: string) {
  return mutate(userId, requestId, operationKey, 'cancel', async (connection, row) => {
    const totals = await movementTotals(row.id, connection)
    if (totals.dispatched > 0) {
      throw new AppError(409, 'ALREADY_DISPATCHED', 'No se puede cancelar una solicitud que ya tiene una salida registrada.')
    }
    const canRequester = writer(row.requester_role)
    const canSupplier = writer(row.supplier_role)
    if (!canRequester && !canSupplier) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes cancelar esta solicitud.')
    }
    if (row.status === 'cancelled') {
      return
    }
    if (reservingStatuses.has(row.status) && !canRequester && !canSupplier) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes liberar esta reserva.')
    }
    assertTransition(row.status, 'cancelled')
    const wasReserved = reservingStatuses.has(row.status)
    await connection.query(`UPDATE material_requests SET status = 'cancelled', logistics_status = 'cancelled' WHERE id = ?`, [row.id])
    const organizationId = canRequester ? row.requesting_organization_id : row.owner_organization_id
    await timeline(connection, row.id, userId, organizationId, 'cancelled', 'Se canceló la solicitud.', `${operationKey}-event`)
    if (wasReserved) {
      await timeline(connection, row.id, userId, organizationId, 'reservation_released', 'Se liberó la reserva porque no había salida física.', `${operationKey}-released`)
      await trace(connection, row.material_id, userId, organizationId, 'availability_changed', 'Se liberó una reserva. La existencia declarada no cambió.', `${operationKey}-release-trace`)
      await markMaterialMatchesStale(connection, row.material_id)
    }
  })
}

export async function updateLogistics(
  userId: number,
  requestId: number,
  input: {
    mode: LogisticsMode
    originCity?: string
    originDepartment?: string
    destinationCity?: string
    destinationDepartment?: string
    pickupPlace?: string
    scheduledDate?: string
    timeWindow?: string
    notes?: string
    status: 'scheduled' | 'ready_for_pickup' | 'cancelled'
  },
  operationKey: string,
) {
  return mutate(userId, requestId, operationKey, 'logistics', async (connection, row) => {
    if (!writer(row.requester_role) && !writer(row.supplier_role)) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes coordinar esta operación.')
    }
    if (!reservingStatuses.has(row.status)) {
      throw new AppError(409, 'INVALID_TRANSITION', 'La coordinación logística empieza cuando la reserva existe.')
    }
    if (!canTransitionLogistics(row.logistics_status, input.status) && row.logistics_status !== input.status) {
      throw new AppError(409, 'INVALID_TRANSITION', 'Ese cambio logístico no está permitido.')
    }
    await connection.query(
      `UPDATE material_requests
       SET logistics_mode = ?, logistics_status = ?, origin_city = ?, origin_department = ?, destination_city = ?, destination_department = ?,
           pickup_place = ?, scheduled_date = ?, time_window = ?, logistics_notes = ?
       WHERE id = ?`,
      [
        input.mode,
        input.status,
        input.originCity ?? null,
        input.originDepartment ?? null,
        input.destinationCity ?? null,
        input.destinationDepartment ?? null,
        input.pickupPlace ?? null,
        input.scheduledDate ?? null,
        input.timeWindow ?? null,
        input.notes ?? null,
        row.id,
      ],
    )
    const organizationId = writer(row.supplier_role) ? row.owner_organization_id : row.requesting_organization_id
    await timeline(connection, row.id, userId, organizationId, 'logistics_updated', 'Se actualizó la coordinación. No se calculó una ruta ni un costo.', `${operationKey}-event`)
    const other = organizationId === row.owner_organization_id ? row.requesting_organization_id : row.owner_organization_id
    await notify(connection, other, row.id, 'logistics', 'Hay una actualización logística. No incluye un transportista externo.')
  })
}

export async function dispatchRequest(userId: number, requestId: number, input: { quantity: number; occurredAt: string; notes?: string }, operationKey: string) {
  return mutate(userId, requestId, operationKey, 'dispatch', async (connection, row) => {
    if (!writer(row.supplier_role)) {
      throw new AppError(403, 'FORBIDDEN', 'Solo la organización oferente registra la salida.')
    }
    if (!reservingStatuses.has(row.status)) {
      throw new AppError(409, 'INVALID_TRANSITION', 'Solo se despacha una cantidad reservada.')
    }
    const prior = await queryRows<RowDataPacket>(connection, 'SELECT id FROM deliveries WHERE operation_key = ?', [`${operationKey}-row`])
    if (prior[0]) {
      return
    }
    await lockAvailability(connection, row.material_id)
    const totals = await movementTotals(row.id, connection)
    const agreed = decimal(row.requested_quantity)
    if (decimal(totals.dispatched + input.quantity) > agreed + 0.0001) {
      throw new AppError(409, 'QUANTITY_EXCEEDED', 'La salida supera la cantidad reservada.')
    }
    let publicCode = ''
    for (let attempt = 0; attempt < 5; attempt += 1) {
      publicCode = code('shp')
      try {
        await connection.query(
          `INSERT INTO deliveries (
             public_code, request_id, delivered_at, delivered_quantity, status, delivery_notes, dispatched_by_user_id, operation_key
           ) VALUES (?, ?, ?, ?, 'delivered', ?, ?, ?)`,
          [publicCode, row.id, new Date(input.occurredAt), input.quantity, input.notes ?? null, userId, `${operationKey}-row`],
        )
        break
      } catch (error) {
        if (!isDuplicateKey(error) || attempt === 4) {
          throw error
        }
      }
    }
    const next = decimal(totals.dispatched + input.quantity) + 0.0001 >= agreed ? 'fulfilled' : 'partially_fulfilled'
    assertTransition(row.status, next)
    await connection.query('UPDATE material_requests SET status = ? WHERE id = ?', [next, row.id])
    await timeline(connection, row.id, userId, row.owner_organization_id, 'dispatched', `Se registró la salida de ${input.quantity} ${row.unit_name}. La recepción sigue pendiente.`, `${operationKey}-event`)
    await trace(connection, row.material_id, userId, row.owner_organization_id, 'delivery_recorded', 'Se registró una salida real. No confirma que el destinatario haya recibido el material.', `${operationKey}-trace`)
    await markMaterialMatchesStale(connection, row.material_id)
    await notify(connection, row.requesting_organization_id, row.id, 'receipt_pending', 'Hay una salida registrada. La recepción todavía no está confirmada.')
  })
}

export async function receiveDelivery(userId: number, requestId: number, deliveryId: number, input: { quantity: number; occurredAt: string; notes?: string; condition?: string }, operationKey: string) {
  return mutate(userId, requestId, operationKey, `receive-${deliveryId}`, async (connection, row) => {
    if (!writer(row.requester_role)) {
      throw new AppError(403, 'FORBIDDEN', 'Solo la organización destinataria confirma la recepción.')
    }
    const rows = await queryRows<RowDataPacket>(connection, 'SELECT id, status, delivered_quantity, received_at FROM deliveries WHERE id = ? AND request_id = ? FOR UPDATE', [deliveryId, row.id])
    const delivery = rows[0]
    if (!delivery || delivery.status !== 'delivered') {
      throw new AppError(404, 'NOT_FOUND', 'No se encontró un despacho para confirmar.')
    }
    if (delivery.received_at !== null) {
      return
    }
    if (input.quantity > decimal(delivery.delivered_quantity) + 0.0001) {
      throw new AppError(409, 'QUANTITY_EXCEEDED', 'La recepción no puede superar lo despachado.')
    }
    await connection.query(
      `UPDATE deliveries
       SET received_quantity = ?, received_at = ?, received_by_user_id = ?, receipt_condition = ?, receipt_notes = ?
       WHERE id = ? AND received_at IS NULL`,
      [input.quantity, new Date(input.occurredAt), userId, input.condition ?? 'not_declared', input.notes ?? null, deliveryId],
    )
    await timeline(connection, row.id, userId, row.requesting_organization_id, 'received', `Se confirmó la recepción de ${input.quantity} ${row.unit_name}. No se volvió a descontar el inventario.`, `${operationKey}-event`)
    const totals = await movementTotals(row.id, connection)
    if (row.status === 'fulfilled' && totals.received + 0.0001 >= decimal(row.requested_quantity)) {
      await timeline(connection, row.id, userId, row.requesting_organization_id, 'finished', 'La cantidad acordada ya tiene recepción confirmada. La necesidad no se cierra sola.', `${operationKey}-finished`)
    }
    await trace(connection, row.material_id, userId, row.requesting_organization_id, 'request_updated', 'El destinatario confirmó una recepción. Eso no certifica el material.', `${operationKey}-trace`)
  })
}

export async function openIncident(userId: number, requestId: number, input: { type: string; description: string; deliveryId?: number }, operationKey: string) {
  return mutate(userId, requestId, operationKey, 'incident', async (connection, row) => {
    if (!writer(row.requester_role) && !writer(row.supplier_role)) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes registrar una incidencia.')
    }
    const organizationId = writer(row.supplier_role) ? row.owner_organization_id : row.requesting_organization_id
    await connection.query(
      `INSERT INTO logistics_incidents (request_id, delivery_id, incident_type, description, created_by_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [row.id, input.deliveryId ?? null, input.type, input.description, userId],
    )
    await timeline(connection, row.id, userId, organizationId, 'incident_opened', 'Se registró una incidencia. Sigue abierta hasta que tenga resolución.', `${operationKey}-event`)
    const other = organizationId === row.owner_organization_id ? row.requesting_organization_id : row.owner_organization_id
    await notify(connection, other, row.id, 'incident', 'Hay una incidencia abierta.')
  })
}

export async function resolveIncident(userId: number, requestId: number, incidentId: number, resolution: string, operationKey: string) {
  return mutate(userId, requestId, operationKey, `resolve-${incidentId}`, async (connection, row) => {
    if (!writer(row.requester_role) && !writer(row.supplier_role)) {
      throw new AppError(403, 'FORBIDDEN', 'No puedes resolver esta incidencia.')
    }
    const rows = await queryRows<RowDataPacket>(connection, 'SELECT id, status FROM logistics_incidents WHERE id = ? AND request_id = ? FOR UPDATE', [incidentId, row.id])
    if (!rows[0]) {
      throw new AppError(404, 'NOT_FOUND', 'No se encontró la incidencia.')
    }
    if (rows[0].status === 'resolved') {
      return
    }
    await connection.query(
      `UPDATE logistics_incidents
       SET status = 'resolved', resolution = ?, resolved_by_user_id = ?, resolved_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [resolution, userId, incidentId],
    )
    const organizationId = writer(row.supplier_role) ? row.owner_organization_id : row.requesting_organization_id
    await timeline(connection, row.id, userId, organizationId, 'incident_resolved', 'La incidencia quedó resuelta con un texto registrado.', `${operationKey}-event`)
  })
}

export async function addOperationDocument(userId: number, requestId: number, buffer: Buffer, originalName: string) {
  const row = await loadRequest(userId, requestId)
  if (!writer(row.requester_role) && !writer(row.supplier_role)) {
    throw new AppError(403, 'FORBIDDEN', 'No puedes adjuntar un archivo.')
  }
  const counts = await queryRows<RowDataPacket>(getPool(), 'SELECT COUNT(*) AS total FROM operation_documents WHERE request_id = ?', [requestId])
  if (Number(counts[0]?.total ?? 0) >= 8) {
    throw new AppError(409, 'LIMIT_REACHED', 'Esta operación ya tiene el máximo de archivos.')
  }
  const stored = await writeDocumentFile(row.material_id, buffer)
  const organizationId = writer(row.supplier_role) ? row.owner_organization_id : row.requesting_organization_id
  try {
    await withTransaction(async (connection) => {
      await connection.query(
        `INSERT INTO operation_documents (request_id, material_id, uploaded_by_user_id, organization_id, storage_key, original_name, content_sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.material_id, userId, organizationId, stored.storageKey, safeOriginalName(originalName), sha256Hex(buffer)],
      )
      await timeline(connection, row.id, userId, organizationId, 'document_added', 'Se adjuntó un archivo. No queda verificado ni certificado.', `doc${randomBytes(12).toString('hex')}`)
      await trace(connection, row.material_id, userId, organizationId, 'evidence_added', 'Se adjuntó un archivo a una operación. No es una evidencia verificada.', `doc${randomBytes(12).toString('hex')}`)
    })
  } catch (error) {
    await removeDocumentFile(stored.storageKey)
    throw error
  }
  return detail(userId, requestId)
}

export async function openOperationDocument(userId: number, requestId: number, documentId: number) {
  const row = await loadRequest(userId, requestId)
  const documents = await queryRows<RowDataPacket>(getPool(), 'SELECT storage_key FROM operation_documents WHERE id = ? AND request_id = ?', [documentId, row.id])
  const key = documents[0]?.storage_key
  if (typeof key !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el archivo.')
  }
  return openDocumentFile(key)
}

export async function listRequests(userId: number, query: { box: string; q?: string; page: number; pageSize: number }) {
  const filters = ['(req_mem.user_id IS NOT NULL OR sup_mem.user_id IS NOT NULL)']
  const params: unknown[] = [userId, userId]
  if (query.box === 'sent') {
    filters.push('req_mem.user_id IS NOT NULL')
  } else if (query.box === 'received') {
    filters.push('sup_mem.user_id IS NOT NULL')
  } else if (query.box === 'pending') {
    filters.push(`r.status IN ('submitted', 'under_review')`)
  } else if (query.box === 'negotiating') {
    filters.push(`r.status = 'counter_proposed'`)
  } else if (query.box === 'accepted') {
    filters.push(`r.status IN ('accepted', 'partially_fulfilled')`)
  } else if (query.box === 'rejected') {
    filters.push(`r.status IN ('rejected', 'expired')`)
  } else if (query.box === 'cancelled') {
    filters.push(`r.status = 'cancelled'`)
  } else if (query.box === 'finished') {
    filters.push(`r.status = 'fulfilled'`)
  }
  if (query.q) {
    filters.push('(m.title LIKE ? OR r.public_code LIKE ?)')
    const pattern = `%${query.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
    params.push(pattern, pattern)
  }
  const where = filters.join(' AND ')
  const totals = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total ${detailSql.replace(/^[\s\S]*FROM material_requests r/, 'FROM material_requests r')} WHERE ${where}`,
    params,
  )
  const total = Number(totals[0]?.total ?? 0)
  const rows = await queryRows<RequestRow>(
    getPool(),
    `${detailSql} WHERE ${where} ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    [...params, query.pageSize, (query.page - 1) * query.pageSize],
  )
  const requestIds = rows.map((row) => row.id)
  const materialIds = [...new Set(rows.map((row) => row.material_id))]
  const movementByRequest = new Map<number, { dispatched: number; received: number }>()
  const availableByMaterial = new Map<number, number>()
  if (requestIds.length > 0) {
    const placeholders = requestIds.map(() => '?').join(', ')
    const movements = await queryRows<RowDataPacket>(
      getPool(),
      `SELECT request_id,
              COALESCE(SUM(CASE WHEN status = 'delivered' THEN delivered_quantity ELSE 0 END), 0) AS dispatched,
              COALESCE(SUM(received_quantity), 0) AS received
       FROM deliveries
       WHERE request_id IN (${placeholders})
       GROUP BY request_id`,
      requestIds,
    )
    for (const movement of movements) {
      movementByRequest.set(Number(movement.request_id), { dispatched: decimal(movement.dispatched), received: decimal(movement.received) })
    }
  }
  if (materialIds.length > 0) {
    const placeholders = materialIds.map(() => '?').join(', ')
    const availability = await queryRows<RowDataPacket>(
      getPool(),
      `SELECT material_id, available_quantity FROM material_quantity_summary WHERE material_id IN (${placeholders})`,
      materialIds,
    )
    for (const item of availability) {
      availableByMaterial.set(Number(item.material_id), decimal(item.available_quantity))
    }
  }
  const items = rows.map((row) => {
    const totalsForRow = movementByRequest.get(row.id) ?? { dispatched: 0, received: 0 }
    return present(row, totalsForRow.dispatched, totalsForRow.received, availableByMaterial.get(row.material_id) ?? 0)
  })
  return { requests: items, page: query.page, pageSize: query.pageSize, total }
}

export async function getOperation(userId: number, requestId: number) {
  return detail(userId, requestId)
}

export async function listNotifications(userId: number) {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT n.id, n.request_id, n.kind, n.message, n.read_at, n.created_at
     FROM operation_notifications n
     INNER JOIN organization_members mem
       ON mem.organization_id = n.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
     ORDER BY n.id DESC
     LIMIT 30`,
    [userId],
  )
  return {
    notifications: rows.map((row) => ({
      id: Number(row.id),
      requestId: Number(row.request_id),
      kind: String(row.kind),
      message: String(row.message),
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
  }
}

export async function markNotificationRead(userId: number, notificationId: number) {
  const result = await getPool().query(
    `UPDATE operation_notifications n
     INNER JOIN organization_members mem
       ON mem.organization_id = n.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
     SET n.read_at = CURRENT_TIMESTAMP(3)
     WHERE n.id = ? AND n.read_at IS NULL`,
    [userId, notificationId],
  )
  const header = Array.isArray(result) ? result[0] : null
  if (!header || Number((header as { affectedRows?: number }).affectedRows ?? 0) === 0) {
    const visible = await queryRows<RowDataPacket>(
      getPool(),
      `SELECT n.id FROM operation_notifications n
       INNER JOIN organization_members mem ON mem.organization_id = n.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
       WHERE n.id = ?`,
      [userId, notificationId],
    )
    if (!visible[0]) {
      throw new AppError(404, 'NOT_FOUND', 'No se encontró el aviso.')
    }
  }
  return { id: notificationId }
}

async function mutate(
  userId: number,
  requestId: number,
  operationKey: string,
  action: string,
  run: (connection: PoolConnection, row: RequestRow) => Promise<void>,
) {
  const existing = await replay(operationKey)
  if (existing && existing !== requestId) {
    throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Esa clave ya se usó en otra solicitud.')
  }
  if (existing === requestId) {
    return detail(userId, requestId)
  }
  const row = await loadRequest(userId, requestId)
  try {
    await withTransaction(async (connection) => {
      await remember(connection, operationKey, requestId, action)
      await run(connection, row)
    })
  } catch (error) {
    if (isDuplicateKey(error)) {
      const again = await replay(operationKey)
      if (again === requestId) {
        return detail(userId, requestId)
      }
    }
    throw error
  }
  return detail(userId, requestId)
}
