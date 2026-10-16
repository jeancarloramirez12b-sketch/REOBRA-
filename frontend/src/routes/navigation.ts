import type { IconName } from '../components/ui/Icon.tsx'

export type Section = {
  path: string
  label: string
  icon: IconName
  summary: string
  pending: boolean
}

export const sections: Section[] = [
  {
    path: '/',
    label: 'Inicio',
    icon: 'home',
    summary: 'Panel inicial de REOBRA y estado de la plataforma.',
    pending: false,
  },
  {
    path: '/inventario',
    label: 'Inventario de materiales',
    icon: 'inventory',
    summary: 'Registro y consulta de materiales recuperables de obras y procesos de construcción.',
    pending: true,
  },
  {
    path: '/pasaporte',
    label: 'Pasaporte digital',
    icon: 'passport',
    summary: 'Documentación de las características y de la trazabilidad de cada material.',
    pending: true,
  },
  {
    path: '/proyectos',
    label: 'Proyectos',
    icon: 'projects',
    summary: 'Obras y procesos que declaran necesidades de material.',
    pending: true,
  },
  {
    path: '/compatibilidad',
    label: 'Compatibilidad',
    icon: 'compatibility',
    summary: 'Comparación explicable entre materiales disponibles y necesidades abiertas.',
    pending: false,
  },
  {
    path: '/solicitudes',
    label: 'Solicitudes y entregas',
    icon: 'deliveries',
    summary: 'Solicitudes, acuerdos, reservas y entregas entre organizaciones.',
    pending: false,
  },
  {
    path: '/impacto',
    label: 'Impacto',
    icon: 'impact',
    summary: 'Indicadores de recepciones confirmadas, circularidad e informes trazables.',
    pending: false,
  },
  {
    path: '/asistente',
    label: 'Asistente',
    icon: 'assistant',
    summary: 'Preguntas, borradores y explicaciones sobre los datos autorizados de REOBRA.',
    pending: false,
  },
  {
    path: '/configuracion',
    label: 'Configuración',
    icon: 'settings',
    summary: 'Parámetros de la plataforma. Las opciones todavía no están disponibles.',
    pending: true,
  },
]

export function findSection(pathname: string): Section | undefined {
  return sections.find((section) => section.path === pathname)
}

export function pageTitle(pathname: string): string {
  if (pathname === '/ingresar') return 'Ingresar'
  if (pathname === '/registro') return 'Crear cuenta'
  if (pathname === '/perfil') return 'Mi perfil'
  if (pathname === '/organizaciones/nueva') return 'Crear organización'
  if (pathname === '/organizaciones') return 'Mis organizaciones'
  if (pathname.startsWith('/organizaciones/')) return 'Organización'
  if (pathname === '/invitacion') return 'Aceptar invitación'
  if (pathname === '/acceso-denegado') return 'Acceso denegado'
  if (pathname === '/sesion-expirada') return 'Sesión vencida'
  if (pathname === '/pasaporte') return 'Pasaporte digital'
  if (/^\/pasaporte\/rob_[a-z0-9]{20}$/.test(pathname)) return 'Pasaporte'
  if (pathname === '/proyectos/nuevo') return 'Crear proyecto'
  if (/^\/proyectos\/\d+\/editar$/.test(pathname)) return 'Editar proyecto'
  if (/^\/proyectos\/\d+\/necesidades\/nueva$/.test(pathname)) return 'Agregar necesidad'
  if (/^\/proyectos\/\d+\/necesidades\/\d+\/editar$/.test(pathname)) return 'Editar necesidad'
  if (/^\/proyectos\/\d+\/necesidades\/\d+\/coincidencias$/.test(pathname)) return 'Matching de materiales'
  if (pathname === '/solicitudes/nueva') return 'Solicitar material'
  if (/^\/solicitudes\/\d+$/.test(pathname)) return 'Operación de material'
  if (/^\/proyectos\/\d+\/necesidades\/\d+$/.test(pathname)) return 'Necesidad'
  if (/^\/proyectos\/\d+$/.test(pathname)) return 'Proyecto'
  if (pathname === '/asistente') return 'Asistente'
  if (pathname === '/inventario/nuevo') return 'Registrar material'
  if (/^\/inventario\/\d+\/editar$/.test(pathname)) return 'Editar material'
  if (/^\/inventario\/\d+$/.test(pathname)) return 'Material'
  return findSection(pathname)?.label ?? 'Página no encontrada'
}
