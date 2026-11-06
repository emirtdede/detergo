use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json::json;
use crate::commands::AppState;
use crate::cleanup::DeleteMode;

#[cfg(windows)]
pub fn attach_console() {
    use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebhookPayload {
    pub event: String,
    pub timestamp: String,
    pub product: String,
    pub version: String,
    pub scope: String,
    pub target_count: usize,
    pub total_bytes: u64,
    pub total_human: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleaned_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleaned_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
}

pub fn handle_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() <= 1 {
        return None;
    }

    #[cfg(windows)]
    attach_console();

    let first_arg = args[1].to_lowercase();
    match first_arg.as_str() {
        "-h" | "--help" | "help" => {
            print_help();
            Some(0)
        }
        "-v" | "--version" | "version" => {
            println!("Dev Cleaner by Vellium v2.2.0 (x64 Windows)");
            Some(0)
        }
        "mcp" | "--mcp" => {
            crate::mcp::run_mcp_server();
            Some(0)
        }
        "caches" => {
            run_caches_cli(&args[2..]);
            Some(0)
        }
        "history" => {
            run_history_cli(&args[2..]);
            Some(0)
        }
        "scan" => {
            run_scan_cli(&args[2..]);
            Some(0)
        }
        _ => None,
    }
}

fn print_help() {
    println!(r#"
==================================================================
  DEV CLEANER by VELLIUM — CLI, MCP & Automation Engine (v2.2.0)
==================================================================

KULLANIM:
  dev-cleaner [KOMUT] [SEÇENEKLER]

KOMUTLAR:
  scan [DIZIN]             Projeleri, AI araçlarını ve önbellekleri tara / temizle
  caches                   21 geliştirici aracının önbellek durumunu listele / temizle
  history                  Geçmiş temizlik ve denetim kayıtlarını listele
  mcp                      Yapay zeka modelleri için MCP sunucusunu başlat (stdio)

SCAN SEÇENEKLERİ:
  --scope <KAPSAM>         projects | agents | caches | all (varsayılan: projects)
  --auto-clean             Bulunan güvenli hedefleri otomatik olarak Geri Dönüşüm Kutusuna taşı
  --safety <SEVİYELER>     safe,regenerate,review (virgülle ayrılmış, varsayılan: safe,regenerate)
  --dry-run                Silme işlemi yapmadan simülasyon çıktısı üret
  --min-size <MB>          Yalnızca belirtilen megabayttan büyük hedefleri işle
  --json                   Sonuçları JSON formatında çıktı ver
  --webhook <URL>          Sonuç özetini n8n, Slack veya Discord webhook'una ilet
  -h, --help               Yardım ve komut bilgilerini görüntüle
  -v, --version            Sürüm bilgisini görüntüle

CACHES SEÇENEKLERİ:
  --clean <ARAÇ|all>       Belirtilen aracın (npm, pip, cargo vb.) veya tüm araçların önbelleğini temizle
  --json                   Sonuçları JSON formatında çıktı ver

HISTORY SEÇENEKLERİ:
  --limit <SAYI>           Gösterilecek kayıt sayısı (varsayılan: 20)
  --json                   Sonuçları JSON formatında çıktı ver

ÖRNEKLER:
  dev-cleaner scan "D:\Projects"
  dev-cleaner scan "D:\Projects" --auto-clean --safety safe,regenerate --dry-run
  dev-cleaner scan "D:\Projects" --auto-clean --min-size 100 --webhook "https://n8n.example.com/webhook/clean"
  dev-cleaner caches --clean npm
  dev-cleaner caches --json
  dev-cleaner history --limit 10
"#);
}

fn format_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.0} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

fn run_caches_cli(args: &[String]) {
    let as_json = args.iter().any(|a| a == "--json");
    let mut clean_target: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        if args[i] == "--clean" && i + 1 < args.len() {
            clean_target = Some(args[i + 1].clone());
            i += 1;
        }
        i += 1;
    }

    let providers = crate::cleanup::official_actions::list_cache_providers();

    if let Some(ref target) = clean_target {
        let registry = crate::cleanup::official_actions::OfficialActionRegistry::new();
        let mut executed = Vec::new();

        for p in &providers {
            if !p.detected {
                continue;
            }
            if target != "all" && !p.id.eq_ignore_ascii_case(target) && !p.name.eq_ignore_ascii_case(target) {
                continue;
            }

            for action in &p.actions {
                match crate::cleanup::official_actions::preview_action(&registry, &p.id, &action.id) {
                    Ok(preview) => {
                        match crate::cleanup::official_actions::execute_action(&registry, &preview.token) {
                            Ok(res) => {
                                let reclaimed = res.before_bytes.saturating_sub(res.after_bytes);
                                executed.push(json!({
                                    "provider": p.id,
                                    "action": action.id,
                                    "success": res.success,
                                    "reclaimed_bytes": reclaimed,
                                    "exit_code": res.exit_code,
                                    "stdout": res.stdout_tail
                                }));
                            }
                            Err(e) => {
                                executed.push(json!({
                                    "provider": p.id,
                                    "action": action.id,
                                    "success": false,
                                    "error": format!("{:?}", e)
                                }));
                            }
                        }
                    }
                    Err(e) => {
                        executed.push(json!({
                            "provider": p.id,
                            "action": action.id,
                            "success": false,
                            "error": format!("{:?}", e)
                        }));
                    }
                }
            }
        }

        if as_json {
            println!("{}", serde_json::to_string_pretty(&json!({
                "product": "Dev Cleaner by Vellium",
                "status": "success",
                "clean_target": target,
                "executed": executed
            })).unwrap_or_default());
        } else {
            println!("\n[Dev Cleaner] Resmi CLI Önbellek Temizliği: {}", target);
            for item in &executed {
                let success = item.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
                let prov = item.get("provider").and_then(|v| v.as_str()).unwrap_or("");
                let act = item.get("action").and_then(|v| v.as_str()).unwrap_or("");
                let reclaimed = item.get("reclaimed_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
                if success {
                    println!("  ✓ {} ({}): Başarılı — Geri kazanılan: {}", prov, act, format_size(reclaimed));
                } else {
                    let err = item.get("error").and_then(|v| v.as_str()).unwrap_or("Bilinmeyen hata");
                    println!("  ⚠️ {} ({}): Başarısız ({})", prov, act, err);
                }
            }
            println!();
        }
        return;
    }

    if as_json {
        let json = serde_json::to_string_pretty(&providers).unwrap_or_default();
        println!("{}", json);
        return;
    }

    println!("\n--- Dev Cleaner: Geliştirici Araç Önbellekleri ---");
    println!("{:<20} {:<15} {:<30}", "Araç / Paket", "Sürüm", "Durum");
    println!("{:-<65}", "");
    for p in providers {
        let status = if p.detected { "Yüklü / Algılandı" } else { "Bulunamadı" };
        let ver = p.version.unwrap_or_else(|| "-".to_string());
        println!("{:<20} {:<15} {:<30}", p.name, ver, status);
    }
    println!("\nToplam 21 araç kontrol edildi. Temizlemek için: dev-cleaner caches --clean <araç|all>\n");
}

fn run_history_cli(args: &[String]) {
    let as_json = args.iter().any(|a| a == "--json");
    let mut limit = 20usize;

    let mut i = 0;
    while i < args.len() {
        if args[i] == "--limit" && i + 1 < args.len() {
            if let Ok(l) = args[i + 1].parse::<usize>() {
                limit = l;
            }
            i += 1;
        }
        i += 1;
    }

    let state = AppState::new();
    let records = state.audit.list_records(limit);

    if as_json {
        println!("{}", serde_json::to_string_pretty(&records).unwrap_or_default());
        return;
    }

    println!("\n--- Dev Cleaner: Geçmiş Temizlik Kayıtları (Son {}) ---", limit);
    println!("{:<22} {:<15} {:<12} {:<15} {:<15}", "Tarih", "Plan ID", "Hedef Sayısı", "Kazanılan Alan", "Silme Modu");
    println!("{:-<80}", "");

    if records.is_empty() {
        println!("  Henüz kayıtlı temizlik geçmişi bulunmuyor.");
    } else {
        for r in records {
            let mode = match r.mode {
                DeleteMode::RecycleBin => "Geri Dönüşüm",
                DeleteMode::Permanent => "Kalıcı",
            };
            let date = if r.timestamp.len() >= 19 { &r.timestamp[..19] } else { &r.timestamp };
            println!("{:<22} {:<15} {:<12} {:<15} {:<15}", date, r.plan_id, r.success_count, format_size(r.reclaim_bytes), mode);
        }
    }
    println!();
}

fn run_scan_cli(args: &[String]) {
    let mut root_path = PathBuf::from(".");
    let mut scope = "projects".to_string();
    let mut as_json = false;
    let mut auto_clean = false;
    let mut dry_run = false;
    let mut min_size_mb: u64 = 0;
    let mut safety_levels = vec!["safe".to_string(), "regenerate".to_string()];
    let mut webhook_url: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--json" {
            as_json = true;
        } else if arg == "--auto-clean" {
            auto_clean = true;
        } else if arg == "--dry-run" {
            dry_run = true;
        } else if arg == "--scope" && i + 1 < args.len() {
            scope = args[i + 1].clone();
            i += 1;
        } else if arg == "--safety" && i + 1 < args.len() {
            safety_levels = args[i + 1].split(',').map(|s| s.trim().to_lowercase()).collect();
            i += 1;
        } else if arg == "--min-size" && i + 1 < args.len() {
            min_size_mb = args[i + 1].parse().unwrap_or(0);
            i += 1;
        } else if arg == "--webhook" && i + 1 < args.len() {
            webhook_url = Some(args[i + 1].clone());
            i += 1;
        } else if !arg.starts_with("--") {
            root_path = PathBuf::from(arg);
        }
        i += 1;
    }

    if !as_json {
        println!("\n[Dev Cleaner] Tarama başlatılıyor: {:?}", root_path);
        println!("[Dev Cleaner] Kapsam: {}", scope);
        if auto_clean {
            println!("[Dev Cleaner] Otonom Temizlik: Aktif (Dry-Run: {}, Güvenlik: {:?})", dry_run, safety_levels);
        }
    }

    if !root_path.exists() {
        if as_json {
            println!("{}", json!({
                "product": "Dev Cleaner by Vellium",
                "status": "error",
                "error": format!("Hedef bulunamadı: {:?}", root_path),
                "items": []
            }));
        } else {
            println!("\n❌ Hata: Belirtilen hedef dizin bulunamadı: {:?}", root_path);
        }
        return;
    }

    let state = AppState::new();
    let catalog = match state.catalog() {
        Ok(idx) => idx,
        Err(err) => {
            eprintln!("Katalog yüklenemedi: {:?}", err);
            return;
        }
    };
    let token = crate::scanner::CancellationToken::new();
    let limits = crate::scanner::limits::ScanLimits::default();
    let mut engine = crate::scanner::discovery::DiscoveryEngine::new(&catalog, token.clone(), limits);

    let config = crate::scanner::discovery::DiscoveryConfig {
        root: &root_path,
        exclusions: &[],
        protected_paths: &[],
        scan_session_id: "cli_scan",
        limits,
    };

    match engine.discover(config, |_| {}, |_| {}) {
        Ok(outcome) => {
            let min_bytes = min_size_mb * 1024 * 1024;
            let session = crate::scanner::session::ScanSession {
                id: "cli_scan".to_string(),
                scope: crate::scanner::models::ScanScope::Project,
                root: root_path.clone(),
                allowed_roots: vec![root_path.clone()],
                created: std::time::Instant::now(),
                items: outcome.items.clone(),
                targets: outcome.targets.into_iter().map(|t| (t.id.clone(), t)).collect(),
                summary: None,
            };

            let total_items = outcome.items.len();
            let mut total_bytes = 0u64;
            for item in &outcome.items {
                total_bytes += item.estimated_reclaim_bytes.unwrap_or(0);
            }

            // Otonom Temizlik Planı Hazırlığı
            let mut matched_target_ids = Vec::new();
            let mut matched_bytes = 0u64;

            for item in &outcome.items {
                let safety_str = serde_json::to_string(&item.safety_class)
                    .unwrap_or_default()
                    .replace('"', "")
                    .to_lowercase();
                let bytes = item.estimated_reclaim_bytes.unwrap_or(0);

                let safety_match = safety_levels.iter().any(|s| safety_str.contains(s));
                let size_match = bytes >= min_bytes;

                if safety_match && size_match {
                    matched_target_ids.push(item.id.clone());
                    matched_bytes += bytes;
                }
            }

            let mut cleaned_count = 0usize;
            let mut cleaned_bytes = 0u64;
            let mut clean_errors = Vec::new();

            if auto_clean && !matched_target_ids.is_empty() {
                if dry_run {
                    cleaned_count = matched_target_ids.len();
                    cleaned_bytes = matched_bytes;
                    if !as_json {
                        println!("\n[DRY RUN SIMÜLASYONU]");
                        println!("  Geri Dönüşüm Kutusuna Taşınacak Hedef Sayısı : {}", cleaned_count);
                        println!("  Kazanılacak Disk Alanı                        : {}", format_size(cleaned_bytes));
                    }
                } else {
                    let settings = state.settings.load();
                    let policy = crate::cleanup::CleanupPolicy::from(&settings);
                    match crate::cleanup::build_plan(&session, &matched_target_ids, DeleteMode::RecycleBin, &catalog, &policy) {
                        Ok(plan) => {
                            let confirmation = plan.confirmation_token.clone();
                            match crate::cleanup::execute_plan(&plan, &session, &catalog, &policy, &confirmation, false) {
                                Ok(report) => {
                                    cleaned_count = report.success_count as usize;
                                    cleaned_bytes = report.reclaim_bytes;
                                    let audit_entry = crate::audit::AuditRecord {
                                        id: format!("h-{}", uuid::Uuid::new_v4().simple()),
                                        timestamp: report.finished_at.clone(),
                                        session_id: plan.session_id.clone(),
                                        plan_id: plan.id.clone(),
                                        mode: report.mode,
                                        success_count: report.success_count,
                                        error_count: report.error_count,
                                        reclaim_bytes: report.reclaim_bytes,
                                        moved_bytes: report.moved_bytes,
                                        duration_ms: report.duration_ms,
                                        entries: report.results.iter().map(|r| crate::audit::AuditEntry {
                                            target_id: r.target_id.clone(),
                                            rule_id: r.rule_id.clone(),
                                            path: r.display_path.clone(),
                                            success: r.success,
                                            verified: r.verified,
                                            error_code: r.error_code.clone(),
                                            bytes: r.measured_bytes,
                                        }).collect(),
                                    };
                                    let _ = state.audit.append_record(&audit_entry);

                                    for res in &report.results {
                                        if !res.success {
                                            clean_errors.push(format!("{}: {}", res.display_path, res.error.clone().unwrap_or_default()));
                                        }
                                    }
                                }
                                Err(e) => {
                                    clean_errors.push(format!("Temizlik yürütülemedi: {:?}", e));
                                }
                            }
                        }
                        Err(e) => {
                            clean_errors.push(format!("Temizlik planı oluşturulamadı: {:?}", e));
                        }
                    }
                }
            }

            if as_json {
                let payload = json!({
                    "product": "Dev Cleaner by Vellium",
                    "status": "success",
                    "root": root_path.to_string_lossy(),
                    "scope": scope,
                    "target_count": total_items,
                    "estimated_reclaim_bytes": total_bytes,
                    "estimated_reclaim_human": format_size(total_bytes),
                    "auto_clean": auto_clean,
                    "dry_run": dry_run,
                    "cleaned_count": cleaned_count,
                    "cleaned_bytes": cleaned_bytes,
                    "cleaned_human": format_size(cleaned_bytes),
                    "clean_errors": clean_errors,
                    "items": outcome.items.iter().map(|it| json!({
                        "id": it.id,
                        "name": it.display_name,
                        "path": it.display_path,
                        "category": it.category,
                        "safety": it.safety_class,
                        "bytes": it.estimated_reclaim_bytes.unwrap_or(0),
                        "human": format_size(it.estimated_reclaim_bytes.unwrap_or(0))
                    })).collect::<Vec<_>>()
                });
                println!("{}", serde_json::to_string_pretty(&payload).unwrap_or_default());
            } else {
                println!("\n✓ Tarama tamamlandı!");
                println!("  Bulunan Hedef Sayısı : {}", total_items);
                println!("  Geri Kazanılabilir   : {}", format_size(total_bytes));
                if auto_clean {
                    if dry_run {
                        println!("  Dry-Run Simülasyonu : {} hedef temizlenebilir ({})", cleaned_count, format_size(cleaned_bytes));
                    } else {
                        println!("  ✓ Temizlik Sonucu   : {} hedef Geri Dönüşüm Kutusuna taşındı ({})", cleaned_count, format_size(cleaned_bytes));
                        if !clean_errors.is_empty() {
                            println!("  ⚠️ Kilitli/Atlanan Öğeler ({}):", clean_errors.len());
                            for err in &clean_errors {
                                println!("    • {}", err);
                            }
                        }
                    }
                }
                println!();
            }

            if let Some(url) = webhook_url {
                if !as_json {
                    println!("[Dev Cleaner] Webhook bildirimi gönderiliyor -> {}", url);
                }
                send_webhook_sync(&url, &WebhookPayload {
                    event: if auto_clean && !dry_run { "cleanup_completed".to_string() } else { "scan_completed".to_string() },
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    product: "Dev Cleaner by Vellium".to_string(),
                    version: "2.2.0".to_string(),
                    scope: scope.to_string(),
                    target_count: total_items,
                    total_bytes,
                    total_human: format_size(total_bytes),
                    status: "success".to_string(),
                    cleaned_count: if auto_clean { Some(cleaned_count) } else { None },
                    cleaned_bytes: if auto_clean { Some(cleaned_bytes) } else { None },
                    dry_run: if auto_clean { Some(dry_run) } else { None },
                });
            }
        }
        Err(err) => {
            eprintln!("\n❌ Tarama hatası: {:?}", err);
        }
    }
}

pub fn send_webhook_sync(url: &str, payload: &WebhookPayload) {
    let json_bytes = match serde_json::to_string(payload) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("  ⚠️ Webhook serileştirme hatası: {:?}", e);
            return;
        }
    };

    let mut cmd = std::process::Command::new("curl.exe");
    cmd.args([
        "-s",
        "-X", "POST",
        "-H", "Content-Type: application/json",
        "-H", "User-Agent: DevCleaner-CLI/2.2.0",
        "-d", &json_bytes,
        url,
        "--max-time", "10",
        "--connect-timeout", "5",
    ]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.output() {
        Ok(out) => {
            if out.status.success() {
                println!("  ✓ Webhook başarıyla iletildi: {}", url);
            } else {
                eprintln!("  ⚠️ Webhook uyarısı: Hedef sunucu {} döndürdü.", out.status);
            }
        }
        Err(err) => {
            eprintln!("  ⚠️ Webhook uyarısı: İstek iletilemedi: {:?}", err);
        }
    }
}
