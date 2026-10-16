import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/Badge.tsx'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { Select } from '../components/ui/Select.tsx'
import { api, apiBlob, ApiError } from '../features/auth/api.ts'
import {
  availabilityLabels,
  availabilityTone,
  conditionLabels,
  originLabels,
  technicalLabels,
  technicalTone,
} from '../features/materials/labels.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import { assessmentLabels, eventLabels, evidenceLabels, reviewLabels, visibilityLabels } from '../features/passports/labels.ts'
import styles from '../features/passports/passports.module.css'
import page from './screen.module.css'

type PassportImage = { id: number; imageOrder: number; createdAt: string }
type PassportDocument = {
  id: number
  evidenceKind: string
  reviewStatus: string
  disclosure: string
  originalName: string
  sha256: string
  createdAt: string
  authenticity: string
}
type Assessment = {
  id: number
  assessmentType: string
  result: string
  observations: string
  assessedAt: string
  assessorName: string
  scope: string
}
type PassportView = {
  audience: 'private' | 'public'
  publicCode: string
  title: string
  categoryName: string
  organizationName: string
  description: string | null
  quantity: string
  unitName: string
  unitCode: string
  materialCondition: string
  originType: string
  city: string
  department: string
  locationDescription: string | null
  availabilityStatus: string
  availableQuantity: string
  technicalValidationStatus: string
  technicalNote: string
  registeredAt: string
  qrUrl: string
  localNetworkOnly: boolean
  visibility: string
  canEdit: boolean
  canReviewEvidence: boolean
  originDescription: string
  images: PassportImage[]
  documents: PassportDocument[]
  assessments: Assessment[]
  assessmentNotice: string
  materialId?: number
}
type TraceEvent = {
  id: number
  eventType: string
  description: string
  eventTimestamp: string
  actorName: string
  organizationName: string
}

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

export function PassportDetailPage() {
  const params = useParams()
  const navigate = useNavigate()
  const publicCode = params.publicCode ?? ''
  const [passport, setPassport] = useState<PassportView | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [kind, setKind] = useState('technical_sheet')

  useEffect(() => {
    if (!/^rob_[a-z0-9]{20}$/.test(publicCode)) {
      setLoading(false)
      setError('El identificador público no es válido.')
      return
    }
    let active = true
    let objectUrl = ''
    setLoading(true)
    setError('')
    void api<{ passport: PassportView }>(`/api/passports/${publicCode}`)
      .then(async (payload) => {
        if (!active) {
          return
        }
        setPassport(payload.passport)
        if (payload.passport.audience === 'private') {
          const history = await api<{ events: TraceEvent[] }>(`/api/passports/${publicCode}/events?pageSize=50`)
          if (active) {
            setEvents(history.events)
          }
        }
        const blob = await apiBlob(`/api/passports/${publicCode}/qr`)
        objectUrl = URL.createObjectURL(blob)
        if (active) {
          setQrUrl(objectUrl)
          setLoading(false)
        }
      })
      .catch((caught: unknown) => {
        if (!active) {
          return
        }
        if (sessionEnded(caught)) {
          navigate('/sesion-expirada', { replace: true })
          return
        }
        setError(caught instanceof ApiError ? caught.message : 'No se pudo abrir el pasaporte.')
        setLoading(false)
      })
    return () => {
      active = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [navigate, publicCode])

  async function refresh() {
    const payload = await api<{ passport: PassportView }>(`/api/passports/${publicCode}`)
    setPassport(payload.passport)
    if (payload.passport.audience === 'private') {
      const history = await api<{ events: TraceEvent[] }>(`/api/passports/${publicCode}/events?pageSize=50`)
      setEvents(history.events)
    }
  }

  async function changeVisibility(next: 'public' | 'private') {
    const message =
      next === 'public'
        ? 'La consulta pública mostrará solo datos generales. No certifica el material. ¿Publicar el pasaporte?'
        : 'La consulta pública se retirará. El historial interno se conserva. ¿Continuar?'
    if (!window.confirm(message)) {
      return
    }
    setPending(true)
    setNotice('')
    try {
      await api(`/api/passports/${publicCode}/visibility`, { method: 'PATCH', body: { visibility: next } })
      await refresh()
      setNotice(next === 'public' ? 'Consulta pública habilitada.' : 'Consulta pública retirada.')
    } catch (caught) {
      if (sessionEnded(caught)) {
        navigate('/sesion-expirada', { replace: true })
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'No se pudo cambiar la visibilidad.')
    } finally {
      setPending(false)
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('document')
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined
    if (!file) {
      setError('Selecciona un documento.')
      return
    }
    setPending(true)
    setError('')
    try {
      const form = new FormData()
      form.set('document', file)
      form.set('evidenceKind', kind)
      form.set('disclosure', 'internal')
      await api(`/api/passports/${publicCode}/evidence`, { method: 'POST', form })
      event.currentTarget.reset()
      await refresh()
      setNotice('Documento recibido. Adjuntarlo no lo verifica ni certifica el material.')
    } catch (caught) {
      if (sessionEnded(caught)) {
        navigate('/sesion-expirada', { replace: true })
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'No se pudo guardar el documento.')
    } finally {
      setPending(false)
    }
  }

  async function downloadQr() {
    if (!qrUrl) {
      return
    }
    const link = document.createElement('a')
    link.href = qrUrl
    link.download = `${publicCode}.svg`
    link.click()
  }

  if (loading) {
    return <LoadingState label="Abriendo el pasaporte." />
  }
  if (!passport) {
    return (
      <ErrorState title="Pasaporte no disponible" action={<ButtonLink to="/pasaporte">Volver</ButtonLink>}>
        <p>{error || 'No está publicado o no tienes permiso para verlo.'}</p>
      </ErrorState>
    )
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow={passport.publicCode} title={passport.title} actions={<ButtonLink to="/pasaporte">Listado</ButtonLink>}>
        <p>{passport.organizationName}</p>
      </PageHeader>
      {notice ? <p className={styles.success}>{notice}</p> : null}
      {error ? <p className={styles.banner} role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <Badge tone={passport.visibility === 'public' ? 'info' : 'neutral'}>{visibilityLabels[passport.visibility] ?? passport.visibility}</Badge>
        <Badge tone={availabilityTone(passport.availabilityStatus)}>{availabilityLabels[passport.availabilityStatus] ?? passport.availabilityStatus}</Badge>
        <Badge tone={technicalTone(passport.technicalValidationStatus)}>
          {technicalLabels[passport.technicalValidationStatus] ?? passport.technicalValidationStatus}
        </Badge>
      </div>
      <section className={styles.panel}>
        <h2>Identidad</h2>
        <div className={styles.qrRow}>
          {qrUrl ? <img className={styles.qr} src={qrUrl} alt={`Código QR del pasaporte ${passport.publicCode}`} /> : <p>No se pudo mostrar el QR.</p>}
          <div>
            <p className={styles.code}>{passport.qrUrl}</p>
            <p className={styles.note}>El QR abre esta ficha. No demuestra por sí mismo la autenticidad del material.</p>
            {passport.localNetworkOnly ? (
              <p className={styles.note}>Esta dirección es local. Un teléfono en otra red no podrá abrirla sin publicar el servidor.</p>
            ) : null}
            <div className={styles.actions}>
              <Button type="button" onClick={() => void downloadQr()}>Descargar QR</Button>
              <Button type="button" variant="quiet" onClick={() => window.print()}>Imprimir etiqueta</Button>
            </div>
          </div>
        </div>
        <dl className={styles.facts}>
          <div><dt>Identificador público</dt><dd>{passport.publicCode}</dd></div>
          <div><dt>Categoría</dt><dd>{passport.categoryName}</dd></div>
          <div><dt>Organización</dt><dd>{passport.organizationName}</dd></div>
          <div><dt>Registro</dt><dd>{passport.registeredAt}</dd></div>
          <div><dt>Cantidad declarada</dt><dd>{formatQuantity(passport.quantity)} {passport.unitName} ({passport.unitCode})</dd></div>
          <div><dt>Disponible</dt><dd>{formatQuantity(passport.availableQuantity)} {passport.unitCode}</dd></div>
          <div><dt>Condición declarada</dt><dd>{conditionLabels[passport.materialCondition] ?? passport.materialCondition}</dd></div>
          <div><dt>Procedencia declarada</dt><dd>{originLabels[passport.originType] ?? passport.originType}</dd></div>
          <div><dt>Lugar general</dt><dd>{passport.city}, {passport.department}</dd></div>
          <div><dt>Detalle de ubicación</dt><dd>{passport.locationDescription ?? 'No registrado en la consulta pública.'}</dd></div>
          <div><dt>Descripción</dt><dd>{passport.description ?? 'No registrado.'}</dd></div>
          <div><dt>Origen en el pasaporte</dt><dd>{passport.originDescription}</dd></div>
        </dl>
      </section>
      <section className={styles.panel}>
        <h2>Evaluación técnica</h2>
        <p className={styles.note}>{passport.technicalNote}</p>
        <p className={styles.note}>{passport.assessmentNotice}</p>
        {passport.assessments.length === 0 ? <p>Pendiente de evaluación. No verificado.</p> : (
          <ul className={styles.documents}>
            {passport.assessments.map((item) => (
              <li key={item.id}>
                <strong>{assessmentLabels[item.assessmentType] ?? item.assessmentType}</strong>
                <p>{technicalLabels[item.result] ?? item.result}</p>
                <p>{item.observations}</p>
                <p className={styles.meta}>{item.assessorName} · {item.assessedAt}</p>
                <p className={styles.note}>{item.scope}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Fotografías</h2>
        {passport.images.length === 0 ? <p className={styles.note}>Sin evidencia fotográfica.</p> : (
          <ul className={styles.gallery}>
            {passport.images.map((image) => (
              <li key={image.id}>
                <PassportPhoto publicCode={passport.publicCode} imageId={image.id} alt={`${passport.title}, fotografía ${image.imageOrder}`} />
                <p className={styles.meta}>{image.createdAt} · Recibida, sin verificación</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Documentos</h2>
        {passport.documents.length === 0 ? <p className={styles.note}>Sin evidencia adjunta.</p> : (
          <ul className={styles.documents}>
            {passport.documents.map((document) => (
              <li key={document.id}>
                <strong>{document.originalName}</strong>
                <p>{evidenceLabels[document.evidenceKind] ?? document.evidenceKind}</p>
                <p>{reviewLabels[document.reviewStatus] ?? document.reviewStatus}</p>
                <p className={styles.meta}>{document.createdAt}</p>
                <p className={styles.note}>{document.authenticity}</p>
                <p className={styles.code}>{document.sha256}</p>
                <div className={styles.actions}>
                  <Button type="button" variant="quiet" onClick={() => void downloadDocument(passport.publicCode, document)}>Abrir</Button>
                  {passport.canReviewEvidence && document.reviewStatus === 'received' ? (
                    <Button type="button" variant="quiet" disabled={pending} onClick={() => void review(document.id, 'reviewed')}>Marcar revisado</Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {passport.canEdit ? (
          <form className={styles.layout} onSubmit={(event) => void uploadDocument(event)}>
            <Select
              label="Tipo de evidencia"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              options={Object.entries(evidenceLabels).map(([value, label]) => ({ value, label }))}
            />
            <label className={styles.note}>
              Documento PDF, JPEG, PNG o WebP
              <input name="document" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={pending} />
            </label>
            <Button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Adjuntar evidencia'}</Button>
          </form>
        ) : null}
      </section>
      {passport.audience === 'private' ? (
        <section className={styles.panel}>
          <h2>Historial</h2>
          {events.length === 0 ? <p className={styles.note}>No hay eventos registrados.</p> : (
            <ol className={styles.timeline}>
              {events.map((event) => (
                <li key={event.id}>
                  <strong>{eventLabels[event.eventType] ?? event.eventType}</strong>
                  <span className={styles.time}>{event.eventTimestamp}</span>
                  <p>{event.description}</p>
                  <p className={styles.meta}>{event.actorName} · {event.organizationName}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        <p className={styles.note}>El historial interno no se muestra en la consulta pública.</p>
      )}
      {passport.canEdit ? (
        <div className={styles.actions}>
          {passport.visibility === 'private' ? (
            <Button type="button" disabled={pending} onClick={() => void changeVisibility('public')}>Habilitar consulta pública</Button>
          ) : (
            <Button type="button" variant="quiet" disabled={pending} onClick={() => void changeVisibility('private')}>Retirar consulta pública</Button>
          )}
          {passport.materialId ? <ButtonLink to={`/inventario/${passport.materialId}`}>Ver en el inventario</ButtonLink> : null}
        </div>
      ) : null}
    </div>
  )

  async function review(documentId: number, reviewStatus: 'reviewed' | 'not_accepted') {
    if (!window.confirm('Marcar el documento como revisado no certifica el material ni aprueba un uso. ¿Continuar?')) {
      return
    }
    setPending(true)
    try {
      await api(`/api/passports/${publicCode}/evidence/${documentId}`, { method: 'PATCH', body: { reviewStatus } })
      await refresh()
      setNotice('La revisión quedó registrada. No es una certificación.')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo revisar el documento.')
    } finally {
      setPending(false)
    }
  }

  async function downloadDocument(code: string, file: PassportDocument) {
    const blob = await apiBlob(`/api/passports/${code}/evidence/${file.id}`)
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = file.originalName
    link.click()
    URL.revokeObjectURL(url)
  }
}

function PassportPhoto({ publicCode, imageId, alt }: { publicCode: string; imageId: number; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let objectUrl = ''
    void apiBlob(`/api/passports/${publicCode}/images/${imageId}`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (active) {
          setUrl(objectUrl)
        }
      })
      .catch(() => {
        if (active) {
          setUrl(null)
        }
      })
    return () => {
      active = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [imageId, publicCode])
  if (!url) {
    return <p className={styles.note}>Sin vista previa</p>
  }
  return <img className={styles.photo} src={url} alt={alt} />
}
