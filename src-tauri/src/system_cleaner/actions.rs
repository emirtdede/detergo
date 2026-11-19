use super::{SystemActionId, SystemSafety};

/// How an action is carried out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    /// Native, guarded deletion of a fixed root's contents.
    Native,
    /// `SHEmptyRecycleBinW`.
    RecycleBin,
    /// `cleanmgr.exe /sagerun` with a fixed, registry-defined profile.
    CleanMgr,
    /// `Dism.exe /Online /Cleanup-Image /StartComponentCleanup`.
    Dism,
}

pub struct ActionSpec {
    pub id: SystemActionId,
    pub safety: SystemSafety,
    pub requires_admin: bool,
    pub engine: Engine,
    /// English label for the CLI; the GUI localises by `id`.
    pub label: &'static str,
}

/// The only actions the backend will ever run. Order is the display order.
pub const ACTIONS: &[ActionSpec] = &[
    ActionSpec {
        id: SystemActionId::UserTemp,
        safety: SystemSafety::Safe,
        requires_admin: false,
        engine: Engine::Native,
        label: "User temporary files",
    },
    ActionSpec {
        id: SystemActionId::WindowsTemp,
        safety: SystemSafety::Regenerate,
        requires_admin: true,
        engine: Engine::Native,
        label: "Windows temporary files",
    },
    ActionSpec {
        id: SystemActionId::Prefetch,
        safety: SystemSafety::Regenerate,
        requires_admin: true,
        engine: Engine::Native,
        label: "Prefetch data",
    },
    ActionSpec {
        id: SystemActionId::WindowsUpdate,
        safety: SystemSafety::Regenerate,
        requires_admin: true,
        engine: Engine::Native,
        label: "Windows Update leftovers",
    },
    ActionSpec {
        id: SystemActionId::ErrorReports,
        safety: SystemSafety::Safe,
        requires_admin: true,
        engine: Engine::Native,
        label: "Windows error reports",
    },
    ActionSpec {
        id: SystemActionId::RecycleBin,
        safety: SystemSafety::Review,
        requires_admin: false,
        engine: Engine::RecycleBin,
        label: "Recycle Bin",
    },
    ActionSpec {
        id: SystemActionId::DiskCleanup,
        safety: SystemSafety::Review,
        requires_admin: true,
        engine: Engine::CleanMgr,
        label: "Windows Disk Cleanup",
    },
    ActionSpec {
        id: SystemActionId::ComponentStore,
        safety: SystemSafety::Review,
        requires_admin: true,
        engine: Engine::Dism,
        label: "Component store cleanup",
    },
];

pub fn spec(id: SystemActionId) -> &'static ActionSpec {
    ACTIONS
        .iter()
        .find(|spec| spec.id == id)
        .expect("every SystemActionId has an ActionSpec")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_id_is_covered_exactly_once() {
        let ids = [
            SystemActionId::UserTemp,
            SystemActionId::WindowsTemp,
            SystemActionId::Prefetch,
            SystemActionId::WindowsUpdate,
            SystemActionId::ErrorReports,
            SystemActionId::RecycleBin,
            SystemActionId::DiskCleanup,
            SystemActionId::ComponentStore,
        ];
        assert_eq!(ids.len(), ACTIONS.len());
        for id in ids {
            assert_eq!(ACTIONS.iter().filter(|spec| spec.id == id).count(), 1);
            assert_eq!(spec(id).id, id);
        }
    }

    #[test]
    fn ids_round_trip_through_text() {
        for spec in ACTIONS {
            assert_eq!(SystemActionId::parse(spec.id.as_str()), Some(spec.id));
        }
    }
}
