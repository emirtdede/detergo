use std::io::{BufRead, Write};
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::commands::AppState;
use crate::cleanup::DeleteMode;

#[derive(Debug, Serialize, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

pub fn run_mcp_server() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let handle = stdin.lock();

    for line in handle.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(_) => {
                let err_res = json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": {
                        "code": -32700,
                        "message": "Parse error: Geçersiz JSON gönderildi"
                    }
                });
                let _ = writeln!(stdout, "{}", serde_json::to_string(&err_res).unwrap_or_default());
                let _ = stdout.flush();
                continue;
            }
        };

        let response = handle_mcp_message(&request);
        if let Some(res) = response {
            let res_str = serde_json::to_string(&res).unwrap_or_default();
            let _ = writeln!(stdout, "{}", res_str);
            let _ = stdout.flush();
        }
    }
}

fn handle_mcp_message(req: &JsonRpcRequest) -> Option<Value> {
    let id = req.id.clone()?;

    match req.method.as_str() {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "serverInfo": {
                    "name": "dev-cleaner-mcp",
                    "version": "2.2.0"
                },
                "capabilities": {
                    "tools": {}
                }
            }
        })),
        "notifications/initialized" => None,
        "ping" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {}
        })),
        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "tools": [
                    {
                        "name": "devcleaner_scan_workspace",
                        "description": "Projeleri, AI depolarını veya önbellekleri tarayarak güvenli temizlenebilir hedefleri (node_modules, target, .venv vb.) raporlar.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "path": { "type": "string", "description": "Taranacak klasör yolu (varsayılan: aktif dizin .)" },
                                "scope": { "type": "string", "enum": ["projects", "agents", "caches", "all"], "default": "projects" },
                                "min_size_mb": { "type": "number", "description": "Minimum boyut eşiği (MB)" }
                            }
                        }
                    },
                    {
                        "name": "devcleaner_clean_safe",
                        "description": "Yalnızca 'Safe' ve 'Regenerate' sınıfındaki doğrulanmış hedefleri Windows Geri Dönüşüm Kutusuna taşır. Asla kalıcı silmez.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "target_ids": { "type": "array", "items": { "type": "string" }, "description": "Temizlenecek hedeflerin ID listesi" },
                                "path": { "type": "string", "description": "Hedeflerin ait olduğu çalışma alanı dizini (doğrulama için)" }
                            },
                            "required": ["target_ids"]
                        }
                    },
                    {
                        "name": "devcleaner_list_caches",
                        "description": "Sistemdeki 21 geliştirici aracının (Docker, npm, Cargo, pip, Gradle, Go vb.) önbellek durumunu ve boyutlarını listeler.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {}
                        }
                    },
                    {
                        "name": "devcleaner_clean_cache",
                        "description": "Belirli bir aracın (npm, pip, cargo, docker vb.) önbelleğini resmi CLI komutuyla temizler.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "provider_id": { "type": "string", "description": "Temizlenecek sağlayıcı ID'si (örn: npm, cargo, pip, docker)" }
                            },
                            "required": ["provider_id"]
                        }
                    },
                    {
                        "name": "devcleaner_get_history",
                        "description": "Dev Cleaner tarafından yapılan geçmiş temizlik ve denetim kayıtlarını listeler.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "limit": { "type": "number", "description": "Listelenecek kayıt sayısı (varsayılan: 10)" }
                            }
                        }
                    },
                    {
                        "name": "devcleaner_inspect_target",
                        "description": "Belirli bir hedefin güvenlik sınıfını, kural detaylarını ve temizlik uygunluğunu ayrıntılı inceler.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "path": { "type": "string", "description": "İncelenecek hedefin dosya yolu" }
                            },
                            "required": ["path"]
                        }
                    }
                ]
            }
        })),
        "tools/call" => {
            let params = req.params.as_ref();
            let tool_name = params.and_then(|p| p.get("name")).and_then(|n| n.as_str()).unwrap_or("");
            let args = params.and_then(|p| p.get("arguments")).cloned().unwrap_or(json!({}));

            let output_text = execute_mcp_tool(tool_name, &args);
            Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": output_text
                        }
                    ]
                }
            }))
        },
        _ => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": "Metot bulunamadı"
            }
        }))
    }
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

fn execute_mcp_tool(name: &str, args: &Value) -> String {
    match name {
        "devcleaner_list_caches" => {
            let providers = crate::cleanup::official_actions::list_cache_providers();
            let mut summary = String::from("Dev Cleaner: 21 Geliştirici Araç Önbelleği Durumu:\n");
            for p in providers {
                let status = if p.detected { "Kurulu / Algılandı" } else { "Bulunamadı" };
                let ver = p.version.unwrap_or_else(|| "-".to_string());
                summary.push_str(&format!("• {} ({}) -> {}\n", p.name, ver, status));
            }
            summary
        }
        "devcleaner_clean_cache" => {
            let provider_id = args.get("provider_id").and_then(|p| p.as_str()).unwrap_or("");
            if provider_id.is_empty() {
                return "Hata: 'provider_id' parametresi zorunludur (örn: 'npm', 'pip', 'cargo').".to_string();
            }

            let registry = crate::cleanup::official_actions::OfficialActionRegistry::new();
            let providers = crate::cleanup::official_actions::list_cache_providers();
            let found = providers.iter().find(|p| p.id.eq_ignore_ascii_case(provider_id));

            match found {
                Some(p) => {
                    if !p.detected {
                        return format!("Araç önbelleği temizlenemedi: '{}' sistemde kurulu değil.", p.name);
                    }
                    if p.actions.is_empty() {
                        return format!("'{}' için tanımlı resmi CLI temizlik komutu bulunmuyor.", p.name);
                    }

                    let action = &p.actions[0];
                    match crate::cleanup::official_actions::preview_action(&registry, &p.id, &action.id) {
                        Ok(preview) => {
                            match crate::cleanup::official_actions::execute_action(&registry, &preview.token) {
                                Ok(res) => {
                                    let reclaimed = res.before_bytes.saturating_sub(res.after_bytes);
                                    if res.success {
                                        format!("✓ Başarılı: {} önbelleği temizlendi. Geri kazanılan: {}", p.name, format_size(reclaimed))
                                    } else {
                                        format!("⚠️ {} temizliği başarısız oldu (Çıkış kodu: {:?})", p.name, res.exit_code)
                                    }
                                }
                                Err(e) => format!("Temizlik komutu yürütülürken hata oluştu: {:?}", e)
                            }
                        }
                        Err(e) => format!("İşlem önizlemesi oluşturulamadı: {:?}", e)
                    }
                }
                None => format!("Bilinmeyen sağlayıcı ID'si: '{}'. Mevcut sağlayıcıları listelemek için 'devcleaner_list_caches' kullanın.", provider_id)
            }
        }
        "devcleaner_scan_workspace" => {
            let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or(".");
            let min_size_mb = args.get("min_size_mb").and_then(|m| m.as_u64()).unwrap_or(0);
            let path = PathBuf::from(path_str);

            let state = AppState::new();
            let catalog = match state.catalog() {
                Ok(idx) => idx,
                Err(e) => return format!("Katalog yüklenemedi: {:?}", e),
            };
            let token = crate::scanner::CancellationToken::new();
            let limits = crate::scanner::limits::ScanLimits::default();
            let mut engine = crate::scanner::discovery::DiscoveryEngine::new(&catalog, token.clone(), limits);

            let config = crate::scanner::discovery::DiscoveryConfig {
                root: &path,
                exclusions: &[],
                protected_paths: &[],
                scan_session_id: "mcp_scan",
                limits,
            };

            match engine.discover(config, |_| {}, |_| {}) {
                Ok(outcome) => {
                    let min_bytes = min_size_mb * 1024 * 1024;
                    let filtered_items: Vec<_> = outcome.items.iter().filter(|it| {
                        it.estimated_reclaim_bytes.unwrap_or(0) >= min_bytes
                    }).collect();

                    let mut total_bytes = 0u64;
                    for item in &filtered_items {
                        total_bytes += item.estimated_reclaim_bytes.unwrap_or(0);
                    }

                    // Token bloat koruması: En büyük 25 hedefi detaylandır, gerisini özetle
                    let mut sorted = filtered_items.clone();
                    sorted.sort_by_key(|it| std::cmp::Reverse(it.estimated_reclaim_bytes.unwrap_or(0)));
                    let top_items: Vec<_> = sorted.into_iter().take(25).collect();

                    let formatted_targets: Vec<_> = top_items.iter().map(|it| json!({
                        "id": it.id,
                        "target_id": it.id,
                        "name": it.display_name,
                        "path": it.display_path,
                        "category": it.category,
                        "safety": it.safety_class,
                        "bytes": it.estimated_reclaim_bytes.unwrap_or(0),
                        "human": format_size(it.estimated_reclaim_bytes.unwrap_or(0))
                    })).collect();

                    let payload = json!({
                        "path": path.to_string_lossy(),
                        "total_targets_found": filtered_items.len(),
                        "total_reclaimable_bytes": total_bytes,
                        "total_reclaimable_human": format_size(total_bytes),
                        "items_truncated": filtered_items.len() > 25,
                        "top_targets": formatted_targets,
                        "items": formatted_targets
                    });
                    serde_json::to_string_pretty(&payload).unwrap_or_default()
                }
                Err(e) => format!("Tarama hatası: {:?}", e)
            }
        }
        "devcleaner_clean_safe" => {
            let target_ids: Vec<String> = if let Some(arr) = args.get("target_ids").and_then(|a| a.as_array()) {
                arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
            } else if let Some(id) = args.get("target_id").and_then(|i| i.as_str()) {
                vec![id.to_string()]
            } else {
                return "Hata: 'target_ids' listesi gereklidir.".to_string();
            };

            if target_ids.is_empty() {
                return "Hata: Temizlenecek en az bir 'target_id' sağlanmalıdır.".to_string();
            }

            let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or(".");
            let root_path = PathBuf::from(path_str);

            let state = AppState::new();
            let catalog = match state.catalog() {
                Ok(idx) => idx,
                Err(e) => return format!("Katalog yüklenemedi: {:?}", e),
            };

            let token = crate::scanner::CancellationToken::new();
            let limits = crate::scanner::limits::ScanLimits::default();
            let mut engine = crate::scanner::discovery::DiscoveryEngine::new(&catalog, token.clone(), limits);

            let config = crate::scanner::discovery::DiscoveryConfig {
                root: &root_path,
                exclusions: &[],
                protected_paths: &[],
                scan_session_id: "mcp_clean",
                limits,
            };

            match engine.discover(config, |_| {}, |_| {}) {
                Ok(outcome) => {
                    let session = crate::scanner::session::ScanSession {
                        id: "mcp_clean".to_string(),
                        scope: crate::scanner::models::ScanScope::Project,
                        root: root_path.clone(),
                        allowed_roots: vec![root_path.clone()],
                        created: std::time::Instant::now(),
                        items: outcome.items.clone(),
                        targets: outcome.targets.into_iter().map(|t| (t.id.clone(), t)).collect(),
                        summary: None,
                    };

                    let settings = state.settings.load();
                    let policy = crate::cleanup::CleanupPolicy::from(&settings);

                    match crate::cleanup::build_plan(&session, &target_ids, DeleteMode::RecycleBin, &catalog, &policy) {
                        Ok(plan) => {
                            let confirmation = plan.confirmation_token.clone();
                            match crate::cleanup::execute_plan(&plan, &session, &catalog, &policy, &confirmation, false) {
                                Ok(report) => {
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

                                    let payload = json!({
                                        "status": "success",
                                        "cleaned_targets_count": report.success_count,
                                        "reclaimed_bytes": report.reclaim_bytes,
                                        "reclaimed_human": format_size(report.reclaim_bytes),
                                        "destination": "Windows Recycle Bin (Sıfır veri kaybı)",
                                        "errors": report.results.iter().filter(|r| !r.success).map(|r| json!({
                                            "path": r.display_path,
                                            "error": r.error
                                        })).collect::<Vec<_>>()
                                    });
                                    serde_json::to_string_pretty(&payload).unwrap_or_default()
                                }
                                Err(e) => format!("Temizlik yürütülemedi: {:?}", e)
                            }
                        }
                        Err(e) => format!("Temizlik planı oluşturulamadı (Hedef bulunamadı veya güvenli değil): {:?}", e)
                    }
                }
                Err(e) => format!("Doğrulama taraması hatası: {:?}", e)
            }
        }
        "devcleaner_get_history" => {
            let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
            let state = AppState::new();
            let records = state.audit.list_records(limit);
            serde_json::to_string_pretty(&records).unwrap_or_default()
        }
        "devcleaner_inspect_target" => {
            let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or("");
            if path_str.is_empty() {
                return "Hata: 'path' parametresi zorunludur.".to_string();
            }
            let target_path = PathBuf::from(path_str);
            let state = AppState::new();
            let catalog = match state.catalog() {
                Ok(idx) => idx,
                Err(e) => return format!("Katalog yüklenemedi: {:?}", e),
            };

            let exists = target_path.exists();
            let is_symlink = target_path.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false);
            
            // Check if matches catalog rule
            let matched_rule = catalog.rules().iter().find(|r| {
                if let Some(name) = target_path.file_name().and_then(|n| n.to_str()) {
                    r.names.iter().any(|rule_name| rule_name.eq_ignore_ascii_case(name))
                } else {
                    false
                }
            });

            let payload = json!({
                "path": target_path.to_string_lossy(),
                "exists": exists,
                "is_symlink": is_symlink,
                "matched_rule": matched_rule.map(|r| json!({
                    "id": r.id,
                    "ecosystem": r.ecosystem,
                    "category": r.category,
                    "names": r.names,
                    "safety": r.safety,
                    "regenerate": r.regenerate
                }))
            });
            serde_json::to_string_pretty(&payload).unwrap_or_default()
        }
        _ => format!("Bilinmeyen araç: {}", name)
    }
}
