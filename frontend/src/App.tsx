import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider.tsx'
import { AppRoutes } from './routes/AppRoutes.tsx'

export function App() {
  return (
    <BrowserRouter basename="/REOBRA-">
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
