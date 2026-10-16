import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checksumMatches, checksumSql, migrationsDirectory, readMigrationDirectory, rollbacksDirectory } from './migrator.js'
import { splitSqlScript } from './sql-script.js'

test('cada migración tiene reversión y secuencia continua', async () => {
  const migrations = await readMigrationDirectory(migrationsDirectory)
  const rollbacks = await readMigrationDirectory(rollbacksDirectory)

  assert.deepEqual(
    migrations.map((file) => file.version),
    rollbacks.map((file) => file.version),
  )
  assert.ok(migrations.length >= 8)
})

test('el script opcional de disparadores no parte sus enunciados', async () => {
  const optionalPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../database/optional/integrity-triggers.sql',
  )
  const sql = await readFile(optionalPath, 'utf8')
  const triggers = splitSqlScript(sql).filter((statement) => /CREATE\s+TRIGGER/i.test(statement))

  assert.equal(triggers.length, 6)
  for (const trigger of triggers) {
    assert.match(trigger, /\bBEGIN\b/i)
    assert.match(trigger, /\bEND\s*$/i)
  }
})

test('un archivo LF coincide con el checksum guardado en CRLF', () => {
  const sql = 'SELECT 1;\n'
  assert.equal(checksumMatches(sql, checksumSql(sql.replace(/\n/g, '\r\n'))), true)
  assert.equal(checksumMatches(`${sql}SELECT 2;\n`, checksumSql(sql)), false)
})

test('las migraciones no incluyen credenciales', async () => {
  const migrations = await readMigrationDirectory(migrationsDirectory)
  const rollbacks = await readMigrationDirectory(rollbacksDirectory)
  const combined = [...migrations, ...rollbacks].map((file) => file.sql).join('\n')

  assert.equal(/IDENTIFIED\s+BY/i.test(combined), false)
  assert.equal(/DB_PASSWORD\s*=/.test(combined), false)
  assert.equal(/password_hash\s+VARCHAR/i.test(combined), true)
})
