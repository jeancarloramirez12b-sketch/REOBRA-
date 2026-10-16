import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/ui/Badge.tsx'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import { MaterialPhoto } from '../features/materials/MaterialPhoto.tsx'
import {
  availabilityLabels,
  availabilityTone,
  conditionLabels,
  originLabels,
  technicalLabels,
  technicalTone,
} from '../features/materials/labels.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import styles from '../features/materials/materials.module.css'
import type { MaterialRecord } from '../features/materials/types.ts'
import page from './screen.module.css'

type NoticeLocation = {
  notice?: string
  warning?: string
}

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

const statusCopy: Record<string, { next: string; label: string; confirm: string }> = {
  published: {
    next: 'published',
    label: 'Publicar',
    confirm: 'El material quedará publicado para los miembros de la organización. Publicarlo no aprueba su uso técnico.',
  },
  paused: {
    next: 'paused',
    label: 'Retirar temporalmente',
    confirm: 'El material dejará de estar publicado. El registro y su historial se conservan.',
  },
  withdrawn: {
    next: 'withdrawn',
    label: 'Archivar',
    confirm: 'El material se archivará. No se borra ni se pierde su historial.',
  },
  draft: {
    next: 'draft',
    label: 'Volver a borrador',
    confirm: 'El material volverá a borrador y seguirá visible para la organización.',
  },
}

export function MaterialDetailPage() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const materialId = Number(params.materialId)
  const noticeState = (location.state ?? {}) as NoticeLocation
  const [material, setMaterial] = useState<MaterialRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(noticeState.notice ?? '')
  const [warning, setWarning] = useState(noticeState.warning ?? '')
  const [pending, setPending] = useState(false)
  const [publicCode, setPublicCode] = useState('')

  useEffect(() => {
    if (!Number.isSafeInteger(materialId) || materialId < 1) {
      setLoading(false)
      setError('El identificador no es válido.')
      return
    }
    let active = true
    void api<{ material: MaterialRecord }>(`/api/materials/${materialId}`)
      .then((payload) => {
        if (active) {
          setMaterial(payload.material)
          setLoading(false)
          void api<{ passport: { publicCode: string } }>(`/api/materials/${materialId}/passport`)
            .then((passportPayload) => {
              if (active) {
                setPublicCode(passportPayload.passport.publicCode)
              }
            })
            .catch(() => {
              if (active) {
                setPublicCode('')
              }
            })
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
        setError(caught instanceof ApiError ? caught.message : 'No se pudo consultar el material.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [materialId, navigate])

  async function changeStatus(next: string, confirm: string) {
    if (!material || !window.confirm(confirm)) {
      return
    }
    setPending(true)
    setNotice('')
    setWarning('')
    try {
      const payload = await api<{ material: MaterialRecord }>(`/api/materials/${material.id}/status`, {
        method: 'PATCH',
        body: { availabilityStatus: next },
      })
      setMaterial(payload.material)
      setNotice('Estado actualizado.')
    } catch (caught) {
      if (sessionEnded(caught)) {
        navigate('/sesion-expirada', { replace: true })
        return
      }
      setWarning(caught instanceof ApiError ? caught.message : 'No se pudo cambiar el estado.')
    } finally {
      setPending(false)
    }
  }

  if (loading) {
    return <LoadingState label="Consultando el material." />
  }
  if (!material) {
    return (
      <ErrorState title="No se encontró el material" action={<ButtonLink to="/inventario">Volver al inventario</ButtonLink>}>
        <p>{error || 'Puede que no exista o que no pertenezca a una organización tuya.'}</p>
      </ErrorState>
    )
  }

  const actions = material.canEdit
    ? ['published', 'paused', 'withdrawn', 'draft'].filter((status) => status !== material.availabilityStatus)
    : []

  return (
    <div className={page.page}>
      <PageHeader
        eyebrow={material.code}
        title={material.title}
        actions={
          <>
            {publicCode ? <ButtonLink to={`/pasaporte/${publicCode}`}>Pasaporte</ButtonLink> : null}
            {material.canEdit ? (
              <ButtonLink to={`/inventario/${material.id}/editar`} variant="primary">
                Editar
              </ButtonLink>
            ) : null}
          </>
        }
      >
        <p>{material.organizationName}</p>
      </PageHeader>
      {notice ? (
        <p className={styles.success} role="status">
          {notice}
        </p>
      ) : null}
      {warning ? (
        <p className={styles.banner} role="alert">
          {warning}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Badge tone={availabilityTone(material.availabilityStatus)}>
          {availabilityLabels[material.availabilityStatus] ?? material.availabilityStatus}
        </Badge>
        <Badge tone={technicalTone(material.technicalValidationStatus)}>
          {technicalLabels[material.technicalValidationStatus] ?? material.technicalValidationStatus}
        </Badge>
      </div>
      <section className={styles.layout} aria-labelledby="datos-material">
        <h2 id="datos-material">Información del material</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Identificador interno</dt>
            <dd>{material.code}</dd>
          </div>
          <div>
            <dt>Categoría</dt>
            <dd>{material.categoryName}</dd>
          </div>
          <div>
            <dt>Cantidad declarada</dt>
            <dd>
              {formatQuantity(material.quantity)} {material.unitName} ({material.unitCode})
            </dd>
          </div>
          <div>
            <dt>Disponible para futuras solicitudes</dt>
            <dd>
              {formatQuantity(material.availableQuantity)} {material.unitCode}
            </dd>
          </div>
          <div>
            <dt>Entregado</dt>
            <dd>{formatQuantity(material.deliveredQuantity)}</dd>
          </div>
          <div>
            <dt>Comprometido</dt>
            <dd>{formatQuantity(material.committedQuantity)}</dd>
          </div>
          <div>
            <dt>Condición declarada</dt>
            <dd>{conditionLabels[material.materialCondition] ?? material.materialCondition}</dd>
          </div>
          <div>
            <dt>Procedencia</dt>
            <dd>{originLabels[material.originType] ?? material.originType}</dd>
          </div>
          <div>
            <dt>Lugar</dt>
            <dd>
              {material.city}, {material.department}
              {material.locationDescription ? `. ${material.locationDescription}` : ''}
            </dd>
          </div>
          <div>
            <dt>Disponible desde</dt>
            <dd>{material.availableFrom ?? 'Sin fecha'}</dd>
          </div>
          <div className={styles.span}>
            <dt>Descripción</dt>
            <dd>{material.description ?? 'Sin descripción complementaria.'}</dd>
          </div>
        </dl>
      </section>
      <section className={styles.layout} aria-labelledby="evaluacion-material">
        <h2 id="evaluacion-material">Evaluación técnica</h2>
        <p className={styles.note}>
          El estado actual es «{technicalLabels[material.technicalValidationStatus] ?? material.technicalValidationStatus}».
          Esta pantalla no emite una certificación ni un pasaporte digital. Un material publicado no queda apto, por ese
          solo hecho, para un uso estructural, sanitario, eléctrico o de seguridad.
        </p>
      </section>
      <section className={styles.layout} aria-labelledby="imagenes-detalle">
        <h2 id="imagenes-detalle">Imágenes</h2>
        {material.images && material.images.length > 0 ? (
          <ul className={styles.gallery}>
            {material.images.map((image) => (
              <li key={image.id}>
                <MaterialPhoto materialId={material.id} imageId={image.id} alt={`${material.title}, imagen ${image.imageOrder}`} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>No hay imágenes asociadas.</p>
        )}
      </section>
      {material.canEdit ? (
        <section className={styles.layout} aria-labelledby="estado-material">
          <h2 id="estado-material">Estado del registro</h2>
          <p className={styles.note}>Archivar o retirar no elimina el material ni las relaciones que ya tenga.</p>
          <div className={styles.actions}>
            {actions.map((status) => {
              const action = statusCopy[status]
              if (!action) {
                return null
              }
              return (
                <Button key={status} variant="quiet" disabled={pending} onClick={() => void changeStatus(action.next, action.confirm)}>
                  {action.label}
                </Button>
              )
            })}
          </div>
        </section>
      ) : (
        <p className={styles.note}>Tu rol permite consultar este material, no modificarlo.</p>
      )}
      <ButtonLink to="/inventario">Volver al inventario</ButtonLink>
    </div>
  )
}
