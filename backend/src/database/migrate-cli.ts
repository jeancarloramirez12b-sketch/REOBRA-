import '../config/env.js'
import { migrateUp } from './migrator.js'

try {
  const result = await migrateUp()
  if (result.applied.length === 0) {
    console.log(`No había migraciones pendientes. ${result.skipped.length} ya estaban aplicadas.`)
  } else {
    console.log(`Migraciones aplicadas: ${result.applied.join(', ')}.`)
    console.log(`Migraciones ya existentes: ${result.skipped.length}.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudieron ejecutar las migraciones.')
  process.exitCode = 1
}
