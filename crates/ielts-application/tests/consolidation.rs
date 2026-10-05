use ielts_application::{ApplicationError, ConsolidationService, ConsolidationStore};
use ielts_db::SupportMemory;
use ielts_domain::{
    ConsolidationConfig, ConsolidationReceipt, MemoryFeedbackKind, MemoryFeedbackRecord,
    PatternKind, PatternProposal, PatternValidationReport, StaleArchiveReport,
    SupportChangeOutcome, ValidatedPattern,
};
use rusqlite::{params, Connection};

const NOW: &str = "2026-08-16T10:00:00+00:00";
const USER: &str = "local";

struct Store(Connection);

fn db_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("db_validation", error.to_string(), false)
}

impl ConsolidationStore for Store {
    fn load_support_memories(
        &self,
        ids: &[String],
        user: &str,
    ) -> Result<Vec<SupportMemory>, ApplicationError> {
        ielts_db::load_support_memories(&self.0, ids, user).map_err(db_error)
    }

    fn validate_patterns(
        &self,
        proposals: &[PatternProposal],
        user: &str,
        config: &ConsolidationConfig,
    ) -> Result<PatternValidationReport, ApplicationError> {
        ielts_db::validate_patterns(&self.0, proposals, user, config).map_err(db_error)
    }

    fn apply_consolidation(
        &self,
        pattern: &ValidatedPattern,
        user: &str,
        now: &str,
    ) -> Result<ConsolidationReceipt, ApplicationError> {
        ielts_db::apply_consolidation(&self.0, pattern, user, now).map_err(db_error)
    }

    fn apply_consolidation_with_config(
        &self,
        pattern: &ValidatedPattern,
        user: &str,
        now: &str,
        config: &ConsolidationConfig,
    ) -> Result<ConsolidationReceipt, ApplicationError> {
        ielts_db::apply_consolidation_with_config(&self.0, pattern, user, now, config)
            .map_err(db_error)
    }

    fn propagate_support_change(
        &self,
        id: &str,
        status: &str,
        now: &str,
    ) -> Result<SupportChangeOutcome, ApplicationError> {
        ielts_db::propagate_support_change(&self.0, id, status, now).map_err(db_error)
    }

    fn archive_stale(&self, now: &str) -> Result<StaleArchiveReport, ApplicationError> {
        ielts_db::archive_stale(&self.0, now).map_err(db_error)
    }

    fn record_memory_feedback(
        &self,
        id: &str,
        kind: MemoryFeedbackKind,
        user: &str,
        payload: &serde_json::Value,
        now: &str,
    ) -> Result<MemoryFeedbackRecord, ApplicationError> {
        ielts_db::record_memory_feedback(&self.0, id, kind, user, payload, now).map_err(db_error)
    }
}

fn fixture() -> Store {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    ielts_db::migrate(&mut conn).unwrap();
    conn.execute_batch("INSERT INTO practice_assets
        (id,activity,source_kind,title,schema_version,fingerprint,created_at,updated_at)
        VALUES ('asset','reading','builtin','asset',1,'asset','now','now');
        INSERT INTO attempts
        (id,activity,asset_id,mode,status,started_at,completed_at,schema_version,created_at,updated_at)
        VALUES ('attempt','reading','asset','single','completed','now','now',1,'now','now');
        INSERT INTO learning_events
        (id,user_id,event_type,source_kind,idempotency_key,activity,asset_id,attempt_id,
         occurred_at,payload_json,content_hash,created_at,updated_at)
        VALUES ('event','local','attempt_completed','test','event','reading','asset','attempt',
                'now','{}','event','now','now');
        INSERT INTO learner_observations
        (id,user_id,observation_type,namespace,scope_kind,scope_key,payload_json,observed_at,
         projector_key,projector_version,source_fingerprint,created_at)
        VALUES ('obs-a','local','practice','strategy','skill','reading','{}','now','test',1,'obs-a','now');
        INSERT INTO learner_observation_evidence (observation_id,event_id) VALUES ('obs-a','event');").unwrap();
    conn.execute(
        "INSERT INTO memory_items
        (id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,
         status,source_class,confidence,importance,source_trust,sensitivity,improvement_state,
         version,created_by,content_hash,created_at,updated_at)
        VALUES ('mem-a',?1,'strategy','reading','procedural','key','label','content',
                'active','observed',0.7,0.5,0.7,'normal','baseline',1,'test','hash',?2,?2)",
        params![USER, NOW],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO memory_evidence
        (memory_id,observation_id,source_fingerprint,projector_key,projector_version,
         event_ids_json,evidence_hash,created_at)
        VALUES ('mem-a','obs-a','obs-a','test',1,'[\"event\"]','obs-a',?1)",
        [NOW],
    )
    .unwrap();
    Store(conn)
}

fn custom() -> ConsolidationConfig {
    ConsolidationConfig {
        min_supports: 1,
        min_distinct_assets: 1,
        ..ConsolidationConfig::default()
    }
}

fn validated(service: &ConsolidationService<'_>) -> ValidatedPattern {
    let report = service
        .validate_patterns(
            &[PatternProposal {
                statement: "learner revisits answers before submitting".into(),
                supporting_memory_ids: vec!["mem-a".into()],
                pattern_kind: PatternKind::BehaviorPattern,
                confidence_proposal: 0.8,
            }],
            USER,
        )
        .unwrap();
    assert!(report.rejected.is_empty(), "{:?}", report.rejected);
    report.validated.into_iter().next().unwrap()
}

fn assert_no_write(store: &Store) {
    let status: String = store
        .0
        .query_row(
            "SELECT status FROM memory_items WHERE id='mem-a'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "active");
    let count: i64 = store
        .0
        .query_row("SELECT COUNT(*) FROM memory_relations", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

// Implements only the original port, exercising the compatibility default.
struct LegacyStore(Store);

impl ConsolidationStore for LegacyStore {
    fn load_support_memories(
        &self,
        ids: &[String],
        user: &str,
    ) -> Result<Vec<SupportMemory>, ApplicationError> {
        self.0.load_support_memories(ids, user)
    }
    fn validate_patterns(
        &self,
        proposals: &[PatternProposal],
        user: &str,
        config: &ConsolidationConfig,
    ) -> Result<PatternValidationReport, ApplicationError> {
        self.0.validate_patterns(proposals, user, config)
    }
    fn apply_consolidation(
        &self,
        pattern: &ValidatedPattern,
        user: &str,
        now: &str,
    ) -> Result<ConsolidationReceipt, ApplicationError> {
        self.0.apply_consolidation(pattern, user, now)
    }
    fn propagate_support_change(
        &self,
        id: &str,
        status: &str,
        now: &str,
    ) -> Result<SupportChangeOutcome, ApplicationError> {
        self.0.propagate_support_change(id, status, now)
    }
    fn archive_stale(&self, now: &str) -> Result<StaleArchiveReport, ApplicationError> {
        self.0.archive_stale(now)
    }
    fn record_memory_feedback(
        &self,
        id: &str,
        kind: MemoryFeedbackKind,
        user: &str,
        payload: &serde_json::Value,
        now: &str,
    ) -> Result<MemoryFeedbackRecord, ApplicationError> {
        self.0.record_memory_feedback(id, kind, user, payload, now)
    }
}

#[test]
fn legacy_port_rejects_loose_receipts_and_requires_custom_policy_support() {
    let store = LegacyStore(fixture());
    let service = ConsolidationService::with_config(&store, custom());
    let pattern = validated(&service);
    let failure = service
        .apply_consolidations(&[pattern.clone()], USER, NOW)
        .unwrap_err();
    assert!(failure.is_clean());
    assert_eq!(failure.error.code, "consolidation_policy_unsupported");
    let default = ConsolidationService::new(&store);
    let failure = default
        .apply_consolidations(&[pattern], USER, NOW)
        .unwrap_err();
    assert!(failure.is_clean());
    assert_eq!(failure.error.code, "consolidation_revalidation_failed");
    assert_no_write(&store.0);
}

#[test]
fn legacy_port_applies_valid_default_policy_receipts() {
    let store = LegacyStore(fixture());
    // Keep one memory but give it three independent sessions and assets.
    for suffix in ["b", "c"] {
        let conn = &store.0 .0;
        conn.execute(
            "INSERT INTO practice_assets
            (id,activity,source_kind,title,schema_version,fingerprint,created_at,updated_at)
            VALUES (?1,'reading','builtin',?1,1,?1,?2,?2)",
            params![format!("asset-{suffix}"), NOW],
        )
        .unwrap();
        conn.execute("INSERT INTO attempts
            (id,activity,asset_id,mode,status,started_at,completed_at,schema_version,created_at,updated_at)
            VALUES (?1,'reading',?2,'single','completed',?3,?3,1,?3,?3)",
            params![format!("attempt-{suffix}"),format!("asset-{suffix}"),NOW]).unwrap();
        conn.execute(
            "INSERT INTO learning_events
            (id,user_id,event_type,source_kind,idempotency_key,activity,asset_id,attempt_id,
             occurred_at,payload_json,content_hash,created_at,updated_at)
            VALUES (?1,?2,'attempt_completed','test',?1,'reading',?3,?4,?5,'{}',?1,?5,?5)",
            params![
                format!("event-{suffix}"),
                USER,
                format!("asset-{suffix}"),
                format!("attempt-{suffix}"),
                NOW
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learner_observations
            (id,user_id,observation_type,namespace,scope_kind,scope_key,payload_json,observed_at,
             projector_key,projector_version,source_fingerprint,created_at)
            VALUES (?1,?2,'practice','strategy','skill','reading','{}',?3,'test',1,?1,?3)",
            params![format!("obs-{suffix}"), USER, NOW],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learner_observation_evidence (observation_id,event_id)
            VALUES (?1,?2)",
            params![format!("obs-{suffix}"), format!("event-{suffix}")],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO memory_evidence
            (memory_id,observation_id,source_fingerprint,projector_key,projector_version,
             event_ids_json,evidence_hash,created_at)
            VALUES ('mem-a',?1,?1,'test',1,?2,?1,?3)",
            params![
                format!("obs-{suffix}"),
                serde_json::json!([format!("event-{suffix}")]).to_string(),
                NOW
            ],
        )
        .unwrap();
    }
    let service = ConsolidationService::new(&store);
    let pattern = validated(&service);
    assert_eq!(pattern.distinct_asset_count, 3);
    assert_eq!(
        service
            .apply_consolidations(&[pattern], USER, NOW)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn default_service_rejects_loose_receipt_and_forged_default_config() {
    let store = fixture();
    let loose = ConsolidationService::with_config(&store, custom());
    let mut pattern = validated(&loose);
    let default = ConsolidationService::new(&store);
    let failure = default
        .apply_consolidations(&[pattern.clone()], USER, NOW)
        .unwrap_err();
    assert!(failure.is_clean());
    assert!(failure.error.message.contains("policy mismatch"));
    let mut receipt: serde_json::Value = serde_json::from_str(&pattern.evidence_snapshot).unwrap();
    receipt["config"] = serde_json::to_value(default.config()).unwrap();
    pattern.evidence_snapshot = receipt.to_string();
    assert!(default
        .apply_consolidations(&[pattern], USER, NOW)
        .unwrap_err()
        .is_clean());
    assert_no_write(&store);
}

#[test]
fn custom_service_applies_its_own_policy() {
    let store = fixture();
    let service = ConsolidationService::with_config(&store, custom());
    let pattern = validated(&service);
    let receipts = service.apply_consolidations(&[pattern], USER, NOW).unwrap();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].relations_created, 1);
}

#[test]
fn custom_service_rejects_threshold_tampering_and_evidence_drift() {
    for change_evidence in [false, true] {
        let store = fixture();
        let service = ConsolidationService::with_config(&store, custom());
        let mut pattern = validated(&service);
        if change_evidence {
            store
                .0
                .execute("UPDATE attempts SET score_value=9", [])
                .unwrap();
        } else {
            let mut receipt: serde_json::Value =
                serde_json::from_str(&pattern.evidence_snapshot).unwrap();
            receipt["config"]["min_new_evidence"] = serde_json::json!(0);
            pattern.evidence_snapshot = receipt.to_string();
        }
        assert!(service
            .apply_consolidations(&[pattern], USER, NOW)
            .unwrap_err()
            .is_clean());
        assert_no_write(&store);
    }
}
