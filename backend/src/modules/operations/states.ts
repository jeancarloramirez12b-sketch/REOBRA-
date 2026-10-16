export const requestStatuses = [
  'draft',
  'submitted',
  'under_review',
  'counter_proposed',
  'accepted',
  'partially_fulfilled',
  'fulfilled',
  'rejected',
  'cancelled',
  'expired',
] as const

export type RequestStatus = (typeof requestStatuses)[number]

const transitions: Record<RequestStatus, RequestStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['under_review', 'counter_proposed', 'accepted', 'rejected', 'cancelled', 'expired'],
  under_review: ['counter_proposed', 'accepted', 'rejected', 'cancelled', 'expired'],
  counter_proposed: ['counter_proposed', 'accepted', 'rejected', 'cancelled'],
  accepted: ['partially_fulfilled', 'fulfilled', 'cancelled'],
  partially_fulfilled: ['fulfilled'],
  fulfilled: [],
  rejected: [],
  cancelled: [],
  expired: [],
}

export const reservingStatuses = new Set<RequestStatus>(['accepted', 'partially_fulfilled'])

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return transitions[from].includes(to)
}

export function requestStatusLabel(status: RequestStatus): string {
  const labels: Record<RequestStatus, string> = {
    draft: 'borrador',
    submitted: 'enviada',
    under_review: 'en revisión',
    counter_proposed: 'con contraoferta',
    accepted: 'aceptada y reservada',
    partially_fulfilled: 'parcialmente despachada',
    fulfilled: 'despachada',
    rejected: 'rechazada',
    cancelled: 'cancelada',
    expired: 'vencida',
  }
  return labels[status]
}

export const logisticsModes = ['pending', 'pickup_by_requester', 'delivery_by_supplier', 'third_party'] as const
export type LogisticsMode = (typeof logisticsModes)[number]

export const logisticsStatuses = ['pending_coordination', 'scheduled', 'ready_for_pickup', 'cancelled'] as const
export type LogisticsStatus = (typeof logisticsStatuses)[number]

const logisticsTransitions: Record<LogisticsStatus, LogisticsStatus[]> = {
  pending_coordination: ['scheduled', 'cancelled'],
  scheduled: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['cancelled'],
  cancelled: [],
}

export function canTransitionLogistics(from: LogisticsStatus, to: LogisticsStatus): boolean {
  return logisticsTransitions[from].includes(to)
}

export function coveragePercent(received: number, required: number): number {
  if (!(required > 0)) {
    return 0
  }
  const usable = Math.min(Math.max(received, 0), required)
  return Math.round((usable / required) * 10000) / 100
}
