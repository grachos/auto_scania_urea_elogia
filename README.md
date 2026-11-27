# Auto Scania Urea Elogia

Reporte automático del nivel de urea (AdBlue) de la flota de camiones Scania.

## 1. Qué hace

Cada 4 horas el proceso:

1. Consulta la API oficial rFMS v4 de Scania y obtiene, para cada camión, el último snapshot (`snapshotData.catalystFuelLevel`, nivel de urea en %).
2. Guarda el histórico en Supabase (tablas `vehicles` y `urea_readings`), si Supabase está configurado.
3. Clasifica cada camión según los umbrales configurados y envía un correo HTML a los destinatarios:

| Estado | Condición (con valores por defecto) |
|---|---|
| `CRITICO` | nivel < 20 % (`THRESHOLD_CRITICAL`) |
| `BAJO` | 20 % <= nivel < 35 % (`THRESHOLD_LOW`) |
| `OK` | nivel >= 35 % |
| `SIN_DATO` | el camión no reporta `catalystFuelLevel` |

El correo incluye la variación respecto a la lectura anterior y marca como desactualizado un dato con más de 24 h de antigüedad. Si la consulta a Scania falla, se envía un correo de alerta con el error.

## 2. Por qué la API oficial y no el login web

Se usa la API oficial rFMS (`SOURCE=rfms`, valor por defecto) porque:

- Los `session_code`, `execution` y `tab_id` del login de Keycloak (`mylogin.scania.com`) son de un solo uso, así que no se pueden reutilizar ni capturar para hacer peticiones directas.
- El scraping del portal es frágil: el login puede pedir MFA/OTP y cualquier cambio en el DOM rompe la extracción.

El modo `SOURCE=scrape` (Playwright contra `my.scania.com`) existe solo como alternativa para el VPS. Hoy no funciona sin configuración adicional: los selectores de `src/sources/scrapeSource.ts` (`SEL.vin`, `SEL.plate`, `SEL.urea`) están vacíos y el código lanza el error "selectors not configured". Además, si la cuenta tiene MFA, el login automático falla.

Autenticación rFMS (`src/scania/auth.ts`): se pide un challenge a `/auth/clientid2challenge`, se calcula `response = base64url(HMAC-SHA256(secretKey, challenge))` y se intercambia por un token en `/auth/response2token`. El token se renueva con `/auth/refreshtoken` y se vuelve a autenticar si expira o responde 401.

## 3. Requisitos previos

- **Credenciales Scania:** en My Scania > API access crear un `clientId` y un `secretKey` (base64url).
- **Servicio de datos:** la cuenta de Scania debe tener activo el servicio de datos FMS/rFMS.
- **Supabase:** un proyecto con la migración aplicada (opcional, pero recomendado para el histórico y la lista de destinatarios).
- **Correo:** una cuenta de Resend (`MAIL_PROVIDER=resend`) o un servidor SMTP (`MAIL_PROVIDER=smtp`).
- **Node.js >= 20.**

## 4. Variables de entorno

Plantilla completa en `.env.example` (solo contiene valores de ejemplo). Resumen:

| Variable | Obligatoria | Descripción |
|---|---|---|
| `SOURCE` | No (`rfms`) | `rfms` o `scrape`. |
| `SCANIA_CLIENT_ID` | Si `SOURCE=rfms` | clientId de My Scania > API access. |
| `SCANIA_SECRET_KEY` | Si `SOURCE=rfms` | secretKey de My Scania > API access. |
| `SCANIA_BASE_URL` | No (`https://dataaccess.scania.com`) | URL base de la API. |
| `MYSCANIA_USER` / `MYSCANIA_PASS` | Si `SOURCE=scrape` | Credenciales del portal web. |
| `SUPABASE_URL` | No | URL del proyecto. Debe definirse junto con la clave, o ninguna de las dos. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Clave service role (salta RLS). Nunca exponerla en el cliente. |
| `MAIL_PROVIDER` | No (`resend`) | `resend` o `smtp`. |
| `RESEND_API_KEY` | Si `MAIL_PROVIDER=resend` | Clave de la API de Resend. |
| `SMTP_HOST` | Si `MAIL_PROVIDER=smtp` | Servidor SMTP. |
| `SMTP_PORT` | No (`587`) | Puerto SMTP; con `465` la conexión es TLS directa. |
| `SMTP_USER` / `SMTP_PASS` | No | Credenciales SMTP, si el servidor las pide. |
| `MAIL_FROM` | Si | Remitente, por ejemplo `Urea Scania <reportes@tu-dominio.com>`. |
| `MAIL_TO` | No | Destinatarios separados por coma. Se usan si la tabla `recipients` no tiene activos. |
| `CRON_SECRET` | Si usas el endpoint de Vercel | Token que protege `/api/cron/urea-report`. Sin él, el endpoint responde siempre 401. |
| `THRESHOLD_CRITICAL` | No (`20`) | Umbral de CRITICO. Debe ser <= `THRESHOLD_LOW`. |
| `THRESHOLD_LOW` | No (`35`) | Umbral de BAJO. |
| `TZ_REPORT` | No (`America/Bogota`) | Zona horaria para las fechas del correo. |

Notas:

- **Nunca subas `.env` al repositorio.** El `.gitignore` ya lo excluye, pero revisa siempre antes de hacer commit.
- Si alguna contraseña o clave se compartió en texto plano (chat, correo, capturas), rótala.
- El código no carga `.env` por sí mismo: hay que exportar las variables (ver la sección 5 o el crontab del VPS).
- En `.env`, valores con espacios o caracteres como `<` deben ir entre comillas (por ejemplo `MAIL_FROM="Urea Scania <reportes@tu-dominio.com>"`), porque el VPS carga el archivo con `. ./.env` y sin comillas bash lo interpreta mal.
- `MYSCANIA_FLEET_URL` y `MYSCANIA_ROW_SELECTOR` se leen directamente de `process.env` en el modo scrape. No están en `.env.example`.

## 5. Instalación local y pruebas

```bash
npm install
npm test            # vitest run
npm run build       # tsc, genera dist/

# Carga las variables de .env en la shell actual
set -a && . ./.env && set +a

npm run report:dry  # consulta Scania y muestra el correo en consola, sin enviar nada
npm run report      # ejecución real: guarda en Supabase y envía el correo
```

Con `--dry-run` no se envía correo ni se escriben lecturas. Si Supabase está configurado, sí se registra una fila en `job_runs` con detalle `dry-run`.

## 6. Despliegue en Vercel + Supabase

**a) Base de datos.** En el SQL Editor de Supabase ejecuta `supabase/migrations/001_init.sql`. Crea las tablas `vehicles`, `urea_readings`, `recipients` y `job_runs`, activa RLS sin políticas (solo accede la service role) y crea los índices.

Añade los destinatarios (la tabla solo envía a los filas con `active = true`):

```sql
insert into recipients (email) values ('reportes@tu-dominio.com');
```

**b) Variables en Vercel.** En Project > Settings > Environment Variables agrega las variables de la sección 4 (como mínimo `SCANIA_CLIENT_ID`, `SCANIA_SECRET_KEY`, `MAIL_FROM`, `RESEND_API_KEY` o SMTP, `CRON_SECRET`, y `SUPABASE_URL` con `SUPABASE_SERVICE_ROLE_KEY` si usas histórico).

**c) Cron.** `vercel.json` define:

```json
{
  "crons": [{ "path": "/api/cron/urea-report", "schedule": "0 */4 * * *" }],
  "functions": { "api/cron/urea-report.ts": { "maxDuration": 60 } }
}
```

Vercel programa los cron en UTC. `0 */4 * * *` equivale a las 00, 04, 08, 12, 16 y 20 UTC, es decir, a las **19:00, 23:00, 03:00, 07:00, 11:00 y 15:00** en Bogotá (UTC-5). Ten en cuenta que los planes gratuitos de Vercel limitan la frecuencia de los cron; confirma que tu plan permita ejecuciones cada 4 horas.

El endpoint exige `Authorization: Bearer <CRON_SECRET>`. Vercel lo envía automáticamente en las ejecuciones programadas.

**d) Disparo manual.** Para probar sin esperar al cron:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://TU-PROYECTO.vercel.app/api/cron/urea-report
```

La respuesta es `{ "status": "ok" | "skipped" | "error", ... }`. Responde 500 si el resultado es error y 401 si el token no coincide.

## 7. Alternativa: VPS en Hostinger

El archivo `deploy/hostinger-crontab.txt` contiene la línea de cron para un VPS, que ejecuta cada 4 horas (hora del servidor):

```
0 */4 * * * cd /opt/auto_scania_urea_elogia && set -a && . ./.env && set +a && /usr/bin/npm run report >> /var/log/urea-report.log 2>&1
```

Pasos:

1. Clona el repositorio en `/opt/auto_scania_urea_elogia`.
2. Crea `/opt/auto_scania_urea_elogia/.env` con las variables de la sección 4 (con las comillas indicadas).
3. Instala dependencias una vez: `npm ci && npm run build`. `npm run report` usa `tsx`, que está en devDependencies, por lo que `npm ci` debe instalarlo.
4. Si usas `SOURCE=scrape`, instala Playwright: `npm i playwright && npx playwright install chromium`.
5. Añade la línea anterior con `crontab -e`.
6. Revisa el resultado en `/var/log/urea-report.log`.

## 8. Estructura del proyecto

```
api/cron/urea-report.ts     Handler de Vercel (valida CRON_SECRET y ejecuta el reporte)
scripts/run.ts              Entrada para VPS y pruebas (npm run report / report:dry)
src/config.ts               Validación de variables de entorno (zod)
src/deps.ts                 Construye dependencias: fuente, repositorio, correo
src/runReport.ts            Flujo principal: consulta, guarda, clasifica, envía
src/scania/auth.ts          Autenticación HMAC y renovación de token rFMS
src/scania/client.ts        Cliente HTTP con reintentos (429 y 5xx) y reautenticación (401)
src/scania/rfms.ts          Paginación y mapeo de vehicles/vehiclestatuses a lecturas
src/sources/                rfmsSource (API), scrapeSource (Playwright, incompleto)
src/db/repo.ts              Repositorio Supabase y repositorio en memoria (sin Supabase)
src/mail/index.ts           Envío con Resend o SMTP (nodemailer)
src/report/                 Clasificación de estados y HTML del correo
supabase/migrations/        Esquema de base de datos
deploy/hostinger-crontab.txt Línea de cron para VPS
tests/                      Pruebas con vitest
```

Sin Supabase no hay histórico: cada ejecución usa un repositorio en memoria, la variación respecto a la lectura anterior queda vacía y la lista de destinatarios sale de `MAIL_TO`.

El sistema evita ejecuciones solapadas: si hay un registro `running` de hace menos de 10 minutos en `job_runs`, la nueva ejecución se omite (`status: skipped`).

## 9. Supuestos y riesgos

- **Endpoints de Scania.** Las rutas (`/auth/*`, `/rfms4/vehicles`, `/rfms4/vehiclestatuses?latestOnly=true&contentFilter=SNAPSHOT`) y las cabeceras `Accept` con versión (`vehicles.v4.0`, `vehiclestatuses.v4.0`) están definidas en `src/scania/auth.ts` y `src/scania/rfms.ts`. Verifícalas contra la documentación vigente de Scania antes de desplegar; si cambian, solo hay que editar esos archivos.
- **Sin dato de AdBlue.** Algunos camiones, sobre todo los más antiguos o sin sensor de urea, no reportan `catalystFuelLevel`. Aparecen como `SIN_DATO` y no se alertan.
- **Lecturas desactualizadas.** Un camión sin reportes recientes puede mostrar un nivel antiguo; el correo lo marca cuando supera 24 h.
- **Scrape incompleto.** El modo `SOURCE=scrape` no funciona hasta completar los selectores y puede fallar con MFA.
- **Operación.** El cron no tiene reintentos propios: si una ejecución falla, se envía el correo de error y se espera a la siguiente ejecución.
- **Sin pruebas contra producción.** Las pruebas unitarias (`npm test`) no llaman a Scania ni a Supabase; el primer `npm run report:dry` con credenciales reales es la verificación de integración.
