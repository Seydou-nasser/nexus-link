// Empêche l'ouverture d'une console supplémentaire sous Windows en mode release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nexus_link_desktop_lib::run()
}
