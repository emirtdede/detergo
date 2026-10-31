#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC: {}\nLocation: {:?}\n", info, info.location());
        let path = std::env::temp_dir().join("node-cleaner-crash.log");
        let _ = std::fs::write(path, msg);
    }));
    node_cleaner_lib::run();
}
