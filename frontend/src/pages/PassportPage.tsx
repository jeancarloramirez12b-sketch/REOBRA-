import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge } from '../components/ui/Badge.tsx'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { Input } from '../components/ui/Input.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { availabilityLabels, technicalLabels } from '../features/materials/labels.ts'
import { visibilityLabels } from '../features/passports/labels.ts'
import styles from '../features/passports/passports.module.css'
import page from './screen.module.css'

type PassportSummary = {
  publicCode: string
  title: string
  categoryName: string
  visibility: string
  availabilityStatus: string
  technicalValidationStatus: string
  organizationName: string
  registeredAt: string
}

type PassportList = {
  passports: PassportSummary[]
  page: number
  pageSize: number
  total: number
}

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

export function PassportPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [code, setCode] = useState('')
  const [rows, setRows] = useState<PassportSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pageNumber = Math.max(1, Number(params.get('page') ?? '1') || 1)

  useEffect(() => {
    setSearch(params.get('q') ?? '')
  }, [params])

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
    query.set('page', String(pageNumber))
    query.set('pageSize', '12')
    const term = params.get('q')?.trim() ?? ''
    if (term) {
      query.set('q', term)
    }
    void api<PassportList>(`/api/passports?${query.toString()}`)
      .then((payload) => {
        if (!active) {
          return
        }
        setRows(payload.passports)
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
        setError(caught instanceof ApiError ? caught.message : 'No se pudieron consultar los pasaportes.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [auth.status, navigate, pageNumber, params])

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

  function openCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = code.trim().toLowerCase()
    if (!/^rob_[a-z0-9]{20}$/.test(value)) {
      setError('El identificador público debe tener la forma rob_ seguido de 20 caracteres.')
      return
    }
    navigate(`/pasaporte/${value}`)
  }

  if (auth.status === 'loading' || (auth.status === 'authenticated' && loading)) {
    return <LoadingState label="Consultando pasaportes." />
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Trazabilidad" title="Pasaporte digital">
        <p>
          Cada material tiene una identidad pública estable. El pasaporte reúne los datos declarados, las evidencias y el
          historial. No es una certificación técnica.
        </p>
      </PageHeader>
      <form className={styles.filters} onSubmit={openCode}>
        <Input label="Abrir por identificador" value={code} onChange={(event) => setCode(event.target.value)} placeholder="rob_…" maxLength={24} />
        <Button type="submit">Abrir</Button>
      </form>
      {auth.status !== 'authenticated' ? (
        <EmptyState icon="passport" title="Inicia sesión para ver los pasaportes de tu organización">
          <p>Sin sesión solo se abre un pasaporte si su organización lo publicó expresamente y conoces su identificador.</p>
          <ButtonLink to="/ingresar" variant="primary">Ingresar</ButtonLink>
        </EmptyState>
      ) : null}
      {auth.status === 'authenticated' ? (
        <form className={styles.filters} onSubmit={submitSearch}>
          <Input label="Buscar" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, categoría o identificador" maxLength={120} />
          <Button type="submit">Buscar</Button>
        </form>
      ) : null}
      {error ? (
        <ErrorState title="No se pudo consultar">
          <p>{error}</p>
        </ErrorState>
      ) : null}
      {auth.status === 'authenticated' && !error && total === 0 ? (
        <EmptyState icon="passport" title={params.get('q') ? 'Ningún pasaporte coincide' : 'Todavía no hay pasaportes en tus organizaciones'}>
          <p>El pasaporte se emite al registrar un material. No se crea un inventario aparte.</p>
          <ButtonLink to="/inventario" variant="primary">Ir al inventario</ButtonLink>
        </EmptyState>
      ) : null}
      {auth.status === 'authenticated' && total > 0 ? (
        <>
          <p className={styles.meta}>{total} {total === 1 ? 'pasaporte' : 'pasaportes'}</p>
          <ul className={styles.list}>
            {rows.map((item) => (
              <li key={item.publicCode} className={styles.card}>
                <p className={styles.code}>{item.publicCode}</p>
                <h2>
                  <ButtonLink to={`/pasaporte/${item.publicCode}`}>{item.title}</ButtonLink>
                </h2>
                <p className={styles.meta}>
                  {item.categoryName} · {item.organizationName}
                </p>
                <div className={styles.actions}>
                  <Badge tone={item.visibility === 'public' ? 'info' : 'neutral'}>{visibilityLabels[item.visibility] ?? item.visibility}</Badge>
                  <Badge>{availabilityLabels[item.availabilityStatus] ?? item.availabilityStatus}</Badge>
                  <Badge tone="warning">{technicalLabels[item.technicalValidationStatus] ?? item.technicalValidationStatus}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
