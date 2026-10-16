import { AppError } from '../../errors/AppError.js'
import { indicatorDefinitions } from '../impact/indicators.js'
import { impactOverview } from '../impact/impact.service.js'
import { calculateMatches } from '../matching/matching.service.js'
import { listCategories } from '../materials/material.service.js'
import { getAiConfig, unconfiguredMessage, type AiConfig } from './config.js'
import { narrateImpact, narrateMatch } from './explainers.js'
import {
  actionKinds,
  isAllowedTool,
  parseModelOutput,
  systemPrompt,
  validateAnswer,
  wrapUntrusted,
  type ActionKind,
  type ModelOutput,
} from './policy.js'
import { resolveProvider, type AiProvider, type ChatTurn } from './provider.js'
import {
  addMessage,
  conversationById,
  countRecentUsage,
  createConversation,
  createProposal,
  listMessages,
  proposalById,
  recentMessages,
  recordTool,
  recordUnknownTool,
  recordUsage,
  setProposalStatus,
} from './repository.js'
import { buildMaterialSuggestion, buildProjectSuggestion } from './suggestions.js'
import { runTool } from './tools.js'
import { parseActionPayload, type ActionPreview } from './validation.js'

const inflight = new Map<number, number>()

export function serviceStatus() {
  const config = getAiConfig()
  const provider = resolveProvider(config)
  const configured = provider !== null
  return {
    configured,
    provider: configured ? provider.name : 'none',
    model: config.configured ? config.model : null,
    state: configured ? 'available' : 'not_configured',
    message: configured ? 'Servicio de inteligencia artificial disponible.' : unconfiguredMessage(),
  }
}

export async function chat(userId: number, input: {
  message: string
  conversationId?: number
  moduleContext: string | null
  organizationId: number | null
}) {
  const config = getAiConfig()
  if (input.message.length > config.maxInputChars) {
    throw new AppError(400, 'AI_INPUT_LIMIT', `El mensaje no puede superar ${config.maxInputChars} caracteres.`)
  }
  const provider = resolveProvider(config)
  let organizationId = input.organizationId
  if (!provider) {
    await recordUsage({
      userId,
      organizationId: input.organizationId,
      operation: 'chat',
      provider: 'none',
      modelName: null,
      inputTokens: null,
      outputTokens: null,
      status: 'not_configured',
    })
    throw new AppError(503, 'AI_NOT_CONFIGURED', unconfiguredMessage())
  }
  acquire(userId)
  try {
    const conversation = input.conversationId
      ? await conversationById(userId, input.conversationId)
      : await createConversation(userId, {
          title: input.message.slice(0, 80),
          moduleContext: input.moduleContext,
          organizationId: input.organizationId,
        })
    organizationId = conversation.organizationId
    const usage = await countRecentUsage(userId, conversation.organizationId)
    if (usage.user >= config.userHourlyLimit || (conversation.organizationId !== null && usage.organization >= config.orgHourlyLimit)) {
      await recordUsage({
        userId,
        organizationId: conversation.organizationId,
        operation: 'chat',
        provider: provider.name,
        modelName: config.model,
        inputTokens: null,
        outputTokens: null,
        status: 'limited',
      })
      throw new AppError(429, 'AI_LIMIT', 'Se alcanzó el límite de consultas de esta hora.')
    }
    await addMessage(conversation.id, 'user', 'user_request', input.message, null)
    const history = await recentMessages(conversation.id)
    const turns: ChatTurn[] = [
      { role: 'system', content: systemPrompt() },
      ...history.map((item) => ({ role: item.role, content: item.content.slice(0, 1000) })),
    ]
    const first = await complete(provider, config, turns)
    let parsed = parseModelOutput(first.text)
    const toolNotes = await executeTools(userId, conversation.id, conversation.organizationId, parsed)
    if (toolNotes.length > 0) {
      const second = await complete(provider, config, [
        ...turns,
        { role: 'user', content: wrapUntrusted('resultados_de_herramientas', toolNotes) },
      ])
      const followed = parseModelOutput(second.text)
      parsed = { ...followed, toolCalls: [] }
      first.inputTokens = sum(first.inputTokens, second.inputTokens)
      first.outputTokens = sum(first.outputTokens, second.outputTokens)
    }
    const answer = validateAnswer(parsed.answer, config.apiKey)
    const sourceNote = parsed.sources.map((item) => `${item.kind}: ${item.label}`).join(' · ').slice(0, 500) || null
    const message = await addMessage(conversation.id, 'assistant', parsed.basis, answer, sourceNote)
    const proposals = await storeProposals(userId, conversation.id, conversation.organizationId, parsed)
    await recordUsage({
      userId,
      organizationId: conversation.organizationId,
      operation: 'chat',
      provider: provider.name,
      modelName: config.configured ? config.model : provider.name,
      inputTokens: first.inputTokens,
      outputTokens: first.outputTokens,
      status: 'completed',
    })
    return { conversation, message, sources: parsed.sources, proposals }
  } catch (error) {
    if (error instanceof AppError && (error.code === 'AI_TIMEOUT' || error.code === 'AI_PROVIDER_ERROR')) {
      await recordUsage({
        userId,
        organizationId,
        operation: 'chat',
        provider: provider.name,
        modelName: null,
        inputTokens: null,
        outputTokens: null,
        status: error.code === 'AI_TIMEOUT' ? 'timeout' : 'error',
      }).catch(() => undefined)
      throw error
    }
    if (error instanceof AppError) throw error
    await recordUsage({
      userId,
      organizationId,
      operation: 'chat',
      provider: provider.name,
      modelName: null,
      inputTokens: null,
      outputTokens: null,
      status: 'error',
    }).catch(() => undefined)
    throw new AppError(502, 'AI_PROVIDER_ERROR', 'El proveedor de inteligencia artificial no respondió. Inténtalo de nuevo.')
  } finally {
    release(userId)
  }
}

export async function conversationDetail(userId: number, conversationId: number) {
  const conversation = await conversationById(userId, conversationId)
  const messages = await listMessages(userId, conversationId)
  return { conversation, messages }
}

export async function suggestMaterial(userId: number, organizationId: number | null, input: Parameters<typeof buildMaterialSuggestion>[0]) {
  const categories = await listCategories()
  const suggestion = buildMaterialSuggestion(input, categories)
  await recordUsage({
    userId,
    organizationId,
    operation: 'material_suggestion',
    provider: 'rules',
    modelName: null,
    inputTokens: null,
    outputTokens: null,
    status: 'completed',
  })
  return suggestion
}

export async function suggestProject(userId: number, organizationId: number | null, input: Parameters<typeof buildProjectSuggestion>[0]) {
  const suggestion = buildProjectSuggestion(input)
  await recordUsage({
    userId,
    organizationId,
    operation: 'project_suggestion',
    provider: 'rules',
    modelName: null,
    inputTokens: null,
    outputTokens: null,
    status: 'completed',
  })
  return suggestion
}

export async function explainMatching(userId: number, needId: number, materialId: number) {
  const report = await calculateMatches(userId, needId, { page: 1, pageSize: 20, sort: 'coverage', pendingTechnical: false }, false)
  const card = [...report.matches, ...report.excluded].find((item) => item.materialId === materialId)
  if (!card) throw new AppError(404, 'NOT_FOUND', 'Ese material no está en el resultado autorizado del matching.')
  const narrative = narrateMatch({
    title: card.title,
    availableQuantity: card.availableQuantity,
    requiredQuantity: card.requiredQuantity,
    unitName: card.unitName,
    coveragePercent: card.coveragePercent,
    observedScore: card.observedScore,
    classification: card.classification,
    explanation: card.explanation,
    hardPass: card.exclusionCode === null,
    technicalValidationStatus: card.technicalValidationStatus,
  })
  await recordUsage({
    userId,
    organizationId: null,
    operation: 'matching_explain',
    provider: 'rules',
    modelName: null,
    inputTokens: null,
    outputTokens: null,
    status: 'completed',
  })
  return {
    ...narrative,
    algorithmVersion: report.algorithmVersion,
    coveragePercent: card.coveragePercent,
    observedScore: card.observedScore,
    availableQuantity: card.availableQuantity,
    requiredQuantity: card.requiredQuantity,
    unitName: card.unitName,
    classification: card.classification,
  }
}

export async function explainImpact(userId: number, input: { organizationId?: number; projectId?: number; indicator?: string }) {
  const overview = await impactOverview(userId, input)
  const indicator = indicatorDefinitions.find((item) => item.code === input.indicator) ?? null
  const environmentalMessage = overview.environmental.status === 'estimated'
    ? `${overview.environmental.value} ${overview.environmental.unit}. ${overview.environmental.message}`
    : overview.environmental.message
  const narrative = narrateImpact({
    receivedByUnit: overview.receivedByUnit,
    massStatus: overview.mass.status,
    massMessage: overview.mass.message,
    environmentalStatus: overview.environmental.status,
    environmentalMessage,
    indicator,
  })
  await recordUsage({
    userId,
    organizationId: input.organizationId ?? null,
    operation: 'impact_explain',
    provider: 'rules',
    modelName: null,
    inputTokens: null,
    outputTokens: null,
    status: 'completed',
  })
  return {
    ...narrative,
    receivedByUnit: overview.receivedByUnit,
    mass: overview.mass,
    environmental: overview.environmental,
    incorporation: overview.incorporation,
  }
}

export async function previewAction(userId: number, input: ActionPreview) {
  const payload = parseActionPayload(input.kind, input.payload)
  return createProposal(userId, {
    organizationId: input.organizationId,
    conversationId: input.conversationId ?? null,
    kind: input.kind,
    summary: input.summary,
    payload,
  })
}

export async function confirmAction(userId: number, proposalId: number) {
  const proposal = await setProposalStatus(userId, proposalId, 'confirmed')
  return {
    proposal,
    applied: false,
    message: 'La propuesta quedó confirmada para que la revises en el formulario. No se modificó inventario, acuerdos, entregas, evidencias ni permisos.',
  }
}

export async function discardAction(userId: number, proposalId: number) {
  return setProposalStatus(userId, proposalId, 'discarded')
}

export async function readProposal(userId: number, proposalId: number) {
  return proposalById(userId, proposalId)
}

async function executeTools(userId: number, conversationId: number, organizationId: number | null, parsed: ModelOutput) {
  const notes: unknown[] = []
  for (const call of parsed.toolCalls) {
    if (!isAllowedTool(call.name)) {
      await recordUnknownTool(userId, organizationId)
      notes.push({ name: 'rechazada', error: 'TOOL_NOT_ALLOWED' })
      continue
    }
    try {
      const result = await runTool(userId, call.name, call.arguments)
      await recordTool({
        conversationId,
        userId,
        organizationId,
        toolName: call.name,
        status: 'ok',
        rowCount: result.rows.length,
        errorCode: null,
      })
      notes.push({ name: call.name, summary: result.summary, rows: result.rows })
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'TOOL_ERROR'
      await recordTool({
        conversationId,
        userId,
        organizationId,
        toolName: call.name,
        status: code === 'TOOL_NOT_ALLOWED' ? 'denied' : 'error',
        rowCount: null,
        errorCode: code,
      })
      notes.push({ name: call.name, error: code })
    }
  }
  return notes
}

async function storeProposals(userId: number, conversationId: number, organizationId: number | null, parsed: ModelOutput) {
  const stored = []
  for (const proposal of parsed.proposals) {
    if (!(actionKinds as readonly string[]).includes(proposal.kind)) continue
    try {
      const payload = parseActionPayload(proposal.kind as ActionKind, proposal.payload)
      stored.push(await createProposal(userId, {
        organizationId,
        conversationId,
        kind: proposal.kind as ActionKind,
        summary: proposal.summary,
        payload,
      }))
    } catch {
      // Una propuesta mal formada no se guarda ni se ejecuta.
    }
  }
  return stored
}

async function complete(provider: AiProvider, config: AiConfig, turns: ChatTurn[]) {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AppError(504, 'AI_TIMEOUT', 'El proveedor tardó demasiado en responder.')), config.timeoutMs)
  })
  try {
    return await Promise.race([
      provider.complete(turns, {
        timeoutMs: config.timeoutMs,
        maxOutputTokens: config.maxOutputTokens,
        model: config.model,
      }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

function acquire(userId: number) {
  const current = inflight.get(userId) ?? 0
  if (current >= 2) throw new AppError(429, 'AI_CONCURRENCY', 'Ya hay consultas del asistente en curso.')
  inflight.set(userId, current + 1)
}

function release(userId: number) {
  const current = (inflight.get(userId) ?? 1) - 1
  if (current <= 0) inflight.delete(userId)
  else inflight.set(userId, current)
}

function sum(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null
  return (left ?? 0) + (right ?? 0)
}
