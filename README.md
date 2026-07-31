# Kiosco POS

Sistema de punto de venta offline-first para kioscos, almacenes y supermercados argentinos.

Stack: **Tauri 2 + React + TypeScript + Vite + SQLite + Tailwind**

---

## Pre-requisitos

Necesitás instalar en tu compu **una sola vez**:

1. **Node.js** (LTS, 20 o superior): https://nodejs.org
2. **Rust** (con rustup): https://www.rust-lang.org/tools/install
3. **Dependencias del sistema de Tauri** (para Windows ya viene casi todo, en Linux/Mac mirá la doc): https://tauri.app/start/prerequisites/

Verificá con:

```bash
node -v       # debe ser >= 20
rustc --version
cargo --version
```

---

## Primer arranque

```bash
# 1. Instalar dependencias del frontend
npm install

# 2. Correr en modo desarrollo (abre la ventana de la app)
npm run tauri dev
```

La primera vez tarda varios minutos porque Rust compila todo desde cero. Las próximas veces es casi instantáneo.

La base de datos SQLite se crea automáticamente la primera vez en:

- Windows: `%APPDATA%\com.kioscopos.app\kiosco.db`
- Mac: `~/Library/Application Support/com.kioscopos.app/kiosco.db`
- Linux: `~/.local/share/com.kioscopos.app/kiosco.db`

---

## Estructura del proyecto

```
kiosco-pos/
├── src/                        # Frontend React + TS
│   ├── routes/                 # Una pantalla por archivo (Caja, Productos, etc.)
│   ├── components/             # Componentes reutilizables
│   ├── stores/                 # Estado global (Zustand)
│   ├── lib/                    # Helpers: api.ts, format.ts
│   ├── types.ts                # Tipos compartidos con Rust
│   ├── App.tsx                 # Router principal
│   └── main.tsx                # Entry point
├── src-tauri/                  # Backend Rust
│   ├── src/
│   │   ├── main.rs             # Entry point, registra comandos
│   │   ├── db.rs               # Conexión SQLite + schema + migraciones
│   │   ├── models/             # Structs: Product, Sale, SaleItem
│   │   └── commands/           # Comandos invocables desde el frontend
│   ├── Cargo.toml              # Dependencias Rust
│   └── tauri.conf.json         # Config de Tauri (ventana, permisos, etc.)
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── README.md
```

---

## Roadmap (orden recomendado)

- [x] Esqueleto del proyecto
- [x] Schema inicial de SQLite
- [x] Pantalla de Caja (alta de ítems, total, vuelto)
- [x] ABM de productos
- [ ] Importación de productos desde Excel
- [ ] Apertura y cierre de caja (arqueo Z)
- [ ] Impresión ESC/POS a térmica + apertura de cajón
- [ ] Login con usuarios y permisos
- [ ] Reportes (ventas por día, productos más vendidos, ganancia)
- [ ] Panel web del dueño (sincronización a la nube)
- [ ] Integración ARCA (factura electrónica)

---

## Comandos útiles

```bash
npm run tauri dev          # Desarrollo
npm run tauri build        # Empaquetar instalador (Windows .msi, Mac .dmg, Linux .AppImage)
npm run dev                # Solo frontend (Vite), para debuggear UI sin Rust
```

---

## Notas de diseño

- **Offline-first**: la app funciona sin internet. SQLite local es la fuente de verdad.
- **Velocidad mental del operario**: la pantalla de caja debe permitir vender sin mouse. Lector de código de barras = teclado USB, todo se opera con teclas.
- **Atajos**: F1 buscar, F4 cobrar, F8 reimprimir último ticket, F12 abrir cajón.
- **Decimal money**: los precios se guardan como enteros (centavos) en la DB para evitar errores de redondeo de float.
