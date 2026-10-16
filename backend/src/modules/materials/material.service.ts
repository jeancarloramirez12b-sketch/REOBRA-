import type { RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { insertRow, queryRows, withTransaction } from '../../utils/sql.js'
import { isMemberRole, type MemberRole } from '../organizations/permissions.js'
import { issueInitialPassport, operationAlreadyUsed, recordMaterialChanges, type MaterialSnapshot } from '../passports/passport.service.js'
import { recordTraceEvent } from '../passports/trace.js'
import { markMaterialMatchesStale } from '../matching/invalidate.js'
import { canWriteMaterials } from './permissions.js'
import { maxMaterialImages, openMaterialFile, removeMaterialFile, writeMaterialFile } from './storage.js'
import type { CreateMaterialInput, MaterialQuery, MaterialStatus, UpdateMaterialInput } from './validation.js'

export type MaterialImageRef = {
  id: number
  imageOrder: number
}

export type MaterialRecord = {
  id: number
  code: string
  organizationId: number
  organizationName: string
  categoryId: number
  categoryName: string
  unitId: number
  unitCode: string
  unitName: string
  title: string
  description: string | null
  materialCondition: string
  quantity: string
  originType: string
  city: string
  department: string
  locationDescription: string | null
  availabilityStatus: string
  technicalValidationStatus: string
  availableFrom: string | null
  publishedQuantity: string
  deliveredQuantity: string
  committedQuantity: string
  availableQuantity: string
  primaryImageId: number | null
  canEdit: boolean
  createdAt: string
  updatedAt: string
  images?: MaterialImageRef[]
}

type MaterialRow = RowDataPacket & {
  id: number
  organization_id: number
  organization_name: string
  category_id: number
  category_name: string
  unit_id: number
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
  published_quantity: string
  delivered_quantity: string
  committed_quantity: string
  available_quantity: string
  primary_image_id: number | null
  member_role: string
  created_at: string
  updated_at: string
}

const materialFrom = `
  FROM materials m
  INNER JOIN organizations o ON o.id = m.organization_id
  INNER JOIN material_categories c ON c.id = m.category_id
  INNER JOIN measurement_units u ON u.id = m.unit_id
  INNER JOIN material_quantity_summary qty ON qty.material_id = m.id
  INNER JOIN organization_members mem
    ON mem.organization_id = m.organization_id
   AND mem.user_id = ?
   AND mem.membership_status = 'active'
`

const materialSelect = `
  SELECT
    m.id,
    m.organization_id,
    o.name AS organization_name,
    m.category_id,
    c.name AS category_name,
    m.unit_id,
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
    DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
    DATE_FORMAT(m.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
    qty.published_quantity,
    qty.delivered_quantity,
    qty.committed_quantity,
    qty.available_quantity,
    mem.role AS member_role,
    (
      SELECT i.id
      FROM material_images i
      WHERE i.material_id = m.id
      ORDER BY i.image_order ASC, i.id ASC
      LIMIT 1
    ) AS primary_image_id
`

const sortColumns: Record<MaterialQuery['sort'], string> = {
  updated_at: 'm.updated_at',
  created_at: 'm.created_at',
  title: 'm.title',
}

export function mapDatabaseError(error: unknown): never {
  if (error instanceof AppError) {
    throw error
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_NO_REFERENCED_ROW') {
    throw new AppError(400, 'INVALID_REFERENCE', 'La categoría, la unidad o la organización no es válida.')
  }
  if (
    code === 'ER_CHECK_CONSTRAINT_VIOLATED' ||
    code === 'ER_WARN_DATA_OUT_OF_RANGE' ||
    code === 'ER_DATA_TOO_LONG' ||
    code === 'ER_TRUNCATED_WRONG_VALUE' ||
    code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD'
  ) {
    throw new AppError(400, 'INVALID_INPUT', 'Los datos no cumplen las reglas del inventario.')
  }
  throw error instanceof Error ? error : new Error('Error de base de datos.')
}

function materialCode(id: number): string {
  return `MAT-${String(id).padStart(6, '0')}`
}

function decimal(value: unknown): string {
  return value === null || value === undefined ? '0.000' : String(value)
}

function toMaterial(row: MaterialRow): MaterialRecord {
  const role = isMemberRole(row.member_role) ? row.member_role : null
  return {
    id: Number(row.id),
    code: materialCode(Number(row.id)),
    organizationId: Number(row.organization_id),
    organizationName: row.organization_name,
    categoryId: Number(row.category_id),
    categoryName: row.category_name,
    unitId: Number(row.unit_id),
    unitCode: row.unit_code,
    unitName: row.unit_name,
    title: row.title,
    description: row.description,
    materialCondition: row.material_condition,
    quantity: decimal(row.quantity),
    originType: row.origin_type,
    city: row.city,
    department: row.department,
    locationDescription: row.location_description,
    availabilityStatus: row.availability_status,
    technicalValidationStatus: row.technical_validation_status,
    availableFrom: row.available_from,
    publishedQuantity: decimal(row.published_quantity),
    deliveredQuantity: decimal(row.delivered_quantity),
    committedQuantity: decimal(row.committed_quantity),
    availableQuantity: decimal(row.available_quantity),
    primaryImageId: row.primary_image_id === null ? null : Number(row.primary_image_id),
    canEdit: role !== null && canWriteMaterials(role),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

function materialFilters(query: MaterialQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (query.organizationId) {
    clauses.push('m.organization_id = ?')
    params.push(query.organizationId)
  }
  if (query.categoryId) {
    clauses.push('m.category_id = ?')
    params.push(query.categoryId)
  }
  if (query.status) {
    clauses.push('m.availability_status = ?')
    params.push(query.status)
  }
  if (query.availability === 'available') {
    clauses.push('qty.available_quantity > 0')
  } else if (query.availability === 'unavailable') {
    clauses.push('qty.available_quantity <= 0')
  }
  if (query.q && query.q.length > 0) {
    const pattern = likePattern(query.q)
    clauses.push(`(
      m.title LIKE ? ESCAPE '\\\\'
      OR m.description LIKE ? ESCAPE '\\\\'
      OR m.city LIKE ? ESCAPE '\\\\'
      OR m.department LIKE ? ESCAPE '\\\\'
      OR m.location_description LIKE ? ESCAPE '\\\\'
      OR c.name LIKE ? ESCAPE '\\\\'
    )`)
    params.push(pattern, pattern, pattern, pattern, pattern, pattern)
  }
  return { sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', params }
}

async function activeRole(userId: number, organizationId: number): Promise<MemberRole | null> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT role
     FROM organization_members
     WHERE user_id = ? AND organization_id = ? AND membership_status = 'active'`,
    [userId, organizationId],
  )
  const role = rows[0]?.role
  return typeof role === 'string' && isMemberRole(role) ? role : null
}

async function assertCategory(categoryId: number): Promise<void> {
  const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT id FROM material_categories WHERE id = ?', [categoryId])
  if (!rows[0]) {
    throw new AppError(400, 'INVALID_REFERENCE', 'La categoría no existe.')
  }
}

async function assertUnit(unitId: number): Promise<void> {
  const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT id FROM measurement_units WHERE id = ?', [unitId])
  if (!rows[0]) {
    throw new AppError(400, 'INVALID_REFERENCE', 'La unidad no existe.')
  }
}

async function loadImages(materialId: number): Promise<MaterialImageRef[]> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, image_order
     FROM material_images
     WHERE material_id = ?
     ORDER BY image_order ASC, id ASC`,
    [materialId],
  )
  return rows.map((row) => ({ id: Number(row.id), imageOrder: Number(row.image_order) }))
}

async function findMaterial(userId: number, materialId: number, withImages: boolean): Promise<MaterialRecord | null> {
  const rows = await queryRows<MaterialRow>(getPool(), `${materialSelect} ${materialFrom} WHERE m.id = ?`, [
    userId,
    materialId,
  ])
  const row = rows[0]
  if (!row) {
    return null
  }
  const material = toMaterial(row)
  if (withImages) {
    material.images = await loadImages(material.id)
  }
  return material
}

async function requireMaterial(userId: number, materialId: number, write: boolean): Promise<MaterialRecord> {
  const material = await findMaterial(userId, materialId, false)
  if (!material) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
  }
  if (write && !material.canEdit) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para modificar este material.')
  }
  return material
}

async function assertQuantityCoversCommitments(materialId: number, quantity: string): Promise<void> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT
       CAST(? AS DECIMAL(14,3)) < delivered_quantity + committed_quantity AS too_low
     FROM material_quantity_summary
     WHERE material_id = ?`,
    [quantity, materialId],
  )
  if (Number(rows[0]?.too_low ?? 0) === 1) {
    throw new AppError(
      409,
      'QUANTITY_BELOW_COMMITMENT',
      'La cantidad declarada no puede quedar por debajo de lo ya entregado o comprometido.',
    )
  }
}

export async function listMaterials(
  userId: number,
  query: MaterialQuery,
): Promise<{ materials: MaterialRecord[]; page: number; pageSize: number; total: number }> {
  const filters = materialFilters(query)
  const params = [userId, ...filters.params]
  const totals = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total ${materialFrom} WHERE 1 = 1${filters.sql}`,
    params,
  )
  const total = Number(totals[0]?.total ?? 0)
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC'
  const orderBy = `${sortColumns[query.sort]} ${direction}, m.id DESC`
  const offset = (query.page - 1) * query.pageSize
  const rows = await queryRows<MaterialRow>(
    getPool(),
    `${materialSelect} ${materialFrom} WHERE 1 = 1${filters.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, query.pageSize, offset],
  )
  return {
    materials: rows.map((row) => toMaterial(row)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

export async function getMaterial(userId: number, materialId: number): Promise<MaterialRecord> {
  const material = await findMaterial(userId, materialId, true)
  if (!material) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
  }
  return material
}

export async function createMaterial(userId: number, input: CreateMaterialInput): Promise<MaterialRecord> {
  const role = await activeRole(userId, input.organizationId)
  if (!role) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la organización.')
  }
  if (!canWriteMaterials(role)) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para registrar materiales en esta organización.')
  }
  await assertCategory(input.categoryId)
  await assertUnit(input.unitId)

  let materialId = 0
  try {
    materialId = await withTransaction(async (connection) => {
      const id = await insertRow(
        connection,
        `INSERT INTO materials (
           organization_id, created_by_user_id, category_id, unit_id, title, description,
           material_condition, quantity, origin_type, city, department, location_description,
           availability_status, available_from
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.organizationId,
          userId,
          input.categoryId,
          input.unitId,
          input.title,
          input.description ?? null,
          input.materialCondition ?? 'not_declared',
          input.quantity,
          input.originType,
          input.city,
          input.department,
          input.locationDescription ?? null,
          input.availabilityStatus ?? 'draft',
          input.availableFrom ?? null,
        ],
      )
      await issueInitialPassport(connection, {
        materialId: id,
        userId,
        organizationId: input.organizationId,
        originType: input.originType,
        city: input.city,
        department: input.department,
      })
      return id
    })
  } catch (error) {
    mapDatabaseError(error)
  }

  return getMaterial(userId, materialId)
}

function snapshotFromRow(row: RowDataPacket): MaterialSnapshot {
  return {
    materialId: Number(row.id),
    organizationId: Number(row.organization_id),
    title: String(row.title),
    description: row.description === null ? null : String(row.description),
    categoryId: Number(row.category_id),
    unitId: Number(row.unit_id),
    quantity: String(row.quantity),
    materialCondition: String(row.material_condition),
    originType: String(row.origin_type),
    city: String(row.city),
    department: String(row.department),
    locationDescription: row.location_description === null ? null : String(row.location_description),
    availabilityStatus: String(row.availability_status),
    availableFrom: row.available_from === null ? null : String(row.available_from),
  }
}

export async function updateMaterial(
  userId: number,
  materialId: number,
  input: UpdateMaterialInput,
  operationKey: string,
): Promise<MaterialRecord> {
  await requireMaterial(userId, materialId, true)
  if (await operationAlreadyUsed(getPool(), operationKey)) {
    return getMaterial(userId, materialId)
  }
  const assignments: string[] = []
  const params: unknown[] = []
  const assign = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`)
    params.push(value)
  }

  if (input.categoryId !== undefined) {
    await assertCategory(input.categoryId)
    assign('category_id', input.categoryId)
  }
  if (input.unitId !== undefined) {
    await assertUnit(input.unitId)
    assign('unit_id', input.unitId)
  }
  if (input.title !== undefined) {
    assign('title', input.title)
  }
  if (input.description !== undefined) {
    assign('description', input.description)
  }
  if (input.materialCondition !== undefined) {
    assign('material_condition', input.materialCondition)
  }
  if (input.quantity !== undefined) {
    await assertQuantityCoversCommitments(materialId, input.quantity)
    assign('quantity', input.quantity)
  }
  if (input.originType !== undefined) {
    assign('origin_type', input.originType)
  }
  if (input.city !== undefined) {
    assign('city', input.city)
  }
  if (input.department !== undefined) {
    assign('department', input.department)
  }
  if (input.locationDescription !== undefined) {
    assign('location_description', input.locationDescription)
  }
  if (input.availabilityStatus !== undefined) {
    assign('availability_status', input.availabilityStatus)
  }
  if (input.availableFrom !== undefined) {
    assign('available_from', input.availableFrom)
  }
  if (assignments.length === 0) {
    throw new AppError(400, 'INVALID_INPUT', 'No hay cambios para guardar.')
  }

  try {
    await withTransaction(async (connection) => {
      const currentRows = await queryRows<RowDataPacket>(
        connection,
        `SELECT id, organization_id, title, description, category_id, unit_id, quantity, material_condition,
                origin_type, city, department, location_description, availability_status,
                DATE_FORMAT(available_from, '%Y-%m-%d') AS available_from
         FROM materials WHERE id = ? FOR UPDATE`,
        [materialId],
      )
      const current = currentRows[0]
      if (!current) {
        throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
      }
      await connection.query(`UPDATE materials SET ${assignments.join(', ')} WHERE id = ?`, [...params, materialId])
      const before = snapshotFromRow(current)
      const after: MaterialSnapshot = {
        ...before,
        title: input.title ?? before.title,
        description: input.description !== undefined ? input.description : before.description,
        categoryId: input.categoryId ?? before.categoryId,
        unitId: input.unitId ?? before.unitId,
        quantity: input.quantity ?? before.quantity,
        materialCondition: input.materialCondition ?? before.materialCondition,
        originType: input.originType ?? before.originType,
        city: input.city ?? before.city,
        department: input.department ?? before.department,
        locationDescription: input.locationDescription !== undefined ? input.locationDescription : before.locationDescription,
        availabilityStatus: input.availabilityStatus ?? before.availabilityStatus,
        availableFrom: input.availableFrom !== undefined ? input.availableFrom : before.availableFrom,
      }
      await recordMaterialChanges(connection, userId, before, after, operationKey)
    })
    await markMaterialMatchesStale(getPool(), materialId)
  } catch (error) {
    mapDatabaseError(error)
  }
  return getMaterial(userId, materialId)
}

export async function updateMaterialStatus(
  userId: number,
  materialId: number,
  availabilityStatus: MaterialStatus,
  operationKey: string,
): Promise<MaterialRecord> {
  await requireMaterial(userId, materialId, true)
  if (await operationAlreadyUsed(getPool(), operationKey)) {
    return getMaterial(userId, materialId)
  }
  try {
    await withTransaction(async (connection) => {
      const currentRows = await queryRows<RowDataPacket>(
        connection,
        `SELECT id, organization_id, title, description, category_id, unit_id, quantity, material_condition,
                origin_type, city, department, location_description, availability_status,
                DATE_FORMAT(available_from, '%Y-%m-%d') AS available_from
         FROM materials WHERE id = ? FOR UPDATE`,
        [materialId],
      )
      const current = currentRows[0]
      if (!current) {
        throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
      }
      await connection.query('UPDATE materials SET availability_status = ? WHERE id = ?', [availabilityStatus, materialId])
      const before = snapshotFromRow(current)
      await recordMaterialChanges(connection, userId, before, { ...before, availabilityStatus }, operationKey)
    })
    await markMaterialMatchesStale(getPool(), materialId)
  } catch (error) {
    mapDatabaseError(error)
  }
  return getMaterial(userId, materialId)
}

export async function addMaterialImage(
  userId: number,
  materialId: number,
  buffer: Buffer,
): Promise<MaterialImageRef> {
  await requireMaterial(userId, materialId, true)
  const storageKey = await writeMaterialFile(materialId, buffer)
  try {
    return await withTransaction(async (connection) => {
      const locked = await queryRows<RowDataPacket>(connection, 'SELECT id FROM materials WHERE id = ? FOR UPDATE', [
        materialId,
      ])
      if (!locked[0]) {
        throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
      }
      const counts = await queryRows<RowDataPacket>(
        connection,
        `SELECT COUNT(*) AS total, COALESCE(MAX(image_order), 0) AS max_order
         FROM material_images
         WHERE material_id = ?`,
        [materialId],
      )
      if (Number(counts[0]?.total ?? 0) >= maxMaterialImages) {
        throw new AppError(400, 'IMAGE_LIMIT', 'Este material ya tiene el máximo de 6 imágenes.')
      }
      const imageOrder = Number(counts[0]?.max_order ?? 0) + 1
      const id = await insertRow(
        connection,
        'INSERT INTO material_images (material_id, storage_key, image_order) VALUES (?, ?, ?)',
        [materialId, storageKey, imageOrder],
      )
      const owners = await queryRows<RowDataPacket>(
        connection,
        'SELECT organization_id FROM materials WHERE id = ?',
        [materialId],
      )
      await recordTraceEvent(connection, {
        materialId,
        actorUserId: userId,
        organizationId: Number(owners[0]?.organization_id ?? 0) || null,
        eventType: 'evidence_added',
        description: 'Se adjuntó una fotografía del material. La imagen no queda verificada por el solo hecho de subirse.',
        operationKey: `image-added-${id}`,
      })
      return { id, imageOrder }
    })
  } catch (error) {
    await removeMaterialFile(storageKey)
    mapDatabaseError(error)
  }
}

export async function removeMaterialImage(userId: number, materialId: number, imageId: number): Promise<void> {
  const material = await requireMaterial(userId, materialId, true)
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    'SELECT storage_key FROM material_images WHERE id = ? AND material_id = ?',
    [imageId, materialId],
  )
  const storageKey = rows[0]?.storage_key
  if (typeof storageKey !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
  }
  await withTransaction(async (connection) => {
    await connection.query('DELETE FROM material_images WHERE id = ? AND material_id = ?', [imageId, materialId])
    await recordTraceEvent(connection, {
      materialId,
      actorUserId: userId,
      organizationId: material.organizationId,
      eventType: 'evidence_removed',
      description: 'Se retiró una fotografía del material.',
      operationKey: `image-removed-${imageId}`,
    })
  })
  await removeMaterialFile(storageKey)
}

export async function readMaterialImage(userId: number, materialId: number, imageId: number) {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT img.storage_key
     FROM material_images img
     INNER JOIN materials m ON m.id = img.material_id
     INNER JOIN organization_members mem
       ON mem.organization_id = m.organization_id
      AND mem.user_id = ?
      AND mem.membership_status = 'active'
     WHERE img.id = ? AND img.material_id = ?`,
    [userId, imageId, materialId],
  )
  const storageKey = rows[0]?.storage_key
  if (typeof storageKey !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la imagen.')
  }
  return openMaterialFile(storageKey)
}

export async function listCategories(): Promise<Array<{ id: number; name: string; description: string | null }>> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    'SELECT id, name, description FROM material_categories ORDER BY name ASC',
  )
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
  }))
}

export async function listUnits(): Promise<Array<{ id: number; code: string; name: string; dimension: string }>> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    'SELECT id, code, name, dimension FROM measurement_units ORDER BY name ASC',
  )
  return rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    dimension: String(row.dimension),
  }))
}
