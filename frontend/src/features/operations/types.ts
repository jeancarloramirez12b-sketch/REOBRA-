export type RequestActions = {
  submit: boolean
  review: boolean
  counter: boolean
  accept: boolean
  reject: boolean
  cancel: boolean
  expire: boolean
  logistics: boolean
  dispatch: boolean
  incident: boolean
}

export type MaterialRequest = {
  id: number
  publicCode: string | null
  materialId: number
  materialTitle: string
  city: string
  department: string
  ownerName: string
  requesterName: string
  projectId: number | null
  projectTitle: string | null
  needId: number | null
  needTitle: string | null
  unitName: string
  status: string
  statusLabel: string
  message: string | null
  requestedQuantity: number
  dispatchedQuantity: number
  receivedQuantity: number
  availableQuantity: number
  requiredQuantity: number | null
  receivedCoveragePercent: number | null
  proposalVersion: number
  requesterConfirmed: boolean
  supplierConfirmed: boolean
  logisticsMode: string
  logisticsStatus: string
  originCity: string | null
  originDepartment: string | null
  destinationCity: string | null
  destinationDepartment: string | null
  pickupPlace: string | null
  scheduledDate: string | null
  timeWindow: string | null
  logisticsNotes: string | null
  createdAt: string
  party: 'requester' | 'supplier' | null
  actions: RequestActions
  agreementNotice: string
}

export type OperationDetail = {
  request: MaterialRequest
  proposals: Array<{ id: number; version: number; quantity: number; conditions: string | null; createdAt: string }>
  deliveries: Array<{
    id: number
    publicCode: string | null
    status: string
    dispatchedQuantity: number | null
    dispatchedAt: string | null
    receivedQuantity: number | null
    receivedAt: string | null
    receiptCondition: string | null
    notes: string | null
    canReceive: boolean
  }>
  incidents: Array<{ id: number; type: string; description: string; status: string; resolution: string | null; createdAt: string }>
  events: Array<{ id: number; type: string; description: string; createdAt: string }>
  documents: Array<{ id: number; name: string; createdAt: string; verified: boolean }>
}

export type RequestContext = {
  material: { id: number; title: string; availableQuantity: number; unitName: string; ownerName: string; city: string; department: string }
  need: { id: number; title: string; requiredQuantity: number; projectId: number }
}

export function nextAction(actions: RequestActions): string {
  if (actions.submit) return 'Enviar la solicitud'
  if (actions.accept) return 'Confirmar las condiciones'
  if (actions.review) return 'Marcar en revisión'
  if (actions.counter) return 'Proponer otra cantidad'
  if (actions.dispatch) return 'Registrar la salida real'
  if (actions.logistics) return 'Coordinar la entrega'
  if (actions.cancel) return 'Cancelar si todavía no hay salida'
  return 'Consultar el historial'
}
