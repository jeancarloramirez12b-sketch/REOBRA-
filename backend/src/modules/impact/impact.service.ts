import { randomBytes } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { queryRows, withTransaction } from '../../utils/sql.js'
import { canManageOrganization, isMemberRole, type MemberRole } from '../organizations/permissions.js'
import { indicatorDefinitions, ratioPercent, sumByUnit } from './indicators.js'
import { renderReportCsv, renderReportPdf } from './pdf.js'
import { convertExact, dimensionOf, round, toKilograms, type MassParameter } from './units.js'

type Scope = { organizationId?: number; projectId?: number; from?: string; to?: string; grain?: 'day' | 'month' | 'year' }
type Member = { organizationId: number; role: MemberRole }
type Quantity = { unitCode: string; quantity: number }

const receiptLimitation = 'La confirmación demuestra una declaración de recepción. No demuestra instalación, disposición evitada ni emisiones evitadas.'
const environmentalGap = 'No calculable: faltan datos o factores validados.'

export async function impactOverview(userId: number, scope: Scope) {
  const members = await loadMembers(userId)
  const organizationIds = selectedOrganizations(members, scope.organizationId)
  if (scope.projectId) {
    await assertProjectAccess(members, scope.projectId)
  }
  const receipts = await loadReceipts(organizationIds, scope)
  const received = sumByUnit(receipts.map((row) => ({ unitCode: row.unit_code, quantity: decimal(row.received_quantity) })))
  const uniqueOrgs = new Set<number>()
  const projects = new Set<number>()
  const requestTotals = new Map<number, { received: number; agreed: number; unitCode: string; started: Date; ended: Date | null; needId: number | null; required: number | null; projectId: number | null }>()
  for (const row of receipts) {
    uniqueOrgs.add(Number(row.supplier_organization_id))
    uniqueOrgs.add(Number(row.requesting_organization_id))
    if (row.project_id !== null) projects.add(Number(row.project_id))
    const current = requestTotals.get(Number(row.request_id)) ?? {
      received: 0,
      agreed: decimal(row.requested_quantity),
      unitCode: String(row.unit_code),
      started: new Date(row.requested_at),
      ended: null,
      needId: row.project_need_id === null ? null : Number(row.project_need_id),
      required: row.required_quantity === null ? null : decimal(row.required_quantity),
      projectId: row.project_id === null ? null : Number(row.project_id),
    }
    current.received = round3(current.received + decimal(row.received_quantity))
    const ended = new Date(row.received_at)
    if (current.ended === null || ended > current.ended) current.ended = ended
    requestTotals.set(Number(row.request_id), current)
  }
  const durations = [...requestTotals.values()].flatMap((item) => {
    if (!item.ended || Number.isNaN(item.started.getTime())) return []
    return [Math.max(0, (item.ended.getTime() - item.started.getTime()) / 86_400_000)]
  })
  const fulfillment = [...requestTotals.values()].flatMap((item) => {
    const ratio = ratioPercent(item.received, item.agreed)
    return ratio === null ? [] : [ratio]
  })
  const mass = await recoverableMass(receipts)
  return {
    scope: scope.organizationId ? 'organization' : 'memberships',
    evidenceLevel: 'declared' as const,
    limitation: receiptLimitation,
    inventoryNote: 'Publicado, disponible y reservado describen el inventario actual. No son transferencias realizadas.',
    receivedByUnit: received,
    dispatchedByUnit: await quantityQuery(organizationIds, scope, 'dispatched'),
    pendingReceiptByUnit: await quantityQuery(organizationIds, scope, 'pending'),
    reservedByUnit: await inventoryQuery(organizationIds, 'committed_quantity'),
    publishedByUnit: await inventoryQuery(organizationIds, 'published_quantity', true),
    availableByUnit: await inventoryQuery(organizationIds, 'available_quantity', true),
    completedOperations: [...requestTotals.values()].filter((item) => item.received + 0.0001 >= item.agreed).length,
    participatingOrganizations: uniqueOrgs.size,
    benefitedProjects: projects.size,
    incidents: await incidentCount(organizationIds, scope),
    agreementFulfillmentPercent: fulfillment.length === 0 ? null : round3(fulfillment.reduce((total, value) => total + value, 0) / fulfillment.length),
    operationDays: durations.length === 0 ? null : round3(durations.reduce((total, value) => total + value, 0) / durations.length),
    operationSample: durations.length,
    mass,
    environmental: await latestEstimate(organizationIds, scope),
    receivedByCategory: categoryTotals(receipts),
    incorporation: {
      status: 'not_documented' as const,
      message: 'No hay un registro de incorporación al proyecto. La recepción confirmada no demuestra instalación ni uso efectivo.',
    },
    definitions: indicatorDefinitions,
  }
}

export async function impactTimeline(userId: number, scope: Scope) {
  const members = await loadMembers(userId)
  const organizationIds = selectedOrganizations(members, scope.organizationId)
  const grain = scope.grain ?? 'month'
  const format = grain === 'day' ? '%Y-%m-%d' : grain === 'year' ? '%Y' : '%Y-%m'
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT DATE_FORMAT(d.received_at, '${format}') AS bucket, u.code AS unit_code, SUM(d.received_quantity) AS quantity
     FROM deliveries d
     INNER JOIN material_requests r ON r.id = d.request_id
     INNER JOIN materials m ON m.id = r.material_id
     INNER JOIN measurement_units u ON u.id = m.unit_id
     WHERE d.received_at IS NOT NULL AND d.received_quantity > 0
       AND (r.requesting_organization_id IN (${placeholders(organizationIds)}) OR m.organization_id IN (${placeholders(organizationIds)}))
       ${periodSql('d.received_at')}
       ${scope.projectId ? 'AND r.project_id = ?' : ''}
     GROUP BY bucket, u.code
     ORDER BY bucket ASC, u.code ASC`,
    [...organizationIds, ...organizationIds, ...periodParams(scope), ...(scope.projectId ? [scope.projectId] : [])],
  )
  return {
    grain,
    points: rows.map((row) => ({ period: String(row.bucket), unitCode: String(row.unit_code), quantity: decimal(row.quantity) })),
    limitation: 'Cada punto suma recepciones confirmadas de una sola unidad. No mezcla unidades ni estima emisiones.',
  }
}

export async function projectImpact(userId: number, projectId: number, scope: Scope) {
  const members = await loadMembers(userId)
  await assertProjectAccess(members, projectId)
  const overview = await impactOverview(userId, { ...scope, projectId, organizationId: undefined })
  const needs = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT n.id, n.title, n.required_quantity, u.code AS unit_code,
            COALESCE(SUM(d.received_quantity), 0) AS received_quantity
     FROM project_material_needs n
     INNER JOIN measurement_units u ON u.id = n.unit_id
     LEFT JOIN material_requests r ON r.project_need_id = n.id
     LEFT JOIN deliveries d ON d.request_id = r.id AND d.received_at IS NOT NULL
     WHERE n.project_id = ?
     GROUP BY n.id, n.title, n.required_quantity, u.code
     ORDER BY n.id ASC`,
    [projectId],
  )
  return {
    projectId,
    needs: needs.map((row) => {
      const required = decimal(row.required_quantity)
      const received = decimal(row.received_quantity)
      return {
        id: Number(row.id),
        title: String(row.title),
        unitCode: String(row.unit_code),
        requiredQuantity: required,
        receivedQuantity: received,
        pendingQuantity: round3(Math.max(required - received, 0)),
        coveragePercent: ratioPercent(received, required),
      }
    }),
    overview,
    limitation: receiptLimitation,
  }
}

export async function organizationImpact(userId: number, organizationId: number, scope: Scope) {
  const members = await loadMembers(userId)
  assertMember(members, organizationId)
  const period = periodParams(scope)
  const supplied = await sideQuantity(organizationId, scope, 'm.organization_id = ?', period)
  const received = await sideQuantity(organizationId, scope, 'r.requesting_organization_id = ?', period)
  return {
    organizationId,
    suppliedByUnit: supplied,
    receivedByUnit: received,
    evidenceLevel: 'declared' as const,
    limitation: 'Suministrado y recibido son perspectivas distintas. No se suman entre sí para obtener un total.',
  }
}

export function listIndicatorDefinitions() {
  return { indicators: indicatorDefinitions }
}

export async function listMethodologies(userId: number, organizationId?: number) {
  const members = await loadMembers(userId)
  const ids = selectedOrganizations(members, organizationId)
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, public_code, organization_id, name, version_label, statement_text, limitations_text, status, used_at, created_at
     FROM impact_methodologies WHERE organization_id IN (${placeholders(ids)}) ORDER BY id DESC`,
    ids,
  )
  return { methodologies: rows.map(presentMethodology) }
}

export async function createMethodology(userId: number, input: { organizationId: number; name: string; versionLabel: string; statement: string; limitations: string }) {
  const members = await loadMembers(userId)
  const member = assertMember(members, input.organizationId)
  if (!canManageOrganization(member.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Solo la administración de la organización registra metodologías.')
  }
  const id = await insertWithCode(
    'mth',
    `INSERT INTO impact_methodologies (
       public_code, organization_id, name, version_label, statement_text, limitations_text, created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    (code) => [code, input.organizationId, input.name, input.versionLabel, input.statement, input.limitations, userId],
  )
  return methodologyById(id)
}

export async function listFactors(userId: number, organizationId?: number) {
  const members = await loadMembers(userId)
  const ids = selectedOrganizations(members, organizationId)
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT f.id, f.public_code, f.organization_id, f.methodology_id, f.impact_kind, f.input_unit_code, f.output_unit,
            f.factor_value, f.source_name, f.source_url, f.issuer_name, f.factor_year, f.region_name, f.version_label,
            f.conditions_text, f.uncertainty_text, f.status
     FROM impact_factors f WHERE f.organization_id IN (${placeholders(ids)}) ORDER BY f.id DESC`,
    ids,
  )
  return { factors: rows.map(presentFactor), notice: 'No hay factores oficiales precargados. Un factor aprobado solo vale para la organización que lo registró.' }
}

export async function createFactor(userId: number, input: {
  methodologyId: number
  impactKind: string
  categoryId?: number
  inputUnitCode: string
  outputUnit: string
  value: number
  sourceName: string
  sourceUrl?: string
  issuerName: string
  year: number
  regionName: string
  versionLabel: string
  conditions: string
  uncertainty?: string
}) {
  if (!dimensionOf(input.inputUnitCode)) {
    throw new AppError(400, 'INVALID_INPUT', 'La unidad de entrada no pertenece al catálogo.')
  }
  const methodology = await methodologyRow(input.methodologyId)
  const members = await loadMembers(userId)
  const member = assertMember(members, Number(methodology.organization_id))
  if (!canManageOrganization(member.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Solo la administración registra factores.')
  }
  const id = await insertWithCode(
    'fac',
    `INSERT INTO impact_factors (
       public_code, methodology_id, organization_id, impact_kind, category_id, input_unit_code, output_unit, factor_value,
       source_name, source_url, issuer_name, factor_year, region_name, version_label, conditions_text, uncertainty_text, created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    (code) => [
      code, input.methodologyId, methodology.organization_id, input.impactKind, input.categoryId ?? null, input.inputUnitCode,
      input.outputUnit, input.value, input.sourceName, input.sourceUrl ?? null, input.issuerName, input.year, input.regionName,
      input.versionLabel, input.conditions, input.uncertainty ?? null, userId,
    ],
  )
  const factor = presentFactor((await queryRows<RowDataPacket>(getPool(), 'SELECT * FROM impact_factors WHERE id = ?', [id]))[0])
  return { factor }
}

export async function updateFactorStatus(userId: number, factorId: number, status: 'reviewed' | 'approved' | 'retired') {
  const factor = (await queryRows<RowDataPacket>(getPool(), 'SELECT * FROM impact_factors WHERE id = ?', [factorId]))[0]
  if (!factor) throw new AppError(404, 'NOT_FOUND', 'No se encontró el factor.')
  const members = await loadMembers(userId)
  const member = assertMember(members, Number(factor.organization_id))
  const allowed = status === 'reviewed' ? member.role === 'technical_reviewer' || canManageOrganization(member.role) : canManageOrganization(member.role)
  if (!allowed) throw new AppError(403, 'FORBIDDEN', 'No puedes cambiar el estado de este factor.')
  if (status === 'approved') {
    const methodology = await methodologyRow(Number(factor.methodology_id))
    if (methodology.status !== 'approved') {
      throw new AppError(409, 'METHODOLOGY_NOT_APPROVED', 'Aprueba primero la metodología de este factor.')
    }
  }
  const transitions: Record<string, string[]> = { draft: ['reviewed', 'retired'], reviewed: ['approved', 'retired'], approved: ['retired'], retired: [] }
  if (!transitions[String(factor.status)]?.includes(status)) {
    throw new AppError(409, 'INVALID_TRANSITION', 'Ese cambio de estado del factor no está permitido.')
  }
  await getPool().query('UPDATE impact_factors SET status = ? WHERE id = ?', [status, factorId])
  return { factor: presentFactor((await queryRows<RowDataPacket>(getPool(), 'SELECT * FROM impact_factors WHERE id = ?', [factorId]))[0]) }
}

export async function approveMethodology(userId: number, methodologyId: number) {
  const methodology = await methodologyRow(methodologyId)
  const member = assertMember(await loadMembers(userId), Number(methodology.organization_id))
  if (!canManageOrganization(member.role)) throw new AppError(403, 'FORBIDDEN', 'No puedes aprobar esta metodología.')
  if (methodology.used_at !== null) throw new AppError(409, 'LOCKED', 'Esta versión ya fue usada por un informe y no se modifica.')
  if (methodology.status !== 'draft') throw new AppError(409, 'INVALID_TRANSITION', 'Solo una metodología en borrador puede aprobarse.')
  await getPool().query(`UPDATE impact_methodologies SET status = 'approved' WHERE id = ?`, [methodologyId])
  return methodologyById(methodologyId)
}

export async function addMassParameter(userId: number, input: { materialId: number; kind: MassParameter['kind']; magnitude: number; sourceNote: string }) {
  const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT organization_id, unit_id FROM materials WHERE id = ?', [input.materialId])
  const material = rows[0]
  if (!material) throw new AppError(404, 'NOT_FOUND', 'No se encontró el material.')
  const member = assertMember(await loadMembers(userId), Number(material.organization_id))
  if (!canManageOrganization(member.role)) throw new AppError(403, 'FORBIDDEN', 'No puedes registrar un parámetro de masa.')
  const unit = (await queryRows<RowDataPacket>(getPool(), 'SELECT code FROM measurement_units WHERE id = ?', [material.unit_id]))[0]
  const dimension = dimensionOf(String(unit?.code))
  const matches = (dimension === 'count' && input.kind === 'mass_per_unit') || (dimension === 'volume' && input.kind === 'density') || (dimension === 'area' && input.kind === 'mass_per_area')
  if (!matches) throw new AppError(400, 'INVALID_INPUT', 'Ese parámetro no corresponde a la dimensión de la unidad del material.')
  await getPool().query(
    `INSERT INTO impact_mass_parameters (material_id, organization_id, parameter_kind, magnitude, source_note, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.materialId, material.organization_id, input.kind, input.magnitude, input.sourceNote, userId],
  )
  return { evidenceLevel: 'declared' as const, notice: 'El parámetro queda declarado. No queda verificado técnicamente.' }
}

export async function calculateImpact(userId: number, input: { organizationId: number; projectId?: number; factorId: number; from: string; to: string }, operationKey: string) {
  const existing = await queryRows<RowDataPacket>(getPool(), 'SELECT id FROM impact_calculations WHERE operation_key = ?', [operationKey])
  if (existing[0]) return calculationDetail(userId, Number(existing[0].id))
  const previous = await queryRows<RowDataPacket>(getPool(), 'SELECT calculation_id FROM impact_audit_events WHERE operation_key = ?', [`${operationKey}-audit`])
  if (previous[0]) return calculationDetail(userId, Number(previous[0].calculation_id))
  const members = await loadMembers(userId)
  assertMember(members, input.organizationId)
  const factor = (await queryRows<RowDataPacket>(getPool(), 'SELECT * FROM impact_factors WHERE id = ?', [input.factorId]))[0]
  if (!factor || Number(factor.organization_id) !== input.organizationId) throw new AppError(404, 'NOT_FOUND', 'No se encontró el factor.')
  const receipts = await loadReceipts([input.organizationId], input)
  const scoped = input.projectId ? receipts.filter((row) => Number(row.project_id) === input.projectId) : receipts
  const prepared = await prepareEstimate(scoped, factor)
  const id = await withTransaction(async (connection) => {
    const scopeRows = await queryRows<RowDataPacket>(
      connection,
      'SELECT id FROM impact_calculations WHERE organization_id = ? AND IFNULL(project_id, 0) = ? AND factor_id = ? AND period_start = ? AND period_end = ? FOR UPDATE',
      [input.organizationId, input.projectId ?? 0, input.factorId, input.from, input.to],
    )
    if (scopeRows[0]) {
      const currentId = Number(scopeRows[0].id)
      await connection.query(
        `UPDATE impact_calculations
         SET status = ?, result_value = ?, result_unit = ?, reason_text = ?, evidence_level = 'declared', updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [prepared.status, prepared.value, prepared.unit, prepared.reason, currentId],
      )
      await connection.query('DELETE FROM impact_calculation_sources WHERE calculation_id = ?', [currentId])
      for (const source of prepared.sources) {
        await connection.query(
          'INSERT INTO impact_calculation_sources (calculation_id, delivery_id, received_quantity) VALUES (?, ?, ?)',
          [currentId, source.deliveryId, source.quantity],
        )
      }
      await connection.query(
        `INSERT INTO impact_audit_events (actor_user_id, organization_id, action_name, calculation_id, description, operation_key)
         VALUES (?, ?, 'calculation_recorded', ?, ?, ?)`,
        [userId, input.organizationId, currentId, 'Se recalculó la estimación sobre el mismo alcance. No se creó otra transferencia.', `${operationKey}-audit`],
      )
      return currentId
    }
    const code = publicCode('cal')
    const header = await connection.query(
      `INSERT INTO impact_calculations (
         public_code, organization_id, project_id, factor_id, period_start, period_end, status, result_value, result_unit,
         reason_text, operation_key, calculated_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, input.organizationId, input.projectId ?? null, input.factorId, input.from, input.to, prepared.status, prepared.value, prepared.unit, prepared.reason, operationKey, userId],
    )
    const inserted = Number((header[0] as { insertId?: number }).insertId)
    for (const source of prepared.sources) {
      await connection.query(
        'INSERT INTO impact_calculation_sources (calculation_id, delivery_id, received_quantity) VALUES (?, ?, ?)',
        [inserted, source.deliveryId, source.quantity],
      )
    }
    await connection.query(
      `INSERT INTO impact_audit_events (actor_user_id, organization_id, action_name, calculation_id, description)
       VALUES (?, ?, 'calculation_recorded', ?, ?)`,
      [userId, input.organizationId, inserted, prepared.status === 'calculated' ? 'Se registró una estimación. No certifica el impacto.' : prepared.reason],
    )
    return inserted
  })
  return calculationDetail(userId, id)
}

export async function calculationDetail(userId: number, calculationId: number) {
  const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT * FROM impact_calculations WHERE id = ?', [calculationId])
  const row = rows[0]
  if (!row) throw new AppError(404, 'NOT_FOUND', 'No se encontró el cálculo.')
  assertMember(await loadMembers(userId), Number(row.organization_id))
  const sources = await queryRows<RowDataPacket>(getPool(), 'SELECT delivery_id, received_quantity FROM impact_calculation_sources WHERE calculation_id = ? ORDER BY id ASC', [calculationId])
  return {
    calculation: {
      id: Number(row.id),
      publicCode: String(row.public_code),
      status: String(row.status),
      resultValue: row.result_value === null ? null : decimal(row.result_value),
      resultUnit: row.result_unit === null ? null : String(row.result_unit),
      reason: row.reason_text === null ? null : String(row.reason_text),
      evidenceLevel: String(row.evidence_level),
      periodStart: formatDay(row.period_start),
      periodEnd: formatDay(row.period_end),
      limitation: 'Esta cifra es una estimación con el factor y los datos guardados. No es una certificación.',
    },
    sources: sources.map((source) => ({ deliveryId: Number(source.delivery_id), receivedQuantity: decimal(source.received_quantity) })),
  }
}

export async function issueReport(userId: number, input: { organizationId: number; projectId?: number; from: string; to: string; methodologyId?: number }, operationKey: string) {
  const replay = await queryRows<RowDataPacket>(getPool(), 'SELECT id FROM impact_reports WHERE operation_key = ?', [operationKey])
  if (replay[0]) return reportDetail(userId, Number(replay[0].id))
  const members = await loadMembers(userId)
  const member = assertMember(members, input.organizationId)
  if (!canManageOrganization(member.role) && member.role !== 'editor') {
    throw new AppError(403, 'FORBIDDEN', 'No puedes emitir un informe de esta organización.')
  }
  if (input.projectId) await assertProjectAccess(members, input.projectId)
  let methodology: RowDataPacket | null = null
  if (input.methodologyId) {
    methodology = await methodologyRow(input.methodologyId)
    if (Number(methodology.organization_id) !== input.organizationId) throw new AppError(404, 'NOT_FOUND', 'No se encontró la metodología.')
  }
  const overview = await impactOverview(userId, input)
  const items = reportItems(overview, methodology)
  const id = await withTransaction(async (connection) => {
    const code = publicCode('rpt')
    const header = await connection.query(
      `INSERT INTO impact_reports (public_code, organization_id, project_id, period_start, period_end, methodology_id, issued_by_user_id, operation_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, input.organizationId, input.projectId ?? null, input.from, input.to, methodology?.id ?? null, userId, operationKey],
    )
    const reportId = Number((header[0] as { insertId?: number }).insertId)
    for (const item of items) {
      await connection.query(
        `INSERT INTO impact_report_items (report_id, indicator_code, label, section_name, value_text, numeric_value, unit_code, evidence_level, limitations_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, item.code, item.label, item.section, item.value, item.numeric, item.unit, item.evidence, item.limitations],
      )
    }
    if (methodology && methodology.used_at === null) {
      await connection.query('UPDATE impact_methodologies SET used_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND used_at IS NULL', [methodology.id])
    }
    await connection.query(
      `INSERT INTO impact_audit_events (actor_user_id, organization_id, action_name, report_id, description)
       VALUES (?, ?, 'report_issued', ?, ?)`,
      [userId, input.organizationId, reportId, 'Se emitió un informe con las cifras de este momento.'],
    )
    return reportId
  })
  return reportDetail(userId, id)
}

export async function reportDetail(userId: number, reportId: number) {
  const report = await loadReport(userId, reportId)
  const items = await queryRows<RowDataPacket>(getPool(), 'SELECT * FROM impact_report_items WHERE report_id = ? ORDER BY id ASC', [reportId])
  return { report: presentReport(report), items: items.map(presentItem) }
}

export async function exportReport(userId: number, reportId: number, format: 'pdf' | 'csv') {
  const detail = await reportDetail(userId, reportId)
  await getPool().query(
    `INSERT INTO impact_audit_events (actor_user_id, organization_id, action_name, report_id, description)
     VALUES (?, ?, 'report_downloaded', ?, ?)`,
    [userId, detail.report.organizationId, reportId, `Se descargó el informe en ${format}.`],
  )
  if (format === 'csv') {
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `${detail.report.publicCode}.csv`,
      body: Buffer.from(renderReportCsv(detail.items.map((item) => ({
        section: item.section,
        indicator: item.label,
        value: item.value,
        unit: item.unitCode ?? '',
        evidence: item.evidenceLevel,
        limitations: item.limitations,
      })))),
    }
  }
  const lines = [
    `Informe ${detail.report.publicCode}`,
    `Periodo ${detail.report.periodStart} a ${detail.report.periodEnd}`,
    'No es una certificacion ambiental.',
    ...detail.items.map((item) => `${item.section}: ${item.label} = ${item.value} ${item.unitCode ?? ''}`),
  ]
  return { contentType: 'application/pdf', filename: `${detail.report.publicCode}.pdf`, body: renderReportPdf(lines) }
}

export async function correctReceipt(userId: number, deliveryId: number, input: { quantity: number; reason: string }, operationKey: string) {
  const replay = await queryRows<RowDataPacket>(getPool(), 'SELECT id FROM impact_audit_events WHERE operation_key = ?', [operationKey])
  if (replay[0]) return { corrected: true, deliveryId }
  const members = await loadMembers(userId)
  await withTransaction(async (connection) => {
    const rows = await queryRows<RowDataPacket>(
      connection,
      `SELECT d.id, d.delivered_quantity, d.received_quantity, d.received_at, r.requesting_organization_id
       FROM deliveries d INNER JOIN material_requests r ON r.id = d.request_id
       WHERE d.id = ? FOR UPDATE`,
      [deliveryId],
    )
    const delivery = rows[0]
    if (!delivery || delivery.received_at === null) throw new AppError(404, 'NOT_FOUND', 'No se encontró una recepción confirmada.')
    const member = assertMember(members, Number(delivery.requesting_organization_id))
    if (!canManageOrganization(member.role) && member.role !== 'editor') {
      throw new AppError(403, 'FORBIDDEN', 'No puedes corregir esta recepción.')
    }
    if (input.quantity > decimal(delivery.delivered_quantity) + 0.0001) {
      throw new AppError(409, 'QUANTITY_EXCEEDED', 'La corrección no puede superar lo despachado.')
    }
    const previous = decimal(delivery.received_quantity)
    await connection.query('UPDATE deliveries SET received_quantity = ? WHERE id = ?', [input.quantity, deliveryId])
    await connection.query(
      `INSERT INTO impact_audit_events (actor_user_id, organization_id, action_name, delivery_id, description, operation_key)
       VALUES (?, ?, 'receipt_corrected', ?, ?, ?)`,
      [userId, delivery.requesting_organization_id, deliveryId, `La recepción pasó de ${previous} a ${input.quantity}. Motivo: ${input.reason}`, operationKey],
    )
  })
  return { corrected: true, deliveryId, quantity: input.quantity }
}

async function prepareEstimate(receipts: RowDataPacket[], factor: RowDataPacket) {
  if (factor.status !== 'approved') {
    return { status: 'not_calculable', value: null, unit: null, reason: environmentalGap, sources: [] as Array<{ deliveryId: number; quantity: number }> }
  }
  const parameters = await parametersByMaterial(receipts.map((row) => Number(row.material_id)))
  let inputQuantity = 0
  const sources: Array<{ deliveryId: number; quantity: number }> = []
  for (const row of receipts) {
    const quantity = decimal(row.received_quantity)
    const converted = convertExactOrNull(quantity, String(row.unit_code), String(factor.input_unit_code), parameters.get(Number(row.material_id)) ?? null)
    if (converted === null) {
      return { status: 'not_calculable', value: null, unit: null, reason: 'No calculable: la cantidad recibida no se convierte a la unidad del factor con datos actuales.', sources: [] }
    }
    inputQuantity = round(inputQuantity + converted)
    sources.push({ deliveryId: Number(row.id), quantity })
  }
  if (sources.length === 0) {
    return { status: 'not_calculable', value: null, unit: null, reason: environmentalGap, sources }
  }
  return {
    status: 'calculated',
    value: round(inputQuantity * decimal(factor.factor_value)),
    unit: String(factor.output_unit),
    reason: 'Estimación con un factor de la organización. No es una certificación.',
    sources,
  }
}

function convertExactOrNull(quantity: number, from: string, to: string, parameter: MassParameter | null): number | null {
  if (from === to) return quantity
  const exact = convertExact(quantity, from, to)
  if (exact !== null) return exact
  if (to !== 'kg') return null
  const mass = toKilograms(quantity, from, parameter)
  return mass.ok ? mass.kilograms : null
}

async function recoverableMass(receipts: RowDataPacket[]) {
  const parameters = await parametersByMaterial(receipts.map((row) => Number(row.material_id)))
  let kilograms = 0
  let included = 0
  let excluded = 0
  for (const row of receipts) {
    const converted = toKilograms(decimal(row.received_quantity), String(row.unit_code), parameters.get(Number(row.material_id)) ?? null)
    if (!converted.ok) {
      excluded += 1
      continue
    }
    kilograms = round(kilograms + converted.kilograms)
    included += 1
  }
  if (included === 0) {
    return { status: 'not_calculable' as const, kilograms: null, message: 'Masa no calculable con los datos actuales.' }
  }
  return {
    status: 'calculated' as const,
    kilograms,
    message: excluded > 0 ? `Se convirtieron ${included} recepciones. ${excluded} quedaron fuera por falta de conversión.` : 'La masa usa conversiones exactas o parámetros declarados.',
  }
}

async function parametersByMaterial(materialIds: number[]): Promise<Map<number, MassParameter>> {
  const unique = [...new Set(materialIds)]
  const map = new Map<number, MassParameter>()
  if (unique.length === 0) return map
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT material_id, parameter_kind, magnitude FROM impact_mass_parameters
     WHERE material_id IN (${placeholders(unique)}) ORDER BY id ASC`,
    unique,
  )
  for (const row of rows) {
    map.set(Number(row.material_id), { kind: row.parameter_kind as MassParameter['kind'], magnitude: decimal(row.magnitude) })
  }
  return map
}

async function latestEstimate(organizationIds: number[], scope: Scope) {
  if (!scope.organizationId) {
    return { status: 'not_calculable' as const, message: environmentalGap }
  }
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT status, result_value, result_unit, reason_text, evidence_level
     FROM impact_calculations
     WHERE organization_id IN (${placeholders(organizationIds)})
       AND period_start >= ? AND period_end <= ?
     ORDER BY updated_at DESC, id DESC LIMIT 1`,
    [...organizationIds, scope.from ?? '1000-01-01', scope.to ?? '9999-12-31'],
  )
  const row = rows[0]
  if (!row || row.status !== 'calculated') {
    return { status: 'not_calculable' as const, message: row?.reason_text ? String(row.reason_text) : environmentalGap }
  }
  return {
    status: 'estimated' as const,
    value: decimal(row.result_value),
    unit: String(row.result_unit),
    evidenceLevel: String(row.evidence_level),
    message: 'Estimación de la organización. No es una certificación ambiental.',
  }
}

function reportItems(overview: Awaited<ReturnType<typeof impactOverview>>, methodology: RowDataPacket | null) {
  const limitations = methodology ? String(methodology.limitations_text) : receiptLimitation
  const items: Array<{ code: string; label: string; section: string; value: string; numeric: number | null; unit: string | null; evidence: string; limitations: string }> = []
  const pushQuantity = (code: string, label: string, rows: Quantity[]) => {
    if (rows.length === 0) {
      items.push({ code, label, section: 'operational', value: 'Sin cantidad confirmada en el período', numeric: 0, unit: null, evidence: 'declared', limitations })
      return
    }
    for (const row of rows) {
      items.push({ code, label, section: 'operational', value: String(row.quantity), numeric: row.quantity, unit: row.unitCode, evidence: 'declared', limitations })
    }
  }
  pushQuantity('received_confirmed', 'Recibido y confirmado', overview.receivedByUnit)
  pushQuantity('dispatched', 'Despachado', overview.dispatchedByUnit)
  pushQuantity('pending_receipt', 'Pendiente de recepción', overview.pendingReceiptByUnit)
  items.push({
    code: 'recovered_mass',
    label: 'Masa recuperada',
    section: overview.mass.status === 'calculated' ? 'operational' : 'unavailable',
    value: overview.mass.kilograms === null ? overview.mass.message : String(overview.mass.kilograms),
    numeric: overview.mass.kilograms,
    unit: overview.mass.kilograms === null ? null : 'kg',
    evidence: 'declared',
    limitations: overview.mass.message,
  })
  items.push({
    code: 'project_incorporation',
    label: 'Incorporación al proyecto',
    section: 'unavailable',
    value: overview.incorporation.message,
    numeric: null,
    unit: null,
    evidence: 'declared',
    limitations: overview.incorporation.message,
  })
  items.push({
    code: 'environmental_estimate',
    label: 'Estimación ambiental',
    section: overview.environmental.status === 'estimated' ? 'estimate' : 'unavailable',
    value: overview.environmental.status === 'estimated' ? String(overview.environmental.value) : overview.environmental.message,
    numeric: overview.environmental.status === 'estimated' ? overview.environmental.value : null,
    unit: overview.environmental.status === 'estimated' ? overview.environmental.unit : null,
    evidence: 'declared',
    limitations: overview.environmental.message,
  })
  return items
}

async function loadReceipts(organizationIds: number[], scope: Scope) {
  return queryRows<RowDataPacket>(
    getPool(),
    `SELECT d.id, d.received_quantity, d.received_at, u.code AS unit_code, c.name AS category_name, r.id AS request_id, r.requested_quantity,
            r.requested_at, r.project_id, r.project_need_id, n.required_quantity, r.requesting_organization_id,
            m.organization_id AS supplier_organization_id, m.id AS material_id
     FROM deliveries d
     INNER JOIN material_requests r ON r.id = d.request_id
     INNER JOIN materials m ON m.id = r.material_id
     INNER JOIN measurement_units u ON u.id = m.unit_id
     LEFT JOIN material_categories c ON c.id = m.category_id
     LEFT JOIN project_material_needs n ON n.id = r.project_need_id
     WHERE d.received_at IS NOT NULL AND d.received_quantity > 0
       AND (r.requesting_organization_id IN (${placeholders(organizationIds)}) OR m.organization_id IN (${placeholders(organizationIds)}))
       ${periodSql('d.received_at')}
       ${scope.projectId ? 'AND r.project_id = ?' : ''}
     ORDER BY d.id ASC`,
    [...organizationIds, ...organizationIds, ...periodParams(scope), ...(scope.projectId ? [scope.projectId] : [])],
  )
}

async function quantityQuery(organizationIds: number[], scope: Scope, kind: 'dispatched' | 'pending'): Promise<Quantity[]> {
  const expression = kind === 'dispatched' ? 'd.delivered_quantity' : 'd.delivered_quantity - COALESCE(d.received_quantity, 0)'
  const filter = kind === 'pending' ? 'AND d.delivered_quantity > COALESCE(d.received_quantity, 0)' : ''
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT u.code AS unit_code, SUM(${expression}) AS quantity
     FROM deliveries d
     INNER JOIN material_requests r ON r.id = d.request_id
     INNER JOIN materials m ON m.id = r.material_id
     INNER JOIN measurement_units u ON u.id = m.unit_id
     WHERE d.status = 'delivered'
       AND (r.requesting_organization_id IN (${placeholders(organizationIds)}) OR m.organization_id IN (${placeholders(organizationIds)}))
       ${periodSql('d.delivered_at')}
       ${scope.projectId ? 'AND r.project_id = ?' : ''}
       ${filter}
     GROUP BY u.code`,
    [...organizationIds, ...organizationIds, ...periodParams(scope), ...(scope.projectId ? [scope.projectId] : [])],
  )
  return rows.map((row) => ({ unitCode: String(row.unit_code), quantity: decimal(row.quantity) }))
}

async function inventoryQuery(organizationIds: number[], column: 'committed_quantity' | 'published_quantity' | 'available_quantity', publishedOnly = false): Promise<Quantity[]> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT u.code AS unit_code, SUM(qs.${column}) AS quantity
     FROM material_quantity_summary qs
     INNER JOIN materials m ON m.id = qs.material_id
     INNER JOIN measurement_units u ON u.id = m.unit_id
     WHERE m.organization_id IN (${placeholders(organizationIds)})
       ${publishedOnly ? "AND m.availability_status = 'published'" : ''}
     GROUP BY u.code`,
    organizationIds,
  )
  return rows.map((row) => ({ unitCode: String(row.unit_code), quantity: decimal(row.quantity) }))
}

async function sideQuantity(organizationId: number, scope: Scope, predicate: string, period: unknown[]): Promise<Quantity[]> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT u.code AS unit_code, SUM(d.received_quantity) AS quantity
     FROM deliveries d
     INNER JOIN material_requests r ON r.id = d.request_id
     INNER JOIN materials m ON m.id = r.material_id
     INNER JOIN measurement_units u ON u.id = m.unit_id
     WHERE d.received_at IS NOT NULL AND ${predicate}
       ${periodSql('d.received_at')}
       ${scope.projectId ? 'AND r.project_id = ?' : ''}
     GROUP BY u.code`,
    [organizationId, ...period, ...(scope.projectId ? [scope.projectId] : [])],
  )
  return rows.map((row) => ({ unitCode: String(row.unit_code), quantity: decimal(row.quantity) }))
}

async function incidentCount(organizationIds: number[], scope: Scope): Promise<number> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total
     FROM logistics_incidents i
     INNER JOIN material_requests r ON r.id = i.request_id
     INNER JOIN materials m ON m.id = r.material_id
     WHERE (r.requesting_organization_id IN (${placeholders(organizationIds)}) OR m.organization_id IN (${placeholders(organizationIds)}))
       ${periodSql('i.created_at')}
       ${scope.projectId ? 'AND r.project_id = ?' : ''}`,
    [...organizationIds, ...organizationIds, ...periodParams(scope), ...(scope.projectId ? [scope.projectId] : [])],
  )
  return Number(rows[0]?.total ?? 0)
}

async function loadMembers(userId: number): Promise<Member[]> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT organization_id, role FROM organization_members WHERE user_id = ? AND membership_status = 'active'`,
    [userId],
  )
  return rows.flatMap((row) => isMemberRole(String(row.role)) ? [{ organizationId: Number(row.organization_id), role: String(row.role) as MemberRole }] : [])
}

function selectedOrganizations(members: Member[], organizationId?: number): number[] {
  if (organizationId) {
    assertMember(members, organizationId)
    return [organizationId]
  }
  if (members.length === 0) throw new AppError(404, 'NOT_FOUND', 'No hay una organización disponible para este indicador.')
  return members.map((member) => member.organizationId)
}

function assertMember(members: Member[], organizationId: number): Member {
  const member = members.find((item) => item.organizationId === organizationId)
  if (!member) throw new AppError(404, 'NOT_FOUND', 'No se encontró la organización.')
  return member
}

async function assertProjectAccess(members: Member[], projectId: number): Promise<void> {
  const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT organization_id FROM projects WHERE id = ?', [projectId])
  if (!rows[0] || !members.some((member) => member.organizationId === Number(rows[0].organization_id))) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el proyecto.')
  }
}

async function methodologyRow(id: number): Promise<RowDataPacket> {
  const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT * FROM impact_methodologies WHERE id = ?', [id])
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'No se encontró la metodología.')
  return rows[0]
}

async function methodologyById(id: number) {
  return { methodology: presentMethodology(await methodologyRow(id)) }
}

async function loadReport(userId: number, reportId: number): Promise<RowDataPacket> {
  const rows = await queryRows<RowDataPacket>(getPool(), 'SELECT * FROM impact_reports WHERE id = ?', [reportId])
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'No se encontró el informe.')
  assertMember(await loadMembers(userId), Number(rows[0].organization_id))
  return rows[0]
}

function presentMethodology(row: RowDataPacket | undefined) {
  if (!row) throw new AppError(404, 'NOT_FOUND', 'No se encontró la metodología.')
  return {
    id: Number(row.id),
    publicCode: String(row.public_code),
    organizationId: Number(row.organization_id),
    name: String(row.name),
    versionLabel: String(row.version_label),
    statement: String(row.statement_text),
    limitations: String(row.limitations_text),
    status: String(row.status),
    locked: row.used_at !== null,
  }
}

function presentFactor(row: RowDataPacket | undefined) {
  if (!row) throw new AppError(404, 'NOT_FOUND', 'No se encontró el factor.')
  return {
    id: Number(row.id),
    publicCode: String(row.public_code),
    organizationId: Number(row.organization_id),
    methodologyId: Number(row.methodology_id),
    impactKind: String(row.impact_kind),
    inputUnitCode: String(row.input_unit_code),
    outputUnit: String(row.output_unit),
    value: decimal(row.factor_value),
    sourceName: String(row.source_name),
    sourceUrl: row.source_url === null ? null : String(row.source_url),
    issuerName: String(row.issuer_name),
    year: Number(row.factor_year),
    regionName: String(row.region_name),
    versionLabel: String(row.version_label),
    conditions: String(row.conditions_text),
    uncertainty: row.uncertainty_text === null ? null : String(row.uncertainty_text),
    status: String(row.status),
  }
}

function presentReport(row: RowDataPacket) {
  return {
    id: Number(row.id),
    publicCode: String(row.public_code),
    organizationId: Number(row.organization_id),
    projectId: row.project_id === null ? null : Number(row.project_id),
    periodStart: formatDay(row.period_start),
    periodEnd: formatDay(row.period_end),
    issuedAt: row.issued_at,
  }
}

function presentItem(row: RowDataPacket) {
  return {
    code: String(row.indicator_code),
    label: String(row.label),
    section: String(row.section_name),
    value: String(row.value_text),
    numericValue: row.numeric_value === null ? null : decimal(row.numeric_value),
    unitCode: row.unit_code === null ? null : String(row.unit_code),
    evidenceLevel: String(row.evidence_level),
    limitations: String(row.limitations_text),
  }
}

function periodSql(column: string): string {
  return `AND (? IS NULL OR ${column} >= ?) AND (? IS NULL OR ${column} < DATE_ADD(?, INTERVAL 1 DAY))`
}

function periodParams(scope: Scope): unknown[] {
  return [scope.from ?? null, scope.from ?? null, scope.to ?? null, scope.to ?? null]
}

function placeholders(values: number[]): string {
  return values.map(() => '?').join(', ')
}

function decimal(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new AppError(500, 'INVALID_QUANTITY', 'Hay una cantidad que no se puede leer.')
  return round3(number)
}

function categoryTotals(rows: RowDataPacket[]): Array<{ category: string; unitCode: string; quantity: number }> {
  const totals = new Map<string, { category: string; unitCode: string; quantity: number }>()
  for (const row of rows) {
    const category = row.category_name === null ? 'Sin categoría' : String(row.category_name)
    const unitCode = String(row.unit_code)
    const key = `${category}\u0000${unitCode}`
    const current = totals.get(key) ?? { category, unitCode, quantity: 0 }
    current.quantity = round3(current.quantity + decimal(row.received_quantity))
    totals.set(key, current)
  }
  return [...totals.values()].sort((left, right) => left.category.localeCompare(right.category) || left.unitCode.localeCompare(right.unitCode))
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function formatDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function publicCode(prefix: 'mth' | 'fac' | 'cal' | 'rpt'): string {
  return `${prefix}_${randomBytes(10).toString('hex')}`
}

async function insertWithCode(prefix: 'mth' | 'fac' | 'cal' | 'rpt', sql: string, values: (code: string) => unknown[]): Promise<number> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [header] = await getPool().query(sql, values(publicCode(prefix)))
      return Number((header as { insertId?: number }).insertId)
    } catch (error) {
      lastError = error
      const duplicate = typeof error === 'object' && error !== null && 'code' in error && String(error.code) === 'ER_DUP_ENTRY'
      if (!duplicate) throw error
    }
  }
  throw lastError
}
