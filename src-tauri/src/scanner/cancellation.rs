use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

static NEXT_TOKEN_ID: AtomicU64 = AtomicU64::new(1);

/// A cancellation flag with a stable identity.
///
/// The identity matters when several scans overlap: a finishing scan must only
/// clear the global "current scan" slot if that slot still points at its own
/// token, never at a newer scan's token.
#[derive(Clone, Debug)]
pub struct CancellationToken {
    id: u64,
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            id: NEXT_TOKEN_ID.fetch_add(1, Ordering::Relaxed),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn id(&self) -> u64 {
        self.id
    }

    /// Returns `true` when both handles refer to the same logical scan token.
    pub fn same(&self, other: &Self) -> bool {
        self.id == other.id
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn reset(&self) {
        self.cancelled.store(false, Ordering::Release);
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::CancellationToken;

    #[test]
    fn clones_share_state_and_identity() {
        let a = CancellationToken::new();
        let b = a.clone();
        assert!(a.same(&b));
        a.cancel();
        assert!(b.is_cancelled());
    }

    #[test]
    fn distinct_tokens_do_not_share_identity() {
        let a = CancellationToken::new();
        let b = CancellationToken::new();
        assert!(!a.same(&b));
        a.cancel();
        assert!(!b.is_cancelled());
    }
}
