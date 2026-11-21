#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC: {}\nLocation: {:?}\n", info, info.location());
        let path = std::env::temp_dir().join("detergo-crash.log");
        let _ = std::fs::write(path, &msg);
    }));

    // If CLI or MCP commands are invoked from terminal, handle and exit!
    if let Some(code) = detergo_lib::cli::handle_cli() {
        std::process::exit(code);
    }

    detergo_lib::run();
}
