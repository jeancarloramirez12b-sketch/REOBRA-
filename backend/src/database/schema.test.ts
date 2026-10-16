import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import type { PoolConnection } from 'mysql2/promise'
import '../config/env.js'
import { closePool, getPool } from '../config/database.js'
import { checkDatabaseConnection } from '../services/health.service.js'
import { migrateUp, rollbackLatest } from './migrator.js'
import { collectSchemaProblems } from './verify-schema.js'

const passwordHash = 'fase2-hash-not-a-password'

describe('esquema MySQL de REOBRA', { concurrency: 1 }, () => {
  after(async () => {
    await closePool()
  })

  test('las migraciones se aplican una sola vez', async () => {
    const first = await migrateUp()
    const second = await migrateUp()

    assert.equal(first.applied.length + first.skipped.length, 18)
    assert.deepEqual(second.applied, [])
    assert.equal(second.skipped.length, 18)
  })

  test('el esquema cumple el contrato', async () => {
    const problems = await collectSchemaProblems()
    assert.deepEqual(problems, [])
  })

  test('rechaza cantidades inválidas, emails duplicados y organizaciones inexistentes', async () => {
    const before = await countRows('users')

    await withRollback(async (connection) => {
      const userId = await insertUser(connection, uniqueEmail('cantidad'))
      const organizationId = await insertOrganization(connection, uniqueEmail('org-cantidad'))
      const categoryId = await insertCategory(connection)
      const unitId = await unitIdByCode(connection, 'kg')

      await expectRejected(
        () => insertMaterial(connection, { userId, organizationId, categoryId, unitId, quantity: -1 }),
        ['ER_CHECK_CONSTRAINT_VIOLATED'],
      )
      await expectRejected(
        () => insertMaterial(connection, { userId, organizationId, categoryId, unitId, quantity: 0 }),
        ['ER_CHECK_CONSTRAINT_VIOLATED'],
      )
      await expectRejected(
        () => insertUser(connection, uniqueEmail('corta'), 'clave-corta'),
        ['ER_CHECK_CONSTRAINT_VIOLATED'],
      )

      const email = uniqueEmail('duplicado')
      await insertUser(connection, email)
      await expectRejected(() => insertUser(connection, email), ['ER_DUP_ENTRY'])
      await expectRejected(
        () => insertMaterial(connection, { userId, organizationId: 999999999, categoryId, unitId, quantity: 2 }),
        ['ER_NO_REFERENCED_ROW_2'],
      )
    })

    assert.equal(await countRows('users'), before)
  })

  test('relaciona materiales, proyectos, solicitudes, entregas e impacto sin dejar datos', async () => {
    const materialsBefore = await countRows('materials')
    const impactBefore = await countRows('impact_records')

    await withRollback(async (connection) => {
      const graph = await insertGraph(connection)
      await connection.query(
        `UPDATE material_passports
         SET version = 2, origin_description = 'Origen revisado dentro de la prueba.'
         WHERE id = ?`,
        [graph.passportId],
      )
      await connection.query(
        `INSERT INTO material_passport_revisions (
           passport_id, version, origin_description, issued_at
         ) VALUES (?, 1, 'Sobrante de obra registrado en la prueba.', CURRENT_TIMESTAMP(3))`,
        [graph.passportId],
      )
      await expectRejected(
        () =>
          connection.query(
            `INSERT INTO material_passport_revisions (
               passport_id, version, origin_description, issued_at
             ) VALUES (?, 1, 'Intento duplicado de la misma versión.', CURRENT_TIMESTAMP(3))`,
            [graph.passportId],
          ),
        ['ER_DUP_ENTRY'],
      )

      const [summary] = await connection.query<RowDataPacket[]>(
        `SELECT published_quantity, delivered_quantity, committed_quantity, available_quantity
         FROM material_quantity_summary WHERE material_id = ?`,
        [graph.materialId],
      )
      assert.equal(Number(summary[0]?.published_quantity), 10)
      assert.equal(Number(summary[0]?.delivered_quantity), 1)
      assert.equal(Number(summary[0]?.committed_quantity), 3)
      assert.equal(Number(summary[0]?.available_quantity), 6)

      await expectRejected(
        () =>
          connection.query(
            `INSERT INTO material_matches (
               material_id, project_need_id, compatibility_score, compatibility_status, evaluation_method
             ) VALUES (?, ?, 80, 'pending', 'manual')`,
            [graph.otherMaterialId, graph.needId],
          ),
        ['ER_CHECK_CONSTRAINT_VIOLATED'],
      )
    })

    assert.equal(await countRows('materials'), materialsBefore)
    assert.equal(await countRows('impact_records'), impactBefore)
  })

  test('la vista puede revertirse y volver a aplicarse', async () => {
    try {
      const assistant = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(assistant.version, '0018')
      const impact = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(impact.version, '0017')
      const operations = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(operations.version, '0016')
      const matching = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(matching.version, '0015')
      const projects = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(projects.version, '0014')
      const repaired = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(repaired.version, '0013')
      const organizations = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(organizations.version, '0012')
      const passports = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(passports.version, '0011')
      const catalog = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(catalog.version, '0010')
      const identity = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(identity.version, '0009')
      const result = await rollbackLatest({ confirm: true, discardData: false })
      assert.equal(result.version, '0008')
      const problemsWhileReverted = await collectSchemaProblems()
      assert.ok(problemsWhileReverted.some((problem) => problem.includes('material_quantity_summary')))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      assert.match(message, /eliminaría filas/)
      assert.match(message, /sessions|organization_invitations|material_documents|project_events|matching_runs|request_events|operation_documents|ai_conversations|ai_messages|ai_usage_records|ai_action_proposals/)
    } finally {
      await migrateUp()
    }

    assert.deepEqual(await collectSchemaProblems(), [])
  })

  test('la comprobación de MySQL sigue respondiendo', async () => {
    const result = await checkDatabaseConnection()
    assert.deepEqual(result, { status: 'ok' })
  })
})

function opaquePublicCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let body = ''
  for (let index = 0; index < 20; index += 1) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `rob_${body}`
}

function uniqueEmail(label: string): string {
  return `fase2-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code)
  }
  return ''
}

async function expectRejected(run: () => Promise<unknown>, codes: string[]): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    const code = errorCode(error)
    assert.ok(codes.includes(code), `código recibido: ${code || 'sin código'}`)
    return true
  })
}

async function withRollback(run: (connection: PoolConnection) => Promise<void>): Promise<void> {
  const connection = await getPool().getConnection()
  try {
    await connection.beginTransaction()
    await run(connection)
    await connection.rollback()
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      // La conexión ya no tiene una transacción activa.
    }
    throw error
  } finally {
    connection.release()
  }
}

async function countRows(table: string): Promise<number> {
  const [rows] = await getPool().query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``)
  return Number(rows[0]?.total ?? 0)
}

async function insert(connection: PoolConnection, sql: string, params: unknown[]): Promise<number> {
  const [result] = await connection.query<ResultSetHeader>(sql, params)
  return Number(result.insertId)
}

async function insertUser(connection: PoolConnection, email: string, hash = passwordHash): Promise<number> {
  return insert(
    connection,
    `INSERT INTO users (full_name, email, password_hash, account_status)
     VALUES ('Persona de prueba', ?, ?, 'active')`,
    [email, hash],
  )
}

async function insertOrganization(connection: PoolConnection, email: string): Promise<number> {
  return insert(
    connection,
    `INSERT INTO organizations (
       name, organization_type, contact_email, city, department, country, verification_status
     ) VALUES ('Organización de prueba', 'company', ?, 'Bogotá', 'Bogotá D.C.', 'CO', 'unverified')`,
    [email],
  )
}

async function insertCategory(connection: PoolConnection): Promise<number> {
  return insert(
    connection,
    'INSERT INTO material_categories (name, description) VALUES (?, ?)',
    [`Categoría ${Date.now()}-${Math.floor(Math.random() * 100000)}`, 'Categoría temporal de prueba'],
  )
}

async function unitIdByCode(connection: PoolConnection, code: string): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM measurement_units WHERE code = ?', [code])
  const id = Number(rows[0]?.id)
  assert.ok(id > 0)
  return id
}

async function insertMaterial(
  connection: PoolConnection,
  input: { userId: number; organizationId: number; categoryId: number; unitId: number; quantity: number },
): Promise<number> {
  return insert(
    connection,
    `INSERT INTO materials (
       organization_id, created_by_user_id, category_id, unit_id, title, description,
       quantity, origin_type, city, department, availability_status, technical_validation_status
     ) VALUES (?, ?, ?, ?, 'Material de prueba', 'Descripción temporal', ?, 'construction', 'Bogotá', 'Bogotá D.C.', 'published', 'pending')`,
    [input.organizationId, input.userId, input.categoryId, input.unitId, input.quantity],
  )
}

async function insertGraph(connection: PoolConnection): Promise<{
  materialId: number
  otherMaterialId: number
  passportId: number
  needId: number
  requestId: number
  deliveryId: number
  unitId: number
}> {
  const userId = await insertUser(connection, uniqueEmail('grafo'))
  const organizationId = await insertOrganization(connection, uniqueEmail('org-grafo'))
  await insert(
    connection,
    `INSERT INTO organization_members (organization_id, user_id, role, membership_status)
     VALUES (?, ?, 'owner', 'active')`,
    [organizationId, userId],
  )
  const categoryId = await insertCategory(connection)
  const unitId = await unitIdByCode(connection, 'kg')
  const materialId = await insertMaterial(connection, { userId, organizationId, categoryId, unitId, quantity: 10 })
  const otherMaterialId = await insertMaterial(connection, {
    userId,
    organizationId,
    categoryId,
    unitId,
    quantity: 5,
  })
  const passportId = await insert(
    connection,
    `INSERT INTO material_passports (material_id, public_code, origin_description)
     VALUES (?, ?, 'Sobrante de obra registrado en la prueba.')`,
    [materialId, opaquePublicCode()],
  )
  await insert(
    connection,
    `INSERT INTO material_trace_events (material_id, actor_user_id, event_type, description, event_timestamp)
     VALUES (?, ?, 'registered', 'Registro temporal de prueba.', CURRENT_TIMESTAMP(3))`,
    [materialId, userId],
  )
  await insert(
    connection,
    `INSERT INTO technical_assessments (
       material_id, assessor_user_id, assessment_type, result, observations, assessed_at
     ) VALUES (?, ?, 'visual', 'insufficient_information', 'Falta información para un uso concreto.', CURRENT_TIMESTAMP(3))`,
    [materialId, userId],
  )
  const projectId = await insert(
    connection,
    `INSERT INTO projects (
       organization_id, created_by_user_id, title, project_type, city, department, status
     ) VALUES (?, ?, 'Proyecto de prueba', 'construction', 'Bogotá', 'Bogotá D.C.', 'active')`,
    [organizationId, userId],
  )
  const needId = await insert(
    connection,
    `INSERT INTO project_material_needs (
       project_id, category_id, unit_id, description, required_quantity, status
     ) VALUES (?, ?, ?, 'Necesidad temporal', 8, 'open')`,
    [projectId, categoryId, unitId],
  )
  await insert(
    connection,
    `INSERT INTO material_matches (
       material_id, project_need_id, compatibility_status, evaluation_method, explanation
     ) VALUES (?, ?, 'not_evaluated', 'manual', 'Aún no hay evaluación de compatibilidad.')`,
    [materialId, needId],
  )
  const requestId = await insert(
    connection,
    `INSERT INTO material_requests (
       material_id, requesting_organization_id, project_id, requested_quantity, status
     ) VALUES (?, ?, ?, 4, 'accepted')`,
    [materialId, organizationId, projectId],
  )
  const deliveryId = await insert(
    connection,
    `INSERT INTO deliveries (request_id, delivered_at, delivered_quantity, status)
     VALUES (?, CURRENT_TIMESTAMP(3), 1, 'delivered')`,
    [requestId],
  )
  const impactId = await insert(
    connection,
    `INSERT INTO impact_records (
       material_id, delivery_id, impact_type, measured_value, measurement_unit_id,
       calculation_method, verification_status, recorded_at
     ) VALUES (?, ?, 'mass_recovered', 1, ?, 'mass-balance-v1', 'estimated', CURRENT_TIMESTAMP(3))`,
    [materialId, deliveryId, unitId],
  )
  await insert(
    connection,
    `INSERT INTO impact_evidence (impact_record_id, evidence_type, storage_reference, uploaded_by_user_id)
     VALUES (?, 'document', 'evidence/fase2/prueba.txt', ?)`,
    [impactId, userId],
  )

  return { materialId, otherMaterialId, passportId, needId, requestId, deliveryId, unitId }
}
