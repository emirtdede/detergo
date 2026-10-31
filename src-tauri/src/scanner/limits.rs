use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub struct ScanLimits {
    pub max_depth: usize,
    pub max_candidates: u64,
    pub timeout: Duration,
    pub min_size_bytes: u64,
}

pub const DEFAULT_MAX_DEPTH: usize = 32;
pub const DEFAULT_MAX_CANDIDATES: u64 = 50_000;
pub const DEFAULT_TIMEOUT_MINUTES: u64 = 15;

impl Default for ScanLimits {
    fn default() -> Self {
        Self {
            max_depth: DEFAULT_MAX_DEPTH,
            max_candidates: DEFAULT_MAX_CANDIDATES,
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_MINUTES * 60),
            min_size_bytes: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    CandidateLimit,
    DepthLimit,
    Timeout,
    Cancelled,
}

impl StopReason {
    pub fn code(self) -> &'static str {
        match self {
            StopReason::CandidateLimit => "candidate-limit",
            StopReason::DepthLimit => "depth-limit",
            StopReason::Timeout => "timeout",
            StopReason::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug)]
pub struct ScanBudget {
    limits: ScanLimits,
    started: Instant,
    candidates: u64,
    depth_hit: bool,
}

impl ScanBudget {
    pub fn new(limits: ScanLimits) -> Self {
        Self {
            limits,
            started: Instant::now(),
            candidates: 0,
            depth_hit: false,
        }
    }

    pub fn limits(&self) -> &ScanLimits {
        &self.limits
    }

    pub fn note_candidate(&mut self) {
        self.candidates = self.candidates.saturating_add(1);
    }

    pub fn candidates(&self) -> u64 {
        self.candidates
    }

    pub fn note_depth_exceeded(&mut self) {
        self.depth_hit = true;
    }

    pub fn exceeded(&self) -> Option<StopReason> {
        if self.candidates >= self.limits.max_candidates {
            return Some(StopReason::CandidateLimit);
        }
        if self.depth_hit {
            return Some(StopReason::DepthLimit);
        }
        if self.started.elapsed() >= self.limits.timeout {
            return Some(StopReason::Timeout);
        }
        None
    }
}
