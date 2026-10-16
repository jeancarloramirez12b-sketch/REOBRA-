import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { ApiError, api } from '../features/auth/api.ts'
import styles from '../features/ai/assistant.module.css'
import page from './screen.module.css'

type Status = {
  configured: boolean
  state: string
  message: string
}

type Conversation = {
  id: number
  title: string
  moduleContext: string | null
  updatedAt: string
}

type Message = {
  id: number
  role: 'user' | 'assistant'
  basis: string
  content: string
  sourceNote: string | null
}

const basisLabels: Record<string, string> = {
  system_data: 'Dato del sistema',
  inference: 'Inferencia',
  recommendation: 'Recomendación',
  guide: 'Guía',
  tool: 'Herramienta',
}

const guide = [
  'Publicar un material se hace en Inventario. La publicación no certifica un uso.',
  'Una solicitud no reserva inventario. La reserva aparece cuando las dos organizaciones confirman el acuerdo.',
  'Un despacho registra la salida. La recepción la confirma la otra organización y no vuelve a descontar.',
  'El matching compara categoría, cantidad, ubicación y datos técnicos. La cobertura no es el puntaje.',
  'Un indicador de impacto explica una cifra calculada por el motor. Si falta un dato, el resultado queda como no calculable.',
  'El pasaporte digital reúne origen, visibilidad, historial y evidencias. No declara por sí solo que el material sea apto.',
]

export function AssistantPage() {
  const [params] = useSearchParams()
  const moduleContext = params.get('contexto')
  const [status, setStatus] = useState<Status | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function loadList() {
    const result = await api<{ conversations: Conversation[] }>('/api/ai/conversations')
    setConversations(result.conversations)
  }

  useEffect(() => {
    let active = true
    void Promise.all([api<Status>('/api/ai/status'), api<{ conversations: Conversation[] }>('/api/ai/conversations')])
      .then(([nextStatus, list]) => {
        if (!active) return
        setStatus(nextStatus)
        setConversations(list.conversations)
        setLoading(false)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof ApiError ? caught.message : 'No se pudo abrir el asistente.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function openConversation(id: number) {
    setPending(true)
    setError('')
    try {
      const result = await api<{ messages: Message[] }>(`/api/ai/conversations/${id}`)
      setActiveId(id)
      setMessages(result.messages)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo abrir la conversación.')
    } finally {
      setPending(false)
    }
  }

  async function startConversation() {
    setPending(true)
    setError('')
    try {
      const result = await api<{ conversation: Conversation }>('/api/ai/conversations', {
        method: 'POST',
        body: { moduleContext: moduleContext || 'assistant' },
      })
      setConversations((current) => [result.conversation, ...current])
      setActiveId(result.conversation.id)
      setMessages([])
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo crear la conversación.')
    } finally {
      setPending(false)
    }
  }

  async function removeConversation(id: number) {
    setPending(true)
    setError('')
    try {
      await api(`/api/ai/conversations/${id}`, { method: 'DELETE' })
      setConversations((current) => current.filter((item) => item.id !== id))
      if (activeId === id) {
        setActiveId(null)
        setMessages([])
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo eliminar la conversación.')
    } finally {
      setPending(false)
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || !status?.configured) return
    setPending(true)
    setError('')
    try {
      const result = await api<{ conversation: Conversation; message: Message }>('/api/ai/chat', {
        method: 'POST',
        body: { message, conversationId: activeId ?? undefined, moduleContext: moduleContext || 'assistant' },
      })
      setActiveId(result.conversation.id)
      setDraft('')
      setMessages((current) => [...current, { id: Date.now(), role: 'user', basis: 'user_request', content: message, sourceNote: null }, result.message])
      await loadList()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'AI_LIMIT') setError('Límite alcanzado. Espera antes de enviar otra consulta.')
      else if (caught instanceof ApiError && caught.code === 'AI_NOT_CONFIGURED') setError(caught.message)
      else setError(caught instanceof ApiError ? caught.message : 'Error temporal del asistente.')
    } finally {
      setPending(false)
    }
  }

  async function feedback(messageId: number, rating: 'helpful' | 'not_helpful') {
    try {
      await api('/api/ai/feedback', { method: 'POST', body: { messageId, rating } })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo guardar la valoración.')
    }
  }

  if (loading) return <LoadingState label="Abriendo el asistente." />
  if (!status && error) {
    return <ErrorState title="No se pudo abrir el asistente"><p>{error}</p></ErrorState>
  }

  const configured = status?.configured === true

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Fase 11" title="REOBRA AI" actions={<Button type="button" variant="quiet" disabled={pending} onClick={() => void startConversation()}>Nueva conversación</Button>}>
        <p>El asistente explica y propone borradores. No reserva, no confirma acuerdos y no certifica materiales.</p>
      </PageHeader>
      <p className={styles.status} role="status">
        {configured ? 'Disponible' : status?.message ?? 'Servicio de inteligencia artificial no configurado'}
        {pending ? ' · Procesando' : ''}
        {error.includes('Límite') ? ' · Límite alcanzado' : ''}
      </p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!configured ? (
        <section className={styles.guide} aria-labelledby="guia-reobra">
          <h2 id="guia-reobra">Guía de REOBRA</h2>
          <p>Esta guía es contenido de la plataforma. No es una respuesta de un modelo.</p>
          <ul>{guide.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}
      <div className={styles.layout}>
        <div className={styles.conversations}>
          {conversations.length === 0 ? <p>No hay conversaciones todavía.</p> : conversations.map((item) => (
            <div key={item.id} className={styles.conversationRow}>
              <button type="button" className={styles.conversation} aria-current={item.id === activeId} onClick={() => void openConversation(item.id)}>
                <strong>{item.title}</strong>
                <small>{item.updatedAt}</small>
              </button>
              <Button type="button" variant="quiet" disabled={pending} onClick={() => void removeConversation(item.id)}>Eliminar</Button>
            </div>
          ))}
        </div>
        <section className={styles.panel} aria-labelledby="chat-reobra">
          <h2 id="chat-reobra" className={styles.hiddenTitle}>Conversación</h2>
          {messages.length === 0 ? (
            <EmptyState icon="assistant" title="Sin mensajes">
              <p>{configured ? 'Escribe una pregunta sobre tu inventario, proyectos o indicadores.' : 'Cuando el servicio esté configurado, las respuestas aparecerán aquí.'}</p>
            </EmptyState>
          ) : (
            <div className={styles.messages} role="log" aria-live="polite" aria-relevant="additions" aria-busy={pending}>
              {messages.map((item) => (
                <article key={item.id} className={styles.message} data-role={item.role}>
                  <p className={styles.basis}>{item.role === 'user' ? 'Tú' : basisLabels[item.basis] ?? 'Asistente'}</p>
                  <p>{item.content}</p>
                  {item.sourceNote ? <p className={styles.disclaimer}>Fuente: {item.sourceNote}</p> : null}
                  {item.role === 'assistant' && item.id > 0 && item.id < 1_000_000_000_000 ? (
                    <div className={styles.row}>
                      <Button type="button" variant="quiet" onClick={() => void feedback(item.id, 'helpful')}>Útil</Button>
                      <Button type="button" variant="quiet" onClick={() => void feedback(item.id, 'not_helpful')}>No útil</Button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          <form className={styles.composer} onSubmit={(event) => void send(event)}>
            <label htmlFor="mensaje-asistente">Mensaje</label>
            <input id="mensaje-asistente" value={draft} maxLength={2000} disabled={!configured || pending} onChange={(event) => setDraft(event.target.value)} />
            <Button type="submit" disabled={!configured || pending || draft.trim().length === 0}>Enviar</Button>
          </form>
        </section>
      </div>
    </div>
  )
}
