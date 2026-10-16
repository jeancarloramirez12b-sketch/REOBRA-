import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button.tsx'
import { Input } from '../components/ui/Input.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import styles from '../features/auth/auth.module.css'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import type { SessionPayload } from '../features/auth/types.ts'
import page from './screen.module.css'

function destination(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state && typeof state.from === 'string') {
    if (state.from.startsWith('/') && !state.from.startsWith('//')) {
      return state.from
    }
  }
  return '/perfil'
}

export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  if (auth.status === 'loading') {
    return <LoadingState label="Comprobando la sesión." />
  }
  if (auth.status === 'authenticated') {
    return <Navigate to={destination(location.state)} replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      const payload = await api<SessionPayload>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      auth.establish(payload)
      navigate(destination(location.state), { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo iniciar sesión.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Cuenta" title="Ingresar">
        <p>Usa el correo y la contraseña de tu cuenta. Las pantallas públicas de REOBRA siguen disponibles sin sesión.</p>
      </PageHeader>
      <form className={`${styles.narrow} ${styles.form}`} onSubmit={onSubmit} noValidate>
        {error ? <p className={styles.banner} role="alert">{error}</p> : null}
        <Input label="Correo" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <Input label="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        <div className={styles.actions}>
          <Button type="submit" disabled={pending}>{pending ? 'Ingresando…' : 'Ingresar'}</Button>
          <Link to="/registro">Crear una cuenta</Link>
        </div>
      </form>
    </div>
  )
}
