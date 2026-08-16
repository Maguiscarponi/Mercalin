pub mod arca;
pub mod audit;
pub mod backup;
pub mod caja;
// Todo el archivo es una herramienta de uso interno (generar la plantilla de catálogo
// para empaquetar con el instalador, ver generate_catalog_template) — no se compila en
// builds de release, ningún cliente real la necesita.
#[cfg(debug_assertions)]
pub mod catalog_import;
pub mod combos;
pub mod dashboard;
pub mod device;
pub mod insights;
pub mod clients;
pub mod config;
pub mod lots;
pub mod products;
pub mod promotions;
pub mod quotes;
pub mod reports;
pub mod returns;
pub mod sales;
pub mod stock;
pub mod suppliers;
pub mod users;
pub mod weighed_labels;

pub type CmdResult<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{}", e)
}
