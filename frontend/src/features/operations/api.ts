import { api } from '../auth/api.ts'
import type { MaterialRequest, OperationDetail, RequestContext } from './types.ts'

export function listRequests(query: { box: string; q: string; page: number }) {
  const params = new URLSearchParams({ box: query.box, page: String(query.page) })
  if (query.q.trim()) params.set('q', query.q.trim())
  return api<{ requests: MaterialRequest[]; page: number; pageSize: number; total: number }>(`/api/material-requests?${params.toString()}`)
}

export function requestContext(materialId: string, needId: string) {
  return api<RequestContext>(`/api/material-requests/context?materialId=${encodeURIComponent(materialId)}&needId=${encodeURIComponent(needId)}`)
}

export function createRequest(input: { materialId: number; needId: number; quantity: number; message?: string }, idempotencyKey: string) {
  return api<OperationDetail>('/api/material-requests', { method: 'POST', body: input, idempotencyKey })
}

export function getOperation(requestId: string) {
  return api<OperationDetail>(`/api/material-requests/${requestId}`)
}

export function postAction(requestId: string, action: string, body: unknown, idempotencyKey: string) {
  return api<OperationDetail>(`/api/material-requests/${requestId}/${action}`, { method: 'POST', body, idempotencyKey })
}

export function receiveDelivery(requestId: string, deliveryId: number, body: unknown, idempotencyKey: string) {
  return api<OperationDetail>(`/api/material-requests/${requestId}/deliveries/${deliveryId}/receive`, { method: 'POST', body, idempotencyKey })
}

export function uploadDocument(requestId: string, file: File) {
  const form = new FormData()
  form.set('file', file)
  return api<OperationDetail>(`/api/material-requests/${requestId}/documents`, { method: 'POST', form })
}

export function listNotifications() {
  return api<{ notifications: Array<{ id: number; requestId: number; kind: string; message: string; readAt: string | null; createdAt: string }> }>('/api/notifications')
}

export function markNotificationRead(id: number) {
  return api<{ id: number }>(`/api/notifications/${id}/read`, { method: 'POST', body: {} })
}
