import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/Badge.tsx'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import { needStatusLabels, priorityLabels, projectStatusLabels, projectTypeLabels, visibilityLabels } from '../features/projects/labels.ts'
import styles from '../features/projects/projects.module.css'
import page from './screen.module.css'

type NeedItem = {
  id: number
  title: string
  categoryName: string
  requiredQuantity: string
  unitCode: string
  priority: string
  status: string
  neededBy: string | null
}
type ProjectEvent = { id: number; eventType: string; description: string; createdAt: string; actorName: string }
type ProjectDetail = {
  id: number
  publicCode: string | null
  title: string
  description: string | null
  organizationName: string
  projectType: string
  city: string
  department: string
  address: string | null
  status: string
  visibility: string
  startDate: string | null
  endDate: string | null
  responsibleName: string | null
  canEdit: boolean
  openNeeds: number
}

const nextStatus: Record<string, Array<{ status: string; label: string }>> = {
  draft: [
    { status: 'active', label: 'Activar' },
    { status: 'archived', label: 'Archivar' },
  ],
  active: [
    { status: 'paused', label: 'Pausar' },
    { status: 'completed', label: 'Finalizar' },
    { status: 'archived', label: 'Archivar' },
  ],
  paused: [
    { status: 'active', label: 'Reanudar' },
    { status: 'completed', label: 'Finalizar' },
    { status: 'archived', label: 'Archivar' },
  ],
  completed: [{ status: 'archived', label: 'Archivar' }],
  archived: [{ status: 'draft', label: 'Restaurar a borrador' }],
  cancelled: [{ status: 'draft', label: 'Restaurar a borrador' }],
}

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

export function ProjectDetailPage() {
  const params = useParams()
  const navigate = useNavigate()
  const projectId = Number(params.projectId)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [needs, setNeeds] = useState<NeedItem[]>([])
  const [events, setEvents] = useState<ProjectEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  function load() {
    return api<{ project: ProjectDetail; needs: NeedItem[]; events: ProjectEvent[] }>(`/api/projects/${projectId}`).then((payload) => {
      setProject(payload.project)
      setNeeds(payload.needs)
      setEvents(payload.events)
    })
  }

  useEffect(() => {
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
      setLoading(false)
      setError('El identificador no es válido.')
      return
    }
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
        setError(caught instanceof ApiError ? caught.message : 'No se pudo abrir el proyecto.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [navigate, projectId])

  async function changeStatus(status: string, label: string) {
    if (!window.confirm(`${label} el proyecto. Las necesidades se conservan. ¿Continuar?`)) {
      return
    }
    setPending(true)
    setError('')
    try {
      await api(`/api/projects/${projectId}/status`, { method: 'POST', body: { status } })
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo cambiar el estado.')
    } finally {
      setPending(false)
    }
  }

  if (loading) {
    return <LoadingState label="Abriendo el proyecto." />
  }
  if (!project) {
    return (
      <ErrorState title="Proyecto no disponible" action={<ButtonLink to="/proyectos">Volver</ButtonLink>}>
        <p>{error || 'No tienes permiso para verlo.'}</p>
      </ErrorState>
    )
  }

  return (
    <div className={page.page}>
      <PageHeader
        eyebrow={project.publicCode ?? 'Proyecto'}
        title={project.title}
        actions={
          <>
            <ButtonLink to="/proyectos">Listado</ButtonLink>
            {project.canEdit ? <ButtonLink to={`/proyectos/${project.id}/editar`} variant="primary">Editar</ButtonLink> : null}
          </>
        }
      >
        <p>{project.organizationName}</p>
      </PageHeader>
      {error ? <p className={styles.banner} role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <Badge>{projectStatusLabels[project.status] ?? project.status}</Badge>
        <Badge tone={project.visibility === 'public' ? 'info' : 'neutral'}>{visibilityLabels[project.visibility] ?? project.visibility}</Badge>
        <Badge tone="warning">{project.openNeeds} abiertas</Badge>
      </div>
      <section className={styles.panel}>
        <h2>Datos del proyecto</h2>
        <dl className={styles.facts}>
          <div><dt>Tipo</dt><dd>{projectTypeLabels[project.projectType] ?? project.projectType}</dd></div>
          <div><dt>Lugar general</dt><dd>{project.city}, {project.department}</dd></div>
          <div><dt>Dirección</dt><dd>{project.address ?? 'No registrada en esta consulta.'}</dd></div>
          <div><dt>Inicio</dt><dd>{project.startDate ?? 'No registrado.'}</dd></div>
          <div><dt>Finalización</dt><dd>{project.endDate ?? 'No registrado.'}</dd></div>
          <div><dt>Responsable</dt><dd>{project.responsibleName ?? 'No registrado.'}</dd></div>
          <div><dt>Descripción</dt><dd>{project.description ?? 'No registrado.'}</dd></div>
        </dl>
        <div className={styles.actions}>
          {(nextStatus[project.status] ?? []).map((action) => (
            <Button key={action.status} type="button" variant="quiet" disabled={pending} onClick={() => void changeStatus(action.status, action.label)}>
              {action.label}
            </Button>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Necesidades</h2>
        <p className={styles.note}>Una necesidad satisfecha no descuenta materiales ni registra una entrega.</p>
        {project.canEdit ? <ButtonLink to={`/proyectos/${project.id}/necesidades/nueva`}>Agregar necesidad</ButtonLink> : null}
        {needs.length === 0 ? <p>Sin necesidades registradas.</p> : (
          <ul className={styles.list}>
            {needs.map((need) => (
              <li key={need.id} className={styles.card}>
                <h2><ButtonLink to={`/proyectos/${project.id}/necesidades/${need.id}`}>{need.title}</ButtonLink></h2>
                <p className={styles.meta}>
                  {formatQuantity(need.requiredQuantity)} {need.unitCode} · {need.categoryName}
                </p>
                <div className={styles.actions}>
                  <Badge>{needStatusLabels[need.status] ?? need.status}</Badge>
                  <Badge tone="warning">{priorityLabels[need.priority] ?? need.priority}</Badge>
                  <span className={styles.meta}>{need.neededBy ?? 'Sin fecha'}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Historial</h2>
        {events.length === 0 ? <p className={styles.note}>No hay eventos registrados.</p> : (
          <ul className={styles.list}>
            {events.map((event) => (
              <li key={event.id}>
                <strong>{event.description}</strong>
                <p className={styles.meta}>{event.createdAt} · {event.actorName}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
