import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { AppError } from '../../errors/AppError.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { getAuth, requireSession } from '../../middleware/requireSession.js'
import { parseOperationKey } from '../passports/validation.js'
import {
  addMassParameter,
  approveMethodology,
  calculateImpact,
  calculationDetail,
  correctReceipt,
  createFactor,
  createMethodology,
  exportReport,
  impactOverview,
  impactTimeline,
  issueReport,
  listFactors,
  listIndicatorDefinitions,
  listMethodologies,
  organizationImpact,
  projectImpact,
  reportDetail,
  updateFactorStatus,
} from './impact.service.js'
import {
  parseCalculation,
  parseCorrection,
  parseFactor,
  parseFactorStatus,
  parseImpactQuery,
  parseMassParameter,
  parseMethodology,
  parseReport,
} from './validation.js'

function resourceId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !/^[1-9]\d*$/.test(raw)) throw new AppError(404, 'NOT_FOUND', 'No se encontró el recurso.')
  return Number(raw)
}

function operationKey(header: string | undefined, suffix: string): string {
  const parsed = parseOperationKey(header)
  return parsed ? `${parsed}-${suffix}` : `op${randomBytes(12).toString('hex')}-${suffix}`
}

export function createImpactRouter(secureCookies: boolean): Router {
  const router = Router()
  const session = requireSession(secureCookies)

  router.get('/overview', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await impactOverview(getAuth(res).id, parseImpactQuery(req.query as Record<string, unknown>)) })
  }))
  router.get('/indicators', session, asyncHandler(async (_req, res) => {
    res.json({ success: true, data: listIndicatorDefinitions() })
  }))
  router.get('/materials', session, asyncHandler(async (req, res) => {
    const overview = await impactOverview(getAuth(res).id, parseImpactQuery(req.query as Record<string, unknown>))
    res.json({ success: true, data: { receivedByUnit: overview.receivedByUnit, dispatchedByUnit: overview.dispatchedByUnit, limitation: overview.limitation } })
  }))
  router.get('/timeline', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await impactTimeline(getAuth(res).id, parseImpactQuery(req.query as Record<string, unknown>)) })
  }))
  router.get('/methodologies', session, asyncHandler(async (req, res) => {
    const organizationId = typeof req.query.organizationId === 'string' && /^[1-9]\d*$/.test(req.query.organizationId) ? Number(req.query.organizationId) : undefined
    res.json({ success: true, data: await listMethodologies(getAuth(res).id, organizationId) })
  }))
  router.post('/methodologies', session, asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await createMethodology(getAuth(res).id, parseMethodology(req.body)) })
  }))
  router.post('/methodologies/:methodologyId/approve', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await approveMethodology(getAuth(res).id, resourceId(req.params.methodologyId)) })
  }))
  router.get('/factors', session, asyncHandler(async (req, res) => {
    const organizationId = typeof req.query.organizationId === 'string' && /^[1-9]\d*$/.test(req.query.organizationId) ? Number(req.query.organizationId) : undefined
    res.json({ success: true, data: await listFactors(getAuth(res).id, organizationId) })
  }))
  router.post('/factors', session, asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await createFactor(getAuth(res).id, parseFactor(req.body)) })
  }))
  router.patch('/factors/:factorId', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await updateFactorStatus(getAuth(res).id, resourceId(req.params.factorId), parseFactorStatus(req.body).status) })
  }))
  router.post('/mass-parameters', session, asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await addMassParameter(getAuth(res).id, parseMassParameter(req.body)) })
  }))
  router.post('/calculations', session, asyncHandler(async (req, res) => {
    const result = await calculateImpact(getAuth(res).id, parseCalculation(req.body), operationKey(req.get('idempotency-key'), 'calc'))
    res.status(201).json({ success: true, data: result })
  }))
  router.get('/calculations/:calculationId', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await calculationDetail(getAuth(res).id, resourceId(req.params.calculationId)) })
  }))
  router.post('/reports', session, asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await issueReport(getAuth(res).id, parseReport(req.body), operationKey(req.get('idempotency-key'), 'report')) })
  }))
  router.get('/reports/:reportId/export', session, asyncHandler(async (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : req.query.format === 'pdf' ? 'pdf' : null
    if (!format) throw new AppError(400, 'INVALID_INPUT', 'El formato debe ser pdf o csv.')
    const file = await exportReport(getAuth(res).id, resourceId(req.params.reportId), format)
    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(file.body)
  }))
  router.get('/reports/:reportId', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await reportDetail(getAuth(res).id, resourceId(req.params.reportId)) })
  }))
  router.get('/projects/:projectId', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await projectImpact(getAuth(res).id, resourceId(req.params.projectId), parseImpactQuery(req.query as Record<string, unknown>)) })
  }))
  router.get('/organizations/:organizationId', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await organizationImpact(getAuth(res).id, resourceId(req.params.organizationId), parseImpactQuery(req.query as Record<string, unknown>)) })
  }))
  router.post('/receipts/:deliveryId/corrections', session, asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await correctReceipt(getAuth(res).id, resourceId(req.params.deliveryId), parseCorrection(req.body), operationKey(req.get('idempotency-key'), 'correct')),
    })
  }))

  return router
}
