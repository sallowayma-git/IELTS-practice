# ADR 0002: SQLite Canonical Store and Derived Memory

状态：Accepted（M0）
日期：2026-08-11

## Context

The product already has learning attempts, answers, evaluations, history, and Agent audit tables in SQLite. Future Memory and Dream data will be derived from those facts. A second vector, graph, or cache authority would make deletion, backup, and reproducibility ambiguous.

## Decision

SQLite remains the canonical local store for both canonical learning records and explicitly versioned derived Agent state. Any later Memory index is an acceleration layer with a rebuild path, never the source of truth. M0 adds no migration and only extends the existing minimized run result JSON.

## Consequences

Backups and user deletion have one durable boundary, and derived state can be rebuilt or quarantined. Large-scale semantic retrieval may require FTS or an index later, but that index must carry schema/model versions and rollback evidence.
