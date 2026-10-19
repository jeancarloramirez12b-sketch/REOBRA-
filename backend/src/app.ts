import { exec } from 'child_process'
import path from 'path'
import cors from 'cors'
import express from 'express'
import type { AppConfig } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFoundHandler } from './middleware/notFoundHandler.js'
import { requireSession } from './middleware/requireSession.js'
import { securityHeaders } from './middleware/securityHeaders.js'
import { createAuthRouter, createUsersRouter } from './modules/auth/auth.routes.js'
import { createCategoriesRouter, createMaterialsRouter, createUnitsRouter } from './modules/materials/material.routes.js'
import { createPassportsRouter } from './modules/passports/passport.routes.js'
import { createMatchRouter, createMatchingConfigRouter, createNeedMatchRouter } from './modules/matching/matching.routes.js'
import { createAiRouter } from './modules/ai/ai.routes.js'
import { createImpactRouter } from './modules/impact/impact.routes.js'
import { createNotificationRouter, createOperationsRouter } from './modules/operations/operations.routes.js'
import { createNeedsRouter, createProjectsRouter } from './modules/projects/project.routes.js'
import { createInvitationsRouter, createOrganizationsRouter } from './modules/organizations/organization.routes.js'
import { healthRouter } from './routes/health.routes.js'

export function createApp(config: AppConfig) {
  const app = express()
  const secureCookies = config.nodeEnv === 'production'

  app.locals.frontendOrigin = config.frontendOrigin
  app.disable('x-powered-by')
  app.use(securityHeaders)
  app.use(express.json({ limit: '1mb' }))
  app.use(
    cors({
      origin: config.frontendOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'X-CSRF-Token', 'Idempotency-Key'],
    }),
  )

  app.use('/api/health', healthRouter)
  app.use('/api/auth', createAuthRouter(secureCookies))
  app.use('/api/users', requireSession(secureCookies), createUsersRouter())
  app.use('/api/organizations', requireSession(secureCookies), createOrganizationsRouter())
  app.use('/api/invitations', requireSession(secureCookies), createInvitationsRouter())
  app.use('/api/materials', requireSession(secureCookies), createMaterialsRouter())
  app.use('/api/passports', createPassportsRouter(secureCookies))
  app.use('/api/projects', createProjectsRouter(secureCookies))
  app.use('/api/needs', createNeedsRouter(secureCookies))
  app.use('/api/needs', createNeedMatchRouter(secureCookies))
  app.use('/api/matches', createMatchRouter(secureCookies))
  app.use('/api/matching', createMatchingConfigRouter(secureCookies))
  app.use('/api/material-requests', createOperationsRouter(secureCookies))
  app.use('/api/notifications', createNotificationRouter(secureCookies))
  app.use('/api/impact', createImpactRouter(secureCookies))
  app.use('/api/ai', createAiRouter(secureCookies))
  app.use('/api/material-categories', requireSession(secureCookies), createCategoriesRouter())
  app.use('/api/measurement-units', requireSession(secureCookies), createUnitsRouter())
  app.use(notFoundHandler)
  app.use(errorHandler) 
   // RUTA TEMPORAL PARA MIGRACIONES EN RENDER
app.get('/api/run-migrations', (req, res) => {
  // Ejecutamos el comando de migración
  exec('npm run db:migrate', (error, stdout, stderr) => {
    if (error) {
      console.error(`Error ejecutando migraciones: ${error.message}`)
      return res.status(500).json({ error: error.message, details: stderr })
    }
    console.log(`Migraciones ejecutadas: ${stdout}`)
    res.json({ success: true, output: stdout })
  })
})
// FIN DE LA RUTA TEMPORAL

return app
  
  return app
}
