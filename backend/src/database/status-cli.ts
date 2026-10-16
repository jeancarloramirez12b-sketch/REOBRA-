import '../config/env.js'
import { migrationStatus } from './migrator.js'

try {
  const status = await migrationStatus()
  if (status.applied.length === 0 && status.pending.length === 0) {
    console.log('No hay archivos de migración.')
  }

  for (const row of status.applied) {
    console.log(`${row.version}  aplicada  ${row.appliedAt}  ${row.name}`)
  }
  for (const file of status.pending) {
    console.log(`${file.version}  pendiente  ${file.name}`)
  }
  for (const file of status.drifted) {
    console.error(`${file.version}  modificada después de aplicarse`)
  }

  if (status.drifted.length > 0) {
    process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo consultar el estado de las migraciones.')
  process.exitCode = 1
}
