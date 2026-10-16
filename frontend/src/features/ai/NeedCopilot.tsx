import { useState } from 'react'
import { ApiError, api } from '../auth/api.ts'
import { Button } from '../../components/ui/Button.tsx'
import styles from './assistant.module.css'

type ProjectSuggestion = {
  source: 'rules'
  draft: string
  missing: string[]
  ambiguities: string[]
  unitNote: string
  disclaimer: string
}

type Props = {
  title: string
  description: string
  quantity: string
  unitName: string
  categoryName: string
  condition: string
  specificationName: string
  specificationValue: string
  onApply: (value: { title: string; description: string }) => void
}

export function NeedCopilot(props: Props) {
  const [suggestion, setSuggestion] = useState<ProjectSuggestion | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function review() {
    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await api<ProjectSuggestion>('/api/ai/projects/suggestions', {
        method: 'POST',
        body: {
          title: props.title,
          description: props.description,
          quantity: props.quantity,
          unitName: props.unitName,
          categoryName: props.categoryName,
          condition: props.condition,
          specificationName: props.specificationName,
          specificationValue: props.specificationValue,
        },
      })
      setSuggestion(result)
      setDraft(result.draft)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo revisar la necesidad.')
    } finally {
      setPending(false)
    }
  }

  async function accept() {
    if (!suggestion || draft.trim().length === 0) return
    setPending(true)
    setError('')
    try {
      const preview = await api<{ proposal: { id: number } }>('/api/ai/actions/preview', {
        method: 'POST',
        body: {
          kind: 'prepare_need',
          summary: 'Borrador de necesidad',
          payload: { title: props.title.trim() || 'Necesidad', description: draft, requiredQuantity: props.quantity, unitName: props.unitName },
        },
      })
      await api(`/api/ai/actions/${preview.proposal.id}/confirm`, { method: 'POST', body: {} })
      props.onApply({ title: props.title, description: draft })
      setNotice('El texto quedó en el formulario. Guardar la necesidad sigue siendo una acción tuya.')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo confirmar el borrador.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={styles.copilot} aria-labelledby="revision-necesidad">
      <div className={styles.copilotHead}>
        <h2 id="revision-necesidad">Apoyo para la necesidad</h2>
        <Button type="button" variant="quiet" disabled={pending} onClick={() => void review()}>
          {pending ? 'Revisando…' : 'Revisar necesidad'}
        </Button>
      </div>
      <p>El texto se arma con lo que ya escribiste. No sustituye la evaluación técnica del proyecto.</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {suggestion ? (
        <div className={styles.cards}>
          <article className={styles.card}>
            <p className={styles.kicker}>Recomendación</p>
            <label htmlFor="borrador-necesidad">Borrador</label>
            <textarea id="borrador-necesidad" value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} />
            <div className={styles.row}>
              <Button type="button" disabled={pending || draft.trim().length === 0} onClick={() => void accept()}>Usar en el formulario</Button>
              <Button type="button" variant="quiet" onClick={() => setSuggestion(null)}>Descartar</Button>
            </div>
          </article>
          {suggestion.missing.length > 0 ? (
            <article className={styles.card}>
              <p className={styles.kicker}>Dato del formulario</p>
              <h3>Información que falta</h3>
              <ul>{suggestion.missing.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ) : null}
          {suggestion.ambiguities.map((item) => <p key={item}>{item}</p>)}
          <p>{suggestion.unitNote}</p>
          <p className={styles.disclaimer}>{suggestion.disclaimer}</p>
        </div>
      ) : null}
    </section>
  )
}
