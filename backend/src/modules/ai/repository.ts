import { randomBytes } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { getPool } from '../../config/database.js'
import { insertRow, queryRows } from '../../utils/sql.js'
import type { ActionKind } from './policy.js'

export type ConversationRecord = {
  id: number
  publicCode: string
  organizationId: number | null
  title: string
  moduleContext: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type MessageRecord = {
  id: number
  role: 'user' | 'assistant'
  basis: string
  content: string
  sourceNote: string | null
  createdAt: string
}

export type ProposalRecord = {
  id: number
  publicCode: string
  kind: ActionKind
  status: string
  summary: string
  payload: Record<string, unknown>
  confirmedAt: string | null
}

function code(prefix: 'cnv' | 'act'): string {
  return `${prefix}_${randomBytes(10).toString('hex')}`
}

function duplicate(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && String(error.code) === 'ER_DUP_ENTRY'
}

async function insertCoded(prefix: 'cnv' | 'act', statement: string, values: (publicCode: string) => unknown[]): Promise<number> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await insertRow(getPool(), statement, values(code(prefix)))
    } catch (error) {
      last = error
      if (!duplicate(error) || attempt === 2) throw error
    }
  }
  throw last
}

export async function assertOrganizationMember(userId: number, organizationId: number): Promise<void> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id FROM organization_members WHERE user_id = ? AND organization_id = ? AND membership_status = 'active'`,
    [userId, organizationId],
  )
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'No se encontró la organización.')
}

export async function createConversation(userId: number, input: { title: string; moduleContext: string | null; organizationId: number | null }): Promise<ConversationRecord> {
  if (input.organizationId !== null) await assertOrganizationMember(userId, input.organizationId)
  const id = await insertCoded(
    'cnv',
    `INSERT INTO ai_conversations (public_code, user_id, organization_id, title, module_context) VALUES (?, ?, ?, ?, ?)`,
    (publicCode) => [publicCode, userId, input.organizationId, input.title, input.moduleContext],
  )
  return conversationById(userId, id)
}

export async function listConversations(userId: number): Promise<ConversationRecord[]> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, public_code, organization_id, title, module_context, status,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 30`,
    [userId],
  )
  return rows.map(presentConversation)
}

export async function conversationById(userId: number, conversationId: number): Promise<ConversationRecord> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, public_code, organization_id, title, module_context, status,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_conversations WHERE id = ? AND user_id = ?`,
    [conversationId, userId],
  )
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'No se encontró la conversación.')
  return presentConversation(rows[0])
}

export async function listMessages(userId: number, conversationId: number): Promise<MessageRecord[]> {
  await conversationById(userId, conversationId)
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, role, basis, content, source_note, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM ai_messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 100`,
    [conversationId],
  )
  return rows.map(presentMessage)
}

export async function recentMessages(conversationId: number): Promise<MessageRecord[]> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, role, basis, content, source_note, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM ai_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 12`,
    [conversationId],
  )
  return rows.map(presentMessage).reverse()
}

export async function addMessage(conversationId: number, role: 'user' | 'assistant', basis: string, content: string, sourceNote: string | null): Promise<MessageRecord> {
  const id = await insertRow(
    getPool(),
    `INSERT INTO ai_messages (conversation_id, role, basis, content, source_note) VALUES (?, ?, ?, ?, ?)`,
    [conversationId, role, basis, content, sourceNote],
  )
  await getPool().query('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [conversationId])
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, role, basis, content, source_note, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at FROM ai_messages WHERE id = ?`,
    [id],
  )
  return presentMessage(rows[0]!)
}

export async function deleteConversation(userId: number, conversationId: number): Promise<void> {
  await conversationById(userId, conversationId)
  const pool = getPool()
  await pool.query(
    `DELETE feedback FROM ai_feedback feedback INNER JOIN ai_messages message ON message.id = feedback.message_id WHERE message.conversation_id = ?`,
    [conversationId],
  )
  await pool.query('DELETE FROM ai_tool_executions WHERE conversation_id = ?', [conversationId])
  await pool.query('DELETE FROM ai_action_proposals WHERE conversation_id = ?', [conversationId])
  await pool.query('DELETE FROM ai_messages WHERE conversation_id = ?', [conversationId])
  await pool.query('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?', [conversationId, userId])
  await insertRow(
    pool,
    `INSERT INTO ai_audit_events (user_id, action, subject_type, subject_id, description) VALUES (?, 'conversation_deleted', 'conversation', ?, ?)`,
    [userId, conversationId, 'El usuario eliminó su conversación.'],
  )
}

export async function countRecentUsage(userId: number, organizationId: number | null): Promise<{ user: number; organization: number }> {
  const userRows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total FROM ai_usage_records
     WHERE user_id = ? AND operation = 'chat' AND status = 'completed' AND created_at >= (NOW(3) - INTERVAL 1 HOUR)`,
    [userId],
  )
  if (organizationId === null) return { user: Number(userRows[0]?.total ?? 0), organization: 0 }
  const orgRows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT COUNT(*) AS total FROM ai_usage_records
     WHERE organization_id = ? AND operation = 'chat' AND status = 'completed' AND created_at >= (NOW(3) - INTERVAL 1 HOUR)`,
    [organizationId],
  )
  return { user: Number(userRows[0]?.total ?? 0), organization: Number(orgRows[0]?.total ?? 0) }
}

export async function recordUsage(input: {
  userId: number
  organizationId: number | null
  operation: 'chat' | 'material_suggestion' | 'project_suggestion' | 'matching_explain' | 'impact_explain'
  provider: string
  modelName: string | null
  inputTokens: number | null
  outputTokens: number | null
  status: 'completed' | 'not_configured' | 'limited' | 'error' | 'timeout'
}): Promise<void> {
  await insertRow(
    getPool(),
    `INSERT INTO ai_usage_records (
       user_id, organization_id, operation, provider, model_name, input_tokens, output_tokens, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.userId, input.organizationId, input.operation, input.provider, input.modelName, input.inputTokens, input.outputTokens, input.status],
  )
}

export async function recordUnknownTool(userId: number, organizationId: number | null): Promise<void> {
  await insertRow(
    getPool(),
    `INSERT INTO ai_audit_events (user_id, organization_id, action, subject_type, description)
     VALUES (?, ?, 'tool_denied', 'tool', ?)`,
    [userId, organizationId, 'Se rechazó una herramienta que no está en la lista permitida.'],
  )
}

export async function recordTool(input: {
  conversationId: number | null
  userId: number
  organizationId: number | null
  toolName: string
  status: 'ok' | 'denied' | 'error'
  rowCount: number | null
  errorCode: string | null
}): Promise<void> {
  await insertRow(
    getPool(),
    `INSERT INTO ai_tool_executions (conversation_id, user_id, organization_id, tool_name, status, row_count, error_code)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.conversationId, input.userId, input.organizationId, input.toolName, input.status, input.rowCount, input.errorCode],
  )
  if (input.status === 'denied') {
    await insertRow(
      getPool(),
      `INSERT INTO ai_audit_events (user_id, organization_id, action, subject_type, description)
       VALUES (?, ?, 'tool_denied', 'tool', ?)`,
      [input.userId, input.organizationId, `Se rechazó la herramienta ${input.toolName}.`],
    )
  }
}

export async function createProposal(userId: number, input: {
  organizationId: number | null
  conversationId: number | null
  kind: ActionKind
  summary: string
  payload: Record<string, unknown>
}): Promise<ProposalRecord> {
  if (input.organizationId !== null) await assertOrganizationMember(userId, input.organizationId)
  if (input.conversationId !== null) await conversationById(userId, input.conversationId)
  const id = await insertCoded(
    'act',
    `INSERT INTO ai_action_proposals (public_code, user_id, organization_id, conversation_id, kind, summary, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    (publicCode) => [publicCode, userId, input.organizationId, input.conversationId, input.kind, input.summary, JSON.stringify(input.payload)],
  )
  return proposalById(userId, id)
}

export async function proposalById(userId: number, proposalId: number): Promise<ProposalRecord> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT id, public_code, kind, status, summary, payload_json, DATE_FORMAT(confirmed_at, '%Y-%m-%d %H:%i:%s') AS confirmed_at
     FROM ai_action_proposals WHERE id = ? AND user_id = ?`,
    [proposalId, userId],
  )
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'No se encontró la propuesta.')
  return presentProposal(rows[0])
}

export async function setProposalStatus(userId: number, proposalId: number, status: 'confirmed' | 'discarded'): Promise<ProposalRecord> {
  const current = await proposalById(userId, proposalId)
  if (current.status !== 'proposed') throw new AppError(409, 'ACTION_ALREADY_RESOLVED', 'Esta propuesta ya fue revisada.')
  await getPool().query(
    `UPDATE ai_action_proposals SET status = ?, confirmed_at = IF(? = 'confirmed', CURRENT_TIMESTAMP(3), NULL) WHERE id = ? AND user_id = ? AND status = 'proposed'`,
    [status, status, proposalId, userId],
  )
  await insertRow(
    getPool(),
    `INSERT INTO ai_audit_events (user_id, action, subject_type, subject_id, description) VALUES (?, ?, 'action', ?, ?)`,
    [
      userId,
      status === 'confirmed' ? 'action_confirmed' : 'action_discarded',
      proposalId,
      status === 'confirmed'
        ? 'El usuario confirmó una propuesta de borrador. No se modificó inventario, acuerdos ni evidencias.'
        : 'El usuario descartó una propuesta.',
    ],
  )
  return proposalById(userId, proposalId)
}

export async function saveFeedback(userId: number, messageId: number, rating: 'helpful' | 'not_helpful', note: string | null): Promise<void> {
  const rows = await queryRows<RowDataPacket>(
    getPool(),
    `SELECT message.id FROM ai_messages message
     INNER JOIN ai_conversations conversation ON conversation.id = message.conversation_id
     WHERE message.id = ? AND conversation.user_id = ? AND message.role = 'assistant'`,
    [messageId, userId],
  )
  if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'No se encontró el mensaje.')
  await getPool().query(
    `INSERT INTO ai_feedback (message_id, user_id, rating, note) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), note = VALUES(note)`,
    [messageId, userId, rating, note],
  )
}

function presentConversation(row: RowDataPacket): ConversationRecord {
  return {
    id: Number(row.id),
    publicCode: String(row.public_code),
    organizationId: row.organization_id === null ? null : Number(row.organization_id),
    title: String(row.title),
    moduleContext: row.module_context === null ? null : String(row.module_context),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function presentMessage(row: RowDataPacket): MessageRecord {
  const role = row.role === 'assistant' ? 'assistant' : 'user'
  return {
    id: Number(row.id),
    role,
    basis: String(row.basis),
    content: String(row.content),
    sourceNote: row.source_note === null ? null : String(row.source_note),
    createdAt: String(row.created_at),
  }
}

function presentProposal(row: RowDataPacket): ProposalRecord {
  const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) as unknown : row.payload_json
  return {
    id: Number(row.id),
    publicCode: String(row.public_code),
    kind: String(row.kind) as ActionKind,
    status: String(row.status),
    summary: String(row.summary),
    payload: payload && typeof payload === 'object' ? payload as Record<string, unknown> : {},
    confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
  }
}
