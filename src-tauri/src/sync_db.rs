// Cola de escrituras pendientes de sincronizar con el servidor, para una
// caja en modo "cliente" que se quedó sin conexión. Vive en un archivo
// SQLite APARTE de kiosco.db a propósito: cuando una caja se conecta como
// cliente (o se reconecta desde cero), `kiosco.db` se reemplaza por completo
// con una copia de la base del servidor (ver `commands::device`), y si la
// cola viviera ahí se perdería justo en ese reemplazo.

use rusqlite::Connection;
use std::path::Path;

pub fn open_sync_queue(app_dir: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(app_dir.join("sync_queue.db"))?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS pending_sync_ops (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            command      TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'pending'
                         CHECK(status IN ('pending','synced','failed')),
            attempts     INTEGER NOT NULL DEFAULT 0,
            last_error   TEXT,
            synced_at    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pending_sync_ops_status ON pending_sync_ops(status, id);
        "#,
    )?;
    Ok(conn)
}
