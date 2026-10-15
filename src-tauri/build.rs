fn main() {
    // Solo la app de escritorio necesita el build de Tauri (íconos, permisos,
    // etc.). La versión web compila sin Tauri.
    #[cfg(feature = "desktop")]
    tauri_build::build()
}
