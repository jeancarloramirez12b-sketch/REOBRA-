import { Link } from 'react-router-dom'
import { ErrorState } from '../components/ui/ErrorState.tsx'

export function AccessDeniedPage() {
  return (
    <ErrorState title="Acceso denegado">
      <p>Tu cuenta no tiene permiso para esta operación. Cambiar un identificador en la dirección no abre recursos de otra organización.</p>
      <Link to="/">Volver al inicio</Link>
    </ErrorState>
  )
}
