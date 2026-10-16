import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { Input } from '../components/ui/Input.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { NeedCopilot } from '../features/ai/NeedCopilot.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { Select } from '../components/ui/Select.tsx'
import { Textarea } from '../components/ui/Textarea.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import { conditionLabels } from '../features/materials/labels.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import type { CategoryOption, UnitOption } from '../features/materials/types.ts'
import { needStatusLabels, priorityLabels, visibilityLabels } from '../features/projects/labels.ts'
import { validateNeedDraft, type NeedDraft } from '../features/projects/rules.ts'
import styles from '../features/projects/projects.module.css'
import page from './screen.module.css'

const emptyDraft: NeedDraft = {
  title: '',
  description: '',
  categoryId: '',
  unitId: '',
  requiredQuantity: '',
  requiredCondition: 'not_declared',
  priority: 'medium',
  neededBy: '',
  city: '',
  department: '',
  locationDescription: '',
  observations: '',
  specificationName: '',
  specificationValue: '',
  visibility: 'private',
  status: 'open',
}

type NeedRecord = {
  id: number
  title: string
  description: string
  categoryId: number
  unitId: number
  requiredQuantity: string
  requiredCondition: string | null
  priority: string
  neededBy: string | null
  city: string | null
  department: string | null
  locationDescription: string | null
  observations: string | null
  specifications: Array<{ name: string; value: string }>
  visibility: string
  status: string
}

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

export function NeedFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const navigate = useNavigate()
  const params = useParams()
  const projectId = Number(params.projectId)
  const needId = Number(params.needId)
  const editing = mode === 'edit'
  const [draft, setDraft] = useState<NeedDraft>(emptyDraft)
  const [errors, setErrors] = useState<Partial<Record<keyof NeedDraft, string>>>({})
  const [banner, setBanner] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [units, setUnits] = useState<UnitOption[]>([])

  useEffect(() => {
    let active = true
    void Promise.all([
      api<{ categories: CategoryOption[] }>('/api/material-categories'),
      api<{ units: UnitOption[] }>('/api/measurement-units'),
      editing ? api<{ need: NeedRecord }>(`/api/needs/${needId}`) : Promise.resolve(null),
    ])
      .then(([categoryPayload, unitPayload, needPayload]) => {
        if (!active) {
          return
        }
        setCategories(categoryPayload.categories)
        setUnits(unitPayload.units)
        if (needPayload) {
          const need = needPayload.need
          const specification = need.specifications[0]
          setDraft({
            title: need.title,
            description: need.description,
            categoryId: String(need.categoryId),
            unitId: String(need.unitId),
            requiredQuantity: formatQuantity(need.requiredQuantity),
            requiredCondition: need.requiredCondition ?? 'not_declared',
            priority: need.priority,
            neededBy: need.neededBy ?? '',
            city: need.city ?? '',
            department: need.department ?? '',
            locationDescription: need.locationDescription ?? '',
            observations: need.observations ?? '',
            specificationName: specification?.name ?? '',
            specificationValue: specification?.value ?? '',
            visibility: need.visibility,
            status: need.status,
          })
        }
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
        setBanner(caught instanceof ApiError ? caught.message : 'No se pudo abrir la necesidad.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [editing, navigate, needId])

  function update<K extends keyof NeedDraft>(key: K, value: NeedDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fieldErrors = validateNeedDraft(draft)
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) {
      setBanner('Revisa los campos marcados.')
      return
    }
    setPending(true)
    setBanner('')
    const specifications =
      draft.specificationName.trim() && draft.specificationValue.trim()
        ? [{ name: draft.specificationName.trim(), value: draft.specificationValue.trim() }]
        : []
    const body = {
      categoryId: Number(draft.categoryId),
      unitId: Number(draft.unitId),
      title: draft.title.trim(),
      description: draft.description.trim(),
      requiredQuantity: draft.requiredQuantity.trim(),
      requiredCondition: draft.requiredCondition,
      priority: draft.priority,
      neededBy: draft.neededBy || null,
      city: draft.city.trim() || null,
      department: draft.department.trim() || null,
      locationDescription: draft.locationDescription.trim() || null,
      observations: draft.observations.trim() || null,
      specifications,
      visibility: draft.visibility,
      ...(editing ? {} : { status: draft.status === 'draft' ? 'draft' : 'open' }),
    }
    try {
      const payload = await api<{ need: { id: number }; project?: { id?: number } }>(
        editing ? `/api/needs/${needId}` : `/api/projects/${projectId}/needs`,
        { method: editing ? 'PATCH' : 'POST', body },
      )
      const targetProject = payload.project?.id ?? projectId
      navigate(`/proyectos/${targetProject}/necesidades/${payload.need.id}`)
    } catch (caught) {
      if (sessionEnded(caught)) {
        navigate('/sesion-expirada', { replace: true })
        return
      }
      setBanner(caught instanceof ApiError ? caught.message : 'No se pudo guardar la necesidad.')
      setPending(false)
    }
  }

  if (loading) {
    return <LoadingState label="Abriendo la necesidad." />
  }
  if (banner && categories.length === 0) {
    return (
      <ErrorState title="No se pudo abrir el formulario" action={<ButtonLink to={`/proyectos/${projectId}`}>Volver</ButtonLink>}>
        <p>{banner}</p>
      </ErrorState>
    )
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Necesidad" title={editing ? 'Editar necesidad' : 'Agregar necesidad'} actions={<ButtonLink to={`/proyectos/${projectId}`}>Volver al proyecto</ButtonLink>}>
        <p>La cantidad usa el catálogo de unidades. No se convierte sola entre kilogramos, metros u otras magnitudes.</p>
      </PageHeader>
      <NeedCopilot
        title={draft.title}
        description={draft.description}
        quantity={draft.requiredQuantity}
        unitName={units.find((item) => String(item.id) === draft.unitId)?.name ?? ''}
        categoryName={categories.find((item) => String(item.id) === draft.categoryId)?.name ?? ''}
        condition={draft.requiredCondition}
        specificationName={draft.specificationName}
        specificationValue={draft.specificationValue}
        onApply={(value) => update('description', value.description)}
      />
      {banner ? <p className={styles.banner} role="alert">{banner}</p> : null}
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <Input label="Material solicitado" value={draft.title} error={errors.title} maxLength={180} onChange={(event) => update('title', event.target.value)} />
        <Textarea label="Descripción" value={draft.description} error={errors.description} maxLength={500} onChange={(event) => update('description', event.target.value)} />
        <Select label="Categoría" value={draft.categoryId} error={errors.categoryId} onChange={(event) => update('categoryId', event.target.value)} options={categories.map((item) => ({ value: String(item.id), label: item.name }))} />
        <Input label="Cantidad" value={draft.requiredQuantity} error={errors.requiredQuantity} inputMode="decimal" onChange={(event) => update('requiredQuantity', event.target.value)} />
        <Select label="Unidad" value={draft.unitId} error={errors.unitId} onChange={(event) => update('unitId', event.target.value)} options={units.map((item) => ({ value: String(item.id), label: `${item.name} (${item.code})` }))} />
        <Select label="Condición aceptable" value={draft.requiredCondition} onChange={(event) => update('requiredCondition', event.target.value)} options={Object.entries(conditionLabels).map(([value, label]) => ({ value, label }))} />
        <Select label="Prioridad" value={draft.priority} error={errors.priority} onChange={(event) => update('priority', event.target.value)} options={Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))} />
        <Input label="Fecha requerida" type="date" value={draft.neededBy} error={errors.neededBy} onChange={(event) => update('neededBy', event.target.value)} />
        <Input label="Municipio donde se requiere" value={draft.city} maxLength={120} onChange={(event) => update('city', event.target.value)} />
        <Input label="Departamento" value={draft.department} maxLength={120} onChange={(event) => update('department', event.target.value)} />
        <Input label="Ubicación general" value={draft.locationDescription} maxLength={500} onChange={(event) => update('locationDescription', event.target.value)} />
        <Input label="Requisito" value={draft.specificationName} maxLength={80} hint="Nombre y valor, por ejemplo aparejo y tipo de junta." onChange={(event) => update('specificationName', event.target.value)} />
        <Input label="Valor del requisito" value={draft.specificationValue} error={errors.specificationValue} maxLength={240} onChange={(event) => update('specificationValue', event.target.value)} />
        <Textarea label="Observaciones" value={draft.observations} maxLength={2000} onChange={(event) => update('observations', event.target.value)} />
        <Select label="Visibilidad" value={draft.visibility} onChange={(event) => update('visibility', event.target.value)} options={Object.entries(visibilityLabels).map(([value, label]) => ({ value, label }))} />
        {!editing ? (
          <Select label="Estado inicial" value={draft.status} onChange={(event) => update('status', event.target.value)} options={['open', 'draft'].map((value) => ({ value, label: needStatusLabels[value] ?? value }))} />
        ) : null}
        <Button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar necesidad'}</Button>
      </form>
    </div>
  )
}
