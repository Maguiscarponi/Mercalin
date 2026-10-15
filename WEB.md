# Mercalin web

El mismo Mercalin, en el navegador: celular, tablet o compu, sin instalar nada.
Los 19 módulos son los mismos de la app de escritorio, con la misma lógica
(ventas, stock, caja, ARCA, consejos, reportes, etc.).

## Cómo está armado

- **La lógica es una sola.** Los comandos de `src-tauri/src/commands` se usan
  igual en las dos versiones. La app de escritorio los llama con Tauri; la web
  los llama por `/api/rpc/<comando>` (el mismo canal que ya usaba multicaja).
- **Una base por comercio.** Cada cuenta tiene su propia `kiosco.db` en el
  servidor (`<datos>/comercios/<id>/kiosco.db`), creada desde la misma
  plantilla con los 7.500 productos.
- **Cuentas y entrada** (`src-tauri/src/bin/web.rs`): registro con mail,
  negocio y teléfono (opcional); prueba de 7 días; para volver a entrar, un
  código de 6 números al mail. El dueño entra directo después de registrarse o
  de poner el código; los empleados entran con su usuario y contraseña, como
  en la app de escritorio.
- **ARCA:** la clave privada de cada comercio se guarda encriptada en el
  servidor (`src-tauri/src/secret.rs`). En la app de escritorio no cambia nada.
- **Frontend:** es el mismo código de React. `npm run build:web` reemplaza los
  módulos de Tauri por equivalentes de navegador (`src/web/shims`) y suma la
  pantalla de entrada/registro (`src/web`). El menú se adapta al celular.

La app de escritorio no cambia: `npm run tauri build` arma lo mismo de siempre.

## Probarlo en tu compu

```powershell
.\web-local.ps1
```

Abrí http://localhost:8787. Si además corrés mercalinonline-web (`npm run dev`)
con las variables `MERCALIN_APP_URL`, `NEXT_PUBLIC_MERCALIN_APP_URL` y
`MERCALIN_SIGNUP_SECRET` en su `.env.local`, el "Probar gratis" de
http://localhost:3000/prueba-gratis crea la cuenta y entra directo.

Sin `RESEND_API_KEY`, los códigos para entrar se muestran en la consola del
servidor.

Para trabajar en la pantalla con recarga automática: dejá el servidor
corriendo y en otra terminal `npm run dev:web` (http://localhost:1430).

## Variables del servidor

| Variable | Para qué | Por defecto |
|---|---|---|
| `MERCALIN_DATA_DIR` | Carpeta de datos (cuentas y bases) | `./mercalin-web-data` |
| `MERCALIN_HOST` / `MERCALIN_PORT` | Dónde escucha | `127.0.0.1` / `8787` |
| `MERCALIN_PUBLIC_URL` | Dirección pública (links y cookies seguras con https) | `http://localhost:8787` |
| `MERCALIN_SIGNUP_SECRET` | Clave compartida con mercalinonline.com | (sin esto, la web no puede crear cuentas) |
| `MERCALIN_SECRET_KEY` | 64 caracteres hex para encriptar las claves de ARCA | se genera y se guarda en la carpeta de datos |
| `RESEND_API_KEY` | Mandar los códigos por mail | (se muestran en la consola) |
| `MERCALIN_MAIL_FROM` | Remitente de los mails | `Mercalin <ventas@mercalinonline.com>` |
| `MERCALIN_TRIAL_DAYS` | Días de prueba | `7` |
| `MERCALIN_STATIC_DIR` | Build web de la app | `../dist-web` |
| `MERCALIN_TEMPLATE_DB` | Plantilla con el catálogo | `resources/template.db` |

En producción: definí `MERCALIN_SECRET_KEY` y guardala aparte (sin ella no se
pueden leer las claves de ARCA guardadas) y hacé backup de `MERCALIN_DATA_DIR`.

## Pendiente antes de lanzar

- Cobro mensual automático (suscripciones de Mercado Pago). Hoy, al vencer la
  prueba, la pantalla ofrece seguir por WhatsApp.
- Pasar a "mensual" una cuenta desde un panel (hoy: columna `plan` en
  `accounts.db`).
- Servidor en internet (VPS), dominio (por ejemplo app.mercalinonline.com) y
  backups automáticos de la carpeta de datos.
