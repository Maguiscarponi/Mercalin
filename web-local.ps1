# Levanta Mercalin web en tu compu, para probarlo en el navegador.
#
# Uso (en PowerShell, parada en la carpeta del proyecto):
#   .\web-local.ps1
#
# Después abrí http://localhost:8787 (o la web en http://localhost:3000/prueba-gratis
# si tenés mercalinonline-web corriendo con `npm run dev`).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# 1. La app (React) en versión web
Write-Host "Armando la app web..." -ForegroundColor Cyan
if (-not (Test-Path "node_modules")) { npm install }
npm run build:web
if ($LASTEXITCODE -ne 0) { throw "Falló el build web" }

# 2. Clave compartida con mercalinonline-web: se toma de su .env.local
#    (MERCALIN_SIGNUP_SECRET), así "Probar gratis" de la web crea la cuenta acá.
$envWeb = Join-Path $PSScriptRoot "..\..\mercalinonline-web\.env.local"
if (Test-Path $envWeb) {
  $line = Get-Content $envWeb | Where-Object { $_ -match '^MERCALIN_SIGNUP_SECRET=' } | Select-Object -First 1
  if ($line) { $env:MERCALIN_SIGNUP_SECRET = $line.Substring("MERCALIN_SIGNUP_SECRET=".Length).Trim() }
}
if (-not $env:MERCALIN_SIGNUP_SECRET) {
  Write-Host "Aviso: no encontré MERCALIN_SIGNUP_SECRET en mercalinonline-web\.env.local -- el formulario de la web no va a poder crear cuentas (la app igual anda en http://localhost:8787)." -ForegroundColor Yellow
}

# LICENSE_SECRET la pide el código de la app de escritorio al compilar; en la
# versión web no se usa, así que para probar en local alcanza cualquier valor.
if (-not $env:LICENSE_SECRET) { $env:LICENSE_SECRET = "solo-local" }

# Los datos de prueba quedan en src-tauri\mercalin-web-data (no se suben a git).
# Sin RESEND_API_KEY, los códigos para recuperar la contraseña se muestran en esta consola.
Write-Host "Iniciando el servidor (la primera vez tarda unos minutos en compilar)..." -ForegroundColor Cyan
Set-Location src-tauri
cargo run --release --no-default-features --features server --bin mercalin-web
