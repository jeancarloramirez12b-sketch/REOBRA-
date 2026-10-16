import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button.tsx'
import { Input } from '../components/ui/Input.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { Select } from '../components/ui/Select.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import styles from '../features/auth/auth.module.css'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { organizationTypeLabels } from '../features/auth/labels.ts'
import type { OrganizationRecord } from '../features/auth/types.ts'
import page from './screen.module.css'

const typeOptions = Object.entries(organizationTypeLabels).map(([value, label]) => ({ value, label }))

export function OrganizationCreatePage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [organizationType, setOrganizationType] = useState('company')
  const [contactEmail, setContactEmail] = useState(auth.user?.email ?? '')
  const [city, setCity] = useState('')
  const [department, setDepartment] = useState('')
  const [country, setCountry] = useState('CO')
  const [taxIdentifier, setTaxIdentifier] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      const result = await api<{ organization: OrganizationRecord }>('/api/organizations', {
        method: 'POST',
        body: {
          name,
          organizationType,
          contactEmail,
          city,
          department,
          country,
          taxIdentifier,
        },
      })
      await auth.refresh()
      auth.setActiveOrganizationId(result.organization.id)
      navigate(`/organizaciones/${result.organization.id}`, { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo crear la organización.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Organizaciones" title="Crear organización">
        <p>Quedarás como responsable principal. El estado de verificación inicia en «Sin verificación».</p>
      </PageHeader>
      <form className={`${styles.narrow} ${styles.form}`} onSubmit={onSubmit}>
        {error ? <p className={styles.banner} role="alert">{error}</p> : null}
        <Input label="Nombre" value={name} onChange={(event) => setName(event.target.value)} required maxLength={180} />
        <Select label="Tipo" value={organizationType} options={typeOptions} onChange={(event) => setOrganizationType(event.target.value)} />
        <Input label="Correo de contacto" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} required />
        <Input label="Ciudad" value={city} onChange={(event) => setCity(event.target.value)} required maxLength={120} />
        <Input label="Departamento" value={department} onChange={(event) => setDepartment(event.target.value)} required maxLength={120} />
        <Input label="País" value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} required maxLength={2} hint="Código de dos letras. Colombia es CO." />
        <Input label="Identificador tributario" value={taxIdentifier} onChange={(event) => setTaxIdentifier(event.target.value)} maxLength={32} hint="Opcional. No confirma la existencia legal de la organización." />
        <Button type="submit" disabled={pending}>{pending ? 'Creando…' : 'Crear organización'}</Button>
      </form>
    </div>
  )
}
