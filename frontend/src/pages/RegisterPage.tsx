import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button.tsx'
import { Input } from '../components/ui/Input.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import styles from '../features/auth/auth.module.css'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import type { SessionPayload } from '../features/auth/types.ts'
import page from './screen.module.css'

export function RegisterPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  if (auth.status === 'loading') {
    return <LoadingState label="Comprobando la sesión." />
  }
  if (auth.status === 'authenticated') {
    return <Navigate to="/perfil" replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (password !== confirmation) {
      setError('La confirmación no coincide con la contraseña.')
      return
    }
    if (!acceptedTerms) {
      setError('Debes aceptar las condiciones de la cuenta.')
      return
    }
    setPending(true)
    try {
      const payload = await api<SessionPayload>('/api/auth/register', {
        method: 'POST',
        body: { fullName, email, password, acceptedTerms: true },
      })
      auth.establish(payload)
      navigate('/perfil', { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo crear la cuenta.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Cuenta" title="Crear cuenta">
        <p>El nombre se guarda completo. La contraseña necesita al menos 12 caracteres y solo se almacena como hash.</p>
      </PageHeader>
      <form className={`${styles.narrow} ${styles.form}`} onSubmit={onSubmit} noValidate>
        {error ? <p className={styles.banner} role="alert">{error}</p> : null}
        <Input label="Nombre completo" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={160} />
        <Input label="Correo" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <Input label="Contraseña" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required hint="Mínimo 12 caracteres. No puede ser igual al correo." />
        <Input label="Confirmar contraseña" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
        <label className={styles.check}>
          <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
          <span>Acepto que REOBRA guarde esta cuenta para operar la plataforma. Esto no certifica una organización ni un material.</span>
        </label>
        <div className={styles.actions}>
          <Button type="submit" disabled={pending}>{pending ? 'Creando cuenta…' : 'Crear cuenta'}</Button>
          <Link to="/ingresar">Ya tengo cuenta</Link>
        </div>
      </form>
    </div>
  )
}
