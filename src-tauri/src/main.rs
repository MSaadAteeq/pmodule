// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Load .env: try current dir first, then search upward from executable (e.g. target/debug -> project root)
    if dotenvy::dotenv().is_err() {
        if let Ok(exe) = std::env::current_exe() {
            let mut dir = exe.parent().map(std::path::PathBuf::from);
            for _ in 0..5 {
                if let Some(ref d) = dir {
                    let env_path = d.join(".env");
                    if env_path.exists() {
                        let _ = dotenvy::from_path(env_path);
                        break;
                    }
                    dir = d.parent().map(std::path::PathBuf::from);
                } else {
                    break;
                }
            }
        }
    }
    ai_assistant::run()
}
