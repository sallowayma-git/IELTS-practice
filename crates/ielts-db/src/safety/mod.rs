//! Protection of user data against accidental loss.
//!
//! The data classes (see the v1.4 amendment, "数据隔离与防误删"):
//!
//! * **A, raw truth** -- what the learner did and wrote, and the evaluation and
//!   coach text that cost money to produce. Cannot be regenerated. Schema-gated:
//!   [`RAW_TRUTH_TABLES`] cannot be deleted unless the [`gate`] is open, and the
//!   gate is opened only by the explicit user paths.
//! * **B, durable derived** -- the learning ledger, memory, journals, weekly
//!   digests. Expensive or impossible to rebuild; never pruned, and never lost
//!   to a cascade out of class A (0028).
//! * **C, rebuildable projections** -- observations, learner state, retrieval
//!   metadata. Rebuilt on demand.
//! * **D, operational records** -- run traces, context snapshots, LLM
//!   invocation logs, finished jobs. Bounded by age ([`operational`]).
//!
//! Plus one safety net: before an operation that rewrites or erases user data
//! (restore, clear, bulk delete, a retention prune, a schema migration) the
//! caller takes a [`snapshot`], and aborts if it cannot.

pub mod gate;
pub mod operational;
pub mod snapshot;

pub use gate::{close_delete_gate, with_delete_gate, DeleteGate, RAW_TRUTH_TABLES};
pub use operational::{
    prune_operational_records, OperationalPruneReport, OPERATIONAL_RETENTION_DAYS,
};
pub use snapshot::{snapshot_before, SNAPSHOT_KEEP};
