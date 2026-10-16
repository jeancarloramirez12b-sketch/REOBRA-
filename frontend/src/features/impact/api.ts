import { api, ApiError } from '../auth/api.ts'
import type {
  ImpactFactor,
  ImpactOverview,
  ImpactTimeline,
  Methodology,
  OrganizationImpact,
  ProjectImpact,
  ReportDetail,
} from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function impactQuery(filters: {
  organizationId?: string
  projectId?: string
  from?: string
  to?: string
  grain?: string
}): string {
  const params = new URLSearchParams()
  if (filters.organizationId) params.set('organizationId', filters.organizationId)
  if (filters.projectId) params.set('projectId', filters.projectId)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.grain) params.set('grain', filters.grain)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function loadOverview(query: string) {
  return api<ImpactOverview>(`/api/impact/overview${query}`)
}

export function loadTimeline(query: string) {
  return api<ImpactTimeline>(`/api/impact/timeline${query}`)
}

export function loadProjectImpact(projectId: string, query: string) {
  return api<ProjectImpact>(`/api/impact/projects/${projectId}${query}`)
}

export function loadOrganizationImpact(organizationId: string, query: string) {
  return api<OrganizationImpact>(`/api/impact/organizations/${organizationId}${query}`)
}

export function loadMethodologies(organizationId: string) {
  return api<{ methodologies: Methodology[] }>(`/api/impact/methodologies?organizationId=${organizationId}`)
}

export function loadFactors(organizationId: string) {
  return api<{ factors: ImpactFactor[]; notice: string }>(`/api/impact/factors?organizationId=${organizationId}`)
}

export function createMethodology(body: {
  organizationId: number
  name: string
  versionLabel: string
  statement: string
  limitations: string
}) {
  return api<{ methodology: Methodology }>('/api/impact/methodologies', { method: 'POST', body })
}

export function approveMethodology(methodologyId: number) {
  return api<{ methodology: Methodology }>(`/api/impact/methodologies/${methodologyId}/approve`, { method: 'POST', body: {} })
}

export function createFactor(body: {
  methodologyId: number
  impactKind: string
  inputUnitCode: string
  outputUnit: string
  value: number
  sourceName: string
  sourceUrl?: string
  issuerName: string
  year: number
  regionName: string
  versionLabel: string
  conditions: string
  uncertainty?: string
}) {
  return api<{ factor: ImpactFactor }>('/api/impact/factors', { method: 'POST', body })
}

export function updateFactorStatus(factorId: number, status: 'reviewed' | 'approved' | 'retired') {
  return api<{ factor: ImpactFactor }>(`/api/impact/factors/${factorId}`, { method: 'PATCH', body: { status } })
}

export function calculateEstimate(body: {
  organizationId: number
  projectId?: number
  factorId: number
  from: string
  to: string
}) {
  return api<{ calculation: { id: number; status: string; resultValue: number | null; resultUnit: string | null; reason: string | null } }>(
    '/api/impact/calculations',
    { method: 'POST', body, idempotencyKey: `impacto-${crypto.randomUUID()}` },
  )
}

export function issueReport(body: {
  organizationId: number
  projectId?: number
  from: string
  to: string
  methodologyId?: number
}) {
  return api<ReportDetail>('/api/impact/reports', {
    method: 'POST',
    body,
    idempotencyKey: `informe-${crypto.randomUUID()}`,
  })
}

export async function downloadReport(reportId: number, format: 'pdf' | 'csv'): Promise<void> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''
  if (!baseUrl) {
    throw new ApiError(0, 'UNCONFIGURED', 'La URL del backend no está configurada.')
  }
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/impact/reports/${reportId}/export?format=${format}`, {
      credentials: 'include',
      headers: { Accept: format === 'csv' ? 'text/csv' : 'application/pdf' },
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'No se pudo contactar el backend.')
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null
    throw new ApiError(
      response.status,
      error ? String(error.code) : 'REQUEST_FAILED',
      error ? String(error.message) : 'No se pudo descargar el informe.',
    )
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const match = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')
  link.href = url
  link.download = match?.[1] ?? `informe-reobra.${format}`
  link.click()
  URL.revokeObjectURL(url)
}
