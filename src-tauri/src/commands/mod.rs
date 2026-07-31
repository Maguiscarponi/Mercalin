pub mod arca;
pub mod audit;
pub mod backup;
pub mod caja;
pub mod catalog_import;
pub mod combos;
pub mod dashboard;
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

pub type CmdResult<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{}", e)
}
