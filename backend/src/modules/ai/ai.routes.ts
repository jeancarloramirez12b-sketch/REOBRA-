import { Router } from 'express'
import { AppError } from '../../errors/AppError.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { getAuth, requireSession } from '../../middleware/requireSession.js'
import {
  chat,
  confirmAction,
  conversationDetail,
  discardAction,
  explainImpact,
  explainMatching,
  previewAction,
  serviceStatus,
  suggestMaterial,
  suggestProject,
} from './gateway.js'
import { createConversation, deleteConversation, listConversations, saveFeedback } from './repository.js'
import {
  parseActionPreview,
  parseChat,
  parseConversation,
  parseFeedback,
  parseImpactExplain,
  parseMatchingExplain,
  parseMaterialSuggestion,
  parseProjectSuggestion,
} from './validation.js'

function resourceId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !/^[1-9]\d*$/.test(raw)) throw new AppError(404, 'NOT_FOUND', 'No se encontró el recurso.')
  return Number(raw)
}

export function createAiRouter(secureCookies: boolean): Router {
  const router = Router()
  const session = requireSession(secureCookies)

  router.get('/status', session, asyncHandler(async (_req, res) => {
    res.json({ success: true, data: serviceStatus() })
  }))

  router.post('/chat', session, asyncHandler(async (req, res) => {
    const input = parseChat(req.body)
    res.json({ success: true, data: await chat(getAuth(res).id, {
      message: input.message,
      conversationId: input.conversationId,
      moduleContext: input.moduleContext ?? null,
      organizationId: input.organizationId ?? null,
    }) })
  }))

  router.get('/conversations', session, asyncHandler(async (_req, res) => {
    res.json({ success: true, data: { conversations: await listConversations(getAuth(res).id) } })
  }))

  router.post('/conversations', session, asyncHandler(async (req, res) => {
    const input = parseConversation(req.body ?? {})
    const conversation = await createConversation(getAuth(res).id, {
      title: input.title ?? 'Conversación nueva',
      moduleContext: input.moduleContext ?? null,
      organizationId: input.organizationId ?? null,
    })
    res.status(201).json({ success: true, data: { conversation } })
  }))

  router.get('/conversations/:id', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await conversationDetail(getAuth(res).id, resourceId(req.params.id)) })
  }))

  router.delete('/conversations/:id', session, asyncHandler(async (req, res) => {
    await deleteConversation(getAuth(res).id, resourceId(req.params.id))
    res.json({ success: true, data: { deleted: true } })
  }))

  router.post('/materials/suggestions', session, asyncHandler(async (req, res) => {
    const input = parseMaterialSuggestion(req.body)
    const { organizationId, ...fields } = input
    res.json({ success: true, data: await suggestMaterial(getAuth(res).id, organizationId ?? null, fields) })
  }))

  router.post('/projects/suggestions', session, asyncHandler(async (req, res) => {
    const input = parseProjectSuggestion(req.body)
    const { organizationId, ...fields } = input
    res.json({ success: true, data: await suggestProject(getAuth(res).id, organizationId ?? null, fields) })
  }))

  router.post('/matching/explain', session, asyncHandler(async (req, res) => {
    const input = parseMatchingExplain(req.body)
    res.json({ success: true, data: await explainMatching(getAuth(res).id, input.needId, input.materialId) })
  }))

  router.post('/impact/explain', session, asyncHandler(async (req, res) => {
    const input = parseImpactExplain(req.body)
    res.json({ success: true, data: await explainImpact(getAuth(res).id, input) })
  }))

  router.post('/actions/preview', session, asyncHandler(async (req, res) => {
    const proposal = await previewAction(getAuth(res).id, parseActionPreview(req.body))
    res.status(201).json({ success: true, data: { proposal } })
  }))

  router.post('/actions/:id/confirm', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await confirmAction(getAuth(res).id, resourceId(req.params.id)) })
  }))

  router.post('/actions/:id/discard', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: { proposal: await discardAction(getAuth(res).id, resourceId(req.params.id)) } })
  }))

  router.post('/feedback', session, asyncHandler(async (req, res) => {
    const input = parseFeedback(req.body)
    await saveFeedback(getAuth(res).id, input.messageId, input.rating, input.note ?? null)
    res.json({ success: true, data: { saved: true } })
  }))

  return router
}
