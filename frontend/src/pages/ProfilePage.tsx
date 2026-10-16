import { useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Input } from '../components/ui/Input.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import styles from '../features/auth/auth.module.css'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import type { AccountUser } from '../features/auth/types.ts'
import page from './screen.module.css'

export function ProfilePage() {
  const auth = useAuth()
  const user = auth.user
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profilePending, setProfilePending] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordPending, setPasswordPending] = useState(false)

  if (!user) {
    return null
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileError('')
    setProfileMessage('')
    setProfilePending(true)
    try {
      const result = await api<{ user: AccountUser }>('/api/users/me', {
        method: 'PATCH',
        body: { fullName, phone },
      })
      auth.establish({ user: result.user, memberships: auth.memberships })
      setProfileMessage('Los datos quedaron guardados.')
    } catch (caught) {
      setProfileError(caught instanceof ApiError ? caught.message : 'No se pudo guardar el perfil.')
    } finally {
      setProfilePending(false)
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    if (newPassword !== confirmPassword) {
      setPasswordError('La confirmación no coincide con la nueva contraseña.')
      return
    }
    setPasswordPending(true)
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('La contraseña cambió y las otras sesiones quedaron cerradas.')
    } catch (caught) {
      setPasswordError(caught instanceof ApiError ? caught.message : 'No se pudo cambiar la contraseña.')
    } finally {
      setPasswordPending(false)
    }
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Cuenta" title="Mi perfil" actions={<Button variant="quiet" onClick={() => void auth.logout()}>Cerrar sesión</Button>}>
        <p>El correo identifica la cuenta y no se cambia desde aquí. La contraseña actual se comprueba antes de reemplazarla.</p>
      </PageHeader>

      <form className={`${styles.narrow} ${styles.form}`} onSubmit={saveProfile}>
        {profileError ? <p className={styles.banner} role="alert">{profileError}</p> : null}
        {profileMessage ? <p className={styles.meta} role="status">{profileMessage}</p> : null}
        <Input label="Nombre completo" value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={160} />
        <Input label="Correo" value={user.email} readOnly hint="El correo no se modifica en esta fase." />
        <Input label="Teléfono" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" hint="Opcional. Entre 7 y 32 caracteres." />
        <Button type="submit" disabled={profilePending}>{profilePending ? 'Guardando…' : 'Guardar perfil'}</Button>
      </form>

      <form className={`${styles.narrow} ${styles.form}`} onSubmit={savePassword}>
        <h2>Cambiar contraseña</h2>
        {passwordError ? <p className={styles.banner} role="alert">{passwordError}</p> : null}
        {passwordMessage ? <p className={styles.meta} role="status">{passwordMessage}</p> : null}
        <Input label="Contraseña actual" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        <Input label="Nueva contraseña" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required hint="Mínimo 12 caracteres." />
        <Input label="Confirmar nueva contraseña" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
        <Button type="submit" disabled={passwordPending}>{passwordPending ? 'Actualizando…' : 'Actualizar contraseña'}</Button>
      </form>
    </div>
  )
}
