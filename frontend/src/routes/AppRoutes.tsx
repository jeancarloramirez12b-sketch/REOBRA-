import { Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell.tsx'
import { RequireAuth } from '../features/auth/RequireAuth.tsx'
import { AccessDeniedPage } from '../pages/AccessDeniedPage.tsx'
import { CompatibilityPage } from '../pages/CompatibilityPage.tsx'
import { HomePage } from '../pages/HomePage.tsx'
import { ImpactPage } from '../pages/ImpactPage.tsx'
import { AssistantPage } from '../pages/AssistantPage.tsx'
import { InventoryPage } from '../pages/InventoryPage.tsx'
import { MaterialDetailPage } from '../pages/MaterialDetailPage.tsx'
import { MaterialFormPage } from '../pages/MaterialFormPage.tsx'
import { InvitationPage } from '../pages/InvitationPage.tsx'
import { LoginPage } from '../pages/LoginPage.tsx'
import { NotFoundPage } from '../pages/NotFoundPage.tsx'
import { OrganizationCreatePage } from '../pages/OrganizationCreatePage.tsx'
import { OrganizationDetailPage } from '../pages/OrganizationDetailPage.tsx'
import { OrganizationsPage } from '../pages/OrganizationsPage.tsx'
import { PassportDetailPage } from '../pages/PassportDetailPage.tsx'
import { PassportPage } from '../pages/PassportPage.tsx'
import { ProfilePage } from '../pages/ProfilePage.tsx'
import { MatchingPage } from '../pages/MatchingPage.tsx'
import { NeedDetailPage } from '../pages/NeedDetailPage.tsx'
import { NeedFormPage } from '../pages/NeedFormPage.tsx'
import { ProjectDetailPage } from '../pages/ProjectDetailPage.tsx'
import { ProjectFormPage } from '../pages/ProjectFormPage.tsx'
import { ProjectsPage } from '../pages/ProjectsPage.tsx'
import { RegisterPage } from '../pages/RegisterPage.tsx'
import { OperationDetailPage } from '../pages/OperationDetailPage.tsx'
import { RequestFormPage } from '../pages/RequestFormPage.tsx'
import { RequestsPage } from '../pages/RequestsPage.tsx'
import { SessionExpiredPage } from '../pages/SessionExpiredPage.tsx'
import { SettingsPage } from '../pages/SettingsPage.tsx'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="inventario" element={<InventoryPage />} />
        <Route path="inventario/nuevo" element={<RequireAuth><MaterialFormPage mode="create" /></RequireAuth>} />
        <Route path="inventario/:materialId/editar" element={<RequireAuth><MaterialFormPage mode="edit" /></RequireAuth>} />
        <Route path="inventario/:materialId" element={<RequireAuth><MaterialDetailPage /></RequireAuth>} />
        <Route path="pasaporte" element={<PassportPage />} />
        <Route path="pasaporte/:publicCode" element={<PassportDetailPage />} />
        <Route path="proyectos" element={<ProjectsPage />} />
        <Route path="proyectos/nuevo" element={<RequireAuth><ProjectFormPage mode="create" /></RequireAuth>} />
        <Route path="proyectos/:projectId/editar" element={<RequireAuth><ProjectFormPage mode="edit" /></RequireAuth>} />
        <Route path="proyectos/:projectId/necesidades/nueva" element={<RequireAuth><NeedFormPage mode="create" /></RequireAuth>} />
        <Route path="proyectos/:projectId/necesidades/:needId/editar" element={<RequireAuth><NeedFormPage mode="edit" /></RequireAuth>} />
        <Route path="proyectos/:projectId/necesidades/:needId/coincidencias" element={<RequireAuth><MatchingPage /></RequireAuth>} />
        <Route path="proyectos/:projectId/necesidades/:needId" element={<RequireAuth><NeedDetailPage /></RequireAuth>} />
        <Route path="proyectos/:projectId" element={<RequireAuth><ProjectDetailPage /></RequireAuth>} />
        <Route path="compatibilidad" element={<CompatibilityPage />} />
        <Route path="solicitudes" element={<RequireAuth><RequestsPage /></RequireAuth>} />
        <Route path="solicitudes/nueva" element={<RequireAuth><RequestFormPage /></RequireAuth>} />
        <Route path="solicitudes/:requestId" element={<RequireAuth><OperationDetailPage /></RequireAuth>} />
        <Route path="impacto" element={<RequireAuth><ImpactPage /></RequireAuth>} />
        <Route path="asistente" element={<RequireAuth><AssistantPage /></RequireAuth>} />
        <Route path="configuracion" element={<SettingsPage />} />
        <Route path="ingresar" element={<LoginPage />} />
        <Route path="registro" element={<RegisterPage />} />
        <Route path="invitacion" element={<InvitationPage />} />
        <Route path="acceso-denegado" element={<AccessDeniedPage />} />
        <Route path="sesion-expirada" element={<SessionExpiredPage />} />
        <Route path="perfil" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="organizaciones" element={<RequireAuth><OrganizationsPage /></RequireAuth>} />
        <Route path="organizaciones/nueva" element={<RequireAuth><OrganizationCreatePage /></RequireAuth>} />
        <Route path="organizaciones/:organizationId" element={<RequireAuth><OrganizationDetailPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
