import { createApp } from './app.js'
import { closePool } from './config/database.js'
import { getConfig } from './config/env.js'

function start(): void {
  let config
  try {
    config = getConfig()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Configuración inválida del backend.'
    console.error(message)
    process.exit(1)
  }

  const app = createApp(config)
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`REOBRA backend escuchando en http://localhost:${config.port}`)
  })

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`El puerto ${config.port} ya está en uso.`)
    } else {
      console.error('No se pudo iniciar el servidor.')
    }
    process.exit(1)
  })

  let shuttingDown = false

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    console.log(`Cerrando REOBRA backend (${signal})...`)

    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })

    try {
      await closePool()
    } catch {
      console.error('No se pudo cerrar el pool de MySQL de forma ordenada.')
    }

    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

start()
