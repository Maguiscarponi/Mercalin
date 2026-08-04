use crate::commands::{err, CmdResult};
use crate::AppState;
use tauri::State;

#[derive(serde::Serialize, Clone)]
pub struct BackupInfo {
    pub name: String,
    pub size_bytes: u64,
    pub display_date: String,
}

fn parse_backup_display_date(name: &str) -> String {
    // kiosco_backup_YYYYMMDD_HHMMSS.db → "DD/MM/YYYY HH:MM"
    let base = name.trim_end_matches(".db");
    if let Some(date_part) = base.strip_prefix("kiosco_backup_") {
        if date_part.len() == 15 {
            let y = &date_part[0..4];
            let mo = &date_part[4..6];
            let d = &date_part[6..8];
            let h = &date_part[9..11];
            let mi = &date_part[11..13];
            return format!("{}/{}/{} {}:{}", d, mo, y, h, mi);
        }
    }
    name.to_string()
}

// Carpeta real donde se guardan los backups. Por defecto es la carpeta "backups"
// al lado de kiosco.db (como siempre) -- pero si la dueña eligió una carpeta propia
// (típicamente su carpeta local de OneDrive/Google Drive/Dropbox), los backups van
// ahí, y es el cliente de sincronización de esa nube -- no esta app -- el que se
// encarga de subirlos. Evita depender de una API de terceros (con su propia cuota,
// credenciales y eventual costo) para algo que el sistema operativo ya resuelve solo.
fn backup_dir(state: &AppState) -> std::path::PathBuf {
    let custom: Option<String> = {
        let conn = state.db.lock();
        conn.query_row("SELECT value FROM config WHERE key='backup_custom_dir'", [], |r| r.get(0))
            .ok()
            .filter(|s: &String| !s.trim().is_empty())
    };
    if let Some(dir) = custom {
        return std::path::PathBuf::from(dir);
    }
    state
        .db_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("backups")
}

fn get_keep_count(state: &AppState) -> usize {
    let conn = state.db.lock();
    conn.query_row(
        "SELECT value FROM config WHERE key='auto_backup_keep_count'",
        [],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or(10)
}

fn prune_old_backups(backup_dir: &std::path::Path, keep: usize) {
    let mut entries: Vec<std::path::PathBuf> = std::fs::read_dir(backup_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "db").unwrap_or(false))
        .map(|e| e.path())
        .collect();
    entries.sort_by(|a, b| b.cmp(a)); // newest first
    for path in entries.iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub fn backup_database(state: State<AppState>) -> CmdResult<String> {
    let keep = get_keep_count(&state);
    let db_path = state.db_path.clone();
    let backup_dir = backup_dir(&state);
    std::fs::create_dir_all(&backup_dir).map_err(err)?;

    let now = chrono::Local::now();
    let filename = format!("kiosco_backup_{}.db", now.format("%Y%m%d_%H%M%S"));
    std::fs::copy(&db_path, &backup_dir.join(&filename)).map_err(err)?;

    // Actualizar timestamp del último backup manual
    {
        let conn = state.db.lock();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('auto_backup_last_at', ?1)",
            rusqlite::params![now.to_rfc3339()],
        );
    }

    prune_old_backups(&backup_dir, keep);
    Ok(filename)
}

#[tauri::command]
pub fn list_backups(state: State<AppState>) -> CmdResult<Vec<BackupInfo>> {
    let backup_dir = backup_dir(&state);

    if !backup_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries: Vec<BackupInfo> = std::fs::read_dir(&backup_dir)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "db").unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let size_bytes = e.metadata().ok()?.len();
            let display_date = parse_backup_display_date(&name);
            Some(BackupInfo { name, size_bytes, display_date })
        })
        .collect();

    entries.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(entries)
}

#[tauri::command]
pub fn delete_backup(name: String, state: State<AppState>) -> CmdResult<()> {
    if !name.starts_with("kiosco_backup_") || !name.ends_with(".db") || name.contains('/') || name.contains('\\') {
        return Err("Nombre de backup inválido".into());
    }
    let path = backup_dir(&state).join(&name);
    if path.exists() {
        std::fs::remove_file(&path).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn auto_backup_check(state: State<AppState>) -> CmdResult<bool> {
    let (enabled, last_at, freq_hours, keep_count) = {
        let conn = state.db.lock();
        let enabled: String = conn
            .query_row("SELECT value FROM config WHERE key='auto_backup_enabled'", [], |r| r.get(0))
            .unwrap_or_else(|_| "0".to_string());
        let last_at: Option<String> = conn
            .query_row("SELECT value FROM config WHERE key='auto_backup_last_at'", [], |r| r.get(0))
            .ok();
        let freq_hours: i64 = conn
            .query_row("SELECT value FROM config WHERE key='auto_backup_freq_hours'", [], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(24);
        let keep_count: usize = conn
            .query_row("SELECT value FROM config WHERE key='auto_backup_keep_count'", [], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10);
        (enabled, last_at, freq_hours, keep_count)
    };

    if enabled != "1" {
        return Ok(false);
    }

    let should_backup = match last_at {
        None => true,
        Some(ref last) => {
            let last_dt = chrono::DateTime::parse_from_rfc3339(last)
                .map(|d| d.with_timezone(&chrono::Local))
                .unwrap_or_else(|_| chrono::Local::now() - chrono::Duration::hours(freq_hours + 1));
            (chrono::Local::now() - last_dt).num_hours() >= freq_hours
        }
    };

    if !should_backup {
        return Ok(false);
    }

    let db_path = state.db_path.clone();
    let backup_dir = backup_dir(&state);
    std::fs::create_dir_all(&backup_dir).map_err(err)?;

    let now = chrono::Local::now();
    let filename = format!("kiosco_backup_{}.db", now.format("%Y%m%d_%H%M%S"));
    std::fs::copy(&db_path, &backup_dir.join(&filename)).map_err(err)?;

    prune_old_backups(&backup_dir, keep_count);

    {
        let conn = state.db.lock();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('auto_backup_last_at', ?1)",
            rusqlite::params![now.to_rfc3339()],
        );
    }

    Ok(true)
}
