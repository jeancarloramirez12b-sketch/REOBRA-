import { Link } from 'react-router-dom'
import { ButtonLink } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import styles from '../features/auth/auth.module.css'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { membershipStatusLabels, roleLabels } from '../features/auth/labels.ts'
import page from './screen.module.css'

export function OrganizationsPage() {
  const auth = useAuth()

  return (
    <div className={page.page}>
      <PageHeader
        eyebrow="Organizaciones"
        title="Mis organizaciones"
        actions={<ButtonLink to="/organizaciones/nueva" variant="primary">Crear organización</ButtonLink>}
      >
        <p>Aquí aparecen las organizaciones en las que participas. Crear una no verifica su existencia legal.</p>
      </PageHeader>
      {auth.memberships.length === 0 ? (
        <EmptyState icon="organization" title="Todavía no participas en una organización">
          <p>Puedes crear la primera y quedarás como responsable principal.</p>
        </EmptyState>
      ) : (
        <div className={styles.members}>
          {auth.memberships.map((membership) => (
            <article className={styles.member} key={membership.organizationId}>
              <header>
                <h3>
                  <Link to={`/organizaciones/${membership.organizationId}`}>{membership.organizationName}</Link>
                </h3>
                <p className={styles.meta}>
                  {roleLabels[membership.role] ?? membership.role}
                  {' · '}
                  {membershipStatusLabels[membership.membershipStatus] ?? membership.membershipStatus}
                </p>
              </header>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
