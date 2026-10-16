import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { Input } from '../components/ui/Input.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { Select } from '../components/ui/Select.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import styles from '../features/auth/auth.module.css'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { membershipStatusLabels, organizationTypeLabels, roleLabels, verificationLabels } from '../features/auth/labels.ts'
import type { InvitationRecord, MemberRecord, OrganizationRecord } from '../features/auth/types.ts'
import page from './screen.module.css'

const typeOptions = Object.entries(organizationTypeLabels).map(([value, label]) => ({ value, label }))
const inviteOptions = [
  { value: 'viewer', label: roleLabels.viewer ?? 'Consulta' },
  { value: 'editor', label: roleLabels.editor ?? 'Edición' },
  { value: 'technical_reviewer', label: roleLabels.technical_reviewer ?? 'Revisión técnica' },
  { value: 'administrator', label: roleLabels.administrator ?? 'Administración' },
]

export function OrganizationDetailPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const params = useParams()
  const organizationId = params.organizationId ?? ''
  const [organization, setOrganization] = useState<OrganizationRecord | null>(null)
  const [members, setMembers] = useState<MemberRecord[]>([])
  const [invitations, setInvitations] = useState<InvitationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [notice, setNotice] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [issuedToken, setIssuedToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)

  const canManage = organization?.membership.role === 'owner' || organization?.membership.role === 'administrator'
  const canInviteAdministrators = organization?.membership.role === 'owner'

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      setDenied(false)
      try {
        const organizationResult = await api<{ organization: OrganizationRecord }>(`/api/organizations/${organizationId}`)
        const memberResult = await api<{ members: MemberRecord[] }>(`/api/organizations/${organizationId}/members`)
        let invitationRows: InvitationRecord[] = []
        const role = organizationResult.organization.membership.role
        if (role === 'owner' || role === 'administrator') {
          const invitationResult = await api<{ invitations: InvitationRecord[] }>(`/api/organizations/${organizationId}/invitations`)
          invitationRows = invitationResult.invitations
        }
        if (!cancelled) {
          setOrganization(organizationResult.organization)
          setMembers(memberResult.members)
          setInvitations(invitationRows)
        }
      } catch (caught) {
        if (!cancelled) {
          if (caught instanceof ApiError && caught.status === 403) {
            setDenied(true)
          } else {
            setError(caught instanceof ApiError ? caught.message : 'No se pudo abrir la organización.')
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [organizationId])

  async function saveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organization) {
      return
    }
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const result = await api<{ organization: OrganizationRecord }>(`/api/organizations/${organization.id}`, {
        method: 'PATCH',
        body: {
          name: organization.name,
          organizationType: organization.organizationType,
          contactEmail: organization.contactEmail,
          city: organization.city,
          department: organization.department,
          country: organization.country,
          taxIdentifier: organization.taxIdentifier ?? '',
        },
      })
      setOrganization(result.organization)
      await auth.refresh()
      setNotice('Los datos de la organización quedaron guardados.')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo guardar la organización.')
    } finally {
      setSaving(false)
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organization) {
      return
    }
    setInviting(true)
    setError('')
    setNotice('')
    setIssuedToken('')
    try {
      const result = await api<{ invitation: InvitationRecord; token: string }>(`/api/organizations/${organization.id}/invitations`, {
        method: 'POST',
        body: { email: inviteEmail, role: inviteRole },
      })
      setInvitations((current) => [...current, result.invitation])
      setIssuedToken(result.token)
      setInviteEmail('')
      setNotice('No hay servicio de correo. Entrega este token por un canal privado. No se volverá a mostrar.')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo crear la invitación.')
    } finally {
      setInviting(false)
    }
  }

  async function revoke(invitationId: number) {
    if (!organization) {
      return
    }
    setError('')
    try {
      await api(`/api/organizations/${organization.id}/invitations/${invitationId}/revoke`, { method: 'POST', body: {} })
      setInvitations((current) => current.filter((invitation) => invitation.id !== invitationId))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo revocar la invitación.')
    }
  }

  async function changeMember(member: MemberRecord, role: string, membershipStatus: string) {
    if (!organization) {
      return
    }
    setError('')
    try {
      const result = await api<{ member: MemberRecord }>(`/api/organizations/${organization.id}/members/${member.id}`, {
        method: 'PATCH',
        body: { role, membershipStatus },
      })
      setMembers((current) => current.map((item) => (item.id === member.id ? result.member : item)))
      if (result.member.userId === auth.user?.id) {
        await auth.refresh()
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo actualizar el miembro.')
    }
  }

  async function remove(member: MemberRecord) {
    if (!organization) {
      return
    }
    setError('')
    try {
      await api(`/api/organizations/${organization.id}/members/${member.id}`, { method: 'DELETE' })
      if (member.userId === auth.user?.id) {
        await auth.refresh()
        navigate('/organizaciones', { replace: true })
        return
      }
      setMembers((current) => current.filter((item) => item.id !== member.id))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo retirar a la persona.')
    }
  }

  if (loading) {
    return <LoadingState label="Cargando la organización." />
  }
  if (denied) {
    return (
      <ErrorState title="No puedes abrir esta organización">
        <p>Tu participación no está activa o no tienes permiso. Pertenecer a otra organización no da acceso a esta.</p>
        <Link to="/organizaciones">Volver a mis organizaciones</Link>
      </ErrorState>
    )
  }
  if (!organization) {
    return (
      <ErrorState title="Organización no disponible">
        <p>{error || 'No se encontró la organización o no participas en ella.'}</p>
        <Link to="/organizaciones">Volver a mis organizaciones</Link>
      </ErrorState>
    )
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Organizaciones" title={organization.name}>
        <p>
          {organizationTypeLabels[organization.organizationType] ?? organization.organizationType}
          {' · '}
          {verificationLabels[organization.verificationStatus] ?? organization.verificationStatus}
          {' · '}
          Tu rol: {roleLabels[organization.membership.role] ?? organization.membership.role}
        </p>
      </PageHeader>
      {error ? <p className={styles.banner} role="alert">{error}</p> : null}
      {notice ? <p className={styles.meta} role="status">{notice}</p> : null}

      <form className={`${styles.narrow} ${styles.form}`} onSubmit={saveOrganization}>
        <Input label="Nombre" value={organization.name} disabled={!canManage} onChange={(event) => setOrganization({ ...organization, name: event.target.value })} required />
        <Select label="Tipo" value={organization.organizationType} options={typeOptions} disabled={!canManage} onChange={(event) => setOrganization({ ...organization, organizationType: event.target.value })} />
        <Input label="Correo de contacto" type="email" value={organization.contactEmail} disabled={!canManage} onChange={(event) => setOrganization({ ...organization, contactEmail: event.target.value })} required />
        <Input label="Ciudad" value={organization.city} disabled={!canManage} onChange={(event) => setOrganization({ ...organization, city: event.target.value })} required />
        <Input label="Departamento" value={organization.department} disabled={!canManage} onChange={(event) => setOrganization({ ...organization, department: event.target.value })} required />
        <Input label="País" value={organization.country} disabled={!canManage} maxLength={2} onChange={(event) => setOrganization({ ...organization, country: event.target.value.toUpperCase() })} required />
        <Input label="Identificador tributario" value={organization.taxIdentifier ?? ''} disabled={!canManage} onChange={(event) => setOrganization({ ...organization, taxIdentifier: event.target.value })} hint="Guardar este dato no verifica la organización." />
        {canManage ? <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar organización'}</Button> : <p className={styles.meta}>Tu rol puede consultar estos datos, no editarlos.</p>}
      </form>

      <section className={styles.stack}>
        <h2>Miembros</h2>
        <div className={styles.members}>
          {members.map((member) => {
            const manageable = canManage && (organization.membership.role === 'owner' || !['owner', 'administrator'].includes(member.role))
            const self = member.userId === auth.user?.id
            return (
              <article className={styles.member} key={member.id}>
                <header>
                  <h3>{member.fullName}</h3>
                  <p className={styles.meta}>{member.email}</p>
                  <p className={styles.meta}>{membershipStatusLabels[member.membershipStatus] ?? member.membershipStatus}</p>
                </header>
                <div className={styles.stack}>
                  {manageable && !self ? (
                    <>
                      <Select
                        label={`Rol de ${member.fullName}`}
                        value={member.role}
                        options={(canInviteAdministrators ? [{ value: 'owner', label: roleLabels.owner ?? 'Responsable' }, ...inviteOptions] : inviteOptions.filter((option) => option.value !== 'administrator'))}
                        onChange={(event) => void changeMember(member, event.target.value, member.membershipStatus === 'suspended' ? 'suspended' : 'active')}
                      />
                      <Button variant="quiet" onClick={() => void changeMember(member, member.role, member.membershipStatus === 'suspended' ? 'active' : 'suspended')}>
                        {member.membershipStatus === 'suspended' ? 'Reactivar' : 'Suspender'}
                      </Button>
                    </>
                  ) : (
                    <p className={styles.meta}>{roleLabels[member.role] ?? member.role}</p>
                  )}
                  {self || manageable ? (
                    <Button variant="quiet" onClick={() => void remove(member)}>{self ? 'Salir de la organización' : 'Retirar'}</Button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {canManage ? (
        <section className={styles.stack}>
          <h2>Invitaciones</h2>
          <p className={styles.meta}>REOBRA no envía correos. El token se muestra una sola vez a quien invita y debe entregarse en privado.</p>
          <form className={`${styles.narrow} ${styles.form}`} onSubmit={invite}>
            <Input label="Correo de la persona" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required />
            <Select
              label="Rol"
              value={inviteRole}
              options={canInviteAdministrators ? inviteOptions : inviteOptions.filter((option) => option.value !== 'administrator')}
              onChange={(event) => setInviteRole(event.target.value)}
            />
            <Button type="submit" disabled={inviting}>{inviting ? 'Creando invitación…' : 'Crear invitación'}</Button>
          </form>
          {issuedToken ? (
            <div className={styles.token}>
              <p className={styles.tokenTitle}>Token de un solo uso</p>
              <textarea readOnly value={issuedToken} aria-label="Token de invitación" />
            </div>
          ) : null}
          {invitations.length === 0 ? (
            <EmptyState icon="organization" title="No hay invitaciones pendientes">
              <p>Las invitaciones vencen a los 7 días y se pueden revocar antes de que se acepten.</p>
            </EmptyState>
          ) : (
            <div className={styles.inviteList}>
              {invitations.map((invitation) => (
                <article className={styles.member} key={invitation.id}>
                  <header>
                    <h3>{invitation.email}</h3>
                    <p className={styles.meta}>
                      {roleLabels[invitation.role] ?? invitation.role}
                      {' · vence '}
                      {new Date(invitation.expiresAt).toLocaleDateString('es-CO')}
                    </p>
                  </header>
                  <Button variant="quiet" onClick={() => void revoke(invitation.id)}>Revocar</Button>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}
