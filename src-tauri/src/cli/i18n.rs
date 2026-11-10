use std::collections::HashMap;
use std::sync::OnceLock;

/// Localized strings for the terminal interface.
///
/// The dictionary is generated from the English source strings that this
/// module prints, keyed per locale. Anything missing falls back to English so
/// the CLI never breaks when a new string is added before its translation.
static TABLE: OnceLock<HashMap<String, HashMap<String, String>>> = OnceLock::new();
static LANGUAGE: OnceLock<String> = OnceLock::new();

fn table() -> &'static HashMap<String, HashMap<String, String>> {
    TABLE.get_or_init(|| {
        serde_json::from_str(include_str!("../../assets/cli-locales.json")).unwrap_or_default()
    })
}

fn language() -> &'static str {
    LANGUAGE.get_or_init(|| {
        crate::settings::SettingsRepository::new()
            .load()
            .language
            .unwrap_or_else(|| "en".to_string())
    })
}

/// Translate one CLI string for the active application language.
pub fn t(key: &str) -> String {
    let lang = language();
    if lang == "en" {
        return key.to_string();
    }
    table()
        .get(lang)
        .and_then(|dict| dict.get(key))
        .cloned()
        .unwrap_or_else(|| key.to_string())
}

/// `t()` plus positional arguments, mirroring `format!`.
pub fn tf(key: &str, args: &[&dyn std::fmt::Display]) -> String {
    let template = t(key);
    let mut out = String::with_capacity(template.len());
    let mut rest = template.as_str();
    for arg in args {
        match rest.find("{}") {
            Some(idx) => {
                out.push_str(&rest[..idx]);
                out.push_str(&arg.to_string());
                rest = &rest[idx + 2..];
            }
            None => break,
        }
    }
    out.push_str(rest);
    out
}
