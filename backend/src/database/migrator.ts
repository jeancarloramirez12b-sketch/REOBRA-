import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import { readDatabaseConfig } from '../config/database.js'
import { developmentDatabaseName } from './schema-contract.js'
import { splitSqlScript } from './sql-script.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const lockName = 'reobra_schema_migration'
const filePattern = /^(\d{4})_([a-z0-9_]+)\.sql$/

export const migrationsDirectory = path.join(backendRoot, 'database', 'migrations')
export const rollbacksDirectory = path.join(backendRoot, 'database', 'rollbacks')

export type MigrationFile = {
  version: string
  name: string
  filename: string
  sql: string
  checksum: string
}

export type AppliedMigration = {
  version: string
  name: string
  checksum: string
  appliedAt: string
}

export type MigrationStatus = {
  applied: AppliedMigration[]
  pending: MigrationFile[]
  drifted: MigrationFile[]
}

type AppliedRow = RowDataPacket & {
  version: string
  name: string
  checksum: string
  applied_at: string
}

export function checksumSql(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

export function checksumMatches(sql: string, stored: string): boolean {
  if (checksumSql(sql) === stored) {
    return true
  }

  const lf = sql.replace(/\r\n/g, '\n')
  const crlf = lf.replace(/\n/g, '\r\n')
  return checksumSql(lf) === stored || checksumSql(crlf) === stored
}

export function assertDevelopmentDatabase(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Las migraciones están bloqueadas cuando NODE_ENV=production.')
  }

  const databaseName = env.DB_NAME?.trim()
  const allowedNames =
    env.NODE_ENV === 'test' ? [developmentDatabaseName, 'reobra_test'] : [developmentDatabaseName]
  if (!databaseName || !allowedNames.includes(databaseName)) {
    throw new Error(`Las migraciones solo se ejecutan sobre la base ${allowedNames.join(' o ')}.`)
  }
}

export async function readMigrationDirectory(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory)
  const filenames = entries.filter((name) => filePattern.test(name)).sort((left, right) => left.localeCompare(right))
  const versions = new Set<string>()
  const migrations: MigrationFile[] = []

  for (const filename of filenames) {
    const match = filePattern.exec(filename)
    const version = match?.[1]
    const name = match?.[2]
    if (!version || !name) {
      throw new Error(`Nombre de migración no válido: ${filename}`)
    }
    if (versions.has(version)) {
      throw new Error(`Versión de migración duplicada: ${version}`)
    }
    versions.add(version)

    const sql = (await readFile(path.join(directory, filename), 'utf8')).replace(/^\uFEFF/, '')
    migrations.push({
      version,
      name,
      filename,
      sql,
      checksum: checksumSql(sql),
    })
  }

  migrations.forEach((migration, index) => {
    const expected = String(index + 1).padStart(4, '0')
    if (migration.version !== expected) {
      throw new Error(`La secuencia de migraciones se interrumpe en ${migration.filename}.`)
    }
  })

  return migrations
}

export async function withSqlConnection<T>(run: (connection: Connection) => Promise<T>): Promise<T> {
  assertDevelopmentDatabase()
  const config = readDatabaseConfig()
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: 'utf8mb4',
    connectTimeout: 5000,
    multipleStatements: false,
    dateStrings: true,
  })

  try {
    return await run(connection)
  } finally {
    await connection.end()
  }
}

async function withMigrationLock<T>(run: (connection: Connection) => Promise<T>): Promise<T> {
  return withSqlConnection(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 30) AS lock_status', [lockName])
    if (Number(rows[0]?.lock_status) !== 1) {
      throw new Error('Otra migración está en curso o no se pudo obtener el bloqueo.')
    }

    try {
      return await run(connection)
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName])
    }
  })
}

async function ensureMigrationsTable(connection: Connection): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(32) NOT NULL,
      name VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

async function loadApplied(connection: Connection): Promise<AppliedMigration[]> {
  const [rows] = await connection.query<AppliedRow[]>(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
  )

  return rows.map((row) => ({
    version: row.version,
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }))
}

function assertNoDrift(files: MigrationFile[], applied: AppliedMigration[]): void {
  const filesByVersion = new Map(files.map((file) => [file.version, file]))

  for (const row of applied) {
    const file = filesByVersion.get(row.version)
    if (!file) {
      throw new Error(`La migración aplicada ${row.version} ya no tiene archivo.`)
    }
    if (!checksumMatches(file.sql, row.checksum)) {
      throw new Error(`La migración ${row.version} cambió después de aplicarse. No se continúa.`)
    }
  }
}

function mysqlErrorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code)
    const message = 'message' in error ? String(error.message).replace(/\s+/g, ' ').slice(0, 400) : ''
    return `${code}: ${message}`
  }

  return 'Error desconocido de MySQL.'
}

async function executeScript(connection: Connection, file: MigrationFile, label: string): Promise<void> {
  const statements = splitSqlScript(file.sql)
  if (statements.length === 0) {
    throw new Error(`La migración ${file.version} no contiene enunciados.`)
  }

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]
    if (!statement) {
      continue
    }

    try {
      await connection.query(statement)
    } catch (error) {
      throw new Error(
        `${label} ${file.version} (${file.filename}) se detuvo en el enunciado ${index + 1} de ${statements.length}. ${mysqlErrorText(error)}`,
      )
    }
  }
}

export async function migrationStatus(): Promise<MigrationStatus> {
  const files = await readMigrationDirectory(migrationsDirectory)
  return withMigrationLock(async (connection) => {
    await ensureMigrationsTable(connection)
    const applied = await loadApplied(connection)
    const appliedByVersion = new Map(applied.map((row) => [row.version, row]))

    return {
      applied,
      pending: files.filter((file) => !appliedByVersion.has(file.version)),
      drifted: files.filter((file) => {
        const row = appliedByVersion.get(file.version)
        return row !== undefined && !checksumMatches(file.sql, row.checksum)
      }),
    }
  })
}

export async function migrateUp(): Promise<{ applied: string[]; skipped: string[] }> {
  const files = await readMigrationDirectory(migrationsDirectory)
  return withMigrationLock(async (connection) => {
    await ensureMigrationsTable(connection)
    const applied = await loadApplied(connection)
    assertNoDrift(files, applied)
    const appliedVersions = new Set(applied.map((row) => row.version))
    const result = { applied: [] as string[], skipped: [] as string[] }

    for (const file of files) {
      if (appliedVersions.has(file.version)) {
        result.skipped.push(file.version)
        continue
      }

      await executeScript(connection, file, 'La migración')
      await connection.query('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)', [
        file.version,
        file.name,
        file.checksum,
      ])
      result.applied.push(file.version)
    }

    return result
  })
}

export type RollbackOptions = {
  confirm: boolean
  discardData: boolean
}

function droppedTables(sql: string): string[] {
  const names: string[] = []
  const pattern = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([a-z0-9_]+)`?/gi
  for (const match of sql.matchAll(pattern)) {
    const name = match[1]
    if (name) {
      names.push(name)
    }
  }
  return names
}

async function tablesWithRows(connection: Connection, tables: string[]): Promise<string[]> {
  const occupied: string[] = []

  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table)) {
      throw new Error('La reversión contiene un nombre de tabla no válido.')
    }

    const [existing] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [table],
    )
    if (Number(existing[0]?.total ?? 0) === 0) {
      continue
    }

    const [counts] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\``)
    if (Number(counts[0]?.total ?? 0) > 0) {
      occupied.push(table)
    }
  }

  return occupied
}

export async function rollbackLatest(options: RollbackOptions): Promise<{ version: string; occupied: string[] }> {
  const migrations = await readMigrationDirectory(migrationsDirectory)
  const rollbacks = await readMigrationDirectory(rollbacksDirectory)

  return withMigrationLock(async (connection) => {
    await ensureMigrationsTable(connection)
    const applied = await loadApplied(connection)
    const latest = applied.at(-1)
    if (!latest) {
      throw new Error('No hay migraciones aplicadas para revertir.')
    }

    const migration = migrations.find((file) => file.version === latest.version)
    const rollback = rollbacks.find((file) => file.version === latest.version)
    if (!migration || !rollback) {
      throw new Error(`No existe reversión para la versión ${latest.version}.`)
    }
    if (!checksumMatches(migration.sql, latest.checksum)) {
      throw new Error(`La migración ${latest.version} cambió después de aplicarse. No se revierte.`)
    }

    const tables = droppedTables(rollback.sql)
    const occupied = await tablesWithRows(connection, tables)
    if (!options.confirm) {
      const occupancy = occupied.length > 0 ? ` Hay filas en: ${occupied.join(', ')}.` : ' Las tablas afectadas no tienen filas.'
      throw new Error(`La reversión de ${latest.version} no se ejecutó. Hace falta --confirm.${occupancy}`)
    }
    if (occupied.length > 0 && !options.discardData) {
      throw new Error(
        `La reversión de ${latest.version} eliminaría filas en: ${occupied.join(', ')}. No se ejecutó.`,
      )
    }

    await executeScript(connection, rollback, 'La reversión')
    await connection.query('DELETE FROM schema_migrations WHERE version = ?', [latest.version])
    return { version: latest.version, occupied }
  })
}
