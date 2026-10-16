import { createHash } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { insertRow, queryRows, withTransaction } from '../../utils/sql.js'
import { canWriteMaterials } from '../materials/permissions.js'
import { isMemberRole, type MemberRole } from '../organizations/permissions.js'
import { matchingAlgorithmVersion, matchingDisclaimer, matchingThresholds, matchingWeights } from './config.js'
import { explainMatch } from './explain.js'
import { foldText } from './normalize.js'
import { compareMatches, evaluateMatch, type MatchClassification, type MatchEvaluation, type Specification } from './score.js'

const candidateLimit = 200
const searchableNeedStatuses = new Set(['open', 'partially_covered'])

type NeedRow = RowDataPacket & {
  id: number
  title: string | null
  description: string
  organization_id: number
  organization_name: string
  project_id: number
  project_title: string
  project_status: string
  role_name: string
  category_id: number
  category_name: string
  parent_category_id: number | null
  unit_id: number
  unit_code: string
  unit_name: string
  required_quantity: string
  required_condition: string | null
  city: string | null
  department: string | null
  status: string
  specifications_json: unknown
}

type MaterialRow = RowDataPacket & {
  id: number
  organization_id: number
  organization_name: string
  title: string
  category_id: number
  category_name: string
  parent_category_id: number | null
  unit_id: number
  unit_code: string
  unit_name: string
  material_condition: string
  city: string
  department: string
  availability_status: string
  technical_validation_status: string
  available_quantity: string
  passport_visibility: string | null
  public_code: string | null
  document_count: number
  assessment_count: number
  updated_at: string
}

export type MatchQuery = {
  page: number
  pageSize: number
  sort: 'score' | 'coverage' | 'proximity' | 'updated'
  level?: 'high' | 'medium' | 'low' | 'insufficient'
  minCoverage?: number
  department?: string
  category?: string
  pendingTechnical: boolean
}

export type MatchCard = {
  materialId: number
  title: string
  organizationName: string
  sameOrganization: boolean
  categoryName: string
  unitCode: string
  unitName: string
  availableQuantity: number
  requiredQuantity: number
  usableQuantity: number | null
  deficitQuantity: number | null
  coveragePercent: number | null
  city: string
  department: string
  condition: string
  technicalValidationStatus: string
  documentCount: number
  assessmentCount: number
  passportPath: string | null
  inventoryPath: string | null
  classification: MatchClassification
  observedScore: number | null
  evaluableRatio: number
  geographyLevel: MatchEvaluation['geographyLevel']
  technicalState: MatchEvaluation['technicalState']
  unresolvedRequirements: string[]
  factors: MatchEvaluation['factors']
  explanation: string
  exclusionCode: string | null
  storedMatchId: number | null
  storedStale: boolean
  updatedAt: string
}

function decimal(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) {
    throw new AppError(500, 'INVALID_QUANTITY', 'Hay una cantidad que no se puede leer.')
  }
  return number
}

function specificationsOf(value: unknown): Specification[] {
  const source = typeof value === 'string' ? JSON.parse(value) as unknown : value
  if (!Array.isArray(source)) {
    return []
  }
  return source.flatMap((item) => {
    if (typeof item !== 'object' || item === null || !('name' in item) || !('value' in item)) {
      return []
    }
    const name = String(item.name).trim()
    const specValue = String(item.value).trim()
    return name && specValue ? [{ name, value: specValue }] : []
  })
}

async function loadNeed(userId: number, needId: number): Promise<NeedRow> {
  const rows = await queryRows<NeedRow>(
    getPool(),
    `SELECT n.id, n.title, n.description, n.category_id, n.unit_id, n.required_quantity, n.required_condition,
            n.city, n.department, n.status, n.specifications_json,
            p.id AS project_id, p.title AS project_title, p.status AS project_status, p.organization_id,
            o.name AS organization_name, c.name AS category_name, c.parent_category_id,
            u.code AS unit_code, u.name AS unit_name, mem.role AS role_name
     FROM project_material_needs n
     INNER JOIN projects p ON p.id = n.project_id
     INNER JOIN organizations o ON o.id = p.organization_id
     INNER JOIN material_categories c ON c.id = n.category_id
     INNER JOIN measurement_units u ON u.id = n.unit_id
     INNER JOIN organization_members mem
       ON mem.organization_id = p.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
     WHERE n.id = ?`,
    [userId, needId],
  )
  const need = rows[0]
  if (!need || !isMemberRole(need.role_name)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la necesidad.')
  }
  return need
}

function assertSearchable(need: NeedRow): void {
  if (need.project_status !== 'active' || !searchableNeedStatuses.has(need.status)) {
    throw new AppError(409, 'MATCHING_NOT_AVAILABLE', 'Solo se buscan materiales para una necesidad abierta de un proyecto activo.')
  }
}

async function loadCandidates(need: NeedRow): Promise<MaterialRow[]> {
  return queryRows<MaterialRow>(
    getPool(),
    `SELECT m.id, m.organization_id, o.name AS organization_name, m.title, m.category_id, c.name AS category_name,
            c.parent_category_id, m.unit_id, u.code AS unit_code, u.name AS unit_name, m.material_condition,
            m.city, m.department, m.availability_status, m.technical_validation_status,
            qs.available_quantity, p.visibility AS passport_visibility, p.public_code,
            COALESCE(docs.document_count, 0) AS document_count,
            COALESCE(reviews.assessment_count, 0) AS assessment_count,
            DATE_FORMAT(m.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM materials m
     INNER JOIN organizations o ON o.id = m.organization_id
     INNER JOIN material_categories c ON c.id = m.category_id
     INNER JOIN measurement_units u ON u.id = m.unit_id
     INNER JOIN material_quantity_summary qs ON qs.material_id = m.id
     LEFT JOIN material_passports p ON p.material_id = m.id
     LEFT JOIN (
       SELECT material_id, COUNT(*) AS document_count FROM material_documents GROUP BY material_id
     ) docs ON docs.material_id = m.id
     LEFT JOIN (
       SELECT material_id, COUNT(*) AS assessment_count FROM technical_assessments GROUP BY material_id
     ) reviews ON reviews.material_id = m.id
     WHERE m.availability_status = 'published'
       AND qs.available_quantity > 0
       AND (
         m.organization_id = ?
         OR (p.visibility = 'public' AND m.availability_status = 'published')
       )
     ORDER BY m.updated_at DESC, m.id DESC
     LIMIT ?`,
    [need.organization_id, candidateLimit],
  )
}

function fingerprint(need: NeedRow, material: MaterialRow, available: number): string {
  const payload = {
    need: {
      id: need.id,
      quantity: decimal(need.required_quantity),
      categoryId: need.category_id,
      unitId: need.unit_id,
      condition: need.required_condition,
      city: need.city,
      department: need.department,
      status: need.status,
      projectStatus: need.project_status,
      specifications: specificationsOf(need.specifications_json),
    },
    material: {
      id: material.id,
      available,
      categoryId: material.category_id,
      unitId: material.unit_id,
      condition: material.material_condition,
      city: material.city,
      department: material.department,
      status: material.availability_status,
      visibility: material.passport_visibility,
      technical: material.technical_validation_status,
    },
    version: matchingAlgorithmVersion,
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function relate(need: NeedRow, material: MaterialRow): { sameCategory: boolean; relatedCategory: boolean } {
  const sameCategory = need.category_id === material.category_id
  const relatedCategory = need.parent_category_id === material.category_id || material.parent_category_id === need.category_id
  return { sameCategory, relatedCategory }
}

function toCard(need: NeedRow, material: MaterialRow, evaluation: MatchEvaluation, stored: { id: number; fingerprint: string | null; stale: number } | undefined): MatchCard {
  const available = decimal(material.available_quantity)
  const sameOrganization = material.organization_id === need.organization_id
  const passportVisible = sameOrganization || material.passport_visibility === 'public'
  const currentFingerprint = fingerprint(need, material, available)
  return {
    materialId: material.id,
    title: material.title,
    organizationName: material.organization_name,
    sameOrganization,
    categoryName: material.category_name,
    unitCode: material.unit_code,
    unitName: material.unit_name,
    availableQuantity: available,
    requiredQuantity: decimal(need.required_quantity),
    usableQuantity: evaluation.usableQuantity,
    deficitQuantity: evaluation.deficitQuantity,
    coveragePercent: evaluation.coveragePercent,
    city: material.city,
    department: material.department,
    condition: material.material_condition,
    technicalValidationStatus: material.technical_validation_status,
    documentCount: Number(material.document_count),
    assessmentCount: Number(material.assessment_count),
    passportPath: passportVisible && material.public_code ? `/pasaporte/${material.public_code}` : null,
    inventoryPath: sameOrganization ? `/inventario/${material.id}` : null,
    classification: evaluation.classification,
    observedScore: evaluation.observedScore,
    evaluableRatio: evaluation.evaluableRatio,
    geographyLevel: evaluation.geographyLevel,
    technicalState: evaluation.technicalState,
    unresolvedRequirements: evaluation.unresolvedRequirements,
    factors: evaluation.factors,
    explanation: explainMatch(evaluation, material.unit_name),
    exclusionCode: evaluation.exclusionCode,
    storedMatchId: stored?.id ?? null,
    storedStale: stored ? stored.stale === 1 || stored.fingerprint !== currentFingerprint : false,
    updatedAt: material.updated_at,
  }
}

async function storedByMaterial(needId: number): Promise<Map<number, { id: number; fingerprint: string | null; stale: number }>> {
  const rows = await queryRows<RowDataPacket & { id: number; material_id: number; input_fingerprint: string | null; stale: number }>(
    getPool(),
    'SELECT id, material_id, input_fingerprint, stale FROM material_matches WHERE project_need_id = ?',
    [needId],
  )
  return new Map(rows.map((row) => [row.material_id, { id: row.id, fingerprint: row.input_fingerprint, stale: Number(row.stale) }]))
}

function evaluateVisible(need: NeedRow, materials: MaterialRow[], stored: Map<number, { id: number; fingerprint: string | null; stale: number }>) {
  const cards = materials.map((material) => {
    const relation = relate(need, material)
    const evaluation = evaluateMatch({
      sameCategory: relation.sameCategory,
      relatedCategory: relation.relatedCategory,
      sameUnit: need.unit_id === material.unit_id,
      requiredQuantity: decimal(need.required_quantity),
      availableQuantity: decimal(material.available_quantity),
      needCity: need.city,
      needDepartment: need.department,
      materialCity: material.city,
      materialDepartment: material.department,
      requiredCondition: need.required_condition,
      materialCondition: material.material_condition,
      specifications: specificationsOf(need.specifications_json),
      published: material.availability_status === 'published',
    })
    return { material, evaluation, card: toCard(need, material, evaluation, stored.get(material.id)) }
  })
  return cards
}

export async function calculateMatches(userId: number, needId: number, query: MatchQuery, persist: boolean) {
  const started = Date.now()
  const need = await loadNeed(userId, needId)
  assertSearchable(need)
  if (persist && !canWriteMaterials(need.role_name as MemberRole)) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para guardar esta evaluación.')
  }
  const materials = await loadCandidates(need)
  const stored = await storedByMaterial(needId)
  const evaluated = evaluateVisible(need, materials, stored)
  if (persist) {
    await persistEvaluations(userId, need, evaluated)
    const fresh = await storedByMaterial(needId)
    for (const item of evaluated) {
      const row = fresh.get(item.material.id)
      const available = decimal(item.material.available_quantity)
      item.card.storedMatchId = row?.id ?? null
      item.card.storedStale = row ? row.stale === 1 || row.fingerprint !== fingerprint(need, item.material, available) : false
    }
  }
  let matches = evaluated.filter((item) => item.evaluation.hardPass).map((item) => item.card)
  const excluded = evaluated.filter((item) => !item.evaluation.hardPass).map((item) => item.card)
  if (query.level) {
    matches = matches.filter((item) => item.classification === query.level)
  }
  if (query.minCoverage !== undefined) {
    matches = matches.filter((item) => (item.coveragePercent ?? -1) >= query.minCoverage!)
  }
  if (query.department) {
    const folded = foldText(query.department)
    matches = matches.filter((item) => foldText(item.department) === folded)
  }
  if (query.category) {
    const folded = foldText(query.category)
    matches = matches.filter((item) => foldText(item.categoryName).includes(folded))
  }
  if (query.pendingTechnical) {
    matches = matches.filter((item) => item.technicalState === 'unknown' || item.classification === 'insufficient')
  }
  if (query.sort === 'proximity' && matches.length > 0 && matches.every((item) => item.geographyLevel === 'unknown')) {
    throw new AppError(400, 'INSUFFICIENT_GEOGRAPHY', 'No hay ubicación suficiente para ordenar por cercanía.')
  }
  matches.sort((left, right) => compareMatches(query.sort, left, right))
  const total = matches.length
  const start = (query.page - 1) * query.pageSize
  return {
    algorithmVersion: matchingAlgorithmVersion,
    disclaimer: matchingDisclaimer,
    weights: matchingWeights,
    thresholds: matchingThresholds,
    persisted: persist,
    durationMs: Date.now() - started,
    truncated: materials.length >= candidateLimit,
    need: {
      id: need.id,
      title: need.title || need.description,
      projectId: need.project_id,
      projectTitle: need.project_title,
      organizationName: need.organization_name,
      categoryName: need.category_name,
      requiredQuantity: decimal(need.required_quantity),
      unitCode: need.unit_code,
      unitName: need.unit_name,
      city: need.city,
      department: need.department,
      status: need.status,
    },
    summary: {
      evaluated: evaluated.length,
      compatible: evaluated.filter((item) => item.evaluation.hardPass && item.evaluation.classification !== 'insufficient').length,
      insufficient: evaluated.filter((item) => item.evaluation.classification === 'insufficient').length,
      incompatible: excluded.length,
    },
    matches: matches.slice(start, start + query.pageSize),
    excluded: excluded.slice(0, 50),
    page: query.page,
    pageSize: query.pageSize,
    total,
  }
}

async function persistEvaluations(
  userId: number,
  need: NeedRow,
  evaluated: Array<{ material: MaterialRow; evaluation: MatchEvaluation; card: MatchCard }>,
): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.query('UPDATE material_matches SET stale = 1 WHERE project_need_id = ?', [need.id])
    for (const item of evaluated) {
      const available = decimal(item.material.available_quantity)
      const explanation = item.card.explanation.slice(0, 1000)
      await connection.query(
        `INSERT INTO material_matches (
           material_id, project_need_id, compatibility_score, compatibility_status, evaluation_method, explanation,
           evaluated_at, algorithm_version, classification, observed_score, evaluable_ratio, factors_json, narrative,
           coverage_percent, required_quantity, available_quantity, usable_quantity, deficit_quantity, input_fingerprint,
           stale, calculated_by_user_id
         ) VALUES (?, ?, ?, ?, 'rule_based', ?, CURRENT_TIMESTAMP(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON DUPLICATE KEY UPDATE
           compatibility_score = VALUES(compatibility_score),
           compatibility_status = VALUES(compatibility_status),
           evaluation_method = 'rule_based',
           explanation = VALUES(explanation),
           evaluated_at = CURRENT_TIMESTAMP(3),
           algorithm_version = VALUES(algorithm_version),
           classification = VALUES(classification),
           observed_score = VALUES(observed_score),
           evaluable_ratio = VALUES(evaluable_ratio),
           factors_json = VALUES(factors_json),
           narrative = VALUES(narrative),
           coverage_percent = VALUES(coverage_percent),
           required_quantity = VALUES(required_quantity),
           available_quantity = VALUES(available_quantity),
           usable_quantity = VALUES(usable_quantity),
           deficit_quantity = VALUES(deficit_quantity),
           input_fingerprint = VALUES(input_fingerprint),
           stale = 0,
           calculated_by_user_id = VALUES(calculated_by_user_id)`,
        [
          item.material.id,
          need.id,
          item.evaluation.compatibilityScore,
          item.evaluation.storedStatus,
          explanation,
          matchingAlgorithmVersion,
          item.evaluation.classification,
          item.evaluation.observedScore,
          item.evaluation.evaluableRatio,
          JSON.stringify(item.evaluation.factors),
          item.card.explanation,
          item.evaluation.coveragePercent,
          decimal(need.required_quantity),
          available,
          item.evaluation.usableQuantity,
          item.evaluation.deficitQuantity,
          fingerprint(need, item.material, available),
          userId,
        ],
      )
    }
    await insertRow(
      connection,
      `INSERT INTO matching_runs (project_need_id, actor_user_id, algorithm_version, candidate_count)
       VALUES (?, ?, ?, ?)`,
      [need.id, userId, matchingAlgorithmVersion, evaluated.length],
    )
  })
}

export async function getStoredMatch(userId: number, matchId: number) {
  const rows = await queryRows<RowDataPacket & {
    id: number
    material_id: number
    project_need_id: number
    stale: number
    input_fingerprint: string | null
    classification: string | null
    narrative: string | null
    observed_score: string | null
    compatibility_status: string
  }>(
    getPool(),
    `SELECT mm.id, mm.material_id, mm.project_need_id, mm.stale, mm.input_fingerprint, mm.classification,
            mm.narrative, mm.observed_score, mm.compatibility_status
     FROM material_matches mm
     INNER JOIN project_material_needs n ON n.id = mm.project_need_id
     INNER JOIN projects p ON p.id = n.project_id
     INNER JOIN organization_members mem
       ON mem.organization_id = p.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
     WHERE mm.id = ?`,
    [userId, matchId],
  )
  const row = rows[0]
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la coincidencia.')
  }
  if (Number(row.stale) === 1) {
    throw new AppError(409, 'STALE_MATCH', 'Esta evaluación quedó desactualizada. Calcula de nuevo la necesidad.')
  }
  const need = await loadNeed(userId, row.project_need_id)
  const materials = await loadCandidates(need)
  const material = materials.find((item) => item.id === row.material_id)
  if (!material) {
    throw new AppError(404, 'NOT_FOUND', 'El material ya no está disponible para esta consulta.')
  }
  if (row.input_fingerprint !== fingerprint(need, material, decimal(material.available_quantity))) {
    throw new AppError(409, 'STALE_MATCH', 'Los datos cambiaron después de esta evaluación.')
  }
  return {
    id: row.id,
    classification: row.classification,
    explanation: row.narrative,
    observedScore: row.observed_score === null ? null : decimal(row.observed_score),
    status: row.compatibility_status,
    disclaimer: matchingDisclaimer,
  }
}

export function matchingConfig() {
  return {
    algorithmVersion: matchingAlgorithmVersion,
    weights: matchingWeights,
    thresholds: matchingThresholds,
    disclaimer: matchingDisclaimer,
    editable: false,
  }
}
