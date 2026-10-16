import type { RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { queryRows } from '../../utils/sql.js'
import { impactOverview } from '../impact/impact.service.js'
import { calculateMatches } from '../matching/matching.service.js'
import { getMaterial, listCategories, listMaterials } from '../materials/material.service.js'
import { materialQuerySchema } from '../materials/validation.js'
import { narrateMatch } from './explainers.js'
import { clip, isAllowedTool, type ToolName } from './policy.js'

export type ToolResult = { rows: unknown[]; summary: string }

const memberOrganizations = `SELECT organization_id FROM organization_members WHERE user_id = ? AND membership_status = 'active'`

export async function runTool(userId: number, name: string, args: Record<string, string | number | boolean>): Promise<ToolResult> {
  if (!isAllowedTool(name)) {
    throw new AppError(400, 'TOOL_NOT_ALLOWED', 'Esa herramienta no está permitida.')
  }
  if ('sql' in args || 'query' in args) {
    throw new AppError(400, 'TOOL_NOT_ALLOWED', 'La herramienta no acepta consultas.')
  }
  return executors[name](userId, args)
}

const executors: Record<ToolName, (userId: number, args: Record<string, string | number | boolean>) => Promise<ToolResult>> = {
  async list_materials(userId, args) {
    const query = materialQuerySchema.parse({ q: typeof args.q === 'string' ? args.q : undefined, page: 1, pageSize: 5 })
    const result = await listMaterials(userId, query)
    const rows = result.materials.map((item) => ({
      id: item.id,
      title: item.title,
      categoryName: item.categoryName,
      quantity: item.quantity,
      availableQuantity: item.availableQuantity,
      unitCode: item.unitCode,
      city: item.city,
      availabilityStatus: item.availabilityStatus,
      description: clip(item.description ?? '', 180),
    }))
    return { rows, summary: `${rows.length} materiales visibles para el usuario.` }
  },
  async get_material(userId, args) {
    const material = await getMaterial(userId, requiredId(args.materialId))
    return {
      rows: [{
        id: material.id,
        title: material.title,
        categoryName: material.categoryName,
        quantity: material.quantity,
        availableQuantity: material.availableQuantity,
        unitCode: material.unitCode,
        condition: material.materialCondition,
        city: material.city,
        department: material.department,
        availabilityStatus: material.availabilityStatus,
        technicalValidationStatus: material.technicalValidationStatus,
        description: clip(material.description ?? '', 240),
      }],
      summary: 'Ficha autorizada del material.',
    }
  },
  async get_passport(userId, args) {
    const rows = await queryRows<RowDataPacket>(
      getPool(),
      `SELECT p.public_code, p.version, p.visibility
       FROM material_passports p
       INNER JOIN materials m ON m.id = p.material_id
       INNER JOIN organization_members mem
         ON mem.organization_id = m.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
       WHERE p.material_id = ?`,
      [userId, requiredId(args.materialId)],
    )
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'No se encontró el pasaporte.')
    return {
      rows: [{ publicCode: String(rows[0].public_code), version: Number(rows[0].version), visibility: String(rows[0].visibility) }],
      summary: 'Identificador del pasaporte. No incluye documentos ni evaluaciones.',
    }
  },
  async list_projects(userId) {
    const rows = await queryRows<RowDataPacket>(
      getPool(),
      `SELECT p.id, p.title, p.status, p.city, p.department
       FROM projects p
       INNER JOIN organization_members mem
         ON mem.organization_id = p.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
       ORDER BY p.updated_at DESC, p.id DESC
       LIMIT 8`,
      [userId],
    )
    return { rows: rows.map(presentProject), summary: `${rows.length} proyectos de las organizaciones del usuario.` }
  },
  async list_needs(userId, args) {
    const rows = await queryRows<RowDataPacket>(
      getPool(),
      `SELECT n.id, n.title, n.status, n.required_quantity, u.code AS unit_code, c.name AS category_name
       FROM project_material_needs n
       INNER JOIN projects p ON p.id = n.project_id
       INNER JOIN material_categories c ON c.id = n.category_id
       INNER JOIN measurement_units u ON u.id = n.unit_id
       INNER JOIN organization_members mem
         ON mem.organization_id = p.organization_id AND mem.user_id = ? AND mem.membership_status = 'active'
       WHERE n.project_id = ?
       ORDER BY n.id DESC
       LIMIT 8`,
      [userId, requiredId(args.projectId)],
    )
    return { rows: rows.map(presentNeed), summary: `${rows.length} necesidades del proyecto autorizado.` }
  },
  async list_requests(userId) {
    const rows = await queryRows<RowDataPacket>(
      getPool(),
      `SELECT r.public_code, r.status, r.requested_quantity, m.title, u.code AS unit_code
       FROM material_requests r
       INNER JOIN materials m ON m.id = r.material_id
       INNER JOIN measurement_units u ON u.id = m.unit_id
       WHERE r.requesting_organization_id IN (${memberOrganizations})
          OR m.organization_id IN (${memberOrganizations})
       ORDER BY r.id DESC
       LIMIT 8`,
      [userId, userId],
    )
    return { rows: rows.map(presentRequest), summary: `${rows.length} solicitudes de las organizaciones del usuario.` }
  },
  async list_deliveries(userId) {
    const rows = await queryRows<RowDataPacket>(
      getPool(),
      `SELECT d.public_code, d.status, d.delivered_quantity, d.received_quantity, u.code AS unit_code
       FROM deliveries d
       INNER JOIN material_requests r ON r.id = d.request_id
       INNER JOIN materials m ON m.id = r.material_id
       INNER JOIN measurement_units u ON u.id = m.unit_id
       WHERE r.requesting_organization_id IN (${memberOrganizations})
          OR m.organization_id IN (${memberOrganizations})
       ORDER BY d.id DESC
       LIMIT 8`,
      [userId, userId],
    )
    return {
      rows: rows.map((row) => ({
        publicCode: String(row.public_code),
        status: String(row.status),
        deliveredQuantity: Number(row.delivered_quantity),
        receivedQuantity: row.received_quantity === null ? null : Number(row.received_quantity),
        unitCode: String(row.unit_code),
      })),
      summary: `${rows.length} entregas de las organizaciones del usuario.`,
    }
  },
  async explain_need_matches(userId, args) {
    const report = await calculateMatches(userId, requiredId(args.needId), {
      page: 1,
      pageSize: 5,
      sort: 'coverage',
      pendingTechnical: false,
    }, false)
    const materialId = optionalId(args.materialId)
    const cards = [...report.matches, ...report.excluded].filter((item) => materialId === null || item.materialId === materialId).slice(0, 5)
    const rows = cards.map((item) => ({
      title: item.title,
      availableQuantity: item.availableQuantity,
      requiredQuantity: item.requiredQuantity,
      coveragePercent: item.coveragePercent,
      observedScore: item.observedScore,
      ...narrateMatch({
        title: item.title,
        availableQuantity: item.availableQuantity,
        requiredQuantity: item.requiredQuantity,
        unitName: item.unitName,
        coveragePercent: item.coveragePercent,
        observedScore: item.observedScore,
        classification: item.classification,
        explanation: item.explanation,
        hardPass: item.exclusionCode === null,
        technicalValidationStatus: item.technicalValidationStatus,
      }),
    }))
    return { rows, summary: 'Explicación tomada del motor de matching, sin recalcular puntajes.' }
  },
  async impact_overview(userId, args) {
    const overview = await impactOverview(userId, {
      organizationId: optionalId(args.organizationId) ?? undefined,
      projectId: optionalId(args.projectId) ?? undefined,
    })
    return {
      rows: [{
        receivedByUnit: overview.receivedByUnit,
        mass: overview.mass,
        environmental: overview.environmental,
        incorporation: overview.incorporation,
        limitation: overview.limitation,
      }],
      summary: 'Indicadores del motor de impacto para las organizaciones del usuario.',
    }
  },
  async list_categories() {
    const categories = await listCategories()
    return {
      rows: categories.slice(0, 20).map((item) => ({ id: item.id, name: item.name })),
      summary: 'Categorías existentes del catálogo.',
    }
  },
}

function requiredId(value: unknown): number {
  const parsed = optionalId(value)
  if (parsed === null) throw new AppError(400, 'INVALID_TOOL_ARGUMENT', 'Falta un identificador válido.')
  return parsed
}

function optionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AppError(400, 'INVALID_TOOL_ARGUMENT', 'El identificador no es válido.')
  return parsed
}

function presentProject(row: RowDataPacket) {
  return { id: Number(row.id), title: String(row.title), status: String(row.status), city: String(row.city), department: String(row.department) }
}

function presentNeed(row: RowDataPacket) {
  return {
    id: Number(row.id),
    title: String(row.title),
    status: String(row.status),
    requiredQuantity: Number(row.required_quantity),
    unitCode: String(row.unit_code),
    categoryName: String(row.category_name),
  }
}

function presentRequest(row: RowDataPacket) {
  return {
    publicCode: String(row.public_code),
    status: String(row.status),
    requestedQuantity: Number(row.requested_quantity),
    title: String(row.title),
    unitCode: String(row.unit_code),
  }
}
