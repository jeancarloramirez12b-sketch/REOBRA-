import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { ApiError } from '../features/auth/api.ts'
import { formatQuantity } from '../features/materials/rules.ts'
import { createRequest, requestContext } from '../features/operations/api.ts'
import type { RequestContext } from '../features/operations/types.ts'
import styles from '../features/operations/operations.module.css'
import page from './screen.module.css'

function operationKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `ui${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

export function RequestFormPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const materialId = params.get('materialId') ?? ''
  const needId = params.get('needId') ?? ''
  const key = useRef(operationKey())
  const [context, setContext] = useState<RequestContext | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!/^[1-9]\d*$/.test(materialId) || !/^[1-9]\d*$/.test(needId)) {
      setError('Falta el material o la necesidad.')
      return
    }
    let cancelled = false
    requestContext(materialId, needId)
      .then((result) => {
        if (!cancelled) setContext(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'No se pudo preparar la solicitud.')
      })
    return () => {
      cancelled = true
    }
  }, [materialId, needId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!context || saving) return
    const amount = Number(quantity)
    if (!(amount > 0) || amount > context.material.availableQuantity + 0.0001) {
      setError('La cantidad debe ser mayor que cero y no superar la disponibilidad libre.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const created = await createRequest({
        materialId: context.material.id,
        needId: context.need.id,
        quantity: amount,
        message: message.trim() || undefined,
      }, key.current)
      navigate(`/solicitudes/${created.request.id}`)
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo guardar la solicitud.')
      setSaving(false)
    }
  }

  if (error && !context) {
    return <ErrorState title="No se puede solicitar este material"><p>{error}</p></ErrorState>
  }
  if (!context) return <LoadingState label="Cargando el material y la necesidad" />

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Solicitud" title="Solicitar material">
        <p>Esta acción no reserva inventario. La organización propietaria todavía tiene que responder.</p>
      </PageHeader>
      {error ? <p role="alert">{error}</p> : null}
      <form className={styles.panel} onSubmit={(event) => { void submit(event) }}>
        <h2>{context.material.title}</h2>
        <p>Disponible para un acuerdo nuevo: {formatQuantity(String(context.material.availableQuantity))} {context.material.unitName}.</p>
        <p>Organización oferente: {context.material.ownerName}. {context.material.city}, {context.material.department}.</p>
        <p>Necesidad: {context.need.title}. Requerida: {formatQuantity(String(context.need.requiredQuantity))} {context.material.unitName}.</p>
        <div className={styles.fields}>
          <label>
            Cantidad solicitada
            <input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" required />
          </label>
          <label>
            Mensaje
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={4} />
          </label>
        </div>
        <Button type="submit" disabled={saving}>{saving ? 'Guardando' : 'Confirmar solicitud'}</Button>
      </form>
    </div>
  )
}
