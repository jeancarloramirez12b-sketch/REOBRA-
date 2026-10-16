import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge } from '../components/ui/Badge.tsx'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { Input } from '../components/ui/Input.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { Select } from '../components/ui/Select.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { canWriteMaterials } from '../features/materials/rules.ts'
import { projectStatusLabels, visibilityLabels } from '../features/projects/labels.ts'
import styles from '../features/projects/projects.module.css'
import page from './screen.module.css'

type ProjectSummary = {
  id: number
  publicCode: string | null
  title: string
  organizationName: string
  city: string
  department: string
  status: string
  visibility: string
  openNeeds: number
}

type ProjectList = {
  summary: { total: number; active: number; openNeeds: number }
  projects: ProjectSummary[]
  total: number
}

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

export function ProjectsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [rows, setRows] = useState<ProjectSummary[]>([])
  const [summary, setSummary] = useState({ total: 0, active: 0, openNeeds: 0 })
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const canCreate = auth.memberships.some((item) => item.membershipStatus === 'active' && canWriteMaterials(item.role))
  const status = params.get('status') ?? ''

  useEffect(() => {
    if (auth.status === 'loading') {
      return
    }
    if (auth.status !== 'authenticated') {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError('')
    const query = new URLSearchParams()
    query.set('page', params.get('page') ?? '1')
    query.set('pageSize', '12')
    const term = params.get('q')?.trim() ?? ''
    if (term) {
      query.set('q', term)
    }
    if (status) {
      query.set('status', status)
    }
    void api<ProjectList>(`/api/projects?${query.toString()}`)
      .then((payload) => {
        if (!active) {
          return
        }
        setRows(payload.projects)
        setSummary(payload.summary)
        setTotal(payload.total)
        setLoading(false)
      })
      .catch((caught: unknown) => {
        if (!active) {
          return
        }
        if (sessionEnded(caught)) {
          navigate('/sesion-expirada', { replace: true })
          return
        }
        setError(caught instanceof ApiError ? caught.message : 'No se pudieron consultar los proyectos.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [auth.status, navigate, params, status])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = new URLSearchParams(params)
    const term = search.trim()
    if (term) {
      next.set('q', term)
    } else {
      next.delete('q')
    }
    next.delete('page')
    setParams(next)
  }

  if (auth.status === 'loading' || (auth.status === 'authenticated' && loading)) {
    return <LoadingState label="Consultando proyectos." />
  }

  return (
    <div className={page.page}>
      <PageHeader
        eyebrow="Obras y procesos"
        title="Proyectos"
        actions={
          <>
            {auth.status === 'authenticated' ? <ButtonLink to="/asistente?contexto=project">Asistente</ButtonLink> : null}
            {canCreate ? <ButtonLink to="/proyectos/nuevo" variant="primary">Crear proyecto</ButtonLink> : null}
          </>
        }
      >
        <p>
          Un proyecto pertenece a una organización y declara las necesidades de material. Registrar una necesidad no reserva
          inventario ni crea una entrega.
        </p>
      </PageHeader>
      {auth.status !== 'authenticated' ? (
        <EmptyState icon="projects" title="Inicia sesión para ver los proyectos de tu organización">
          <ButtonLink to="/ingresar" variant="primary">Ingresar</ButtonLink>
        </EmptyState>
      ) : null}
      {auth.status === 'authenticated' ? (
        <>
          <div className={styles.stats}>
            <article><span>Proyectos</span><strong>{summary.total}</strong></article>
            <article><span>Activos</span><strong>{summary.active}</strong></article>
            <article><span>Necesidades abiertas</span><strong>{summary.openNeeds}</strong></article>
          </div>
          <form className={styles.filters} onSubmit={submitSearch}>
            <Input label="Buscar" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, municipio o identificador" maxLength={120} />
            <Select
              label="Estado"
              value={status}
              onChange={(event) => {
                const next = new URLSearchParams(params)
                if (event.target.value) {
                  next.set('status', event.target.value)
                } else {
                  next.delete('status')
                }
                next.delete('page')
                setParams(next)
              }}
              options={[{ value: '', label: 'Todos' }, ...Object.entries(projectStatusLabels).map(([value, label]) => ({ value, label }))]}
            />
            <Button type="submit">Buscar</Button>
          </form>
        </>
      ) : null}
      {error ? <ErrorState title="No se pudo consultar"><p>{error}</p></ErrorState> : null}
      {auth.status === 'authenticated' && !error && total === 0 ? (
        <EmptyState icon="projects" title={params.get('q') || status ? 'Ningún proyecto coincide' : 'Todavía no hay proyectos'}>
          <p>No se muestran obras de ejemplo. El listado sale de MySQL.</p>
          {canCreate ? <ButtonLink to="/proyectos/nuevo" variant="primary">Crear proyecto</ButtonLink> : null}
        </EmptyState>
      ) : null}
      {total > 0 ? (
        <ul className={styles.list}>
          {rows.map((item) => (
            <li key={item.id} className={styles.card}>
              <p className={styles.code}>{item.publicCode ?? 'Sin identificador público'}</p>
              <h2><ButtonLink to={`/proyectos/${item.id}`}>{item.title}</ButtonLink></h2>
              <p className={styles.meta}>{item.organizationName} · {item.city}, {item.department}</p>
              <div className={styles.actions}>
                <Badge>{projectStatusLabels[item.status] ?? item.status}</Badge>
                <Badge tone={item.visibility === 'public' ? 'info' : 'neutral'}>{visibilityLabels[item.visibility] ?? item.visibility}</Badge>
                <Badge tone="warning">{item.openNeeds} {item.openNeeds === 1 ? 'necesidad abierta' : 'necesidades abiertas'}</Badge>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
