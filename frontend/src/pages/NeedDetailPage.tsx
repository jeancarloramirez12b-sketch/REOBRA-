import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/Badge.tsx'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import { conditionLabels } from '../features/materials/labels.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import { needStatusLabels, priorityLabels, visibilityLabels } from '../features/projects/labels.ts'
import styles from '../features/projects/projects.module.css'
import page from './screen.module.css'

type NeedView = {
  id: number
  publicCode: string | null
  title: string
  description: string
  categoryName: string
  requiredQuantity: string
  unitName: string
  unitCode: string
  requiredCondition: string | null
  priority: string
  neededBy: string | null
  status: string
  visibility: string
  city: string | null
  department: string | null
  locationDescription: string | null
  observations: string | null
  specifications: Array<{ name: string; value: string }>
}
type NeedPayload = { need: NeedView; project: { id: number; title: string }; canEdit: boolean }

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

export function NeedDetailPage() {
  const params = useParams()
  const navigate = useNavigate()
  const projectId = Number(params.projectId)
  const needId = Number(params.needId)
  const [payload, setPayload] = useState<NeedPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  function load() {
    return api<NeedPayload>(`/api/needs/${needId}`).then((result) => setPayload(result))
  }

  useEffect(() => {
    let active = true
    void load()
      .then(() => {
        if (active) {
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
        setError(caught instanceof ApiError ? caught.message : 'No se pudo abrir la necesidad.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [navigate, needId])

  async function act(path: string, message: string, body: Record<string, string> = {}) {
    if (!window.confirm(message)) {
      return
    }
    setPending(true)
    setError('')
    try {
      await api(path, { method: 'POST', body })
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo actualizar la necesidad.')
    } finally {
      setPending(false)
    }
  }

  if (loading) {
    return <LoadingState label="Abriendo la necesidad." />
  }
  if (!payload) {
    return (
      <ErrorState title="Necesidad no disponible" action={<ButtonLink to={`/proyectos/${projectId}`}>Volver</ButtonLink>}>
        <p>{error || 'No tienes permiso para verla.'}</p>
      </ErrorState>
    )
  }
  const { need, project, canEdit } = payload
  const place = [need.city, need.department].filter(Boolean).join(', ')

  return (
    <div className={page.page}>
      <PageHeader
        eyebrow={need.publicCode ?? 'Necesidad'}
        title={need.title}
        actions={
          <>
            <ButtonLink to={`/proyectos/${project.id}`}>Volver al proyecto</ButtonLink>
            {canEdit ? <ButtonLink to={`/proyectos/${project.id}/necesidades/${need.id}/editar`} variant="primary">Editar</ButtonLink> : null}
            {need.status === 'open' || need.status === 'partially_covered' ? <ButtonLink to={`/proyectos/${project.id}/necesidades/${need.id}/coincidencias`}>Buscar materiales compatibles</ButtonLink> : null}
          </>
        }
      >
        <p>{project.title}</p>
      </PageHeader>
      {error ? <p className={styles.banner} role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <Badge>{needStatusLabels[need.status] ?? need.status}</Badge>
        <Badge tone="warning">{priorityLabels[need.priority] ?? need.priority}</Badge>
        <Badge tone={need.visibility === 'public' ? 'info' : 'neutral'}>{visibilityLabels[need.visibility] ?? need.visibility}</Badge>
      </div>
      <section className={styles.panel}>
        <h2>Requisito</h2>
        <dl className={styles.facts}>
          <div><dt>Cantidad</dt><dd>{formatQuantity(need.requiredQuantity)} {need.unitName} ({need.unitCode})</dd></div>
          <div><dt>Categoría</dt><dd>{need.categoryName}</dd></div>
          <div><dt>Condición aceptable</dt><dd>{need.requiredCondition ? conditionLabels[need.requiredCondition] ?? need.requiredCondition : 'No registrada.'}</dd></div>
          <div><dt>Fecha requerida</dt><dd>{need.neededBy ?? 'No registrada.'}</dd></div>
          <div><dt>Lugar</dt><dd>{place || 'No registrado.'}</dd></div>
          <div><dt>Ubicación</dt><dd>{need.locationDescription ?? 'No registrada.'}</dd></div>
          <div><dt>Descripción</dt><dd>{need.description}</dd></div>
          <div><dt>Observaciones</dt><dd>{need.observations ?? 'No registradas.'}</dd></div>
        </dl>
        <h2>Requisitos declarados</h2>
        {need.specifications.length === 0 ? <p className={styles.note}>Sin requisitos estructurados.</p> : (
          <ul className={styles.list}>
            {need.specifications.map((item) => (
              <li key={`${item.name}-${item.value}`}><strong>{item.name}:</strong> {item.value}</li>
            ))}
          </ul>
        )}
        <p className={styles.note}>Marcar esta necesidad como satisfecha no descuenta el inventario ni registra una entrega.</p>
        <div className={styles.actions}>
          {need.status === 'draft' || need.status === 'paused' ? (
            <Button type="button" disabled={pending} onClick={() => void act(`/api/needs/${need.id}/status`, 'La necesidad quedará abierta. ¿Continuar?', { status: 'open' })}>
              Abrir
            </Button>
          ) : null}
          {need.status === 'open' ? (
            <Button type="button" variant="quiet" disabled={pending} onClick={() => void act(`/api/needs/${need.id}/status`, 'La necesidad quedará pausada. ¿Continuar?', { status: 'paused' })}>
              Pausar
            </Button>
          ) : null}
          {need.status === 'open' || need.status === 'paused' ? (
            <Button type="button" disabled={pending} onClick={() => void act(`/api/needs/${need.id}/close`, 'Marcar como satisfecha no mueve materiales del inventario. ¿Continuar?')}>
              Marcar satisfecha
            </Button>
          ) : null}
          {need.status === 'draft' || need.status === 'open' || need.status === 'paused' ? (
            <Button type="button" variant="quiet" disabled={pending} onClick={() => void act(`/api/needs/${need.id}/cancel`, 'La necesidad se cancelará. ¿Continuar?')}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
