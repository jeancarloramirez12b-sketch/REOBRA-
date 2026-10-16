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
import { MaterialPhoto } from '../features/materials/MaterialPhoto.tsx'
import { availabilityLabels, availabilityTone, technicalLabels, technicalTone } from '../features/materials/labels.ts'
import { canWriteMaterials, formatQuantity, inventoryEmptyKind } from '../features/materials/rules.ts'
import styles from '../features/materials/materials.module.css'
import type { CategoryOption, MaterialList, MaterialRecord } from '../features/materials/types.ts'
import page from './screen.module.css'

const pageSize = 12

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

function queryString(values: URLSearchParams): string {
  const query = new URLSearchParams()
  query.set('pageSize', String(pageSize))
  query.set('sort', 'updated_at')
  query.set('direction', 'desc')
  for (const key of ['q', 'categoryId', 'organizationId', 'status', 'availability', 'page'] as const) {
    const value = values.get(key)?.trim() ?? ''
    if (value) {
      query.set(key, value)
    }
  }
  if (!query.get('page')) {
    query.set('page', '1')
  }
  return query.toString()
}

export function InventoryPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [materials, setMaterials] = useState<MaterialRecord[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const pageNumber = Math.max(1, Number(params.get('page') ?? '1') || 1)
  const filtering = ['q', 'categoryId', 'organizationId', 'status', 'availability'].some((key) => (params.get(key) ?? '').trim().length > 0)
  const memberships = auth.memberships.filter((item) => item.membershipStatus === 'active')
  const canRegister = memberships.some((item) => canWriteMaterials(item.role))
  const emptyKind = inventoryEmptyKind({ hasMembership: memberships.length > 0, total, filtering })

  useEffect(() => {
    setSearch(params.get('q') ?? '')
  }, [params])

  useEffect(() => {
    if (auth.status === 'loading') {
      return
    }
    if (auth.status === 'expired') {
      navigate('/sesion-expirada', { replace: true })
      return
    }
    if (auth.status !== 'authenticated') {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError('')
    void Promise.all([
      api<MaterialList>(`/api/materials?${queryString(params)}`),
      api<{ categories: CategoryOption[] }>('/api/material-categories'),
    ])
      .then(([list, catalog]) => {
        if (!active) {
          return
        }
        setMaterials(list.materials)
        setTotal(list.total)
        setCategories(catalog.categories)
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
        setError(caught instanceof ApiError ? caught.message : 'No se pudo consultar el inventario.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [auth.status, navigate, params])

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    next.delete('page')
    setParams(next)
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateFilter('q', search.trim())
  }

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(params)
    if (nextPage <= 1) {
      next.delete('page')
    } else {
      next.set('page', String(nextPage))
    }
    setParams(next)
  }

  if (auth.status === 'loading' || (auth.status === 'authenticated' && loading && materials.length === 0 && !error)) {
    return <LoadingState label="Consultando el inventario." />
  }

  if (auth.status === 'anonymous') {
    return (
      <div className={page.page}>
        <EmptyState icon="user" title="Inicia sesión para ver el inventario">
          <p>Los materiales pertenecen a una organización. Esta pantalla no publica un catálogo abierto.</p>
          <ButtonLink to="/ingresar" variant="primary">Ingresar</ButtonLink>
        </EmptyState>
      </div>
    )
  }

  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className={page.page}>
      <PageHeader
        eyebrow="Materiales"
        title="Inventario de materiales"
        actions={
          <>
            {auth.status === 'authenticated' ? <ButtonLink to="/asistente?contexto=inventory">Asistente</ButtonLink> : null}
            {canRegister ? <ButtonLink to="/inventario/nuevo" variant="primary">Registrar material</ButtonLink> : undefined}
          </>
        }
      >
        <p>
          Inventario privado de tus organizaciones. Publicar un material no lo certifica para un uso estructural,
          sanitario, eléctrico o de seguridad.
        </p>
      </PageHeader>

      <form className={styles.filters} onSubmit={submitSearch}>
        <Input label="Buscar" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, categoría o lugar" maxLength={120} />
        <Select
          label="Categoría"
          value={params.get('categoryId') ?? ''}
          onChange={(event) => updateFilter('categoryId', event.target.value)}
          options={[{ value: '', label: 'Todas' }, ...categories.map((item) => ({ value: String(item.id), label: item.name }))]}
        />
        <Select
          label="Estado"
          value={params.get('status') ?? ''}
          onChange={(event) => updateFilter('status', event.target.value)}
          options={[{ value: '', label: 'Todos' }, ...Object.entries(availabilityLabels).map(([value, label]) => ({ value, label }))]}
        />
        <Select
          label="Organización"
          value={params.get('organizationId') ?? ''}
          onChange={(event) => updateFilter('organizationId', event.target.value)}
          options={[{ value: '', label: 'Todas las mías' }, ...memberships.map((item) => ({ value: String(item.organizationId), label: item.organizationName }))]}
        />
        <Select
          label="Disponibilidad"
          value={params.get('availability') ?? ''}
          onChange={(event) => updateFilter('availability', event.target.value)}
          options={[
            { value: '', label: 'Cualquiera' },
            { value: 'available', label: 'Con cantidad disponible' },
            { value: 'unavailable', label: 'Sin cantidad disponible' },
          ]}
        />
        <Button type="submit">Buscar</Button>
      </form>

      {error ? (
        <ErrorState title="No se pudo cargar el inventario">
          <p>{error}</p>
        </ErrorState>
      ) : null}

      {!error && emptyKind === 'no-organization' ? (
        <EmptyState icon="organization" title="Todavía no perteneces a una organización">
          <p>El inventario muestra los materiales de las organizaciones en las que tienes una membresía activa.</p>
          <ButtonLink to="/organizaciones" variant="primary">Ir a organizaciones</ButtonLink>
        </EmptyState>
      ) : null}

      {!error && emptyKind === 'no-materials' ? (
        <EmptyState icon="inventory" title="Esta organización todavía no tiene materiales">
          <p>Cuando registres uno, quedará guardado en la base de datos y seguirá aquí al volver a entrar.</p>
          {canRegister ? <ButtonLink to="/inventario/nuevo" variant="primary">Registrar material</ButtonLink> : null}
        </EmptyState>
      ) : null}

      {!error && emptyKind === 'no-results' ? (
        <EmptyState icon="inventory" title="Ningún material coincide con la búsqueda">
          <p>Prueba con otro nombre, otra categoría o quita los filtros.</p>
          <Button type="button" onClick={() => setParams(new URLSearchParams())}>Limpiar filtros</Button>
        </EmptyState>
      ) : null}

      {!error && emptyKind === 'list' ? (
        <>
          <p className={styles.meta} role="status">
            {total} {total === 1 ? 'material' : 'materiales'}
          </p>
          <ul className={styles.list}>
            {materials.map((material) => (
              <li key={material.id} className={styles.card}>
                <MaterialSummary material={material} />
              </li>
            ))}
          </ul>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Cantidad</th>
                  <th>Lugar</th>
                  <th>Estado</th>
                  <th>Evaluación</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((material) => (
                  <tr key={material.id}>
                    <td>
                      <MaterialSummary material={material} compact />
                    </td>
                    <td>
                      {formatQuantity(material.quantity)} {material.unitCode}
                    </td>
                    <td>
                      {material.city}, {material.department}
                    </td>
                    <td>{availabilityLabels[material.availabilityStatus] ?? material.availabilityStatus}</td>
                    <td>{technicalLabels[material.technicalValidationStatus] ?? material.technicalValidationStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className={styles.pager} aria-label="Páginas del inventario">
            <button type="button" disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}>
              Anterior
            </button>
            <span>
              Página {pageNumber} de {pages}
            </span>
            <button type="button" disabled={pageNumber >= pages} onClick={() => goToPage(pageNumber + 1)}>
              Siguiente
            </button>
          </nav>
        </>
      ) : null}
    </div>
  )
}

function MaterialSummary({ material, compact = false }: { material: MaterialRecord; compact?: boolean }) {
  return (
    <article className={styles.cardHead}>
      {material.primaryImageId ? (
        <MaterialPhoto materialId={material.id} imageId={material.primaryImageId} alt="" compact />
      ) : (
        <span className={compact ? styles.thumbFallback : styles.photoFallback}>Sin imagen</span>
      )}
      <div>
        <p className={styles.code}>{material.code}</p>
        <h2>
          <ButtonLink to={`/inventario/${material.id}`}>{material.title}</ButtonLink>
        </h2>
        <p className={styles.meta}>
          {material.categoryName} · {formatQuantity(material.quantity)} {material.unitName} · {material.city}, {material.department}
        </p>
        <p className={styles.meta}>{material.organizationName}</p>
        <div className={styles.actions}>
          <Badge tone={availabilityTone(material.availabilityStatus)}>
            {availabilityLabels[material.availabilityStatus] ?? material.availabilityStatus}
          </Badge>
          <Badge tone={technicalTone(material.technicalValidationStatus)}>
            {technicalLabels[material.technicalValidationStatus] ?? material.technicalValidationStatus}
          </Badge>
          {material.canEdit ? <ButtonLink to={`/inventario/${material.id}/editar`}>Editar</ButtonLink> : null}
        </div>
      </div>
    </article>
  )
}
