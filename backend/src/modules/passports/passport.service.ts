import { randomBytes } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import type { PoolConnection } from 'mysql2/promise'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { insertRow, queryRows, withTransaction, type SqlExecutor } from '../../utils/sql.js'
import { isMemberRole, type MemberRole } from '../organizations/permissions.js'
import { canWriteMaterials } from '../materials/permissions.js'
import {
  maxDocuments,
  openDocumentFile,
  removeDocumentFile,
  safeOriginalName,
  sha256Hex,
  writeDocumentFile,
} from './document-storage.js'
import { canPublishPassport, canReviewEvidence } from './permissions.js'
import { createPublicCode, declaredOrigin, isPublicCode } from './public-code.js'
import { isLocalPassportUrl, passportQrSvg, passportUrl } from './qr.js'
import { isDuplicateKey, recordTraceEvent } from './trace.js'

export type MaterialSnapshot = {
  materialId: number
  organizationId: number
  title: string
  description: string | null
  categoryId: number
  unitId: number
  quantity: string
  materialCondition: string
  originType: string
  city: string
  department: string
  locationDescription: string | null
  availabilityStatus: string
  availableFrom: string | null
}

type AccessRow = RowDataPacket & {
  passport_id: number
  public_code: string
  visibility: string
  origin_description: string
  version: number
  issued_at: string
  material_id: number
  organization_id: number
  organization_name: string
  category_name: string
  unit_code: string
  unit_name: string
  title: string
  description: string | null
  material_condition: string
  quantity: string
  origin_type: string
  city: string
  department: string
  location_description: string | null
  availability_status: string
  technical_validation_status: string
  available_from: string | null
  registered_at: string
  available_quantity: string
  member_role: string | null
}

const passportFrom = `
  FROM material_passports p
  INNER JOIN materials m ON m.id = p.material_id
  INNER JOIN organizations o ON o.id = m.organization_id
  INNER JOIN material_categories c ON c.id = m.category_id
  INNER JOIN measurement_units u ON u.id = m.unit_id
  INNER JOIN material_quantity_summary qty ON qty.material_id = m.id
  LEFT JOIN organization_members mem
    ON mem.organization_id = m.organization_id
   AND mem.user_id = ?
   AND mem.membership_status = 'active'
`

const passportSelect = `
  SELECT
    p.id AS passport_id,
    p.public_code,
    p.visibility,
    p.origin_description,
    p.version,
    DATE_FORMAT(p.issued_at, '%Y-%m-%d %H:%i:%s') AS issued_at,
    m.id AS material_id,
    m.organization_id,
    o.name AS organization_name,
    c.name AS category_name,
    u.code AS unit_code,
    u.name AS unit_name,
    m.title,
    m.description,
    m.material_condition,
    m.quantity,
    m.origin_type,
    m.city,
    m.department,
    m.location_description,
    m.availability_status,
    m.technical_validation_status,
    DATE_FORMAT(m.available_from, '%Y-%m-%d') AS available_from,
    DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS registered_at,
    qty.available_quantity,
    mem.role AS member_role
`

function decimal(value: unknown): string {
  return value === null || value === undefined ? '0.000' : String(value)
}

function roleOf(row: AccessRow): MemberRole | null {
  return row.member_role && isMemberRole(row.member_role) ? row.member_role : null
}

function isPubliclyVisible(row: AccessRow): boolean {
  return row.visibility === 'public' && row.availability_status === 'published'
}

async function loadRow(publicCode: string, userId: number | null): Promise<AccessRow | null> {
  if (!isPublicCode(publicCode)) {
    return null
  }
  const rows = await queryRows<AccessRow>(getPool(), `${passportSelect} ${passportFrom} WHERE p.public_code = ?`, [
    userId ?? 0,
    publicCode,
  ])
  return rows[0] ?? null
}

function technicalNote(status: string): string {
  if (status === 'pending') {
    return 'Pendiente de evaluación. El pasaporte no certifica un uso.'
  }
  return 'Hay un estado de evaluación registrado. No equivale a una certificación oficial ni a una aptitud para un uso concreto.'
}

async function imageIds(materialId: number): Promise<Array<{ id: number; imageOrder: number; createdAt: string }>> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, image_order, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM material_images WHERE material_id = ? ORDER BY image_order ASC, id ASC`,
    [materialId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    imageOrder: Number(row.image_order),
    createdAt: String(row.created_at),
  }))
}

async function documentsOf(materialId: number, includeInternal: boolean) {
  const disclosure = includeInternal ? '' : ` AND disclosure = 'public' AND review_status <> 'not_accepted'`
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, evidence_kind, review_status, disclosure, original_name, content_type, byte_size, sha256,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM material_documents
     WHERE material_id = ?${disclosure}
     ORDER BY created_at ASC, id ASC`,
    [materialId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    evidenceKind: String(row.evidence_kind),
    reviewStatus: String(row.review_status),
    disclosure: String(row.disclosure),
    originalName: String(row.original_name),
    contentType: String(row.content_type),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    createdAt: String(row.created_at),
    authenticity: 'La huella SHA-256 identifica el archivo guardado. No comprueba por sí sola que el documento sea auténtico.',
  }))
}

async function assessmentsOf(materialId: number) {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT a.id, a.assessment_type, a.result, a.observations,
            DATE_FORMAT(a.assessed_at, '%Y-%m-%d %H:%i:%s') AS assessed_at,
            u.full_name AS assessor_name
     FROM technical_assessments a
     INNER JOIN users u ON u.id = a.assessor_user_id
     WHERE a.material_id = ?
     ORDER BY a.assessed_at ASC, a.id ASC`,
    [materialId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    assessmentType: String(row.assessment_type),
    result: String(row.result),
    observations: String(row.observations),
    assessedAt: String(row.assessed_at),
    assessorName: String(row.assessor_name),
    scope: 'Registro interno de evaluación. No es una certificación oficial.',
  }))
}

async function present(row: AccessRow, frontendOrigin: string, member: boolean) {
  const code = row.public_code
  const url = passportUrl(frontendOrigin, code)
  const images = await imageIds(row.material_id)
  const shared = {
    audience: member ? 'private' : 'public',
    publicCode: code,
    title: row.title,
    categoryName: row.category_name,
    organizationName: row.organization_name,
    description: row.description,
    quantity: decimal(row.quantity),
    unitCode: row.unit_code,
    unitName: row.unit_name,
    materialCondition: row.material_condition,
    originType: row.origin_type,
    city: row.city,
    department: row.department,
    availabilityStatus: row.availability_status,
    availableQuantity: decimal(row.available_quantity),
    technicalValidationStatus: row.technical_validation_status,
    technicalNote: technicalNote(row.technical_validation_status),
    registeredAt: row.registered_at,
    issuedAt: row.issued_at,
    qrUrl: url,
    localNetworkOnly: isLocalPassportUrl(url),
    images: images.map((image) => ({ id: image.id, imageOrder: image.imageOrder, createdAt: image.createdAt })),
    documents: await documentsOf(row.material_id, member),
  }
  if (!member) {
    return {
      ...shared,
      locationDescription: null,
      visibility: 'public' as const,
      canEdit: false,
      canReviewEvidence: false,
      originDescription: row.origin_description,
      assessments: [],
      assessmentNotice: 'La consulta pública no incluye observaciones internas de evaluación.',
    }
  }
  const role = roleOf(row)
  return {
    ...shared,
    materialId: row.material_id,
    locationDescription: row.location_description,
    visibility: row.visibility,
    passportVersion: row.version,
    canEdit: role !== null && canWriteMaterials(role),
    canReviewEvidence: role !== null && canReviewEvidence(role),
    originDescription: row.origin_description,
    assessments: await assessmentsOf(row.material_id),
    assessmentNotice:
      'Una evaluación registrada aquí no certifica el material ni lo declara apto para un uso estructural, sanitario, eléctrico o de seguridad.',
  }
}

export async function listPassports(
  userId: number,
  query: { q?: string; page: number; pageSize: number },
): Promise<{ passports: Array<Record<string, unknown>>; page: number; pageSize: number; total: number }> {
  const clauses: string[] = []
  const params: unknown[] = [userId]
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
    clauses.push(`(m.title LIKE ? ESCAPE '\\\\' OR c.name LIKE ? ESCAPE '\\\\' OR p.public_code = ?)`)
    params.push(pattern, pattern, query.q)
  }
  const where = clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : ''
  const memberJoin = `
    FROM material_passports p
    INNER JOIN materials m ON m.id = p.material_id
    INNER JOIN material_categories c ON c.id = m.category_id
    INNER JOIN organization_members mem
      ON mem.organization_id = m.organization_id
     AND mem.user_id = ?
     AND mem.membership_status = 'active'
  `
  const totals = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total ${memberJoin} WHERE 1 = 1${where}`,
    params,
  )
  const total = Number(totals[0]?.total ?? 0)
  const offset = (query.page - 1) * query.pageSize
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT p.public_code, m.title, c.name AS category_name, p.visibility, m.availability_status,
            m.technical_validation_status, o.name AS organization_name,
            DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS registered_at
     ${memberJoin}
     INNER JOIN organizations o ON o.id = m.organization_id
     WHERE 1 = 1${where}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, query.pageSize, offset],
  )
  return {
    passports: rows.map((row) => ({
      publicCode: String(row.public_code),
      title: String(row.title),
      categoryName: String(row.category_name),
      visibility: String(row.visibility),
      availabilityStatus: String(row.availability_status),
      technicalValidationStatus: String(row.technical_validation_status),
      organizationName: String(row.organization_name),
      registeredAt: String(row.registered_at),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function getPassport(publicCode: string, userId: number | null, frontendOrigin: string) {
  const row = await loadRow(publicCode, userId)
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el pasaporte.')
  }
  const member = roleOf(row) !== null
  if (!member && !isPubliclyVisible(row)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el pasaporte.')
  }
  return present(row, frontendOrigin, member)
}

export async function getPassportForMaterial(userId: number, materialId: number, frontendOrigin: string) {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT p.public_code
     FROM material_passports p
     INNER JOIN materials m ON m.id = p.material_id
     INNER JOIN organization_members mem
       ON mem.organization_id = m.organization_id
      AND mem.user_id = ?
      AND mem.membership_status = 'active'
     WHERE p.material_id = ?`,
    [userId, materialId],
  )
  const publicCode = rows[0]?.public_code
  if (typeof publicCode !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el pasaporte.')
  }
  return getPassport(publicCode, userId, frontendOrigin)
}

export async function listEvents(publicCode: string, userId: number, page: number, pageSize: number) {
  const row = await loadRow(publicCode, userId)
  if (!row || roleOf(row) === null) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el pasaporte.')
  }
  const totals = await queryRows<RowDataPacket>(
    getPool(),
    'SELECT COUNT(*) AS total FROM material_trace_events WHERE material_id = ?',
    [row.material_id],
  )
  const total = Number(totals[0]?.total ?? 0)
  const offset = (page - 1) * pageSize
  const events = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT e.id, e.event_type, e.description,
            DATE_FORMAT(e.event_timestamp, '%Y-%m-%d %H:%i:%s') AS event_timestamp,
            u.full_name AS actor_name,
            o.name AS organization_name
     FROM material_trace_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     LEFT JOIN organizations o ON o.id = e.organization_id
     WHERE e.material_id = ?
     ORDER BY e.event_timestamp ASC, e.id ASC
     LIMIT ? OFFSET ?`,
    [row.material_id, pageSize, offset],
  )
  return {
    events: events.map((event) => ({
      id: Number(event.id),
      eventType: String(event.event_type),
      description: String(event.description),
      eventTimestamp: String(event.event_timestamp),
      actorName: event.actor_name === null ? 'No registrado' : String(event.actor_name),
      organizationName: event.organization_name === null ? 'No registrado' : String(event.organization_name),
    })),
    page,
    pageSize,
    total,
  }
}

async function requireWriter(publicCode: string, userId: number): Promise<AccessRow> {
  const row = await loadRow(publicCode, userId)
  const role = row ? roleOf(row) : null
  if (!row || !role) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el pasaporte.')
  }
  if (!canPublishPassport(role)) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para modificar este pasaporte.')
  }
  return row
}

export function newOperationKey(): string {
  return `op${randomBytes(16).toString('hex')}`
}

export async function operationAlreadyUsed(executor: SqlExecutor, operationKey: string): Promise<boolean> {
  const rows = await queryRows<RowDataPacket>(
    executor,
    `SELECT id FROM material_trace_events
     WHERE operation_key IN (?, ?, ?, ?)`,
    [`${operationKey}-details`, `${operationKey}-status`, `${operationKey}-origin`, `${operationKey}-visibility`],
  )
  return rows.length > 0
}

export async function issueInitialPassport(
  connection: PoolConnection,
  input: {
    materialId: number
    userId: number
    organizationId: number
    originType: string
    city: string
    department: string
  },
): Promise<string> {
  let publicCode = ''
  for (let attempt = 0; attempt < 5; attempt += 1) {
    publicCode = createPublicCode()
    try {
      await insertRow(
        connection,
        `INSERT INTO material_passports (material_id, public_code, origin_description, visibility)
         VALUES (?, ?, ?, 'private')`,
        [input.materialId, publicCode, declaredOrigin(input)],
      )
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (isDuplicateKey(error) && message.includes('public_code') && attempt < 4) {
        continue
      }
      throw error
    }
  }

  await recordTraceEvent(connection, {
    materialId: input.materialId,
    actorUserId: input.userId,
    organizationId: input.organizationId,
    eventType: 'registered',
    description: 'Se registró el material en el inventario.',
    operationKey: `registered-${input.materialId}`,
  })
  await recordTraceEvent(connection, {
    materialId: input.materialId,
    actorUserId: input.userId,
    organizationId: input.organizationId,
    eventType: 'passport_issued',
    description: 'Se emitió el pasaporte digital con una identidad pública estable.',
    operationKey: `passport-${input.materialId}`,
    metadata: { publicCode },
  })
  return publicCode
}

async function reviseOrigin(
  connection: PoolConnection,
  materialId: number,
  userId: number,
  organizationId: number,
  nextOrigin: string,
  operationKey: string,
): Promise<void> {
  const rows = await queryRows<RowDataPacket>(
    connection,
    `SELECT id, version, origin_description, specifications_json, issued_at
     FROM material_passports WHERE material_id = ? FOR UPDATE`,
    [materialId],
  )
  const passport = rows[0]
  if (!passport || String(passport.origin_description) === nextOrigin) {
    return
  }
  const specifications = passport.specifications_json
  const specificationsValue =
    specifications === null || specifications === undefined
      ? null
      : typeof specifications === 'string'
        ? specifications
        : JSON.stringify(specifications)
  await insertRow(
    connection,
    `INSERT INTO material_passport_revisions (
       passport_id, version, origin_description, specifications_json, issued_at, created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [passport.id, passport.version, passport.origin_description, specificationsValue, passport.issued_at, userId],
  )
  await connection.query(
    `UPDATE material_passports
     SET origin_description = ?, version = version + 1
     WHERE id = ?`,
    [nextOrigin, passport.id],
  )
  await recordTraceEvent(connection, {
    materialId,
    actorUserId: userId,
    organizationId,
    eventType: 'passport_revised',
    description: 'Se actualizó la procedencia declarada del pasaporte. La identidad pública no cambió.',
    operationKey: `${operationKey}-origin`,
  })
}

export async function recordMaterialChanges(
  connection: PoolConnection,
  userId: number,
  before: MaterialSnapshot,
  after: MaterialSnapshot,
  operationKey: string,
): Promise<void> {
  const detailFields = [
    ['title', before.title, after.title],
    ['description', before.description ?? '', after.description ?? ''],
    ['categoryId', String(before.categoryId), String(after.categoryId)],
    ['unitId', String(before.unitId), String(after.unitId)],
    ['quantity', before.quantity, after.quantity],
    ['materialCondition', before.materialCondition, after.materialCondition],
    ['locationDescription', before.locationDescription ?? '', after.locationDescription ?? ''],
    ['availableFrom', before.availableFrom ?? '', after.availableFrom ?? ''],
    ['originType', before.originType, after.originType],
    ['city', before.city, after.city],
    ['department', before.department, after.department],
  ].filter(([name, previous, next]) => (name === 'quantity' ? Number(previous) !== Number(next) : previous !== next))

  if (detailFields.length > 0) {
    await recordTraceEvent(connection, {
      materialId: before.materialId,
      actorUserId: userId,
      organizationId: before.organizationId,
      eventType: 'details_updated',
      description: 'Se actualizó información declarada del material.',
      operationKey: `${operationKey}-details`,
      metadata: { fields: detailFields.map(([name]) => name).join(',') },
    })
  }

  if (before.originType !== after.originType || before.city !== after.city || before.department !== after.department) {
    await reviseOrigin(
      connection,
      before.materialId,
      userId,
      before.organizationId,
      declaredOrigin({ originType: after.originType, city: after.city, department: after.department }),
      operationKey,
    )
  }

  if (before.availabilityStatus !== after.availabilityStatus) {
    await recordTraceEvent(connection, {
      materialId: before.materialId,
      actorUserId: userId,
      organizationId: before.organizationId,
      eventType: 'availability_changed',
      description: `El estado administrativo pasó de ${before.availabilityStatus} a ${after.availabilityStatus}.`,
      operationKey: `${operationKey}-status`,
    })
    if (after.availabilityStatus !== 'published') {
      const hidden = await connection.query(
        `UPDATE material_passports SET visibility = 'private'
         WHERE material_id = ? AND visibility = 'public'`,
        [before.materialId],
      )
      const changed = Array.isArray(hidden) ? Number((hidden[0] as { affectedRows?: number }).affectedRows ?? 0) : 0
      if (changed > 0) {
        await recordTraceEvent(connection, {
          materialId: before.materialId,
          actorUserId: userId,
          organizationId: before.organizationId,
          eventType: 'visibility_changed',
          description: 'La consulta pública se retiró porque el material ya no está publicado.',
          operationKey: `${operationKey}-visibility`,
        })
      }
    }
  }
}

export async function setPassportVisibility(
  userId: number,
  publicCode: string,
  visibility: 'private' | 'public',
  operationKey: string,
) {
  const row = await requireWriter(publicCode, userId)
  if (visibility === 'public' && row.availability_status !== 'published') {
    throw new AppError(409, 'NOT_PUBLISHED', 'Solo un material publicado puede consultarse sin sesión.')
  }
  if (row.visibility === visibility || (await operationAlreadyUsed(getPool(), operationKey))) {
    return { visibility: row.visibility === visibility ? visibility : row.visibility }
  }
  const duplicate = await withTransaction(async (connection) => {
    await connection.query('UPDATE material_passports SET visibility = ? WHERE id = ?', [visibility, row.passport_id])
    const result = await recordTraceEvent(connection, {
      materialId: row.material_id,
      actorUserId: userId,
      organizationId: row.organization_id,
      eventType: 'visibility_changed',
      description:
        visibility === 'public'
          ? 'Se habilitó la consulta pública del pasaporte. Sigue sin ser una certificación.'
          : 'Se retiró la consulta pública. El historial interno se conserva.',
      operationKey: `${operationKey}-visibility`,
    })
    return result === 'duplicate'
  })
  if (duplicate) {
    return { visibility: row.visibility }
  }
  const { markMaterialMatchesStale } = await import('../matching/invalidate.js')
  await markMaterialMatchesStale(getPool(), row.material_id)
  return { visibility }
}

export async function addPassportDocument(
  userId: number,
  publicCode: string,
  buffer: Buffer,
  originalName: string,
  evidenceKind: string,
  disclosure: 'internal' | 'public',
) {
  const row = await requireWriter(publicCode, userId)
  const stored = await writeDocumentFile(row.material_id, buffer)
  try {
    return await withTransaction(async (connection) => {
      await queryRows<RowDataPacket>(connection, 'SELECT id FROM materials WHERE id = ? FOR UPDATE', [row.material_id])
      const counts = await queryRows<RowDataPacket>(
        connection,
        'SELECT COUNT(*) AS total FROM material_documents WHERE material_id = ?',
        [row.material_id],
      )
      if (Number(counts[0]?.total ?? 0) >= maxDocuments) {
        throw new AppError(400, 'DOCUMENT_LIMIT', 'Este material ya tiene el máximo de 8 documentos.')
      }
      const id = await insertRow(
        connection,
        `INSERT INTO material_documents (
           material_id, uploaded_by_user_id, organization_id, evidence_kind, review_status, disclosure,
           storage_key, original_name, content_type, byte_size, sha256
         ) VALUES (?, ?, ?, ?, 'received', ?, ?, ?, ?, ?, ?)`,
        [
          row.material_id,
          userId,
          row.organization_id,
          evidenceKind,
          disclosure,
          stored.storageKey,
          safeOriginalName(originalName),
          stored.kind === 'pdf' ? 'application/pdf' : stored.kind === 'png' ? 'image/png' : stored.kind === 'webp' ? 'image/webp' : 'image/jpeg',
          buffer.length,
          sha256Hex(buffer),
        ],
      )
      await recordTraceEvent(connection, {
        materialId: row.material_id,
        actorUserId: userId,
        organizationId: row.organization_id,
        eventType: 'evidence_added',
        description: 'Se adjuntó un documento como evidencia recibida, sin verificación.',
        operationKey: `document-${id}`,
        metadata: { evidenceKind, reviewStatus: 'received' },
      })
      return { id, reviewStatus: 'received' }
    })
  } catch (error) {
    await removeDocumentFile(stored.storageKey)
    throw error
  }
}

export async function readPassportDocument(publicCode: string, documentId: number, userId: number | null) {
  const row = await loadRow(publicCode, userId)
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
  }
  const member = roleOf(row) !== null
  const files = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT storage_key, original_name, disclosure, review_status
     FROM material_documents WHERE id = ? AND material_id = ?`,
    [documentId, row.material_id],
  )
  const file = files[0]
  if (!file) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
  }
  const visibleToPublic =
    isPubliclyVisible(row) && file.disclosure === 'public' && file.review_status !== 'not_accepted'
  if (!member && !visibleToPublic) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
  }
  const opened = await openDocumentFile(String(file.storage_key))
  return { ...opened, filename: safeOriginalName(String(file.original_name)) }
}

export async function removePassportDocument(userId: number, publicCode: string, documentId: number) {
  const row = await requireWriter(publicCode, userId)
  const files = await queryRows<RowDataPacket>(
    getPool(),
    'SELECT storage_key FROM material_documents WHERE id = ? AND material_id = ?',
    [documentId, row.material_id],
  )
  const storageKey = files[0]?.storage_key
  if (typeof storageKey !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
  }
  await withTransaction(async (connection) => {
    await connection.query('DELETE FROM material_documents WHERE id = ? AND material_id = ?', [documentId, row.material_id])
    await recordTraceEvent(connection, {
      materialId: row.material_id,
      actorUserId: userId,
      organizationId: row.organization_id,
      eventType: 'evidence_removed',
      description: 'Se retiró un documento de evidencia. El evento queda en el historial.',
      operationKey: `document-removed-${documentId}`,
    })
  })
  await removeDocumentFile(storageKey)
}

export async function reviewPassportDocument(
  userId: number,
  publicCode: string,
  documentId: number,
  reviewStatus: 'reviewed' | 'not_accepted',
) {
  const row = await loadRow(publicCode, userId)
  const role = row ? roleOf(row) : null
  if (!row || !role) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
  }
  if (!canReviewEvidence(role)) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para revisar esta evidencia.')
  }
  await withTransaction(async (connection) => {
    const result = await connection.query(
      `UPDATE material_documents SET review_status = ? WHERE id = ? AND material_id = ?`,
      [reviewStatus, documentId, row.material_id],
    )
    const changed = Number((result[0] as { affectedRows?: number }).affectedRows ?? 0)
    if (changed === 0) {
      throw new AppError(404, 'NOT_FOUND', 'No se encontró el documento.')
    }
    await recordTraceEvent(connection, {
      materialId: row.material_id,
      actorUserId: userId,
      organizationId: row.organization_id,
      eventType: 'note',
      description:
        reviewStatus === 'reviewed'
          ? 'Una persona autorizada marcó el documento como revisado. Eso no certifica el material.'
          : 'Una persona autorizada no aceptó el documento como evidencia.',
      operationKey: `document-review-${documentId}-${reviewStatus}`,
      metadata: { reviewStatus },
    })
  })
  return { reviewStatus }
}

export async function passportQr(publicCode: string, userId: number | null, frontendOrigin: string) {
  const passport = await getPassport(publicCode, userId, frontendOrigin)
  const svg = await passportQrSvg(passport.qrUrl)
  return { svg, url: passport.qrUrl }
}

export async function openPassportImage(publicCode: string, imageId: number, userId: number | null) {
  const row = await loadRow(publicCode, userId)
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
  }
  const member = roleOf(row) !== null
  if (!member && !isPubliclyVisible(row)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
  }
  const images = await queryRows<RowDataPacket>(
    getPool(),
    'SELECT storage_key FROM material_images WHERE id = ? AND material_id = ?',
    [imageId, row.material_id],
  )
  const storageKey = images[0]?.storage_key
  if (typeof storageKey !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
  }
  const { openMaterialFile } = await import('../materials/storage.js')
  return openMaterialFile(storageKey)
}
