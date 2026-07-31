// Evita que se abra una consola en Windows en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kiosco_pos_lib::run();
}
