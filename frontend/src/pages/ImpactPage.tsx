import { useEffect, useState, type FormEvent } from 'react'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { Input } from '../components/ui/Input.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { Select } from '../components/ui/Select.tsx'
import { Textarea } from '../components/ui/Textarea.tsx'
import { ApiError, api } from '../features/auth/api.ts'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import {
  approveMethodology,
  calculateEstimate,
  createFactor,
  createMethodology,
  downloadReport,
  impactQuery,
  issueReport,
  loadFactors,
  loadMethodologies,
  loadOrganizationImpact,
  loadOverview,
  loadProjectImpact,
  loadTimeline,
  updateFactorStatus,
} from '../features/impact/api.ts'
import styles from '../features/impact/impact.module.css'
import type {
  ImpactFactor,
  ImpactOverview,
  Methodology,
  OrganizationImpact,
  ProjectImpact,
  QuantityRow,
  ReportDetail,
  TimelinePoint,
} from '../features/impact/types.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import page from './screen.module.css'

const evidenceLabels: Record<string, string> = {
  declared: 'Declarado',
  documented: 'Documentado',
  reviewed: 'Revisado',
  technically_verified: 'Verificado técnicamente',
}

const sectionLabels: Record<string, string> = {
  operational: 'Datos operacionales confirmados',
  estimate: 'Estimaciones ambientales',
  unavailable: 'Datos no disponibles',
}

function quantities(rows: QuantityRow[]): string {
  if (rows.length === 0) return 'Sin cantidad en este alcance'
  return rows.map((row) => `${formatQuantity(String(row.quantity))} ${row.unitCode}`).join(' · ')
}

function percent(value: number | null): string {
  return value === null ? 'No calculable' : `${formatQuantity(String(value))} %`
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function QuantityBars({ rows }: { rows: QuantityRow[] }) {
  if (rows.length === 0) return <p className={styles.note}>Sin cantidades para esta vista.</p>
  const peak = Math.max(...rows.map((row) => Math.abs(row.quantity)), 0)
  return (
    <div className={styles.bars}>
      {rows.map((row) => (
        <div key={row.unitCode} className={styles.bar}>
          <span>{row.unitCode}</span>
          <div className={styles.track} aria-hidden="true">
            <div className={styles.fill} style={{ width: peak === 0 ? '0%' : `${(Math.abs(row.quantity) / peak) * 100}%` }} />
          </div>
          <strong>{formatQuantity(String(row.quantity))} {row.unitCode}</strong>
        </div>
      ))}
    </div>
  )
}

function TimelineChart({ points }: { points: TimelinePoint[] }) {
  const units = [...new Set(points.map((point) => point.unitCode))]
  if (points.length === 0) {
    return (
      <EmptyState icon="impact" title="Sin recepciones en el período">
        <p>La serie solo incluye cantidades recibidas y confirmadas, separadas por unidad.</p>
      </EmptyState>
    )
  }
  return (
    <div className={styles.bars}>
      {units.map((unit) => {
        const rows = points.filter((point) => point.unitCode === unit)
        const peak = Math.max(...rows.map((row) => row.quantity), 0)
        return (
          <section key={unit} className={styles.panel}>
            <h3>Unidad {unit}</h3>
            {rows.map((row) => (
              <div key={`${row.period}-${unit}`} className={styles.bar}>
                <span>{row.period}</span>
                <div className={styles.track} aria-hidden="true">
                  <div className={styles.fill} style={{ width: peak === 0 ? '0%' : `${(row.quantity / peak) * 100}%` }} />
                </div>
                <strong>{formatQuantity(String(row.quantity))} {unit}</strong>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export function ImpactPage() {
  const auth = useAuth()
  const memberships = auth.memberships.filter((item) => item.membershipStatus === 'active')
  const [organizationId, setOrganizationId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [grain, setGrain] = useState<'day' | 'month' | 'year'>('month')
  const [projects, setProjects] = useState<Array<{ id: number; title: string }>>([])
  const [overview, setOverview] = useState<ImpactOverview | null>(null)
  const [points, setPoints] = useState<TimelinePoint[]>([])
  const [timelineNote, setTimelineNote] = useState('')
  const [project, setProject] = useState<ProjectImpact | null>(null)
  const [organization, setOrganization] = useState<OrganizationImpact | null>(null)
  const [methodologies, setMethodologies] = useState<Methodology[]>([])
  const [factors, setFactors] = useState<ImpactFactor[]>([])
  const [factorNotice, setFactorNotice] = useState('')
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [insight, setInsight] = useState('')
  const [insightBusy, setInsightBusy] = useState(false)

  const selected = memberships.find((item) => String(item.organizationId) === organizationId)
  const canManage = selected?.role === 'owner' || selected?.role === 'administrator'
  const canIssue = canManage || selected?.role === 'editor'
  const query = impactQuery({ organizationId, projectId, from, to, grain })

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    let cancelled = false
    api<{ projects: Array<{ id: number; title: string }> }>('/api/projects?pageSize=50')
      .then((result) => {
        if (!cancelled) setProjects(result.projects)
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [auth.status])

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    if (memberships.length === 0) {
      setLoading(false)
      setError('')
      setOverview(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    const loaders = [
      loadOverview(query).then((result) => {
        if (!cancelled) setOverview(result)
      }),
      loadTimeline(query).then((result) => {
        if (!cancelled) {
          setPoints(result.points)
          setTimelineNote(result.limitation)
        }
      }),
      projectId
        ? loadProjectImpact(projectId, query).then((result) => {
            if (!cancelled) setProject(result)
          })
        : Promise.resolve().then(() => {
            if (!cancelled) setProject(null)
          }),
      organizationId
        ? loadOrganizationImpact(organizationId, query).then((result) => {
            if (!cancelled) setOrganization(result)
          })
        : Promise.resolve().then(() => {
            if (!cancelled) setOrganization(null)
          }),
      organizationId
        ? loadMethodologies(organizationId).then((result) => {
            if (!cancelled) setMethodologies(result.methodologies)
          })
        : Promise.resolve().then(() => {
            if (!cancelled) setMethodologies([])
          }),
      organizationId
        ? loadFactors(organizationId).then((result) => {
            if (!cancelled) {
              setFactors(result.factors)
              setFactorNotice(result.notice)
            }
          })
        : Promise.resolve().then(() => {
            if (!cancelled) {
              setFactors([])
              setFactorNotice('')
            }
          }),
    ]
    Promise.all(loaders)
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause, 'No se pudieron cargar los indicadores.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [auth.status, memberships.length, query, organizationId, projectId, reloadKey])

  async function onReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organizationId || !from || !to) {
      setNotice('El informe necesita una organización y un período.')
      return
    }
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const methodologyValue = String(form.get('methodologyId') ?? '')
    setBusy(true)
    setNotice('')
    try {
      const issued = await issueReport({
        organizationId: Number(organizationId),
        projectId: projectId ? Number(projectId) : undefined,
        from,
        to,
        methodologyId: methodologyValue ? Number(methodologyValue) : undefined,
      })
      setReport(issued)
      setNotice(`Informe ${issued.report.publicCode} emitido. Conserva las cifras de este momento.`)
    } catch (cause: unknown) {
      setNotice(messageOf(cause, 'No se pudo emitir el informe.'))
    } finally {
      setBusy(false)
    }
  }

  async function onEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const factorId = String(form.get('factorId') ?? '')
    if (!organizationId || !from || !to || !factorId) {
      setNotice('La estimación necesita organización, período y un factor aprobado.')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const result = await calculateEstimate({
        organizationId: Number(organizationId),
        projectId: projectId ? Number(projectId) : undefined,
        factorId: Number(factorId),
        from,
        to,
      })
      setNotice(result.calculation.status === 'calculated'
        ? `Estimación ${result.calculation.resultValue} ${result.calculation.resultUnit ?? ''}. No es una certificación.`
        : (result.calculation.reason ?? 'No calculable: faltan datos o factores validados.'))
      setReloadKey((value) => value + 1)
    } catch (cause: unknown) {
      setNotice(messageOf(cause, 'No se pudo calcular la estimación.'))
    } finally {
      setBusy(false)
    }
  }

  async function onMethodology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setNotice('')
    try {
      await createMethodology({
        organizationId: Number(organizationId),
        name: String(form.get('name') ?? ''),
        versionLabel: String(form.get('versionLabel') ?? ''),
        statement: String(form.get('statement') ?? ''),
        limitations: String(form.get('limitations') ?? ''),
      })
      formElement.reset()
      setReloadKey((value) => value + 1)
      setNotice('Metodología registrada en borrador. No queda aprobada sola.')
    } catch (cause: unknown) {
      setNotice(messageOf(cause, 'No se pudo registrar la metodología.'))
    } finally {
      setBusy(false)
    }
  }

  async function onFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const sourceUrl = String(form.get('sourceUrl') ?? '').trim()
    const uncertainty = String(form.get('uncertainty') ?? '').trim()
    setBusy(true)
    setNotice('')
    try {
      await createFactor({
        methodologyId: Number(form.get('methodologyId')),
        impactKind: String(form.get('impactKind') ?? ''),
        inputUnitCode: String(form.get('inputUnitCode') ?? ''),
        outputUnit: String(form.get('outputUnit') ?? ''),
        value: Number(form.get('value')),
        sourceName: String(form.get('sourceName') ?? ''),
        sourceUrl: sourceUrl || undefined,
        issuerName: String(form.get('issuerName') ?? ''),
        year: Number(form.get('year')),
        regionName: String(form.get('regionName') ?? ''),
        versionLabel: String(form.get('versionLabel') ?? ''),
        conditions: String(form.get('conditions') ?? ''),
        uncertainty: uncertainty || undefined,
      })
      formElement.reset()
      setReloadKey((value) => value + 1)
      setNotice('Factor registrado en borrador. No es un factor oficial.')
    } catch (cause: unknown) {
      setNotice(messageOf(cause, 'No se pudo registrar el factor.'))
    } finally {
      setBusy(false)
    }
  }

  async function explainIndicators() {
    setInsightBusy(true)
    try {
      const result = await api<{ narrative: string }>('/api/ai/impact/explain', {
        method: 'POST',
        body: {
          organizationId: organizationId ? Number(organizationId) : undefined,
          projectId: projectId ? Number(projectId) : undefined,
        },
      })
      setInsight(result.narrative)
    } catch (caught) {
      setInsight(messageOf(caught, 'No se pudo explicar el indicador.'))
    } finally {
      setInsightBusy(false)
    }
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Fase 10" title="IMPACT ENGINE — Centro de Impacto">
        <p>
          Los indicadores de reutilización usan cantidades recibidas y confirmadas. Una recepción no demuestra instalación,
          disposición evitada ni emisiones evitadas. No hay factores oficiales precargados.
        </p>
      </PageHeader>
      <div className={styles.filters}>
        <Button type="button" variant="quiet" disabled={insightBusy} onClick={() => void explainIndicators()}>
          {insightBusy ? 'Explicando…' : 'Explicar indicadores'}
        </Button>
      </div>
      {insight ? <p>{insight}</p> : null}

      {memberships.length === 0 ? (
        <EmptyState icon="impact" title="Sin organización">
          <p>Los indicadores se calculan dentro de las organizaciones a las que perteneces.</p>
        </EmptyState>
      ) : (
        <div className={styles.filters}>
          <Select
            label="Organización"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            options={[{ value: '', label: 'Todas mis organizaciones' }, ...memberships.map((item) => ({ value: String(item.organizationId), label: item.organizationName }))]}
          />
          <Select
            label="Proyecto"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            options={[{ value: '', label: 'Todos los proyectos visibles' }, ...projects.map((item) => ({ value: String(item.id), label: item.title }))]}
          />
          <Input label="Desde" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input label="Hasta" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <Select
            label="Evolución"
            value={grain}
            onChange={(event) => setGrain(event.target.value as 'day' | 'month' | 'year')}
            options={[
              { value: 'day', label: 'Por día' },
              { value: 'month', label: 'Por mes' },
              { value: 'year', label: 'Por año' },
            ]}
          />
        </div>
      )}

      {error ? <ErrorState title="No se pudo mostrar el impacto"><p>{error}</p></ErrorState> : null}
      {notice ? <p className={styles.note} role="status">{notice}</p> : null}
      {loading && memberships.length > 0 ? <LoadingState label="Calculando indicadores" /> : null}

      {overview ? (
        <>
          <section className={styles.metrics} aria-label="Resumen">
            <article className={styles.metric}>
              <Badge tone="info">{evidenceLabels[overview.evidenceLevel] ?? overview.evidenceLevel}</Badge>
              <h2>Recibidos confirmados</h2>
              <strong>{quantities(overview.receivedByUnit)}</strong>
              <p>{overview.limitation}</p>
            </article>
            <article className={styles.metric}>
              <h2>Operaciones completadas</h2>
              <strong>{overview.completedOperations}</strong>
              <p>Acuerdos cuya recepción confirmada alcanza la cantidad acordada.</p>
            </article>
            <article className={styles.metric}>
              <h2>Organizaciones participantes</h2>
              <strong>{overview.participatingOrganizations}</strong>
              <p>{overview.scope === 'memberships' ? 'Cada transferencia se cuenta una vez en tus organizaciones.' : 'Alcance de la organización seleccionada.'}</p>
            </article>
            <article className={styles.metric}>
              <h2>Proyectos beneficiados</h2>
              <strong>{overview.benefitedProjects}</strong>
              <p>Proyectos con al menos una recepción confirmada en el período.</p>
            </article>
            <article className={styles.metric}>
              <h2>Masa recuperada</h2>
              <strong>{overview.mass.status === 'calculated' ? `${formatQuantity(String(overview.mass.kilograms))} kg` : 'No calculable'}</strong>
              <p>{overview.mass.message}</p>
            </article>
            <article className={styles.metric}>
              <h2>Estimación ambiental</h2>
              <strong>
                {overview.environmental.status === 'estimated'
                  ? `${formatQuantity(String(overview.environmental.value))} ${overview.environmental.unit}`
                  : 'No calculable'}
              </strong>
              <p>{overview.environmental.message}</p>
            </article>
          </section>

          <section className={styles.panel}>
            <h2>Flujos que no son recepción</h2>
            <p>{overview.inventoryNote}</p>
            <p>Publicado: {quantities(overview.publishedByUnit)}</p>
            <p>Disponible: {quantities(overview.availableByUnit)}</p>
            <p>Reservado: {quantities(overview.reservedByUnit)}</p>
            <p>Despachado: {quantities(overview.dispatchedByUnit)}</p>
            <p>Pendiente de recepción: {quantities(overview.pendingReceiptByUnit)}</p>
            <p>Incidencias: {overview.incidents}</p>
            <p>Cumplimiento medio de acuerdos con recepción: {percent(overview.agreementFulfillmentPercent)}</p>
            <p>Tiempo medio de operación: {overview.operationDays === null ? 'No calculable' : `${formatQuantity(String(overview.operationDays))} días (${overview.operationSample} operaciones)`}</p>
          </section>

          <section className={styles.panel}>
            <h2>Evolución de recepciones</h2>
            <p>{timelineNote}</p>
            <TimelineChart points={points} />
          </section>

          <section className={styles.panel}>
            <h2>Distribución recibida por unidad</h2>
            <QuantityBars rows={overview.receivedByUnit} />
          </section>

          <section className={styles.panel}>
            <h2>Distribución por categoría</h2>
            <p className={styles.note}>Cada barra conserva su unidad. Categorías distintas no se suman entre sí.</p>
            {overview.receivedByCategory.length === 0 ? <p>Sin recepciones confirmadas en este alcance.</p> : (
              <ul className={styles.needs}>
                {overview.receivedByCategory.map((row) => (
                  <li key={`${row.category}-${row.unitCode}`}>{row.category}: {formatQuantity(String(row.quantity))} {row.unitCode}</li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.panel}>
            <h2>Incorporación al proyecto</h2>
            <strong>No documentada</strong>
            <p>{overview.incorporation.message}</p>
          </section>
        </>
      ) : null}

      {project ? (
        <section className={styles.panel}>
          <h2>Impacto del proyecto</h2>
          <p>{project.limitation}</p>
          {project.needs.length === 0 ? <p className={styles.note}>Este proyecto no tiene necesidades.</p> : null}
          <div className={styles.needs}>
            {project.needs.map((need) => (
              <article key={need.id} className={styles.need}>
                <h3>{need.title}</h3>
                <p>Requerida: {formatQuantity(String(need.requiredQuantity))} {need.unitCode}</p>
                <p>Recibida y confirmada: {formatQuantity(String(need.receivedQuantity))} {need.unitCode}</p>
                <p>Pendiente de la necesidad: {formatQuantity(String(need.pendingQuantity))} {need.unitCode}</p>
                <strong>Cobertura: {percent(need.coveragePercent)}</strong>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {organization ? (
        <section className={styles.panel}>
          <h2>Impacto de la organización</h2>
          <p>{organization.limitation}</p>
          <p>Suministrado y confirmado por el destinatario: {quantities(organization.suppliedByUnit)}</p>
          <p>Recibido y confirmado: {quantities(organization.receivedByUnit)}</p>
          <Badge>{evidenceLabels[organization.evidenceLevel] ?? organization.evidenceLevel}</Badge>
        </section>
      ) : overview ? (
        <p className={styles.note}>Elige una organización para ver por separado lo suministrado y lo recibido. Esas dos cifras no se suman.</p>
      ) : null}

      {overview ? (
        <section className={styles.panel}>
          <h2>Metodologías y evidencia</h2>
          {overview.definitions.map((item) => (
            <details key={item.code} className={styles.definition}>
              <summary>{item.name}</summary>
              <p>{item.definition}</p>
              <p>Unidad: {item.unit}</p>
              <p>Fórmula: {item.formula}</p>
              <p>Fuente: {item.source}</p>
              <p>Evidencia: {evidenceLabels[item.evidenceLevel] ?? item.evidenceLevel}</p>
              <p>Limitación: {item.limitation}</p>
            </details>
          ))}
        </section>
      ) : null}

      {organizationId && canIssue ? (
        <section className={styles.panel}>
          <h2>Informes</h2>
          <p>El informe guarda las cifras y la metodología usadas al emitirlo. No es un certificado ambiental.</p>
          <form className={styles.fields} onSubmit={onReport}>
            <Select
              label="Metodología del informe"
              name="methodologyId"
              options={[{ value: '', label: 'Sin metodología ambiental' }, ...methodologies.map((item) => ({ value: String(item.id), label: `${item.name} ${item.versionLabel}` }))]}
            />
            <Button type="submit" disabled={busy}>Generar informe</Button>
          </form>
          {report ? (
            <div className={styles.needs}>
              <p>Identificador {report.report.publicCode}. Período {report.report.periodStart} a {report.report.periodEnd}.</p>
              <div className={styles.actions}>
                <Button variant="quiet" disabled={busy} onClick={() => downloadReport(report.report.id, 'pdf').catch((cause: unknown) => setNotice(messageOf(cause, 'No se pudo descargar el PDF.')))}>Descargar PDF</Button>
                <Button variant="quiet" disabled={busy} onClick={() => downloadReport(report.report.id, 'csv').catch((cause: unknown) => setNotice(messageOf(cause, 'No se pudo descargar el CSV.')))}>Descargar CSV</Button>
              </div>
              {(['operational', 'estimate', 'unavailable'] as const).map((section) => {
                const items = report.items.filter((item) => item.section === section)
                if (items.length === 0) return null
                return (
                  <article key={section} className={styles.need}>
                    <h3>{sectionLabels[section]}</h3>
                    {items.map((item) => (
                      <p key={`${item.code}-${item.unitCode ?? 'none'}`}>{item.label}: {item.value}{item.unitCode ? ` ${item.unitCode}` : ''}. Evidencia {evidenceLabels[item.evidenceLevel] ?? item.evidenceLevel}. {item.limitations}</p>
                    ))}
                  </article>
                )
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {organizationId ? (
        <section className={styles.panel}>
          <h2>Catálogo de la organización</h2>
          <p>{factorNotice || 'No hay factores oficiales precargados.'}</p>
          {methodologies.length === 0 && factors.length === 0 ? <p className={styles.note}>Todavía no hay metodologías ni factores de esta organización.</p> : null}
          <div className={styles.catalog}>
            {methodologies.map((item) => (
              <article key={item.id} className={styles.factor}>
                <h3>{item.name} · {item.versionLabel}</h3>
                <Badge>{item.status}</Badge>
                <p>{item.statement}</p>
                <p>{item.limitations}</p>
                {canManage && item.status === 'draft' ? (
                  <Button variant="quiet" disabled={busy} onClick={() => {
                    setBusy(true)
                    approveMethodology(item.id)
                      .then(() => {
                        setNotice('Metodología aprobada para esta organización.')
                        setReloadKey((value) => value + 1)
                      })
                      .catch((cause: unknown) => setNotice(messageOf(cause, 'No se pudo aprobar la metodología.')))
                      .finally(() => setBusy(false))
                  }}>Aprobar metodología</Button>
                ) : null}
                {item.locked ? <p>Esta versión ya se usó en un informe y no se modifica.</p> : null}
              </article>
            ))}
            {factors.map((item) => (
              <article key={item.id} className={styles.factor}>
                <h3>{item.impactKind} · {item.value} {item.outputUnit} por {item.inputUnitCode}</h3>
                <Badge>{item.status}</Badge>
                <p>{item.sourceName}. {item.issuerName}, {item.year}, {item.regionName}, versión {item.versionLabel}.</p>
                <p>{item.conditions}</p>
                {canManage && item.status === 'draft' ? <Button variant="quiet" disabled={busy} onClick={() => changeFactor(item.id, 'reviewed')}>Marcar revisado</Button> : null}
                {canManage && item.status === 'reviewed' ? <Button variant="quiet" disabled={busy} onClick={() => changeFactor(item.id, 'approved')}>Aprobar factor</Button> : null}
                {canManage && item.status !== 'retired' ? <Button variant="quiet" disabled={busy} onClick={() => changeFactor(item.id, 'retired')}>Retirar factor</Button> : null}
              </article>
            ))}
          </div>

          {canManage ? (
            <form className={styles.fields} onSubmit={onEstimate}>
              <h3>Calcular una estimación</h3>
              <Select
                label="Factor aprobado"
                name="factorId"
                options={[{ value: '', label: 'Selecciona un factor' }, ...factors.filter((item) => item.status === 'approved').map((item) => ({ value: String(item.id), label: `${item.publicCode} · ${item.outputUnit}` }))]}
              />
              <Button type="submit" disabled={busy}>Calcular con el factor elegido</Button>
            </form>
          ) : null}

          {canManage ? (
            <form className={styles.fields} onSubmit={onMethodology}>
              <h3>Registrar metodología</h3>
              <Input label="Nombre" name="name" required maxLength={160} />
              <Input label="Versión" name="versionLabel" required maxLength={40} />
              <Textarea label="Enunciado" name="statement" required maxLength={4000} />
              <Textarea label="Limitaciones" name="limitations" required maxLength={2000} />
              <Button type="submit" disabled={busy}>Guardar metodología</Button>
            </form>
          ) : null}

          {canManage && methodologies.length > 0 ? (
            <form className={styles.fields} onSubmit={onFactor}>
              <h3>Registrar factor</h3>
              <p className={styles.note}>Escribe el valor, la fuente y la región que correspondan. REOBRA no propone un factor oficial.</p>
              <Select label="Metodología" name="methodologyId" options={methodologies.map((item) => ({ value: String(item.id), label: `${item.name} ${item.versionLabel}` }))} />
              <Input label="Tipo de impacto" name="impactKind" required maxLength={40} />
              <Input label="Unidad de entrada" name="inputUnitCode" required maxLength={16} hint="Por ejemplo kg, t o unit." />
              <Input label="Unidad de salida" name="outputUnit" required maxLength={40} />
              <Input label="Valor" name="value" type="number" step="any" required />
              <Input label="Fuente" name="sourceName" required maxLength={200} />
              <Input label="URL de referencia" name="sourceUrl" type="url" maxLength={500} />
              <Input label="Entidad emisora" name="issuerName" required maxLength={200} />
              <Input label="Año" name="year" type="number" min={1900} max={2200} required />
              <Input label="Región" name="regionName" required maxLength={120} />
              <Input label="Versión del factor" name="versionLabel" required maxLength={40} />
              <Textarea label="Condiciones de uso" name="conditions" required maxLength={2000} />
              <Input label="Incertidumbre" name="uncertainty" maxLength={500} />
              <Button type="submit" disabled={busy}>Guardar factor en borrador</Button>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  )

  function changeFactor(factorId: number, status: 'reviewed' | 'approved' | 'retired') {
    setBusy(true)
    updateFactorStatus(factorId, status)
      .then(() => {
        setNotice(status === 'retired' ? 'Factor retirado. Los informes ya emitidos conservan su versión.' : 'Estado del factor actualizado.')
        setReloadKey((value) => value + 1)
      })
      .catch((cause: unknown) => setNotice(messageOf(cause, 'No se pudo actualizar el factor.')))
      .finally(() => setBusy(false))
  }
}
