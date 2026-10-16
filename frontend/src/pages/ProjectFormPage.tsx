import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '../components/ui/Button.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'
import { Input } from '../components/ui/Input.tsx'
import { LoadingState } from '../components/ui/LoadingState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { Select } from '../components/ui/Select.tsx'
import { Textarea } from '../components/ui/Textarea.tsx'
import { api, ApiError } from '../features/auth/api.ts'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import type { MemberRecord } from '../features/auth/types.ts'
import { canWriteMaterials } from '../features/materials/rules.ts'
import { projectStatusLabels, projectTypeLabels, visibilityLabels } from '../features/projects/labels.ts'
import { validateProjectDraft, type ProjectDraft } from '../features/projects/rules.ts'
import styles from '../features/projects/projects.module.css'
import page from './screen.module.css'

const emptyDraft: ProjectDraft = {
  title: '',
  description: '',
  projectType: 'construction',
  organizationId: '',
  city: '',
  department: '',
  address: '',
  startDate: '',
  endDate: '',
  visibility: 'private',
  responsibleUserId: '',
  status: 'draft',
}

type ProjectRecord = ProjectDraft & { id: number; canEdit: boolean; organizationName?: string }

function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
}

export function ProjectFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const params = useParams()
  const projectId = Number(params.projectId)
  const editing = mode === 'edit'
  const writable = auth.memberships.filter((item) => item.membershipStatus === 'active' && canWriteMaterials(item.role))
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft)
  const [errors, setErrors] = useState<Partial<Record<keyof ProjectDraft, string>>>({})
  const [banner, setBanner] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(editing)
  const [members, setMembers] = useState<MemberRecord[]>([])

  useEffect(() => {
    if (editing) {
      return
    }
    const first = auth.memberships.find((item) => item.membershipStatus === 'active' && canWriteMaterials(item.role))
    if (!first) {
      return
    }
    setDraft((current) => (current.organizationId ? current : { ...current, organizationId: String(first.organizationId) }))
  }, [auth.memberships, editing])

  useEffect(() => {
    if (!editing) {
      return
    }
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
      setBanner('El identificador no es válido.')
      setLoading(false)
      return
    }
    let active = true
    void api<{ project: ProjectRecord & { organizationId: number; responsibleUserId: number | null; description: string | null; address: string | null; startDate: string | null; endDate: string | null } }>(`/api/projects/${projectId}`)
      .then((payload) => {
        if (!active) {
          return
        }
        const project = payload.project
        setDraft({
          title: project.title,
          description: project.description ?? '',
          projectType: project.projectType,
          organizationId: String(project.organizationId),
          city: project.city,
          department: project.department,
          address: project.address ?? '',
          startDate: project.startDate ?? '',
          endDate: project.endDate ?? '',
          visibility: project.visibility,
          responsibleUserId: project.responsibleUserId ? String(project.responsibleUserId) : '',
          status: project.status,
        })
        setLoading(false)
      })
      .catch((caught: unknown) => {
        if (!active) {
          return
        }
        if (sessionEnded(caught)) {
          navigate('/sesion-expirada', { replace: true })
          return
        }
        setBanner(caught instanceof ApiError ? caught.message : 'No se pudo abrir el proyecto.')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [editing, navigate, projectId])

  useEffect(() => {
    const organizationId = Number(draft.organizationId)
    if (!Number.isSafeInteger(organizationId) || organizationId < 1) {
      setMembers([])
      return
    }
    let active = true
    void api<{ members: MemberRecord[] }>(`/api/organizations/${organizationId}/members`)
      .then((payload) => {
        if (active) {
          setMembers(payload.members.filter((item) => item.membershipStatus === 'active'))
        }
      })
      .catch(() => {
        if (active) {
          setMembers([])
        }
      })
    return () => {
      active = false
    }
  }, [draft.organizationId])

  function update<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fieldErrors = validateProjectDraft(draft)
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) {
      setBanner('Revisa los campos marcados.')
      return
    }
    setPending(true)
    setBanner('')
    const body = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      projectType: draft.projectType,
      city: draft.city.trim(),
      department: draft.department.trim(),
      address: draft.address.trim() || null,
      startDate: draft.startDate || null,
      endDate: draft.endDate || null,
      visibility: draft.visibility,
      responsibleUserId: draft.responsibleUserId ? Number(draft.responsibleUserId) : null,
      ...(editing ? {} : { organizationId: Number(draft.organizationId), status: draft.status === 'active' ? 'active' : 'draft' }),
    }
    try {
      const payload = await api<{ project: { id: number } }>(editing ? `/api/projects/${projectId}` : '/api/projects', {
        method: editing ? 'PATCH' : 'POST',
        body,
      })
      navigate(`/proyectos/${payload.project.id}`)
    } catch (caught) {
      if (sessionEnded(caught)) {
        navigate('/sesion-expirada', { replace: true })
        return
      }
      setBanner(caught instanceof ApiError ? caught.message : 'No se pudo guardar el proyecto.')
      setPending(false)
    }
  }

  if (loading) {
    return <LoadingState label="Abriendo el formulario." />
  }
  if (!editing && writable.length === 0) {
    return (
      <ErrorState title="No puedes crear proyectos" action={<ButtonLink to="/proyectos">Volver</ButtonLink>}>
        <p>Hace falta una organización donde tengas permiso de edición.</p>
      </ErrorState>
    )
  }

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Proyecto" title={editing ? 'Editar proyecto' : 'Crear proyecto'} actions={<ButtonLink to="/proyectos">Volver</ButtonLink>}>
        <p>La dirección exacta queda privada. La consulta pública solo está disponible cuando el proyecto está activo.</p>
      </PageHeader>
      {banner ? <p className={styles.banner} role="alert">{banner}</p> : null}
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        {!editing ? (
          <Select
            label="Organización"
            value={draft.organizationId}
            error={errors.organizationId}
            onChange={(event) => update('organizationId', event.target.value)}
            options={writable.map((item) => ({ value: String(item.organizationId), label: item.organizationName }))}
          />
        ) : null}
        <Input label="Nombre" value={draft.title} error={errors.title} maxLength={180} onChange={(event) => update('title', event.target.value)} />
        <Textarea label="Descripción" value={draft.description} error={errors.description} maxLength={4000} onChange={(event) => update('description', event.target.value)} />
        <Select
          label="Tipo"
          value={draft.projectType}
          error={errors.projectType}
          onChange={(event) => update('projectType', event.target.value)}
          options={Object.entries(projectTypeLabels).map(([value, label]) => ({ value, label }))}
        />
        <Input label="Municipio" value={draft.city} error={errors.city} maxLength={120} onChange={(event) => update('city', event.target.value)} />
        <Input label="Departamento" value={draft.department} error={errors.department} maxLength={120} onChange={(event) => update('department', event.target.value)} />
        <Input label="Dirección privada" value={draft.address} error={errors.address} hint="No se muestra en la consulta pública." maxLength={240} onChange={(event) => update('address', event.target.value)} />
        <Input label="Inicio estimado" type="date" value={draft.startDate} error={errors.startDate} onChange={(event) => update('startDate', event.target.value)} />
        <Input label="Finalización estimada" type="date" value={draft.endDate} error={errors.endDate} onChange={(event) => update('endDate', event.target.value)} />
        <Select
          label="Responsable"
          value={draft.responsibleUserId}
          onChange={(event) => update('responsibleUserId', event.target.value)}
          options={[{ value: '', label: 'Quien crea el proyecto' }, ...members.map((item) => ({ value: String(item.userId), label: item.fullName }))]}
        />
        {!editing ? (
          <Select
            label="Estado inicial"
            value={draft.status}
            onChange={(event) => update('status', event.target.value)}
            options={['draft', 'active'].map((value) => ({ value, label: projectStatusLabels[value] ?? value }))}
          />
        ) : null}
        <Select
          label="Visibilidad"
          value={draft.visibility}
          error={errors.visibility}
          onChange={(event) => update('visibility', event.target.value)}
          options={Object.entries(visibilityLabels).map(([value, label]) => ({ value, label }))}
        />
        <Button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar proyecto'}</Button>
      </form>
    </div>
  )
}
