import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { ApiError } from '../features/auth/api.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import { getOperation, postAction, receiveDelivery, uploadDocument } from '../features/operations/api.ts'
import { nextAction, type OperationDetail } from '../features/operations/types.ts'
import styles from '../features/operations/operations.module.css'
import page from './screen.module.css'

const modes = [
  ['pending', 'Modalidad pendiente de definir'],
  ['pickup_by_requester', 'Recogida por el solicitante'],
  ['delivery_by_supplier', 'Entrega por el oferente'],
  ['third_party', 'Transporte coordinado por terceros'],
] as const

function operationKey(suffix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `ui${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}${suffix}`
}

function amount(value: number): string {
  return formatQuantity(String(value))
}

function occurredAt(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function OperationDetailPage() {
  const { requestId = '' } = useParams()
  const keys = useRef(new Map<string, string>())
  const [detail, setDetail] = useState<OperationDetail | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState('')

  function keyFor(action: string): string {
    const current = keys.current.get(action)
    if (current) return current
    const created = operationKey(action)
    keys.current.set(action, created)
    return created
  }

  function clearKey(action: string) {
    keys.current.delete(action)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getOperation(requestId)
      .then((result) => {
        if (!cancelled) setDetail(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'No se encontró la operación.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [requestId])

  async function run(action: string, body: unknown = {}) {
    setPending(action)
    setError('')
    try {
      const result = await postAction(requestId, action, body, keyFor(action))
      clearKey(action)
      setDetail(result)
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'La operación no se pudo completar.')
    } finally {
      setPending('')
    }
  }

  if (loading) return <LoadingState label="Cargando la operación" />
  if (!detail) return <ErrorState title="Operación no disponible"><p>{error || 'No se encontró la operación.'}</p></ErrorState>

  const request = detail.request
  const reserved = request.status === 'accepted' || request.status === 'partially_fulfilled' || request.status === 'fulfilled' ? request.requestedQuantity : 0

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Operación" title={request.materialTitle} actions={<Link to="/solicitudes">Volver a solicitudes</Link>}>
        <p>{request.publicCode ?? `Solicitud ${request.id}`}. {request.agreementNotice}</p>
      </PageHeader>
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <Badge tone="info">{request.statusLabel}</Badge>
        <Badge>{request.party === 'supplier' ? 'Oferente' : 'Solicitante'}</Badge>
      </div>
      <dl className={styles.quantities}>
        <div><dt>Solicitada</dt><dd>{amount(request.requestedQuantity)} {request.unitName}</dd></div>
        <div><dt>Acordada y reservada</dt><dd>{amount(reserved)} {request.unitName}</dd></div>
        <div><dt>Despachada</dt><dd>{amount(request.dispatchedQuantity)} {request.unitName}</dd></div>
        <div><dt>Recibida</dt><dd>{amount(request.receivedQuantity)} {request.unitName}</dd></div>
        <div><dt>Libre para otros acuerdos</dt><dd>{amount(request.availableQuantity)} {request.unitName}</dd></div>
        {request.requiredQuantity !== null ? <div><dt>Requerida por la necesidad</dt><dd>{amount(request.requiredQuantity)} {request.unitName}</dd></div> : null}
        {request.receivedCoveragePercent !== null ? <div><dt>Cobertura recibida</dt><dd>{request.receivedCoveragePercent} %</dd></div> : null}
      </dl>
      <section className={styles.panel}>
        <h2>Participantes</h2>
        <p>Oferente: {request.ownerName}. Solicitante: {request.requesterName}.</p>
        <p>Proyecto: {request.projectTitle ?? 'Sin proyecto'}. Necesidad: {request.needTitle ?? 'Sin necesidad'}.</p>
        <p>{request.city}, {request.department}.</p>
        <p>Siguiente acción: {nextAction(request.actions)}</p>
        <p className={styles.note}>Confirmación del solicitante: {request.requesterConfirmed ? 'registrada' : 'pendiente'}. Confirmación del oferente: {request.supplierConfirmed ? 'registrada' : 'pendiente'}.</p>
      </section>
      <section className={styles.panel}>
        <h2>Propuestas</h2>
        {detail.proposals.length === 0 ? <p>No hay propuestas registradas.</p> : (
          <ol className={styles.timeline}>
            {detail.proposals.map((proposal) => (
              <li key={proposal.id}>
                <strong>Versión {proposal.version}: {amount(proposal.quantity)} {request.unitName}</strong>
                <span>{proposal.conditions ?? 'Sin condiciones adicionales.'}</span>
              </li>
            ))}
          </ol>
        )}
        <div className={styles.actions}>
          {request.actions.submit ? <Button type="button" disabled={pending !== ''} onClick={() => { void run('submit') }}>Enviar</Button> : null}
          {request.actions.review ? <Button type="button" disabled={pending !== ''} onClick={() => { void run('review') }}>Marcar en revisión</Button> : null}
          {request.actions.accept ? <Button type="button" disabled={pending !== ''} onClick={() => { void run('accept') }}>Confirmar</Button> : null}
          {request.actions.reject ? <Button type="button" variant="quiet" disabled={pending !== ''} onClick={() => { void run('reject') }}>Rechazar</Button> : null}
          {request.actions.cancel ? <Button type="button" variant="quiet" disabled={pending !== ''} onClick={() => { void run('cancel') }}>Cancelar</Button> : null}
        </div>
        {request.actions.counter ? (
          <form className={styles.fields} onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void run('counteroffer', { quantity: Number(data.get('quantity')), conditions: String(data.get('conditions') ?? '') || undefined })
          }}>
            <label>Cantidad propuesta<input name="quantity" inputMode="decimal" required /></label>
            <label>Condiciones<textarea name="conditions" rows={3} maxLength={2000} /></label>
            <Button type="submit" disabled={pending !== ''}>Enviar contraoferta</Button>
          </form>
        ) : null}
      </section>
      <section className={styles.panel}>
        <h2>Logística</h2>
        <p>Modalidad: {modes.find((item) => item[0] === request.logisticsMode)?.[1] ?? request.logisticsMode}. Estado: {request.logisticsStatus}.</p>
        <p>{[request.originCity, request.originDepartment].filter(Boolean).join(', ') || 'Municipio de origen sin registrar'} → {[request.destinationCity, request.destinationDepartment].filter(Boolean).join(', ') || 'Municipio de destino sin registrar'}.</p>
        {request.pickupPlace ? <p>Lugar de recogida autorizado: {request.pickupPlace}</p> : null}
        {request.scheduledDate ? <p>Fecha propuesta: {request.scheduledDate}{request.timeWindow ? ` · ${request.timeWindow}` : ''}</p> : null}
        {request.logisticsNotes ? <p>{request.logisticsNotes}</p> : null}
        <p className={styles.note}>No hay transportista, ruta ni costo calculado.</p>
        {request.actions.logistics ? (
          <form className={styles.fields} onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void run('logistics', {
              mode: String(data.get('mode')),
              status: String(data.get('status')),
              originCity: String(data.get('originCity') ?? '') || undefined,
              originDepartment: String(data.get('originDepartment') ?? '') || undefined,
              destinationCity: String(data.get('destinationCity') ?? '') || undefined,
              destinationDepartment: String(data.get('destinationDepartment') ?? '') || undefined,
              pickupPlace: String(data.get('pickupPlace') ?? '') || undefined,
              scheduledDate: String(data.get('scheduledDate') ?? '') || undefined,
              timeWindow: String(data.get('timeWindow') ?? '') || undefined,
              notes: String(data.get('notes') ?? '') || undefined,
            })
          }}>
            <label>Modalidad<select name="mode" defaultValue={request.logisticsMode}>{modes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Estado<select name="status" defaultValue="scheduled"><option value="scheduled">Programada</option><option value="ready_for_pickup">Lista para recogida</option><option value="cancelled">Cancelada</option></select></label>
            <label>Municipio de origen<input name="originCity" defaultValue={request.originCity ?? ''} /></label>
            <label>Departamento de origen<input name="originDepartment" defaultValue={request.originDepartment ?? ''} /></label>
            <label>Municipio de destino<input name="destinationCity" defaultValue={request.destinationCity ?? ''} /></label>
            <label>Departamento de destino<input name="destinationDepartment" defaultValue={request.destinationDepartment ?? ''} /></label>
            <label>Lugar de recogida autorizado<input name="pickupPlace" defaultValue={request.pickupPlace ?? ''} /></label>
            <label>Fecha propuesta<input name="scheduledDate" type="date" defaultValue={request.scheduledDate ?? ''} /></label>
            <label>Franja horaria<input name="timeWindow" defaultValue={request.timeWindow ?? ''} /></label>
            <label>Observaciones<textarea name="notes" rows={3} defaultValue={request.logisticsNotes ?? ''} /></label>
            <Button type="submit" disabled={pending !== ''}>Guardar coordinación</Button>
          </form>
        ) : null}
      </section>
      <section className={styles.panel}>
        <h2>Salidas y recepciones</h2>
        {detail.deliveries.length === 0 ? <p>No hay salidas registradas.</p> : (
          <ol className={styles.timeline}>
            {detail.deliveries.map((delivery) => (
              <li key={delivery.id}>
                <strong>{delivery.publicCode ?? `Salida ${delivery.id}`}</strong>
                <span>Despachada: {delivery.dispatchedQuantity === null ? 'sin cantidad' : amount(delivery.dispatchedQuantity)} {request.unitName}. Recibida: {delivery.receivedQuantity === null ? 'pendiente' : amount(delivery.receivedQuantity)} {request.unitName}.</span>
                {delivery.notes ? <span>{delivery.notes}</span> : null}
                {delivery.canReceive ? (
                  <form className={styles.fields} onSubmit={(event) => {
                    event.preventDefault()
                    const data = new FormData(event.currentTarget)
                    const when = occurredAt(String(data.get('occurredAt') ?? ''))
                    if (!when) {
                      setError('Indica la fecha real de la recepción.')
                      return
                    }
                    setPending(`receive-${delivery.id}`)
                    receiveDelivery(requestId, delivery.id, {
                      quantity: Number(data.get('quantity')),
                      occurredAt: when,
                      condition: String(data.get('condition')),
                      notes: String(data.get('notes') ?? '') || undefined,
                    }, keyFor(`receive-${delivery.id}`))
                      .then((result) => { clearKey(`receive-${delivery.id}`); setDetail(result) })
                      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'No se pudo registrar la recepción.'))
                      .finally(() => setPending(''))
                  }}>
                    <label>Cantidad recibida<input name="quantity" inputMode="decimal" required /></label>
                    <label>Fecha real<input name="occurredAt" type="datetime-local" required /></label>
                    <label>Estado declarado<select name="condition" defaultValue="not_declared"><option value="good">Bueno</option><option value="fair">Aceptable</option><option value="deteriorated">Deteriorado</option><option value="different">Diferente a lo declarado</option><option value="not_declared">Sin declaración</option></select></label>
                    <label>Observaciones<textarea name="notes" rows={2} /></label>
                    <Button type="submit" disabled={pending !== ''}>Confirmar recepción</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {request.actions.dispatch ? (
          <form className={styles.fields} onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const when = occurredAt(String(data.get('occurredAt') ?? ''))
            if (!when) {
              setError('Indica la fecha real de la salida.')
              return
            }
            void run('dispatch', { quantity: Number(data.get('quantity')), occurredAt: when, notes: String(data.get('notes') ?? '') || undefined })
          }}>
            <label>Cantidad despachada<input name="quantity" inputMode="decimal" required /></label>
            <label>Fecha real<input name="occurredAt" type="datetime-local" required /></label>
            <label>Observaciones<textarea name="notes" rows={2} /></label>
            <Button type="submit" disabled={pending !== ''}>Registrar salida</Button>
          </form>
        ) : null}
      </section>
      <section className={styles.panel}>
        <h2>Incidencias</h2>
        {detail.incidents.length === 0 ? <p>No hay incidencias.</p> : (
          <ol className={styles.timeline}>
            {detail.incidents.map((incident) => (
              <li key={incident.id}>
                <strong>{incident.type} · {incident.status}</strong>
                <span>{incident.description}</span>
                {incident.resolution ? <span>Resolución: {incident.resolution}</span> : request.actions.incident ? (
                  <form className={styles.fields} onSubmit={(event) => {
                    event.preventDefault()
                    const data = new FormData(event.currentTarget)
                    void run(`incidents/${incident.id}/resolve`, { resolution: String(data.get('resolution') ?? '') })
                  }}>
                    <label>Resolución<textarea name="resolution" required rows={2} /></label>
                    <Button type="submit" disabled={pending !== ''}>Registrar resolución</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {request.actions.incident ? (
          <form className={styles.fields} onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void run('incidents', { type: String(data.get('type')), description: String(data.get('description') ?? '') })
          }}>
            <label>Tipo<select name="type" defaultValue="delay"><option value="unavailable">Material no disponible</option><option value="short_quantity">Cantidad inferior</option><option value="delay">Retraso</option><option value="condition_difference">Condición diferente</option><option value="delivery_cancelled">Entrega cancelada</option><option value="receipt_pending">Recepción pendiente</option></select></label>
            <label>Descripción<textarea name="description" required rows={3} /></label>
            <Button type="submit" disabled={pending !== ''}>Registrar incidencia</Button>
          </form>
        ) : null}
      </section>
      <section className={styles.panel}>
        <h2>Archivos</h2>
        <p className={styles.note}>Un archivo adjunto no queda verificado ni certificado.</p>
        {detail.documents.length === 0 ? <p>No hay archivos.</p> : (
          <ul>
            {detail.documents.map((document) => (
              <li key={document.id}><a href={`${import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''}/api/material-requests/${request.id}/documents/${document.id}`}>{document.name}</a></li>
            ))}
          </ul>
        )}
        {request.actions.incident ? (
          <form className={styles.fields} onSubmit={(event) => {
            event.preventDefault()
            const file = event.currentTarget.elements.namedItem('file')
            if (!(file instanceof HTMLInputElement) || !file.files?.[0]) return
            setPending('document')
            uploadDocument(requestId, file.files[0])
              .then((result) => setDetail(result))
              .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'No se pudo adjuntar el archivo.'))
              .finally(() => setPending(''))
          }}>
            <label>PDF, JPEG, PNG o WebP, hasta 8 MB<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></label>
            <Button type="submit" disabled={pending !== ''}>Adjuntar</Button>
          </form>
        ) : null}
      </section>
      <section className={styles.panel}>
        <h2>Historial</h2>
        {detail.events.length === 0 ? <p>Todavía no hay eventos.</p> : (
          <ol className={styles.timeline}>
            {detail.events.map((event) => (
              <li key={event.id}>
                <strong>{event.description}</strong>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('es-CO')}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
