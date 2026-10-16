import { ButtonLink } from '../components/ui/Button.tsx'
import { ErrorState } from '../components/ui/ErrorState.tsx'

export function NotFoundPage() {
  return (
    <ErrorState title="Esta página no existe" action={<ButtonLink to="/">Volver al inicio</ButtonLink>}>
      <p>La dirección no corresponde a ninguna sección de REOBRA.</p>
    </ErrorState>
  )
}
