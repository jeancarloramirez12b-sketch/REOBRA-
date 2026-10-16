import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/Badge.tsx'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import { classificationLabels, factorLabels, geographyLabels } from '../features/matching/labels.ts'
import styles from '../features/matching/matching.module.css'
import page from './screen.module.css'

type Factor = { key: string; state: 'known' | 'unknown'; score: number | null; summary: string }
type MatchCard = {
  materialId: number
  title: string
  organizationName: string
  categoryName: string
  unitName: string
  availableQuantity: number
  requiredQuantity: number
  usableQuantity: number | null
  deficitQuantity: number | null
  coveragePercent: number | null
  city: string
  department: string
  classification: string
  observedScore: number | null
  evaluableRatio: number
  geographyLevel: string
  technicalState: string
  factors: Factor[]
  explanation: string
  exclusionCode: string | null
  passportPath: string | null
  inventoryPath: string | null
  technicalValidationStatus: string
}
type MatchReport = {
  disclaimer: string
  persisted: boolean
  durationMs: number
  need: { id: number; title: string; projectTitle: string; requiredQuantity: number; unitName: string; city: string | null; department: string | null }
  summary: { evaluated: number; compatible: number; insufficient: number; incompatible: number }
  matches: MatchCard[]
  excluded: MatchCard[]
  page: number
  pageSize: number
  total: number
}

const percent = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

export function MatchingPage() {
  const params = useParams()
  const navigate = useNavigate()
  const projectId = params.projectId
  const needId = params.needId
  const [report, setReport] = useState<MatchReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [level, setLevel] = useState('')
  const [sort, setSort] = useState('score')
  const [pendingTechnical, setPendingTechnical] = useState(false)
  const [department, setDepartment] = useState('')
  const [category, setCategory] = useState('')
  const [minCoverage, setMinCoverage] = useState('')
  const [resultPage, setResultPage] = useState(1)
  const [explanations, setExplanations] = useState<Record<number, string>>({})
  const [explaining, setExplaining] = useState<number | null>(null)

  function load(persist: boolean) {
    const search = new URLSearchParams()
    if (level) search.set('level', level)
    if (sort) search.set('sort', sort)
    if (pendingTechnical) search.set('pendingTechnical', '1')
    if (department.trim()) search.set('department', department.trim())
    if (category.trim()) search.set('category', category.trim())
    if (minCoverage.trim()) search.set('minCoverage', minCoverage.trim())
    if (resultPage > 1) search.set('page', String(resultPage))
    const query = search.toString()
    const path = persist
      ? `/api/needs/${needId}/matches/recalculate${query ? `?${query}` : ''}`
      : `/api/needs/${needId}/matches${query ? `?${query}` : ''}`
    return api<MatchReport>(path, persist ? { method: 'POST', body: {} } : undefined)
  }

  async function explain(materialId: number) {
    setExplaining(materialId)
    try {
      const result = await api<{ narrative: string }>('/api/ai/matching/explain', {
        method: 'POST',
        body: { needId: Number(needId), materialId },
      })
      setExplanations((current) => ({ ...current, [materialId]: result.narrative }))
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'No se pudo explicar el resultado.'
      setExplanations((current) => ({ ...current, [materialId]: message }))
    } finally {
      setExplaining(null)
    }
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    void load(false)
      .then((result) => {
        if (active) {
          setReport(result)
          setError('')
          setLoading(false)
        }
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (sessionEnded(caught)) {
          navigate('/sesion-expirada', { replace: true })
          return
        }
        setError(caught instanceof ApiError ? caught.message : 'No se pudo calcular la compatibilidad.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [navigate, needId, level, sort, pendingTechnical, department, category, minCoverage, resultPage])

  async function save() {
    setLoading(true)
    try {
      const result = await load(true)
      setReport(result)
      setError('')
    } catch (caught: unknown) {
      if (sessionEnded(caught)) {
        navigate('/sesion-expirada', { replace: true })
        return
      }
      setError(caught instanceof ApiError ? caught.message : 'No se pudo guardar la evaluación.')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !report) {
    return <LoadingState label="Buscando materiales compatibles." />
  }
  if (!report) {
    return (
      <ErrorState title="No hay evaluación" action={<ButtonLink to={`/proyectos/${projectId}/necesidades/${needId}`}>Volver</ButtonLink>}>
        <p>{error || 'La necesidad no admite esta búsqueda.'}</p>
      </ErrorState>
    )
  }

  const place = [report.need.city, report.need.department].filter(Boolean).join(', ')

  return (
    <div className={page.page}>
      <PageHeader
        eyebrow="Matching de materiales"
        title={report.need.title}
        actions={
          <>
            <ButtonLink to={`/proyectos/${projectId}/necesidades/${needId}`}>Volver a la necesidad</ButtonLink>
            <Button type="button" variant="primary" disabled={loading} onClick={() => void save()}>Buscar y guardar</Button>
          </>
        }
      >
        <p>
          {report.need.projectTitle}. Se requieren {formatQuantity(String(report.need.requiredQuantity))} {report.need.unitName}
          {place ? ` en ${place}` : ''}.
        </p>
      </PageHeader>
      {error ? <p role="alert">{error}</p> : null}
      <p className={styles.disclaimer}>{report.disclaimer} Las coberturas no se suman como material asegurado.</p>
      <div className={styles.meta}>
        <Badge>Evaluados {report.summary.evaluated}</Badge>
        <Badge tone="info">Con datos {report.summary.compatible}</Badge>
        <Badge tone="warning">Información insuficiente {report.summary.insufficient}</Badge>
        <Badge>Incompatibles {report.summary.incompatible}</Badge>
      </div>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          setDepartment(String(data.get('department') ?? ''))
          setCategory(String(data.get('category') ?? ''))
          setMinCoverage(String(data.get('minCoverage') ?? ''))
          setResultPage(1)
        }}
      >
        <label>
          Nivel
          <select value={level} onChange={(event) => { setLevel(event.target.value); setResultPage(1) }}>
            <option value="">Todos</option>
            <option value="high">Coincidencia alta</option>
            <option value="medium">Coincidencia media</option>
            <option value="low">Coincidencia baja</option>
            <option value="insufficient">Información insuficiente</option>
          </select>
        </label>
        <label>
          Categoría
          <input name="category" defaultValue={category} placeholder="Nombre del catálogo" />
        </label>
        <label>
          Departamento
          <input name="department" defaultValue={department} placeholder="Departamento" />
        </label>
        <label>
          Cobertura mínima
          <input name="minCoverage" defaultValue={minCoverage} inputMode="decimal" placeholder="0 a 100" />
        </label>
        <label>
          Orden
          <select value={sort} onChange={(event) => { setSort(event.target.value); setResultPage(1) }}>
            <option value="score">Mayor puntuación</option>
            <option value="coverage">Mayor cobertura</option>
            <option value="proximity">Municipio más cercano</option>
            <option value="updated">Actualización más reciente</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={pendingTechnical} onChange={(event) => { setPendingTechnical(event.target.checked); setResultPage(1) }} />
          Información técnica pendiente
        </label>
        <Button type="submit">Aplicar filtros</Button>
      </form>
      {report.matches.length === 0 && report.excluded.length === 0 ? (
        <EmptyState icon="info" title="Sin candidatos">
          <p>No hay materiales publicados y disponibles que esta organización pueda evaluar.</p>
        </EmptyState>
      ) : null}
      {report.matches.length === 0 && report.excluded.length > 0 ? (
        <EmptyState icon="alert" title="Sin coincidencias compatibles">
          <p>Los materiales visibles no superaron los requisitos obligatorios.</p>
        </EmptyState>
      ) : null}
      <div className={styles.layout}>
        {report.matches.map((item) => (
          <article key={item.materialId} className={styles.card}>
            <div className={styles.actions}>
              <Badge tone={item.classification === 'insufficient' ? 'warning' : 'info'}>{classificationLabels[item.classification] ?? item.classification}</Badge>
              <Badge>{geographyLabels[item.geographyLevel] ?? item.geographyLevel}</Badge>
            </div>
            <h2>{item.title}</h2>
            <p>{item.organizationName} · {item.categoryName}</p>
            {item.observedScore !== null ? (
              <p className={styles.score}>{percent.format(item.observedScore)}</p>
            ) : (
              <p className={styles.unknown}>Sin puntuación concluyente</p>
            )}
            <p>Información evaluada: {percent.format(item.evaluableRatio)} %. Un factor desconocido no suma puntos y tampoco se trata como incompatible.</p>
            <p>
              Disponible: {formatQuantity(String(item.availableQuantity))} {item.unitName}. Necesidad: {formatQuantity(String(item.requiredQuantity))} {item.unitName}.
              Cobertura: {item.coveragePercent === null ? 'No calculada' : `${percent.format(item.coveragePercent)} %`}.
            </p>
            <p>{item.city}, {item.department}</p>
            <div className={styles.factors}>
              {item.factors.map((factor) => (
                <div key={factor.key} className={styles.factor}>
                  <strong>{factorLabels[factor.key] ?? factor.key}</strong>
                  {factor.state === 'unknown' ? (
                    <p className={styles.unknown}>Sin información suficiente</p>
                  ) : (
                    <div className={styles.track} aria-hidden="true"><span style={{ width: `${factor.score ?? 0}%` }} /></div>
                  )}
                  <small>{factor.summary}</small>
                </div>
              ))}
            </div>
            <p>{item.explanation}</p>
            {explanations[item.materialId] ? <p>{explanations[item.materialId]}</p> : null}
            <p className={styles.note}>Revisión técnica del material: {item.technicalValidationStatus}. Un pasaporte no certifica este uso.</p>
            <div className={styles.actions}>
              <Button type="button" variant="quiet" disabled={explaining === item.materialId} onClick={() => void explain(item.materialId)}>
                {explaining === item.materialId ? 'Explicando…' : 'Explicar cobertura'}
              </Button>
              {item.passportPath ? <ButtonLink to={item.passportPath}>Ver pasaporte</ButtonLink> : null}
              {item.inventoryPath ? <ButtonLink to={item.inventoryPath}>Ver en inventario</ButtonLink> : null}
              <ButtonLink to={`/solicitudes/nueva?materialId=${item.materialId}&needId=${report.need.id}`}>Solicitar material</ButtonLink>
            </div>
          </article>
        ))}
      </div>
      {report.excluded.length > 0 ? (
        <section className={styles.panel}>
          <h2>No evaluables</h2>
          <ul>
            {report.excluded.map((item) => (
              <li key={item.materialId}><strong>{item.title}:</strong> {item.explanation}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.total > report.matches.length ? (
        <div className={styles.actions}>
          <p className={styles.note}>Página {resultPage}. Hay {report.total} coincidencias.</p>
          <Button type="button" disabled={resultPage <= 1} onClick={() => setResultPage((current) => Math.max(1, current - 1))}>Anterior</Button>
          <Button type="button" disabled={resultPage * report.pageSize >= report.total} onClick={() => setResultPage((current) => current + 1)}>Siguiente</Button>
        </div>
      ) : null}
    </div>
  )
}
