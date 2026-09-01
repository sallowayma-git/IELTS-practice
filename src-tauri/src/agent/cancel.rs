//! Run-scoped cancellation registry (M12-02 cancel path).
//!
//! The UI generates the run id before invoking `agent_run`, so it can cancel
//! a run that is still executing. The registry maps run id → cancel token;
//! `agent_cancel_run` flips the token and the AgentService loop lands the run
//! as `Interrupted` at its next round/tool boundary.

use std::collections::HashMap;
use std::sync::Mutex;

use ielts_application::AgentCancelToken;

#[derive(Default)]
pub(crate) struct AgentCancelRegistry {
    tokens: Mutex<HashMap<String, AgentCancelToken>>,
}

impl AgentCancelRegistry {
    /// Register a fresh token for a run. Returns `None` when the id is
    /// already active — two concurrent runs sharing an id would otherwise
    /// silently disable cancellation for the survivor.
    pub(crate) fn register(&self, run_id: &str) -> Option<AgentCancelToken> {
        let mut tokens = self.tokens.lock().expect("cancel registry poisoned");
        if tokens.contains_key(run_id) {
            return None;
        }
        let token = AgentCancelToken::new();
        tokens.insert(run_id.to_owned(), token.clone());
        Some(token)
    }

    /// Remove the token once the run finished (cancel requests after this
    /// land as a no-op reporting the run is not running).
    pub(crate) fn unregister(&self, run_id: &str) {
        self.tokens
            .lock()
            .expect("cancel registry poisoned")
            .remove(run_id);
    }

    /// Cancel a registered run. Returns false when the run is unknown
    /// (already finished, or never started on this host).
    pub(crate) fn cancel(&self, run_id: &str) -> bool {
        let tokens = self.tokens.lock().expect("cancel registry poisoned");
        match tokens.get(run_id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }
}
