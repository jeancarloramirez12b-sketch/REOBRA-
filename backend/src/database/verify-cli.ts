import '../config/env.js'
import { collectSchemaProblems } from './verify-schema.js'

try {
  const problems = await collectSchemaProblems()
  if (problems.length === 0) {
    console.log('El esquema de REOBRA cumple las comprobaciones definidas.')
  } else {
    for (const problem of problems) {
      console.error(problem)
    }
    process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo verificar el esquema.')
  process.exitCode = 1
}
