//! Poison-tolerant mutex locking.
//!
//! `Mutex::lock` returns `Err` once any thread panicked while holding the lock.
//! Unwrapping that result therefore turned one unrelated panic into a cascade
//! of panics, permanently disabling scans, cleanup and window commands for the
//! rest of the process.
//!
//! The values guarded here (session maps, tokens, summaries) remain structurally
//! valid after a panic: the safest recovery is to take the inner guard and keep
//! serving. Callers should use [`crate::lock!`] instead of unwrapping the lock.

/// Locks a mutex, recovering the guard if the mutex was poisoned.
#[macro_export]
macro_rules! lock {
    ($mutex:expr) => {
        match $mutex.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    };
}
