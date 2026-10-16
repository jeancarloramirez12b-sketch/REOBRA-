import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/Badge.tsx'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { ApiError } from '../features/auth/api.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import { listNotifications, listRequests, markNotificationRead } from '../features/operations/api.ts'
import { nextAction, type MaterialRequest } from '../features/operations/types.ts'
import styles from '../features/operations/operations.module.css'
import page from './screen.module.css'

const boxes = [
  ['all', 'Todas'],
  ['sent', 'Enviadas'],
  ['received', 'Recibidas'],
  ['pending', 'Pendientes'],
  ['negotiating', 'En negociación'],
  ['accepted', 'Aceptadas'],
  ['rejected', 'Rechazadas'],
  ['cancelled', 'Canceladas'],
  ['finished', 'Finalizadas'],
] as const

function quantity(value: number): string {
  return formatQuantity(String(value))
}

function RequestCards({ requests }: { requests: MaterialRequest[] }) {
  if (requests.length === 0) {
    return (
      <EmptyState icon="deliveries" title="No hay operaciones en esta vista">
        <p>Una coincidencia no crea una solicitud. Cuando exista una, aparecerá aquí con su estado real.</p>
      </EmptyState>
    )
  }
  return (
    <div className={styles.layout}>
      {requests.map((item) => (
        <article key={item.id} className={styles.card}>
          <div className={styles.actions}>
            <Badge tone={item.status === 'rejected' || item.status === 'cancelled' ? 'danger' : 'info'}>{item.statusLabel}</Badge>
            {item.publicCode ? <Badge>{item.publicCode}</Badge> : null}
          </div>
          <h2>{item.materialTitle}</h2>
          <p>{quantity(item.requestedQuantity)} {item.unitName}</p>
          <p>{item.party === 'supplier' ? item.requesterName : item.ownerName}</p>
          <p>{item.projectTitle ?? 'Sin proyecto'}{item.needTitle ? ` · ${item.needTitle}` : ''}</p>
          <p className={styles.note}>{new Date(item.createdAt).toLocaleString('es-CO')}</p>
          <p>Siguiente acción: {nextAction(item.actions)}</p>
          <ButtonLink to={`/solicitudes/${item.id}`}>Abrir operación</ButtonLink>
        </article>
      ))}
    </div>
  )
}

export function RequestsPage() {
  const [section, setSection] = useState('solicitudes')
  const [box, setBox] = useState<(typeof boxes)[number][0]>('all')
  const [q, setQ] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [requests, setRequests] = useState<MaterialRequest[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notifications, setNotifications] = useState<Array<{ id: number; requestId: number; kind: string; message: string; readAt: string | null }>>([])

  const activeBox = section === 'acuerdos' || section === 'reservas' ? 'accepted' : section === 'entregas' ? 'finished' : box

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    listRequests({ box: activeBox, q, page: pageNumber })
      .then((result) => {
        if (!cancelled) {
          setRequests(result.requests)
          setTotal(result.total)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar las solicitudes.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeBox, q, pageNumber])

  useEffect(() => {
    if (section !== 'incidencias' && section !== 'historial') return
    let cancelled = false
    listNotifications()
      .then((result) => {
        if (!cancelled) setNotifications(result.notifications)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar los avisos.')
      })
    return () => {
      cancelled = true
    }
  }, [section])

  const visibleNotices = section === 'incidencias' ? notifications.filter((item) => item.kind === 'incident') : notifications

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Fase 9" title="Operaciones de materiales">
        <p>Solicitudes, acuerdos, reservas y movimientos reales. Confirmar un acuerdo reserva cantidad. La salida y la recepción se registran por separado.</p>
      </PageHeader>
      {error ? <ErrorState title="No se pudo mostrar la operación"><p>{error}</p></ErrorState> : null}
      <div className={styles.filters} role="tablist" aria-label="Secciones de operaciones">
        {[
          ['solicitudes', 'Solicitudes'],
          ['acuerdos', 'Acuerdos'],
          ['reservas', 'Reservas'],
          ['entregas', 'Entregas'],
          ['incidencias', 'Incidencias'],
          ['historial', 'Historial'],
        ].map(([id, label]) => (
          <button key={id} type="button" className={page.filter} aria-pressed={section === id} onClick={() => { setSection(id); setPageNumber(1) }}>{label}</button>
        ))}
      </div>
      {section === 'solicitudes' ? (
        <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setQ(String(data.get('q') ?? '')); setPageNumber(1) }}>
          {boxes.map(([id, label]) => (
            <button key={id} type="button" className={page.filter} aria-pressed={box === id} onClick={() => { setBox(id); setPageNumber(1) }}>{label}</button>
          ))}
          <label>
            Buscar
            <input name="q" defaultValue={q} placeholder="Material o código" />
          </label>
          <Button type="submit">Buscar</Button>
        </form>
      ) : null}
      {section === 'reservas' ? <p className={styles.note}>Una reserva existe cuando el acuerdo está aceptado y todavía no se despachó toda la cantidad. No es una salida física.</p> : null}
      {section === 'acuerdos' ? <p className={styles.note}>El acuerdo queda confirmado con las dos organizaciones. No es un contrato con firma electrónica.</p> : null}
      {loading ? <LoadingState label="Cargando operaciones" /> : section === 'incidencias' || section === 'historial' ? (
        visibleNotices.length === 0 ? (
          <EmptyState icon="info" title={section === 'incidencias' ? 'No hay incidencias avisadas' : 'No hay avisos'}>
            <p>La bandeja solo muestra avisos internos persistidos. No representa un correo enviado.</p>
          </EmptyState>
        ) : (
          <ul className={styles.timeline}>
            {visibleNotices.map((item) => (
              <li key={item.id}>
                <strong>{item.message}</strong>
                <Link to={`/solicitudes/${item.requestId}`}>Abrir operación {item.requestId}</Link>
                {item.readAt ? <span className={styles.note}>Leído</span> : <Button type="button" variant="quiet" onClick={() => { void markNotificationRead(item.id).then(() => setNotifications((current) => current.map((notice) => notice.id === item.id ? { ...notice, readAt: new Date().toISOString() } : notice))) }}>Marcar leído</Button>}
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <RequestCards requests={requests} />
          {total > requests.length ? (
            <div className={styles.actions}>
              <p className={styles.note}>Página {pageNumber}. Hay {total} operaciones.</p>
              <Button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}>Anterior</Button>
              <Button type="button" disabled={pageNumber * 10 >= total} onClick={() => setPageNumber((current) => current + 1)}>Siguiente</Button>
            </div>
          ) : null}
        </>
      )}
      <p className={styles.note}>Solicitar no reserva. Reservar no despacha. Despachar no confirma la recepción.</p>
    </div>
  )
}
