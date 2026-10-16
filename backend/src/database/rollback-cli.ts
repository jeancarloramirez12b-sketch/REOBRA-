import '../config/env.js'
import { rollbackLatest } from './migrator.js'

const confirm = process.argv.includes('--confirm')
const discardData = process.argv.includes('--discard-data')

try {
  const result = await rollbackLatest({ confirm, discardData })
  console.log(`Reversión aplicada: ${result.version}.`)
  if (result.occupied.length > 0) {
    console.log(`Se eliminaron filas de: ${result.occupied.join(', ')}.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo revertir la última migración.')
  process.exitCode = 1
}
