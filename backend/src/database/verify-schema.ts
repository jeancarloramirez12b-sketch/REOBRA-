import type { Connection, RowDataPacket } from 'mysql2/promise'
import { checksumMatches, migrationsDirectory, readMigrationDirectory, withSqlConnection } from './migrator.js'
import {
  referenceUnitCodes,
  requiredChecks,
  requiredForeignKeys,
  requiredIndexes,
  requiredTables,
  requiredUniqueKeys,
  requiredViews,
  developmentDatabaseName,
} from './schema-contract.js'

export async function verifySchema(connection: Connection): Promise<string[]> {
  const problems: string[] = []
  const [databaseRows] = await connection.query<RowDataPacket[]>(
    'SELECT DATABASE() AS db_name, @@character_set_database AS charset_name',
  )
  const database = databaseRows[0]
  if (database?.db_name !== developmentDatabaseName) {
    problems.push(`La base conectada no es ${developmentDatabaseName}.`)
  }
  if (!String(database?.charset_name ?? '').startsWith('utf8mb4')) {
    problems.push('La base no usa utf8mb4.')
  }

  const [tables] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_TYPE
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`,
  )
  const tableInfo = new Map(tables.map((row) => [String(row.TABLE_NAME).toLowerCase(), row]))

  for (const name of requiredTables) {
    const row = tableInfo.get(name)
    if (!row || row.TABLE_TYPE !== 'BASE TABLE') {
      problems.push(`Falta la tabla ${name}.`)
      continue
    }
    if (String(row.ENGINE).toUpperCase() !== 'INNODB') {
      problems.push(`La tabla ${name} no usa InnoDB.`)
    }
    if (!String(row.TABLE_COLLATION).toLowerCase().startsWith('utf8mb4')) {
      problems.push(`La tabla ${name} no usa utf8mb4.`)
    }
  }

  for (const name of requiredViews) {
    const row = tableInfo.get(name)
    if (!row || row.TABLE_TYPE !== 'VIEW') {
      problems.push(`Falta la vista ${name}.`)
    }
  }

  const [checks] = await connection.query<RowDataPacket[]>(
    'SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()',
  )
  const checkNames = new Set(checks.map((row) => String(row.CONSTRAINT_NAME).toLowerCase()))
  for (const name of requiredChecks) {
    if (!checkNames.has(name)) {
      problems.push(`Falta la restricción ${name}.`)
    }
  }

  const [indexes] = await connection.query<RowDataPacket[]>(
    'SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()',
  )
  const indexNames = new Set(indexes.map((row) => String(row.INDEX_NAME).toLowerCase()))
  for (const name of [...requiredUniqueKeys, ...requiredIndexes]) {
    if (!indexNames.has(name)) {
      problems.push(`Falta el índice ${name}.`)
    }
  }

  const [foreignKeys] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
  )
  const foreignKeyNames = new Set(
    foreignKeys.map(
      (row) =>
        `${String(row.TABLE_NAME).toLowerCase()}.${String(row.COLUMN_NAME).toLowerCase()}->${String(row.REFERENCED_TABLE_NAME).toLowerCase()}.${String(row.REFERENCED_COLUMN_NAME).toLowerCase()}`,
    ),
  )
  for (const name of requiredForeignKeys) {
    if (!foreignKeyNames.has(name)) {
      problems.push(`Falta la clave foránea ${name}.`)
    }
  }

  if (tableInfo.has('measurement_units')) {
    const [units] = await connection.query<RowDataPacket[]>('SELECT code FROM measurement_units')
    const codes = units.map((row) => String(row.code)).sort()
    const expected = [...referenceUnitCodes].sort()
    if (codes.join(',') !== expected.join(',')) {
      problems.push('El catálogo de unidades no coincide con el conjunto de referencia.')
    }
  }

  if (tableInfo.has('schema_migrations')) {
    const files = await readMigrationDirectory(migrationsDirectory)
    const [applied] = await connection.query<RowDataPacket[]>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    )
    if (applied.length !== files.length) {
      problems.push(`Hay ${applied.length} migraciones registradas y ${files.length} archivos.`)
    }
    const appliedByVersion = new Map(applied.map((row) => [String(row.version), String(row.checksum)]))
    for (const file of files) {
      const checksum = appliedByVersion.get(file.version)
      if (checksum && !checksumMatches(file.sql, checksum)) {
        problems.push(`La migración ${file.version} no coincide con el archivo actual.`)
      }
    }
  }

  return problems
}

export async function collectSchemaProblems(): Promise<string[]> {
  return withSqlConnection((connection) => verifySchema(connection))
}
