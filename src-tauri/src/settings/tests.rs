#[cfg(test)]
#[allow(clippy::module_inception, clippy::field_reassign_with_default)]
mod tests {
    use crate::settings::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_settings_default_on_non_existent() {
        let temp = tempdir().unwrap();
        let repo = SettingsRepository::with_path(temp.path().join("config.json"));
        let settings = repo.load();
        assert_eq!(settings.schema_version, 4);
        assert_eq!(settings.theme, "dark-transparent");
        assert!(!settings.reduce_motion);
        assert_eq!(settings.scan_profile, "balanced");
        assert_eq!(settings.sidebar_mode, "expanded");
        assert_eq!(settings.cache_measure_mode, "fast");
    }

    #[test]
    fn test_settings_save_and_load_roundtrip() {
        let temp = tempdir().unwrap();
        let repo = SettingsRepository::with_path(temp.path().join("config.json"));

        let mut settings = AppSettings::default();
        settings.theme = "white".to_string();
        settings.reduce_motion = true;
        settings
            .protected_paths
            .push("D:\\Work\\important".to_string());
        settings.favorites.push(FavoriteItem {
            id: "fav-1".to_string(),
            label: "My Code".to_string(),
            path: "C:\\Code".to_string(),
            created_at: "2026-08-28T00:00:00Z".to_string(),
            last_used_at: None,
        });

        repo.save(&settings).expect("Failed to save settings");
        let loaded = repo.load();
        assert_eq!(loaded.theme, "white");
        assert!(loaded.reduce_motion);
        assert_eq!(loaded.favorites.len(), 1);
        assert_eq!(
            loaded.protected_paths,
            vec!["D:\\Work\\important".to_string()]
        );
    }

    #[test]
    fn test_settings_save_replaces_existing_file() {
        let temp = tempdir().unwrap();
        let repo = SettingsRepository::with_path(temp.path().join("config.json"));

        let mut first = AppSettings::default();
        first.theme = "white".to_string();
        repo.save(&first).unwrap();

        let mut second = AppSettings::default();
        second.theme = "dark-transparent".to_string();
        second.history_enabled = false;
        repo.save(&second).unwrap();

        let loaded = repo.load();
        assert_eq!(loaded.theme, "dark-transparent");
        assert!(!loaded.history_enabled);
        let temp_files: Vec<_> = std::fs::read_dir(temp.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with("config.tmp."))
            .collect();
        assert!(temp_files.is_empty(), "temp files must not be left behind");
    }

    #[test]
    fn test_settings_corrupt_json_fallback_preserves_file() {
        let temp = tempdir().unwrap();
        let config_path = temp.path().join("config.json");
        {
            let mut file = File::create(&config_path).unwrap();
            file.write_all(b"{ this is invalid JSON garbage ---")
                .unwrap();
        }

        let repo = SettingsRepository::with_path(config_path.clone());
        let settings = repo.load();

        assert_eq!(settings.schema_version, 4);
        assert_eq!(settings.theme, "dark-transparent");
        let backups: Vec<_> = std::fs::read_dir(temp.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains("corrupt"))
            .collect();
        assert_eq!(backups.len(), 1, "corrupt config must be preserved");
    }

    #[test]
    fn test_v1_settings_migrate_without_data_loss() {
        let temp = tempdir().unwrap();
        let config_path = temp.path().join("config.json");
        {
            let mut file = File::create(&config_path).unwrap();
            file.write_all(
                br#"{
                    "schemaVersion": 1,
                    "theme": "dark-gray",
                    "reduceMotion": true,
                    "favorites": [{"id":"f1","label":"Code","path":"C:\\Code","createdAt":"2026-01-01T00:00:00Z","lastUsedAt":null}],
                    "recentLocations": ["C:\\Code"],
                    "lastScanPath": "C:\\Code",
                    "sort": {"field":"size","direction":"desc"}
                }"#,
            )
            .unwrap();
        }

        let repo = SettingsRepository::with_path(config_path);
        let loaded = repo.load();
        assert_eq!(loaded.schema_version, 4);
        assert!(!loaded.mcp_allow_destructive);
        assert_eq!(loaded.theme, "dark-gray");
        assert!(loaded.reduce_motion);
        assert_eq!(loaded.favorites.len(), 1);
        assert_eq!(loaded.recent_locations, vec!["C:\\Code".to_string()]);
        assert_eq!(loaded.max_depth, 32);
        assert!(loaded.agent_policy.allow_cache_cleanup);
        assert_eq!(loaded.sidebar_mode, "expanded");
        assert!(loaded.custom_agent_providers.is_empty());
    }

    #[test]
    fn test_limits_are_clamped() {
        let mut settings = AppSettings::default();
        settings.max_depth = 0;
        settings.max_candidates = 10;
        settings.timeout_minutes = 999;
        settings.migrate();
        assert_eq!(settings.max_depth, 1);
        assert_eq!(settings.max_candidates, 1_000);
        assert_eq!(settings.timeout_minutes, 120);
    }

    #[test]
    fn protected_paths_are_made_absolute_and_deduplicated() {
        let temp = tempdir().unwrap();
        let dir = temp.path().join("important");
        std::fs::create_dir_all(&dir).unwrap();

        let mut settings = AppSettings::default();
        settings.protected_paths = vec![
            dir.to_string_lossy().to_string(),
            format!("{}\\", dir.to_string_lossy()),
            format!("{}\\..\\important", dir.to_string_lossy()),
            "   ".to_string(),
        ];
        settings.normalize();

        assert_eq!(
            settings.protected_paths.len(),
            1,
            "duplicate and blank entries must collapse: {:?}",
            settings.protected_paths
        );
        assert!(std::path::Path::new(&settings.protected_paths[0]).is_absolute());
        assert!(!settings.protected_paths[0].contains(".."));
    }

    #[test]
    fn relative_protected_path_is_anchored_to_the_working_directory() {
        let mut settings = AppSettings::default();
        settings.protected_paths = vec!["relative-protected-folder".to_string()];
        settings.normalize();
        assert_eq!(settings.protected_paths.len(), 1);
        assert!(std::path::Path::new(&settings.protected_paths[0]).is_absolute());
    }

    #[test]
    fn excluded_names_are_lowercased_and_deduplicated() {
        let mut settings = AppSettings::default();
        settings.excluded_names = vec![
            "node_modules".to_string(),
            "NODE_MODULES".to_string(),
            "  ".to_string(),
            " Target ".to_string(),
        ];
        settings.normalize();
        assert_eq!(settings.excluded_names, vec!["node_modules", "target"]);
    }

    #[test]
    fn custom_agent_providers_are_sanitized() {
        let temp = tempdir().unwrap();
        let dir = temp.path().join("cursor-data");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();

        let mut settings = AppSettings::default();
        settings.custom_agent_providers = vec![
            CustomAgentProvider {
                id: " u1 ".to_string(),
                name: " Cursor ".to_string(),
                root_paths: vec![path.clone(), format!("{}\\", path), "  ".to_string()],
                created_at: String::new(),
            },
            CustomAgentProvider {
                id: "u1".to_string(),
                name: "Duplicate id".to_string(),
                root_paths: vec![path.clone()],
                created_at: String::new(),
            },
            CustomAgentProvider {
                id: String::new(),
                name: "No id".to_string(),
                root_paths: vec![path.clone()],
                created_at: String::new(),
            },
            CustomAgentProvider {
                id: "u2".to_string(),
                name: "No roots".to_string(),
                root_paths: vec!["   ".to_string()],
                created_at: String::new(),
            },
        ];
        settings.normalize();

        assert_eq!(settings.custom_agent_providers.len(), 1);
        let provider = &settings.custom_agent_providers[0];
        assert_eq!(provider.id, "u1");
        assert_eq!(provider.name, "Cursor");
        assert_eq!(
            provider.root_paths.len(),
            1,
            "duplicate and blank roots must collapse: {:?}",
            provider.root_paths
        );
    }

    #[test]
    fn enum_like_setting_fields_reject_unknown_values() {
        let mut settings = AppSettings::default();
        settings.sidebar_mode = "sideways".to_string();
        settings.cache_measure_mode = "turbo".to_string();
        settings.close_action = "explode".to_string();
        settings.hidden_builtin_providers =
            vec![" Codex ".to_string(), "codex".to_string(), String::new()];
        settings.normalize();

        assert_eq!(settings.sidebar_mode, "expanded");
        assert_eq!(settings.cache_measure_mode, "fast");
        assert_eq!(settings.close_action, "ask");
        assert_eq!(settings.hidden_builtin_providers, vec!["codex"]);
    }

    #[test]
    fn remembered_close_action_round_trips_and_defaults_to_ask() {
        let mut settings = AppSettings::default();
        assert_eq!(settings.close_action, "ask");

        settings.close_action = "tray".to_string();
        settings.normalize();
        assert_eq!(settings.close_action, "tray");

        // Old config files predate the field: serde must fill the safe default.
        let legacy: AppSettings =
            serde_json::from_str(r#"{"theme":"dark-black","reduceMotion":false,"favorites":[],"recentLocations":[],"lastScanPath":null,"sort":{"field":"size","direction":"desc"}}"#)
                .expect("legacy settings must still deserialize");
        assert_eq!(legacy.close_action, "ask");
    }

    /// The E1-03 smoke test seeds its sandbox config from this fixture and then
    /// flips only `language`. If the schema grows without regenerating it, the
    /// smoke test would silently fall back to defaults and stop proving anything.
    #[test]
    fn default_settings_fixture_matches_app_defaults() {
        let fixture = include_str!("../../../scripts/fixtures/default-settings.json");
        let parsed: AppSettings =
            serde_json::from_str(fixture).expect("fixture must deserialize as AppSettings");

        assert_eq!(
            serde_json::to_value(parsed).unwrap(),
            serde_json::to_value(AppSettings::default()).unwrap(),
            "regenerate scripts/fixtures/default-settings.json: \
             cargo run --manifest-path src-tauri/Cargo.toml --example dump-default-settings"
        );
    }
}
