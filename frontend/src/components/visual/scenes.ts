export type SceneId =
  | 'home'
  | 'inventory'
  | 'passport'
  | 'project'
  | 'matching'
  | 'logistics'
  | 'impact'
  | 'assistant'
  | 'auth'
  | 'organization'

export type Scene = {
  src: string
  alt: string
}

export const scenes: Record<SceneId, Scene> = {
  home: {
    src: '/scenes/reobra-home.jpg',
    alt: 'Patio circular de ladrillos, madera y acero recuperados',
  },
  inventory: {
    src: '/scenes/reobra-inventory.jpg',
    alt: 'Bodega con ladrillos, tablas y vigas ordenados para reutilizar',
  },
  passport: {
    src: '/scenes/reobra-passport.jpg',
    alt: 'Viga de madera y ladrillos con una placa de identificación',
  },
  project: {
    src: '/scenes/reobra-project.jpg',
    alt: 'Obra de concreto con materiales recuperados preparados al frente',
  },
  matching: {
    src: '/scenes/reobra-matching.jpg',
    alt: 'Dos grupos de materiales recuperados enfrentados para compararlos',
  },
  logistics: {
    src: '/scenes/reobra-logistics.jpg',
    alt: 'Bultos de ladrillo y madera listos para una entrega',
  },
  impact: {
    src: '/scenes/reobra-impact.jpg',
    alt: 'Plantas creciendo entre ladrillos y madera recuperados',
  },
  assistant: {
    src: '/scenes/reobra-assistant.jpg',
    alt: 'Mesa de trabajo con muestras de ladrillo, madera y una pantalla oscura',
  },
  auth: {
    src: '/scenes/reobra-auth.jpg',
    alt: 'Entrada nocturna de un patio de materiales recuperados',
  },
  organization: {
    src: '/scenes/reobra-organization.jpg',
    alt: 'Banco de taller con cascos, guantes y muestras de materiales',
  },
}

export function sceneForPath(pathname: string): SceneId {
  if (pathname.startsWith('/inventario')) return 'inventory'
  if (pathname.startsWith('/pasaporte')) return 'passport'
  if (pathname.includes('/coincidencias') || pathname.startsWith('/compatibilidad')) return 'matching'
  if (pathname.startsWith('/proyectos')) return 'project'
  if (pathname.startsWith('/solicitudes')) return 'logistics'
  if (pathname.startsWith('/impacto')) return 'impact'
  if (pathname.startsWith('/asistente')) return 'assistant'
  if (
    pathname.startsWith('/organizaciones') ||
    pathname.startsWith('/perfil') ||
    pathname.startsWith('/configuracion')
  ) {
    return 'organization'
  }
  if (
    pathname.startsWith('/ingresar') ||
    pathname.startsWith('/registro') ||
    pathname.startsWith('/invitacion') ||
    pathname.startsWith('/acceso-denegado') ||
    pathname.startsWith('/sesion-expirada')
  ) {
    return 'auth'
  }
  return 'home'
}
