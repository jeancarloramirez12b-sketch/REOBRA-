import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { Input } from '../components/ui/Input.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { MaterialCopilot } from '../features/ai/MaterialCopilot.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { Select } from '../components/ui/Select.tsx'
import { Textarea } from '../components/ui/Textarea.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { MaterialPhoto } from '../features/materials/MaterialPhoto.tsx'
import { availabilityLabels, conditionLabels, originLabels } from '../features/materials/labels.ts'
import { formatQuantity, canWriteMaterials, validateMaterialDraft, type FieldErrors, type MaterialDraft } from '../features/materials/rules.ts'
import styles from '../features/materials/materials.module.css'
import type { CategoryOption, MaterialRecord, UnitOption } from '../features/materials/types.ts'
import page from './screen.module.css'

const emptyDraft: MaterialDraft = {
  title: '',
  description: '',
  categoryId: '',
  organizationId: '',
  quantity: '',
  unitId: '',
  materialCondition: 'not_declared',
  originType: 'construction',
  city: '',
  department: '',
  locationDescription: '',
  availabilityStatus: 'draft',
  availableFrom: '',
}

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

function optionsFrom(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}

export function MaterialFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const params = useParams()
  const materialId = Number(params.materialId)
  const editing = mode === 'edit'
  const writable = auth.memberships.filter((item) => item.membershipStatus === 'active' && canWriteMaterials(item.role))
  const [draft, setDraft] = useState<MaterialDraft>(emptyDraft)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [units, setUnits] = useState<UnitOption[]>([])
  const [images, setImages] = useState<MaterialRecord['images']>([])
  const [files, setFiles] = useState<File[]>([])
  const [organizationName, setOrganizationName] = useState('')
  const [canEdit, setCanEdit] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([
      api<{ categories: CategoryOption[] }>('/api/material-categories'),
      api<{ units: UnitOption[] }>('/api/measurement-units'),
      editing && Number.isSafeInteger(materialId) && materialId > 0
        ? api<{ material: MaterialRecord }>(`/api/materials/${materialId}`)
        : Promise.resolve(null),
    ])
      .then(([categoryPayload, unitPayload, materialPayload]) => {
        if (!active) {
          return
        }
        setCategories(categoryPayload.categories)
        setUnits(unitPayload.units)
        if (materialPayload) {
          const material = materialPayload.material
          setCanEdit(material.canEdit)
          setOrganizationName(material.organizationName)
          setImages(material.images ?? [])
          setDraft({
            title: material.title,
            description: material.description ?? '',
            categoryId: String(material.categoryId),
            organizationId: String(material.organizationId),
            quantity: formatQuantity(material.quantity),
            unitId: String(material.unitId),
            materialCondition: material.materialCondition,
            originType: material.originType,
            city: material.city,
            department: material.department,
            locationDescription: material.locationDescription ?? '',
            availabilityStatus: material.availabilityStatus,
            availableFrom: material.availableFrom ?? '',
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
        setBanner(caught instanceof ApiError ? caught.message : 'No se pudo preparar el formulario.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [editing, materialId, navigate])

  useEffect(() => {
    if (editing || draft.organizationId || writable.length === 0) {
      return
    }
    const preferred = writable.find((item) => item.organizationId === auth.activeOrganizationId) ?? writable[0]
    if (!preferred) {
      return
    }
    setDraft((current) => ({ ...current, organizationId: String(preferred.organizationId) }))
  }, [auth.activeOrganizationId, draft.organizationId, editing, writable])

  function update<Key extends keyof MaterialDraft>(key: Key, value: MaterialDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function chooseFiles(list: FileList | null) {
    if (!list) {
      return
    }
    const next = [...files]
    let message = ''
    const existing = editing ? (images?.length ?? 0) : 0
    for (const file of list) {
      if (existing + next.length >= 6) {
        message = 'Solo se pueden asociar 6 imágenes.'
        break
      }
      if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
        message = 'Cada imagen debe pesar como máximo 5 MB.'
        continue
      }
      if (file.type && !imageTypes.has(file.type)) {
        message = 'Solo se admiten JPEG, PNG o WebP.'
        continue
      }
      next.push(file)
    }
    setFiles(next)
    setBanner(message)
  }

  async function uploadImages(id: number, selected: File[]) {
    for (const file of selected) {
      const form = new FormData()
      form.append('image', file)
      await api(`/api/materials/${id}/images`, { method: 'POST', form })
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fieldErrors = validateMaterialDraft(draft)
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) {
      setBanner('Revisa los campos marcados.')
      return
    }
    setPending(true)
    setBanner('')
    const body = {
      categoryId: Number(draft.categoryId),
      unitId: Number(draft.unitId),
      title: draft.title.trim(),
      description: draft.description.trim(),
      materialCondition: draft.materialCondition,
      quantity: draft.quantity.trim(),
      originType: draft.originType,
      city: draft.city.trim(),
      department: draft.department.trim(),
      locationDescription: draft.locationDescription.trim(),
      availabilityStatus: draft.availabilityStatus,
      availableFrom: draft.availableFrom,
    }
    try {
      if (editing) {
        const saved = await api<{ material: MaterialRecord }>(`/api/materials/${materialId}`, { method: 'PATCH', body })
        navigate(`/inventario/${saved.material.id}`, { replace: true, state: { notice: 'Material actualizado.' } })
        return
      }
      const created = await api<{ material: MaterialRecord }>('/api/materials', {
        method: 'POST',
        body: { ...body, organizationId: Number(draft.organizationId) },
      })
      let warning = ''
      try {
        await uploadImages(created.material.id, files)
      } catch (caught) {
        warning = caught instanceof ApiError ? caught.message : 'El material se guardó, pero una imagen no se pudo asociar.'
      }
      navigate(`/inventario/${created.material.id}`, {
        replace: true,
        state: { notice: warning ? '' : 'Material registrado.', warning },
      })
    } catch (caught) {
      if (sessionEnded(caught)) {
        navigate('/sesion-expirada', { replace: true })
        return
      }
      setBanner(caught instanceof ApiError ? caught.message : 'No se pudo guardar el material.')
    } finally {
      setPending(false)
    }
  }

  async function uploadNow(list: FileList | null) {
    if (!list || !editing) {
      return
    }
    setPending(true)
    setBanner('')
    try {
      let count = images?.length ?? 0
      for (const file of list) {
        if (count >= 6) {
          throw new ApiError(400, 'IMAGE_LIMIT', 'Este material ya tiene el máximo de 6 imágenes.')
        }
        if (file.size <= 0 || file.size > 5 * 1024 * 1024 || (file.type && !imageTypes.has(file.type))) {
          throw new ApiError(400, 'INVALID_INPUT', 'La imagen debe ser JPEG, PNG o WebP y pesar como máximo 5 MB.')
        }
        const form = new FormData()
        form.append('image', file)
        await api(`/api/materials/${materialId}/images`, { method: 'POST', form })
        count += 1
      }
      const refreshed = await api<{ material: MaterialRecord }>(`/api/materials/${materialId}`)
      setImages(refreshed.material.images ?? [])
    } catch (caught) {
      if (sessionEnded(caught)) {
        navigate('/sesion-expirada', { replace: true })
        return
      }
      setBanner(caught instanceof ApiError ? caught.message : 'No se pudo guardar la imagen.')
    } finally {
      setPending(false)
    }
  }

  async function removeImage(imageId: number) {
    if (!window.confirm('¿Quitar esta imagen del material?')) {
      return
    }
    setPending(true)
    try {
      await api(`/api/materials/${materialId}/images/${imageId}`, { method: 'DELETE' })
      const refreshed = await api<{ material: MaterialRecord }>(`/api/materials/${materialId}`)
      setImages(refreshed.material.images ?? [])
    } catch (caught) {
      if (sessionEnded(caught)) {
        navigate('/sesion-expirada', { replace: true })
        return
      }
      setBanner(caught instanceof ApiError ? caught.message : 'No se pudo quitar la imagen.')
    } finally {
      setPending(false)
    }
  }

  if (editing && (!Number.isSafeInteger(materialId) || materialId < 1)) {
    return (
      <ErrorState title="No se encontró el material">
        <p>El identificador no es válido.</p>
      </ErrorState>
    )
  }
  if (loading) {
    return <LoadingState label="Preparando el formulario." />
  }
  if (!editing && writable.length === 0) {
    return (
      <div className={page.page}>
        <EmptyState icon="organization" title="No puedes registrar materiales todavía">
          <p>Hace falta una organización en la que tu rol sea de responsable, administración o edición.</p>
          <ButtonLink to="/organizaciones" variant="primary">Ir a organizaciones</ButtonLink>
        </EmptyState>
      </div>
    )
  }
  if (editing && !canEdit) {
    return (
      <ErrorState title="No puedes editar este material" action={<ButtonLink to={`/inventario/${materialId}`}>Volver al detalle</ButtonLink>}>
        <p>Tu rol en la organización permite consultarlo, no modificarlo.</p>
      </ErrorState>
    )
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Materiales" title={editing ? 'Editar material' : 'Registrar material'}>
        <p>
          {editing ? `Organización responsable: ${organizationName}.` : 'El material queda asociado a una organización en la que puedes editar.'}{' '}
          La evaluación técnica no se declara aquí y publicar no certifica un uso.
        </p>
      </PageHeader>
      <MaterialCopilot
        title={draft.title}
        description={draft.description}
        quantity={draft.quantity}
        unitName={units.find((item) => String(item.id) === draft.unitId)?.name ?? ''}
        condition={draft.materialCondition}
        city={draft.city}
        department={draft.department}
        availabilityStatus={draft.availabilityStatus}
        hasEvidence={files.length + (images?.length ?? 0) > 0}
        onApplyDescription={(value) => update('description', value)}
        onApplyCategory={(categoryId) => update('categoryId', categoryId)}
      />
      <form className={styles.form} onSubmit={onSubmit} aria-busy={pending} noValidate>
        {banner ? (
          <p className={styles.banner} role="alert">
            {banner}
          </p>
        ) : null}
        <div className={styles.grid}>
          <Input label="Nombre del material" value={draft.title} onChange={(event) => update('title', event.target.value)} error={errors.title} maxLength={180} required />
          <div className={styles.span}>
            <Textarea label="Descripción" value={draft.description} onChange={(event) => update('description', event.target.value)} error={errors.description} maxLength={4000} />
          </div>
          {editing ? (
            <p className={styles.note}>La organización propietaria no se cambia desde este formulario.</p>
          ) : (
            <Select
              label="Organización propietaria"
              value={draft.organizationId}
              error={errors.organizationId}
              onChange={(event) => update('organizationId', event.target.value)}
              options={writable.map((item) => ({ value: String(item.organizationId), label: item.organizationName }))}
            />
          )}
          <Select
            label="Categoría"
            value={draft.categoryId}
            error={errors.categoryId}
            onChange={(event) => update('categoryId', event.target.value)}
            options={[{ value: '', label: 'Selecciona una categoría' }, ...categories.map((item) => ({ value: String(item.id), label: item.name }))]}
          />
          <Input label="Cantidad" inputMode="decimal" value={draft.quantity} onChange={(event) => update('quantity', event.target.value)} error={errors.quantity} required hint="Mayor que cero. Usa punto para los decimales." />
          <Select
            label="Unidad de medida"
            value={draft.unitId}
            error={errors.unitId}
            onChange={(event) => update('unitId', event.target.value)}
            options={[{ value: '', label: 'Selecciona una unidad' }, ...units.map((item) => ({ value: String(item.id), label: `${item.name} (${item.code})` }))]}
          />
          <Select label="Condición declarada" value={draft.materialCondition} error={errors.materialCondition} onChange={(event) => update('materialCondition', event.target.value)} options={optionsFrom(conditionLabels)} />
          <Select label="Procedencia" value={draft.originType} error={errors.originType} onChange={(event) => update('originType', event.target.value)} options={optionsFrom(originLabels)} />
          <Input label="Departamento" value={draft.department} onChange={(event) => update('department', event.target.value)} error={errors.department} maxLength={120} required />
          <Input label="Municipio o ciudad" value={draft.city} onChange={(event) => update('city', event.target.value)} error={errors.city} maxLength={120} required />
          <div className={styles.span}>
            <Textarea
              label="Ubicación general"
              value={draft.locationDescription}
              onChange={(event) => update('locationDescription', event.target.value)}
              error={errors.locationDescription}
              maxLength={500}
              hint="Describe una referencia general. No escribas una dirección exacta."
            />
          </div>
          <Select label="Estado del registro" value={draft.availabilityStatus} error={errors.availabilityStatus} onChange={(event) => update('availabilityStatus', event.target.value)} options={optionsFrom(availabilityLabels)} />
          <Input label="Fecha de disponibilidad" type="date" value={draft.availableFrom} onChange={(event) => update('availableFrom', event.target.value)} error={errors.availableFrom} />
        </div>
        {editing ? (
          <section className={styles.layout} aria-labelledby="imagenes-material">
            <h2 id="imagenes-material">Imágenes</h2>
            <p className={styles.note}>JPEG, PNG o WebP. Máximo 6 imágenes y 5 MB cada una. El servidor comprueba el contenido real del archivo.</p>
            {images && images.length > 0 ? (
              <ul className={styles.gallery}>
                {images.map((image) => (
                  <li key={image.id}>
                    <MaterialPhoto materialId={materialId} imageId={image.id} alt={`Imagen ${image.imageOrder}`} />
                    <Button type="button" variant="quiet" disabled={pending} onClick={() => void removeImage(image.id)}>
                      Quitar
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>Este material todavía no tiene imágenes.</p>
            )}
            <label className={styles.file}>
              Agregar imágenes
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={pending} onChange={(event) => void uploadNow(event.target.files)} />
            </label>
          </section>
        ) : (
          <label className={styles.file}>
            Imágenes
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={pending} onChange={(event) => chooseFiles(event.target.files)} />
            <span className={styles.note}>{files.length > 0 ? files.map((file) => file.name).join(', ') : 'Opcional. Se guardan después de crear el material.'}</span>
          </label>
        )}
        <div className={styles.actions}>
          <Button type="submit" disabled={pending}>
            {pending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar material'}
          </Button>
          <ButtonLink to={editing ? `/inventario/${materialId}` : '/inventario'}>Cancelar</ButtonLink>
        </div>
      </form>
    </div>
  )
}
