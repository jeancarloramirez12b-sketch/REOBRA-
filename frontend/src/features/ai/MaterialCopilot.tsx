import { useState } from 'react'
import { ApiError, api } from '../auth/api.ts'
import { Button } from '../../components/ui/Button.tsx'
import styles from './assistant.module.css'

type MaterialSuggestion = {
  source: 'rules'
  description: string
  category: { id: number; name: string; reason: string } | null
  missing: string[]
  warnings: string[]
  tags: string[]
  disclaimer: string
}

type Props = {
  title: string
  description: string
  quantity: string
  unitName: string
  condition: string
  city: string
  department: string
  availabilityStatus: string
  hasEvidence: boolean
  onApplyDescription: (value: string) => void
  onApplyCategory: (categoryId: string) => void
}

export function MaterialCopilot(props: Props) {
  const [suggestion, setSuggestion] = useState<MaterialSuggestion | null>(null)
  const [edited, setEdited] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function review() {
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await api<MaterialSuggestion>('/api/ai/materials/suggestions', {
        method: 'POST',
        body: {
          title: props.title,
          description: props.description,
          quantity: props.quantity,
          unitName: props.unitName,
          condition: props.condition,
          city: props.city,
          department: props.department,
          availabilityStatus: props.availabilityStatus,
          hasEvidence: props.hasEvidence,
          restrictions: '',
        },
      })
      setSuggestion(result)
      setEdited(result.description)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo revisar el borrador.')
    } finally {
      setPending(false)
    }
  }

  async function acceptDescription() {
    if (!suggestion) return
    setPending(true)
    setError('')
    try {
      const preview = await api<{ proposal: { id: number } }>('/api/ai/actions/preview', {
        method: 'POST',
        body: { kind: 'prepare_description', summary: 'Descripción propuesta para el borrador', payload: { description: edited } },
      })
      await api(`/api/ai/actions/${preview.proposal.id}/confirm`, { method: 'POST', body: {} })
      props.onApplyDescription(edited)
      setNotice('La descripción quedó en el formulario. Todavía no se guarda hasta que confirmes el material.')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo confirmar la propuesta.')
    } finally {
      setPending(false)
    }
  }

  async function acceptCategory() {
    if (!suggestion?.category) return
    setPending(true)
    setError('')
    try {
      const preview = await api<{ proposal: { id: number } }>('/api/ai/actions/preview', {
        method: 'POST',
        body: {
          kind: 'suggest_category',
          summary: `Categoría propuesta: ${suggestion.category.name}`,
          payload: { categoryId: suggestion.category.id, categoryName: suggestion.category.name },
        },
      })
      await api(`/api/ai/actions/${preview.proposal.id}/confirm`, { method: 'POST', body: {} })
      props.onApplyCategory(String(suggestion.category.id))
      setNotice('La categoría quedó seleccionada en el formulario. Puedes cambiarla antes de guardar.')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo confirmar la categoría.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={styles.copilot} aria-labelledby="revision-material">
      <div className={styles.copilotHead}>
        <h2 id="revision-material">Revisión del borrador</h2>
        <Button type="button" variant="quiet" disabled={pending} onClick={() => void review()}>
          {pending ? 'Revisando…' : 'Revisar campos'}
        </Button>
      </div>
      <p>Esta revisión usa los datos del formulario. No inventa características y no publica el material.</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {suggestion ? (
        <div className={styles.cards}>
          <article className={styles.card}>
            <p className={styles.kicker}>Recomendación</p>
            <label htmlFor="descripcion-propuesta">Descripción propuesta</label>
            <textarea id="descripcion-propuesta" value={edited} maxLength={4000} onChange={(event) => setEdited(event.target.value)} />
            <div className={styles.row}>
              <Button type="button" disabled={pending || edited.trim().length === 0} onClick={() => void acceptDescription()}>Usar en el formulario</Button>
              <Button type="button" variant="quiet" onClick={() => setSuggestion(null)}>Descartar</Button>
            </div>
          </article>
          {suggestion.category ? (
            <article className={styles.card}>
              <p className={styles.kicker}>Recomendación</p>
              <h3>{suggestion.category.name}</h3>
              <p>{suggestion.category.reason}</p>
              <Button type="button" variant="quiet" disabled={pending} onClick={() => void acceptCategory()}>Aceptar categoría</Button>
            </article>
          ) : null}
          {suggestion.missing.length > 0 ? (
            <article className={styles.card}>
              <p className={styles.kicker}>Dato del formulario</p>
              <h3>Campos incompletos</h3>
              <ul>{suggestion.missing.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ) : null}
          {suggestion.warnings.map((warning) => (
            <article key={warning} className={styles.card}>
              <p className={styles.kicker}>Advertencia</p>
              <p>{warning}</p>
            </article>
          ))}
          {suggestion.tags.length > 0 ? <p>Etiquetas sugeridas: {suggestion.tags.join(', ')}.</p> : null}
          <p className={styles.disclaimer}>{suggestion.disclaimer}</p>
        </div>
      ) : null}
    </section>
  )
}
