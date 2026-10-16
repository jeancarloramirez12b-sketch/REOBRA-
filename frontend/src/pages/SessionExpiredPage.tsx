import { Link } from 'react-router-dom'
import { ErrorState } from '../components/ui/ErrorState.tsx'

export function SessionExpiredPage() {
  return (
    <ErrorState title="La sesión ya no es válida">
      <p>Venció o se cerró en el servidor. Vuelve a ingresar para continuar. Las pantallas públicas siguen disponibles.</p>
      <Link to="/ingresar">Ingresar de nuevo</Link>
    </ErrorState>
  )
}
