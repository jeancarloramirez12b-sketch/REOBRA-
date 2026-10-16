# REOBRA

REOBRA es una aplicación para la gestión trazable de materiales recuperables de la construcción. La Fase 1 dejó la navegación y la comunicación con el servidor. La Fase 2 añadió el esquema MySQL. La Fase 3 construyó la experiencia visual. La Fase 4 añade cuentas, sesiones, organizaciones y permisos. La Fase 5 registra el inventario de materiales en MySQL. La Fase 6 añade el pasaporte digital, el código QR y el historial. La Fase 7 registra proyectos y necesidades. La Fase 8 compara materiales con esas necesidades. La Fase 9 opera solicitudes, acuerdos, reservas y entregas. La Fase 10 mide lo recibido y confirmado y guarda informes con su metodología. La Fase 11 añade un asistente que explica esos datos y propone borradores.

El modelo de datos, sus estados y las migraciones están en [backend/database/README.md](backend/database/README.md).

## Requisitos

- Node.js 20 o superior
- npm 10 o superior
- MySQL es opcional en esta fase. El frontend y la ruta `GET /api/health` funcionan sin base de datos.

Compruebe las herramientas en PowerShell:

```powershell
node -v
npm -v
mysql --version
```

Si `mysql` no existe, puede continuar. La comprobación `GET /api/health/db` responderá con un error controlado hasta que configure un servidor MySQL.

## Estructura

```text
frontend/   Interfaz React + Vite + TypeScript
backend/    API Express + TypeScript, preparada para MySQL
```

## Instalación

Abra la carpeta `REOBRA` en Visual Studio Code. En la terminal integrada (PowerShell):

```powershell
cd C:\Users\jeanc\OneDrive\Desktop\REOBRA
npm install
```

Si `frontend/.env` o `backend/.env` no existen, créelos a partir de los ejemplos:

```powershell
Copy-Item frontend\.env.example frontend\.env
Copy-Item backend\.env.example backend\.env
```

Esos archivos locales están en `.gitignore`. No los versione y no ponga secretos en el frontend.

## Ejecución en desarrollo

Desde la raíz, en una sola terminal:

```powershell
npm run dev
```

O en dos terminales, con Terminal > Dividir terminal:

```powershell
npm run dev:frontend
```

```powershell
npm run dev:backend
```

- Interfaz: http://localhost:5173
- API: http://localhost:3001/api/health
- MySQL: http://localhost:3001/api/health/db

El backend escucha solo en `127.0.0.1`. El navegador debe abrirse en `http://localhost:5173`: ese origen es el único permitido por CORS.

Después de cambiar un `.env`, detenga el proceso y vuelva a ejecutar `npm run dev`. Vite lee las variables al arrancar.

## Comprobaciones

```powershell
npm run typecheck
npm test
npm run build
```

Salud del backend:

```powershell
curl.exe http://localhost:3001/api/health
curl.exe -i http://localhost:3001/api/health/db
```

La compilación de producción queda en `frontend/dist` y `backend/dist`. Para arrancar el backend compilado:

```powershell
npm run start:backend
```

La vista previa del frontend usa el puerto 4173. Si quiere que esa vista hable con el backend, cambie `FRONTEND_ORIGIN` a `http://localhost:4173` y reinicie el backend. En el día a día use el puerto 5173.

## MySQL

La ruta `GET /api/health` no depende de MySQL. `GET /api/health/db` solo ejecuta `SELECT 1`. Las tablas de negocio se crean con migraciones, no al arrancar el servidor.

1. Instale MySQL Server y deje el servicio en ejecución.
2. Cree una base vacía y un usuario local. Sustituya la clave por una propia y no la guarde en el repositorio:

```sql
CREATE DATABASE reobra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'reobra_user'@'localhost' IDENTIFIED BY 'una_clave_propia';
GRANT ALL PRIVILEGES ON reobra.* TO 'reobra_user'@'localhost';
FLUSH PRIVILEGES;
```

3. Edite `backend/.env` con `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`.
4. Reinicie el backend y abra `http://localhost:3001/api/health/db`.
5. Con la base `reobra` accesible, aplique el esquema:

```powershell
npm run db:migrate
npm run db:status
npm run db:verify
```

Si la conexión falla, la API responde `503` con un mensaje genérico. La interfaz sigue disponible y `GET /api/health` no depende de MySQL.

`DB_PASSWORD` puede quedar vacío únicamente cuando el usuario local de MySQL no tiene clave. La variable debe existir en el archivo.

## Variables de entorno

| Variable | Dónde | Uso |
| --- | --- | --- |
| `PORT` | Backend | Puerto HTTP. En local, `3001`. |
| `NODE_ENV` | Backend | `development`, `test` o `production`. |
| `FRONTEND_ORIGIN` | Backend | Origen CORS, sin barra final. En local, `http://localhost:5173`. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Backend | Conexión MySQL. Son secretos locales. |
| `VITE_API_BASE_URL` | Frontend | URL pública del backend, por ejemplo `http://localhost:3001`. |

## Decisiones de esta fase

- Express 4, con los controladores asíncronos envueltos de forma explícita. Así el manejo de errores no depende del comportamiento de Express 5.
- Un solo origen CORS, tomado de `FRONTEND_ORIGIN`.
- El pool de MySQL se crea solo cuando se consulta `/api/health/db`.
- No hay biblioteca de iconos: los iconos son SVG del propio proyecto.
- Las pruebas del backend usan el ejecutor integrado de Node.js (`node:test`) mediante `tsx`. El frontend se verifica con el chequeo de tipos, la compilación y la interfaz en el navegador.

## Esquema de la Fase 2

Las migraciones viven en `backend/database/migrations` y solo se aplican a la base `reobra`. No se ejecutan con `NODE_ENV=production`.

```powershell
npm run db:migrate
npm run db:status
npm run db:verify
npm test
```

Para deshacer únicamente la última migración cuando no hay filas que perder:

```powershell
npm run db:rollback -- --confirm
```

`--discard-data` además borra filas. No lo use si la base ya tiene información que deba conservarse. El detalle del modelo está en `backend/database/README.md`.

## Interfaz de la Fase 3

La interfaz conserva la paleta oscura de REOBRA: fondo `#070b11`, acento `#3dffb0` y cian `#2ad4ff`. La tipografía es Outfit, con JetBrains Mono para etiquetas técnicas. No se añadieron bibliotecas de componentes: los controles son del propio proyecto y los iconos siguen siendo SVG locales.

Tokens en `frontend/src/styles/tokens.css`: color, escala tipográfica, espaciado, radios, sombras y anchos de la barra lateral.

Componentes en `frontend/src/components/ui/`: botones, campo de texto, distintivos, tarjetas, estado vacío, error, carga, esqueleto, encabezados, pestañas y migas de pan. El layout vive en `frontend/src/components/layout/`.

Pantallas: Inicio, Inventario, Pasaporte digital, Proyectos, Compatibilidad, Solicitudes y entregas, Impacto y Configuración. Las acciones que todavía no guardan datos quedan deshabilitadas y explican que estarán disponibles más adelante. La barra lateral se puede contraer en escritorio; la preferencia se guarda en el navegador. En pantallas estrechas el menú se abre como panel.

Los listados futuros usarán tabla en escritorio y fichas en teléfono. Hoy esos listados están vacíos a propósito.

## Identidad de la Fase 4

Una persona puede crear una cuenta, iniciar sesión, cerrar sesión, editar su perfil, cambiar su contraseña, crear una organización e invitar miembros. La sesión es una cookie `HttpOnly` llamada `reobra_session`. MySQL guarda el SHA-256 de ese identificador, nunca el valor en claro. Las contraseñas se guardan con Argon2id.

Las pantallas públicas siguen abiertas sin sesión. Perfil y organizaciones exigen una sesión vigente. Cada operación de organización comprueba en el servidor la membresía y el rol. Un identificador ajeno responde como recurso no encontrado.

No hay servicio de correo. Quien invita ve el token una sola vez y debe entregarlo por un canal privado. La persona invitada inicia sesión con ese mismo correo y lo pega en «Aceptar invitación». El token vence a los 7 días, es de un solo uso y se puede revocar.

Roles dentro de una organización:

- Responsable principal (`owner`): administra la organización, invita incluso a otra persona administradora y no puede dejar la organización si es el único responsable activo.
- Administración (`administrator`): edita la organización e invita roles de consulta, edición y revisión técnica. No invita ni degrada a responsables o administradores.
- Edición, revisión técnica y consulta: ven la organización. No editan miembros ni datos.

La migración nueva es `0009_sessions_and_invitations.sql`. Las migraciones 0001 a 0008 no se modifican. La cuenta MySQL de la aplicación no puede crear otra base, así que las pruebas de identidad usan `reobra` y al final borran solo los correos `fase4-…@reobra.test` que ellas mismas crearon.

Dependencias añadidas en el backend: `argon2` para el hash de contraseñas y `zod` para validar las solicitudes. No se guardan secretos nuevos en el repositorio.

El archivo `aliada/acceso-directo.html` es un índice para abrir la aplicación en el navegador. No forma parte del build de Vite ni cambia las rutas de React.

## Inventario de la Fase 5

Un miembro con rol de responsable, administración o edición puede registrar, editar, publicar, retirar o archivar materiales de su organización. La consulta ve el inventario, pero no lo modifica. Quien no pertenece a la organización recibe «no encontrado»: no existe un catálogo público.

El identificador visible `MAT-000123` se calcula a partir del id interno. No es un pasaporte ni un código QR. La evaluación técnica sigue en `pending` y el formulario no permite declararla. La cantidad disponible sale de la vista `material_quantity_summary` (publicada menos entregada y comprometida) y puede ser negativa. No se implementó otra fórmula.

Las imágenes se guardan en `backend/storage/materials/{id}/{uuid}.jpg|png|webp`, fuera de MySQL. La tabla `material_images` solo guarda la referencia. Se aceptan JPEG, PNG y WebP de hasta 5 MB, como máximo 6 por material, comprobando los bytes reales. Ese directorio está ignorado por git. Más adelante se puede cambiar el almacenamiento local por uno externo sin mover las claves si se conserva el mismo patrón.

La migración `0010_material_category_catalog.sql` carga el catálogo de categorías. No crea materiales de ejemplo. Las migraciones 0001 a 0009 no se modifican.

Endpoints, todos con sesión:

- `GET /api/materials`
- `POST /api/materials`
- `GET /api/materials/:id`
- `PATCH /api/materials/:id`
- `PATCH /api/materials/:id/status`
- `POST /api/materials/:id/images`
- `GET /api/materials/:id/images/:imageId`
- `DELETE /api/materials/:id/images/:imageId`
- `GET /api/material-categories`
- `GET /api/measurement-units`

Las pruebas de inventario usan `reobra` y al final borran solo los correos `fase5-…@reobra.test` que ellas mismas crearon, con sus materiales e imágenes.

## Pasaporte de la Fase 6

Cada material recibe un pasaporte en `material_passports`. El identificador público tiene la forma `rob_` más 20 caracteres y no cambia al editar el material. Los materiales ya registrados reciben uno al aplicar `0011_passport_visibility_and_evidence.sql`. `0012` y `0013` reponen la organización en eventos históricos si esa columna se recreó vacía. La consulta es privada por defecto. Solo un miembro que puede editar el inventario puede habilitar la consulta pública, y solo si el material está publicado. Al retirarlo, la consulta pública se apaga y el historial se conserva.

El código QR contiene la URL `{FRONTEND_ORIGIN}/pasaporte/{publicCode}`. No incluye sesión ni datos privados. Si esa URL apunta a localhost, un teléfono fuera de la máquina no puede abrirla.

Los documentos se guardan en `backend/storage/documents/{id}/{uuid}.pdf|jpg|png|webp`. La huella SHA-256 permite comparar el archivo; no demuestra su autenticidad. Marcar un documento como revisado no certifica el material. No hay un formulario para declarar una evaluación técnica.

El historial en `material_trace_events` solo se añade. La API no ofrece editar ni borrar eventos. Un cambio de material y su evento van en la misma transacción. La cabecera `Idempotency-Key` evita repetir la misma operación.

Endpoints:

- `GET /api/materials/:id/passport` (sesión y membresía)
- `GET /api/passports` (sesión)
- `GET /api/passports/:publicCode` (pública solo si está publicada y marcada como pública)
- `GET /api/passports/:publicCode/events` (sesión y membresía)
- `GET /api/passports/:publicCode/evidence` y `GET .../evidence/:documentId`
- `POST /api/passports/:publicCode/evidence`
- `PATCH /api/passports/:publicCode/evidence/:documentId`
- `DELETE /api/passports/:publicCode/evidence/:documentId`
- `PATCH /api/passports/:publicCode/visibility`
- `GET /api/passports/:publicCode/qr`
- `GET /api/passports/:publicCode/images/:imageId`

Las pruebas de pasaporte usan correos `fase6-…@reobra.test` y no borran los materiales anteriores.

## Proyectos de la Fase 7

Una organización puede crear proyectos y declarar varias necesidades de material. El identificador público del proyecto es `prj_` más 20 caracteres. La necesidad usa `nd_` más 20 caracteres. La consulta es privada por defecto. La dirección exacta no sale en la ficha pública. Marcar una necesidad como satisfecha no descuenta inventario ni registra una entrega.

La migración `0014_project_operations.sql` amplía `projects` y `project_material_needs` y crea `project_events`. No borra proyectos ni materiales. Las pruebas usan correos `fase7-…@reobra.test`.

## Matching de la Fase 8

El motor `reobra-match-v1` compara materiales publicados con una necesidad abierta. Las ponderaciones iniciales son categoría 30 %, cantidad 25 %, ubicación 15 %, características 20 % y disponibilidad 10 %. Un dato desconocido no suma puntos y no se presenta como incompatibilidad. La migración `0015_matching_engine.sql` amplía `material_matches` y crea `matching_runs`. Una coincidencia no reserva ni certifica el material. La cantidad que ofrece es la disponibilidad libre: existencia declarada menos entregas registradas menos saldo comprometido.

## Operaciones de la Fase 9

Una organización puede solicitar un material publicado y visible. La solicitud no reserva inventario. La reserva ocurre cuando las dos organizaciones confirman la misma propuesta y hay cantidad libre. La existencia declarada no se descuenta al reservar. Un despacho con estado `delivered` consume esa reserva. La recepción la confirma el destinatario y no vuelve a descontar. La migración `0016_material_operations.sql` amplía `material_requests` y `deliveries` y crea propuestas, eventos, avisos internos, incidencias y archivos. No es un contrato con firma electrónica ni calcula rutas o costos. Las pruebas usan correos `fase9-…@reobra.test`.

## Impacto de la Fase 10

El centro de impacto lee recepciones confirmadas. Una publicación, una coincidencia, una solicitud, un acuerdo, una reserva o un despacho no entran en el total recibido. Cada despacho se cuenta una vez: lo suministrado y lo recibido son perspectivas distintas y no se suman para obtener el total.

La cobertura de una necesidad es la cantidad recibida y confirmada dividida por la cantidad requerida, dentro de esa misma unidad. Si el denominador no es mayor que cero, la tasa no se calcula. Las unidades distintas no se suman. Kilogramos, gramos y toneladas se convierten entre sí. Un conteo, un área o un volumen solo pasan a kilogramos si la organización registró un parámetro de masa con su procedencia. Sin ese dato, la masa queda como no calculable.

Una estimación ambiental exige un factor aprobado de la propia organización, con fuente, emisor, año, región, versión y condiciones. No hay factores oficiales precargados. Si faltan datos, la respuesta es “No calculable: faltan datos o factores validados”. La estimación no es una certificación, un análisis de ciclo de vida ni una declaración de neutralidad. La migración `0017_impact_engine.sql` añade el gramo y las tablas de metodologías, factores, parámetros de masa, cálculos, informes y auditoría. Las tablas anteriores `impact_records` e `impact_evidence` se conservan. Las pruebas usan correos `fase10-…@reobra.test`.

## Asistente de la Fase 11

El asistente vive en el backend. El navegador no llama al proveedor ni ve la clave. Si `AI_ENABLED`, `AI_PROVIDER=openai` y `AI_API_KEY` no están completos, la respuesta es “Servicio de inteligencia artificial no configurado”. No se inventa una respuesta de modelo.

Las sugerencias de materiales y necesidades, y las explicaciones de matching e impacto, salen de reglas y de los motores ya existentes. El matching sigue calculando compatibilidad, cobertura y puntaje. El impacto sigue siendo la única fuente de cifras ambientales. La cobertura de cantidad no se presenta como puntaje.

Las herramientas de lectura solo consultan lo que el usuario ya puede ver. No aceptan SQL. Un texto dentro de un material se trata como dato, no como instrucción. Una propuesta confirmada llena un borrador en la pantalla; no reserva, no despacha, no recibe y no certifica.

La migración es `0018_ai_assistant.sql`. Las conversaciones pertenecen al usuario que las creó. Al proveedor, cuando está configurado, se le envían la instrucción fija, los últimos mensajes de esa conversación y un resumen corto de las herramientas. No se envían documentos completos, claves ni tokens. El usuario puede borrar su conversación. Esta fase no incluye un borrado automático por antigüedad. Las pruebas usan correos `fase11-…@reobra.test` y un proveedor sustituto que solo existe en esas pruebas.

Variables en `backend/.env`, nunca en el frontend: `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, `AI_TIMEOUT_MS`, `AI_MAX_INPUT_CHARS`, `AI_MAX_OUTPUT_TOKENS`, `AI_USER_HOURLY_LIMIT`, `AI_ORG_HOURLY_LIMIT`.

## Fuera de alcance

Certificación ambiental oficial, huella de carbono certificada, neutralidad climática, mercado de créditos, factores inventados, rutas de transporte ficticias, firma electrónica certificada, transportistas externos, pagos, cadena de bloques, agentes que negocien acuerdos, reservas automáticas, certificación técnica o ambiental hecha por un modelo y despliegue.
