//! Publication history is canonical state: creation order cannot replace it.
use ielts_db::{
    approve_candidate, create_backup_package, create_prompt_version, create_skill_version,
    ensure_prompt_template, ensure_skill_definition, import_backup, insert_eval_case, migrate,
    open_connection, promote_candidate, propose_candidate, rollback_version, run_eval,
    validate_backup, DbOpenOptions,
};
use ielts_domain::dto::{BackupPackage, BackupSqlValue, BackupTable};
use ielts_domain::{
    ApproveCandidateCommand, CandidateTargetKind, EvalCaseGrading, EvalCaseKind,
    PromoteCandidateCommand, PromptModule, ProposeCandidateCommand, RollbackCommand,
    RunEvalCommand, SkillName,
};
use rusqlite::Connection;
use serde_json::json;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn open_db(path: impl Into<std::path::PathBuf>) -> Connection {
    let mut conn = open_connection(&DbOpenOptions::create(path.into())).unwrap();
    migrate(&mut conn).unwrap();
    conn
}

/// Keep the manifest's table and row counts in step with a fabricated payload.
fn recount(package: &mut BackupPackage) {
    package.manifest.table_count = package.database.len() as u32;
    package.manifest.row_count = package
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + package.secret_refs.len() as u64;
}

fn rechecksum(package: &mut BackupPackage) {
    package.manifest.table_count = package.database.len() as u32;
    package.manifest.row_count = package
        .database
        .iter()
        .map(|t| t.rows.len() as u64)
        .sum::<u64>()
        + package.secret_refs.len() as u64;
    package.manifest.checksum_sha256.clear();
    package.manifest.checksum_sha256 =
        hex::encode(Sha256::digest(serde_json::to_vec(package).unwrap()));
}

fn table_mut<'a>(package: &'a mut BackupPackage, name: &str) -> &'a mut BackupTable {
    package
        .database
        .iter_mut()
        .find(|table| table.name == name)
        .unwrap()
}

fn set_cell(table: &mut BackupTable, row: usize, column: &str, value: BackupSqlValue) {
    let index = table
        .columns
        .iter()
        .position(|name| name == column)
        .unwrap();
    table.rows[row][index] = value;
}

fn text(value: &str) -> BackupSqlValue {
    BackupSqlValue::Text(value.into())
}

fn publish(conn: &Connection, kind: CandidateTargetKind, version: &str, case: &str) {
    let candidate = propose_candidate(
        conn,
        &ProposeCandidateCommand {
            target_kind: kind,
            target_version_id: version.into(),
            proposal: json!({}),
            proposed_by: "backup-test".into(),
        },
    )
    .unwrap();
    run_eval(
        conn,
        &RunEvalCommand {
            candidate_id: candidate.id.clone(),
            results: vec![EvalCaseGrading {
                case_id: case.into(),
                passed: true,
                score: 1.0,
                grading: json!({}),
            }],
        },
    )
    .unwrap();
    approve_candidate(
        conn,
        &ApproveCandidateCommand {
            candidate_id: candidate.id.clone(),
            approved_by: "backup-test".into(),
        },
    )
    .unwrap();
    promote_candidate(
        conn,
        &PromoteCandidateCommand {
            candidate_id: candidate.id,
        },
    )
    .unwrap();
}

fn seed_chain(conn: &Connection, kind: CandidateTargetKind) -> Vec<String> {
    let versions = match kind {
        CandidateTargetKind::Prompt => {
            let parent = ensure_prompt_template(conn, PromptModule::AttemptReview, None).unwrap();
            (1..=3)
                .map(|v| {
                    create_prompt_version(
                        conn,
                        &parent.id,
                        &format!("v{v}"),
                        &json!({}),
                        "backup-test",
                    )
                    .unwrap()
                    .id
                })
                .collect::<Vec<_>>()
        }
        CandidateTargetKind::Skill => {
            let parent =
                ensure_skill_definition(conn, SkillName::ReadAttemptEvidence, None).unwrap();
            (1..=3)
                .map(|v| {
                    create_skill_version(conn, &parent.id, &json!({"version": v}), "backup-test")
                        .unwrap()
                        .id
                })
                .collect::<Vec<_>>()
        }
    };
    let case = insert_eval_case(
        conn,
        EvalCaseKind::ContextSelection,
        &json!({}),
        &json!({}),
        false,
    )
    .unwrap()
    .id;
    // Create v1, v2, v3; actually publish v1, v3, v2.
    for index in [0, 2, 1] {
        publish(conn, kind, &versions[index], &case);
    }
    versions
}

fn rollback(conn: &Connection, kind: CandidateTargetKind, version: &str) -> Option<String> {
    rollback_version(
        conn,
        &RollbackCommand {
            target_kind: kind,
            target_version_id: version.into(),
            rolled_back_by: "backup-test".into(),
        },
    )
    .unwrap()
    .reinstated_version_id
}

fn assert_fk_enabled(conn: &Connection) {
    assert_eq!(
        conn.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
    assert!(stmt.query([]).unwrap().next().unwrap().is_none());
    assert_eq!(
        conn.query_row("PRAGMA defer_foreign_keys", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn out_of_order_publications_survive_backup_restore_and_all_rollbacks() {
    let dir = tempdir().unwrap();
    let source = open_db(dir.path().join("source.db"));
    let prompt = seed_chain(&source, CandidateTargetKind::Prompt);
    let skill = seed_chain(&source, CandidateTargetKind::Skill);
    let package = create_backup_package(&source, "release-history").unwrap();
    assert_eq!(package.manifest.schema_version, 18);
    assert_eq!(
        package
            .database
            .iter()
            .find(|t| t.name == "prompt_skill_releases")
            .unwrap()
            .rows
            .len(),
        6
    );
    let mut shuffled = package.clone();
    // Force each successor before its predecessor, independently of random UUIDs.
    let rows = source
        .prepare(
            "WITH RECURSIVE chain(id, depth) AS (
           SELECT id, 0 FROM prompt_skill_releases WHERE predecessor_release_id IS NULL
           UNION ALL SELECT r.id, c.depth + 1 FROM prompt_skill_releases r
           JOIN chain c ON r.predecessor_release_id = c.id
         ) SELECT id FROM chain ORDER BY depth DESC, id",
        )
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let releases = table_mut(&mut shuffled, "prompt_skill_releases");
    let id_column = releases.columns.iter().position(|c| c == "id").unwrap();
    releases.rows.sort_by_key(|row| {
        rows.iter()
            .position(|id| row[id_column] == text(id))
            .unwrap()
    });
    shuffled.database.reverse();
    rechecksum(&mut shuffled);
    let target = open_db(dir.path().join("target.db"));
    seed_chain(&target, CandidateTargetKind::Prompt);
    seed_chain(&target, CandidateTargetKind::Skill);
    // Triggers verify actual order even though the general restore defers FKs.
    target
        .execute_batch(
            "CREATE TRIGGER check_release_order BEFORE INSERT ON prompt_skill_releases
         WHEN NEW.predecessor_release_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM prompt_skill_releases WHERE id = NEW.predecessor_release_id)
         BEGIN SELECT RAISE(ABORT, 'predecessor must be inserted first'); END;
         CREATE TRIGGER check_release_delete_order BEFORE DELETE ON prompt_skill_releases
         WHEN EXISTS (SELECT 1 FROM prompt_skill_releases WHERE predecessor_release_id = OLD.id)
         BEGIN SELECT RAISE(ABORT, 'successor must be deleted first'); END;
         CREATE TRIGGER check_release_fks BEFORE INSERT ON prompt_skill_releases
         WHEN (SELECT foreign_keys FROM pragma_foreign_keys) != 1
         BEGIN SELECT RAISE(ABORT, 'foreign keys must stay enabled'); END;
         CREATE TRIGGER check_head_order BEFORE INSERT ON prompt_skill_release_heads
         WHEN NOT EXISTS (SELECT 1 FROM prompt_skill_releases WHERE id = NEW.release_id)
         BEGIN SELECT RAISE(ABORT, 'release must precede head'); END;",
        )
        .unwrap();
    let before = create_backup_package(&target, "before").unwrap().database;
    let dry = import_backup(&target, &shuffled, true).unwrap();
    assert!(dry.ok, "{:?}", dry.errors);
    assert_eq!(
        before,
        create_backup_package(&target, "after-dry")
            .unwrap()
            .database
    );
    assert_fk_enabled(&target);
    for _ in 0..2 {
        let report = import_backup(&target, &shuffled, false).unwrap();
        assert!(report.ok, "{:?}", report.errors);
        assert_eq!(report.rows_imported, shuffled.manifest.row_count);
        assert_eq!(
            package.database,
            create_backup_package(&target, "restored").unwrap().database
        );
        assert_fk_enabled(&target);
    }
    for (kind, versions, table) in [
        (CandidateTargetKind::Prompt, prompt, "prompt_versions"),
        (CandidateTargetKind::Skill, skill, "skill_versions"),
    ] {
        for (from, to) in [(1, 2), (2, 0)] {
            assert_eq!(
                rollback(&target, kind, &versions[from]),
                Some(versions[to].clone())
            );
            assert_eq!(
                target
                    .query_row(
                        &format!("SELECT id FROM {table} WHERE status = 'active'"),
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap(),
                versions[to]
            );
        }
        assert_eq!(rollback(&target, kind, &versions[0]), None);
    }
    assert_eq!(
        target
            .query_row("SELECT COUNT(*) FROM prompt_skill_release_heads", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        target
            .query_row("SELECT COUNT(*) FROM prompt_skill_releases", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        6
    );
    assert_fk_enabled(&target);
}

#[test]
fn legacy_v16_restore_clears_release_history_without_guessing_predecessors() {
    let dir = tempdir().unwrap();
    let source = open_db(dir.path().join("source.db"));
    // Actual pre-0025 database and old exporter payload, not a v17 package
    // merely relabelled v16 with extra empty tables left inside it.
    source
        .execute_batch(
            "DROP TABLE prompt_skill_release_heads; DROP TABLE prompt_skill_releases;
         ALTER TABLE attempts DROP COLUMN submitted_asset_fingerprint;
         ALTER TABLE coach_threads DROP COLUMN learner_profile_json;
         DELETE FROM schema_migrations WHERE version >= 25;",
        )
        .unwrap();
    let parent = ensure_prompt_template(&source, PromptModule::AttemptReview, None).unwrap();
    let prior = create_prompt_version(&source, &parent.id, "prior", &json!({}), "legacy").unwrap();
    let live = create_prompt_version(&source, &parent.id, "live", &json!({}), "legacy").unwrap();
    source
        .execute(
            "UPDATE prompt_versions SET status = 'rollback' WHERE id = ?1",
            [&prior.id],
        )
        .unwrap();
    source
        .execute(
            "UPDATE prompt_versions SET status = 'active' WHERE id = ?1",
            [&live.id],
        )
        .unwrap();
    // Migrate only to enable the current exporter, then discard exactly the
    // two tables absent from the original v16 exporter.
    let mut source = source;
    migrate(&mut source).unwrap();
    let mut package = create_backup_package(&source, "v16").unwrap();
    package.manifest.schema_version = 16;
    package.manifest.database_schema_version = 24;
    package
        .database
        .retain(|t| t.name != "prompt_skill_releases" && t.name != "prompt_skill_release_heads");
    package.database.retain(|t| t.name != "weekly_digests");
    package.attempts = ielts_db::format17_attempt_summaries(&source).unwrap();
    recount(&mut package);
    rechecksum(&mut package);
    validate_backup(&package).unwrap();
    let target = open_db(dir.path().join("target.db"));
    seed_chain(&target, CandidateTargetKind::Prompt);
    let before = create_backup_package(&target, "before").unwrap().database;
    assert!(import_backup(&target, &package, true).unwrap().ok);
    assert_eq!(
        before,
        create_backup_package(&target, "after-dry")
            .unwrap()
            .database
    );
    let report = import_backup(&target, &package, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    for table in ["prompt_skill_releases", "prompt_skill_release_heads"] {
        assert_eq!(
            target
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    let restored = create_backup_package(&target, "after").unwrap();
    assert_eq!(
        package.database,
        restored
            .database
            .into_iter()
            .filter(|t| {
                !matches!(
                    t.name.as_str(),
                    "prompt_skill_releases" | "prompt_skill_release_heads" | "weekly_digests"
                )
            })
            .collect::<Vec<_>>()
    );
    let error = rollback_version(
        &target,
        &RollbackCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: live.id.clone(),
            rolled_back_by: "test".into(),
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("predecessor record missing"));
    assert_eq!(
        target
            .query_row(
                "SELECT status FROM prompt_versions WHERE id = ?1",
                [&live.id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "active"
    );
    assert_fk_enabled(&target);
}

#[test]
fn every_snapshot_schema_before_release_history_remains_restorable() {
    let dir = tempdir().unwrap();
    let source = open_db(dir.path().join("source.db"));
    let current = create_backup_package(&source, "compatibility").unwrap();
    let summaries = ielts_db::format17_attempt_summaries(&source).unwrap();
    let target = open_db(dir.path().join("target.db"));
    // Freeze the introduction boundary independently from the implementation's
    // table lists. v9 and v10 have the same snapshot shape.
    for schema in 2..=16 {
        let mut package = current.clone();
        package.manifest.schema_version = schema;
        package.database.retain(|table| {
            let introduced = match table.name.as_str() {
                "writing_topics" => 3,
                "history_retention_policy" => 4,
                "writing_prompts" => 5,
                "reading_timer_states" => 6,
                "agent_runs" | "agent_tool_calls" => 7,
                "learning_events" => 8,
                "explicit_user_preferences"
                | "memory_items"
                | "memory_candidate_batches"
                | "memory_candidates"
                | "memory_evidence"
                | "memory_mutations"
                | "coach_feedback"
                | "coach_reask_links"
                | "coach_strategy_assignments_v0"
                | "coach_outcome_links_v0" => 9,
                "daily_journals"
                | "daily_journal_sources"
                | "background_jobs"
                | "dream_runs"
                | "dream_candidates" => 11,
                "memory_relations" | "memory_feedback" | "memory_capacity_state" => 12,
                "teaching_strategy_catalog"
                | "teaching_strategy_assignments"
                | "teaching_strategy_feedback"
                | "teaching_strategy_outcomes"
                | "user_strategy_state"
                | "strategy_candidate_batches" => 13,
                "prompt_templates"
                | "prompt_versions"
                | "skill_definitions"
                | "skill_versions"
                | "eval_cases"
                | "candidate_promotions"
                | "eval_runs"
                | "eval_results"
                | "shadow_runs" => 14,
                "agent_threads"
                | "agent_messages"
                | "agent_checkpoints"
                | "study_plans"
                | "study_plan_items"
                | "agent_action_approvals" => 15,
                "strategy_candidate_evaluations" => 16,
                "prompt_skill_releases" | "prompt_skill_release_heads" => 17,
                "weekly_digests" => 18,
                _ => 2,
            };
            schema >= introduced
        });
        if schema < 18 {
            package.attempts = summaries.clone();
        }
        recount(&mut package);
        rechecksum(&mut package);
        validate_backup(&package).unwrap_or_else(|error| panic!("v{schema}: {error}"));
        for dry_run in [true, false] {
            let report = import_backup(&target, &package, dry_run).unwrap();
            assert!(report.ok, "v{schema}, dry={dry_run}: {:?}", report.errors);
            assert_fk_enabled(&target);
        }
    }
}

#[test]
fn invalid_release_packages_fail_atomically_in_dry_and_real_restore() {
    let dir = tempdir().unwrap();
    let source = open_db(dir.path().join("source.db"));
    seed_chain(&source, CandidateTargetKind::Prompt);
    let original = create_backup_package(&source, "constraints").unwrap();
    let target = open_db(dir.path().join("target.db"));
    seed_chain(&target, CandidateTargetKind::Skill);
    let before = create_backup_package(&target, "before").unwrap().database;
    for corruption in [
        "missing_predecessor",
        "missing_candidate",
        "missing_head",
        "head_parent",
        "kind_check",
        "same_version_check",
        "predecessor_check",
        "duplicate_head",
        "cycle",
        "missing_table",
    ] {
        let mut package = original.clone();
        match corruption {
            "missing_predecessor" => set_cell(
                table_mut(&mut package, "prompt_skill_releases"),
                0,
                "predecessor_release_id",
                text("missing"),
            ),
            "missing_candidate" => set_cell(
                table_mut(&mut package, "prompt_skill_releases"),
                0,
                "candidate_id",
                text("missing"),
            ),
            "missing_head" => set_cell(
                table_mut(&mut package, "prompt_skill_release_heads"),
                0,
                "release_id",
                text("missing"),
            ),
            "head_parent" => set_cell(
                table_mut(&mut package, "prompt_skill_release_heads"),
                0,
                "parent_id",
                text("other-parent"),
            ),
            "kind_check" => set_cell(
                table_mut(&mut package, "prompt_skill_releases"),
                0,
                "target_kind",
                text("invalid-kind"),
            ),
            "same_version_check" => {
                let t = table_mut(&mut package, "prompt_skill_releases");
                let index = t.columns.iter().position(|c| c == "version_id").unwrap();
                let version = t.rows[0][index].clone();
                set_cell(t, 0, "predecessor_version_id", version);
            }
            "predecessor_check" => {
                let t = table_mut(&mut package, "prompt_skill_releases");
                let index = t
                    .columns
                    .iter()
                    .position(|c| c == "predecessor_release_id")
                    .unwrap();
                let row = t
                    .rows
                    .iter()
                    .position(|r| r[index] != BackupSqlValue::Null)
                    .unwrap();
                set_cell(t, row, "predecessor_version_id", BackupSqlValue::Null);
            }
            "duplicate_head" => {
                let t = table_mut(&mut package, "prompt_skill_release_heads");
                t.rows.push(t.rows[0].clone());
            }
            "cycle" => {
                let t = table_mut(&mut package, "prompt_skill_releases");
                let id_index = t.columns.iter().position(|c| c == "id").unwrap();
                let id = t.rows[0][id_index].clone();
                set_cell(t, 0, "predecessor_release_id", id);
            }
            "missing_table" => package
                .database
                .retain(|t| t.name != "prompt_skill_releases"),
            _ => unreachable!(),
        }
        rechecksum(&mut package);
        for dry in [true, false] {
            let report = import_backup(&target, &package, dry).unwrap();
            assert!(!report.ok, "{corruption}, dry={dry}");
            assert!(!report.errors.is_empty());
            assert_eq!(
                before,
                create_backup_package(&target, "after").unwrap().database,
                "{corruption}, dry={dry}"
            );
            assert_fk_enabled(&target);
        }
    }
}
