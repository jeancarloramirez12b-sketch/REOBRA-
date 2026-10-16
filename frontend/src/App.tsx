import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider.tsx'
import { AppRoutes } from './routes/AppRoutes.tsx'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
