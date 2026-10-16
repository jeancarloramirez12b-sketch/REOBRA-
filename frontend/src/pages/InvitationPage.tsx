import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button.tsx'
import { Input } from '../components/ui/Input.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import styles from '../features/auth/auth.module.css'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import type { OrganizationRecord } from '../features/auth/types.ts'
import page from './screen.module.css'

export function InvitationPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (auth.status !== 'authenticated') {
      setError('Inicia sesión con el correo que recibió la invitación y vuelve a pegar el token.')
      return
    }
    setPending(true)
    try {
      const result = await api<{ organization: OrganizationRecord }>('/api/invitations/accept', {
        method: 'POST',
        body: { token },
      })
      await auth.refresh()
      auth.setActiveOrganizationId(result.organization.id)
      navigate(`/organizaciones/${result.organization.id}`, { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo aceptar la invitación.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Organizaciones" title="Aceptar invitación">
        <p>Pega el token que te entregaron. Debe corresponder al correo de la sesión actual y solo puede usarse una vez.</p>
      </PageHeader>
      <form className={`${styles.narrow} ${styles.form}`} onSubmit={onSubmit}>
        {error ? <p className={styles.banner} role="alert">{error}</p> : null}
        {auth.status !== 'authenticated' ? <p className={styles.meta}>No hay una sesión activa. <Link to="/ingresar" state={{ from: '/invitacion' }}>Ingresar</Link></p> : null}
        <Input label="Token" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required />
        <Button type="submit" disabled={pending}>{pending ? 'Comprobando…' : 'Aceptar invitación'}</Button>
      </form>
    </div>
  )
}
