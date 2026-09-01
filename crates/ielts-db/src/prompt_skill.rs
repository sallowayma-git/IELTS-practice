//! M11 Prompt/Skill Evolution persistence.
//!
//! Rust is the release gate (M11-05): the LLM may only PROPOSE candidates;
//! promotion is gated on a passing eval run and manual approval. The online
//! Agent never edits its own Soul (M11-01); the versioned registry is an
//! overlay over the existing hardcoded prompt constants - when no active
//! registry version exists, callers fall back to the compiled-in constant.
//!
//! M11-05 invariants enforced here:
//! - a candidate cannot skip eval (promotion requires eval_passed)
//! - a candidate cannot skip approval (promotion requires approved)
//! - only one version per template/definition may be active at a time
//! - rollback is exact (prior version reinstated as active)
//! - holdout cases are never exposed via the prompt-generation read path
//! - shadow runs assert no_user_visible_side_effect = TRUE

use ielts_domain::{
    ApproveCandidateCommand, CandidateDecision, CandidatePromotion, CandidateStatus,
    CandidateTargetKind, EvalCase, EvalCaseKind, EvalResult, EvalRun, EvalRunOutcome,
    EvalRunStatus, PromptModule, PromptTemplate, PromptVersion, PromoteCandidateCommand,
    ProposeCandidateCommand, RollbackCommand, RollbackOutcome, RunEvalCommand,
    SkillDefinition, SkillName, SkillVersion, VersionStatus,
};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::sqlite::{DbError, DbResult};

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        return Err(DbError::Validation(format!("{field} is required")));
    }
    Ok(())
}

fn require_value(value: &serde_json::Value, field: &str) -> DbResult<()> {
    if value.is_null() {
        return Err(DbError::Validation(format!("{field} is required")));
    }
    Ok(())
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

// === Template ===

/// M11-02: ensure a prompt template row exists for the given module. The
/// template is the parent of version rows; one template per module.
pub fn ensure_prompt_template(
    conn: &Connection,
    module: PromptModule,
    description: Option<&str>,
) -> DbResult<PromptTemplate> {
    let module_str = module.as_str();
    let existing = conn
        .query_row(
            "SELECT id, module_name, description, created_at FROM prompt_templates
             WHERE module_name = ?1",
            params![module_str],
            |row| {
                Ok(PromptTemplate {
                    id: row.get(0)?,
                    module_name: module,
                    description: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .optional()?;
    if let Some(template) = existing {
        return Ok(template);
    }
    let id = format!("pt-{}", Uuid::new_v4());
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO prompt_templates (id, module_name, description, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, module_str, description, now],
    )?;
    Ok(PromptTemplate {
        id,
        module_name: module,
        description: description.map(str::to_owned),
        created_at: now,
    })
}

/// M11-02: load a prompt template by module.
pub fn load_prompt_template(
    conn: &Connection,
    module: PromptModule,
) -> DbResult<Option<PromptTemplate>> {
    conn.query_row(
        "SELECT id, module_name, description, created_at FROM prompt_templates
         WHERE module_name = ?1",
        params![module.as_str()],
        |row| {
            Ok(PromptTemplate {
                id: row.get(0)?,
                module_name: module,
                description: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

// === Prompt Version ===

/// M11-05: create a prompt version. The version number is auto-incremented
/// per template. The content hash is computed from content_text. New
/// versions start at draft.
pub fn create_prompt_version(
    conn: &Connection,
    template_id: &str,
    content_text: &str,
    prompt_metadata: &serde_json::Value,
    created_by: &str,
) -> DbResult<PromptVersion> {
    require_text(template_id, "template_id")?;
    require_text(content_text, "content_text")?;
    require_text(created_by, "created_by")?;
    let module_str: String = conn
        .query_row(
            "SELECT module_name FROM prompt_templates WHERE id = ?1",
            params![template_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            DbError::Validation(format!("prompt template not found: {template_id}"))
        })?;
    let module = PromptModule::parse(&module_str)
        .ok_or_else(|| DbError::Validation(format!("unknown prompt module: {module_str}")))?;
    let next_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM prompt_versions WHERE template_id = ?1",
            params![template_id],
            |row| row.get(0),
        )
        .unwrap_or(1);
    let id = format!("pv-{}", Uuid::new_v4());
    let now = now_rfc3339();
    let hash = content_hash(content_text);
    let metadata_text = serde_json::to_string(prompt_metadata)
        .map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO prompt_versions
           (id, template_id, version, content_hash, content_text,
            prompt_metadata_json, status, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8)",
        params![id, template_id, next_version, hash, content_text, metadata_text, created_by, now],
    )?;
    Ok(PromptVersion {
        id,
        template_id: template_id.to_owned(),
        module_name: module,
        version: next_version,
        content_hash: hash,
        content_text: content_text.to_owned(),
        prompt_metadata: prompt_metadata.clone(),
        status: VersionStatus::Draft,
        created_by: created_by.to_owned(),
        created_at: now,
    })
}

/// M11-05: list prompt versions for a module, ordered by version desc.
pub fn list_prompt_versions(
    conn: &Connection,
    module: PromptModule,
) -> DbResult<Vec<PromptVersion>> {
    let mut stmt = conn.prepare(
        "SELECT pv.id, pv.template_id, pt.module_name, pv.version, pv.content_hash,
                pv.content_text, pv.prompt_metadata_json, pv.status, pv.created_by,
                pv.created_at
         FROM prompt_versions pv
         JOIN prompt_templates pt ON pt.id = pv.template_id
         WHERE pt.module_name = ?1
         ORDER BY pv.version DESC",
    )?;
    let rows = stmt.query_map(params![module.as_str()], |row| {
        let module_str: String = row.get(2)?;
        let module = PromptModule::parse(&module_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                format!("unknown prompt module: {module_str}").into(),
            )
        })?;
        let status_str: String = row.get(7)?;
        let status = VersionStatus::parse(&status_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                format!("unknown version status: {status_str}").into(),
            )
        })?;
        let metadata_text: String = row.get(6)?;
        let metadata: serde_json::Value =
            serde_json::from_str(&metadata_text).unwrap_or(serde_json::Value::Null);
        Ok(PromptVersion {
            id: row.get(0)?,
            template_id: row.get(1)?,
            module_name: module,
            version: row.get(3)?,
            content_hash: row.get(4)?,
            content_text: row.get(5)?,
            prompt_metadata: metadata,
            status,
            created_by: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// M11-05: get the active prompt version for a module. Returns None when no
/// registry version is active (callers fall back to the compiled-in const).
/// M11-05: holdout cases never enter this path - this read only returns
/// active versions, never holdout eval cases.
pub fn get_active_prompt_version(
    conn: &Connection,
    module: PromptModule,
) -> DbResult<Option<PromptVersion>> {
    let mut stmt = conn.prepare(
        "SELECT pv.id, pv.template_id, pt.module_name, pv.version, pv.content_hash,
                pv.content_text, pv.prompt_metadata_json, pv.status, pv.created_by,
                pv.created_at
         FROM prompt_versions pv
         JOIN prompt_templates pt ON pt.id = pv.template_id
         WHERE pt.module_name = ?1 AND pv.status = 'active'
         ORDER BY pv.version DESC LIMIT 1",
    )?;
    let mut rows = stmt.query_map(params![module.as_str()], |row| {
        let module_str: String = row.get(2)?;
        let module = PromptModule::parse(&module_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                format!("unknown prompt module: {module_str}").into(),
            )
        })?;
        let metadata_text: String = row.get(6)?;
        let metadata: serde_json::Value =
            serde_json::from_str(&metadata_text).unwrap_or(serde_json::Value::Null);
        Ok(PromptVersion {
            id: row.get(0)?,
            template_id: row.get(1)?,
            module_name: module,
            version: row.get(3)?,
            content_hash: row.get(4)?,
            content_text: row.get(5)?,
            prompt_metadata: metadata,
            status: VersionStatus::Active,
            created_by: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    if let Some(row) = rows.next() {
        Ok(Some(row?))
    } else {
        Ok(None)
    }
}

// === Skill ===

/// M11-03: ensure a skill definition row exists for the given skill name.
pub fn ensure_skill_definition(
    conn: &Connection,
    skill_name: SkillName,
    description: Option<&str>,
) -> DbResult<SkillDefinition> {
    let name_str = skill_name.as_str();
    let existing = conn
        .query_row(
            "SELECT id, skill_name, description, created_at FROM skill_definitions
             WHERE skill_name = ?1",
            params![name_str],
            |row| {
                Ok(SkillDefinition {
                    id: row.get(0)?,
                    skill_name,
                    description: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .optional()?;
    if let Some(def) = existing {
        return Ok(def);
    }
    let id = format!("sd-{}", Uuid::new_v4());
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO skill_definitions (id, skill_name, description, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, name_str, description, now],
    )?;
    Ok(SkillDefinition {
        id,
        skill_name,
        description: description.map(str::to_owned),
        created_at: now,
    })
}

/// M11-05: create a skill version. Auto-incremented per definition.
pub fn create_skill_version(
    conn: &Connection,
    skill_definition_id: &str,
    definition: &serde_json::Value,
    created_by: &str,
) -> DbResult<SkillVersion> {
    require_text(skill_definition_id, "skill_definition_id")?;
    require_text(created_by, "created_by")?;
    require_value(definition, "definition")?;
    let name_str: String = conn
        .query_row(
            "SELECT skill_name FROM skill_definitions WHERE id = ?1",
            params![skill_definition_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            DbError::Validation(format!("skill definition not found: {skill_definition_id}"))
        })?;
    let skill_name = SkillName::parse(&name_str)
        .ok_or_else(|| DbError::Validation(format!("unknown skill name: {name_str}")))?;
    let next_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM skill_versions WHERE skill_definition_id = ?1",
            params![skill_definition_id],
            |row| row.get(0),
        )
        .unwrap_or(1);
    let id = format!("sv-{}", Uuid::new_v4());
    let now = now_rfc3339();
    let def_text = serde_json::to_string(definition)
        .map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO skill_versions
           (id, skill_definition_id, version, definition_json, status, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6)",
        params![id, skill_definition_id, next_version, def_text, created_by, now],
    )?;
    Ok(SkillVersion {
        id,
        skill_definition_id: skill_definition_id.to_owned(),
        skill_name,
        version: next_version,
        definition: definition.clone(),
        status: VersionStatus::Draft,
        created_by: created_by.to_owned(),
        created_at: now,
    })
}

/// M11-05: list skill versions, ordered by version desc.
pub fn list_skill_versions(
    conn: &Connection,
    skill_name: SkillName,
) -> DbResult<Vec<SkillVersion>> {
    let mut stmt = conn.prepare(
        "SELECT sv.id, sv.skill_definition_id, sd.skill_name, sv.version,
                sv.definition_json, sv.status, sv.created_by, sv.created_at
         FROM skill_versions sv
         JOIN skill_definitions sd ON sd.id = sv.skill_definition_id
         WHERE sd.skill_name = ?1
         ORDER BY sv.version DESC",
    )?;
    let rows = stmt.query_map(params![skill_name.as_str()], |row| {
        let name_str: String = row.get(2)?;
        let skill_name = SkillName::parse(&name_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                format!("unknown skill name: {name_str}").into(),
            )
        })?;
        let status_str: String = row.get(5)?;
        let status = VersionStatus::parse(&status_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                format!("unknown version status: {status_str}").into(),
            )
        })?;
        let def_text: String = row.get(4)?;
        let definition: serde_json::Value =
            serde_json::from_str(&def_text).unwrap_or(serde_json::Value::Null);
        Ok(SkillVersion {
            id: row.get(0)?,
            skill_definition_id: row.get(1)?,
            skill_name,
            version: row.get(3)?,
            definition,
            status,
            created_by: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// === Eval Case ===

/// M11-04: insert an eval case. Holdout cases (holdout=true) never enter
/// prompt generation context.
pub fn insert_eval_case(
    conn: &Connection,
    case_kind: EvalCaseKind,
    input: &serde_json::Value,
    expected: &serde_json::Value,
    holdout: bool,
) -> DbResult<EvalCase> {
    require_value(input, "input")?;
    require_value(expected, "expected")?;
    let id = format!("ec-{}", Uuid::new_v4());
    let input_text = serde_json::to_string(input)
        .map_err(|error| DbError::Message(error.to_string()))?;
    let expected_text = serde_json::to_string(expected)
        .map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO eval_cases (id, case_kind, input_json, expected_json, holdout)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, case_kind.as_str(), input_text, expected_text, holdout as i64],
    )?;
    Ok(EvalCase {
        id,
        case_kind,
        input: input.clone(),
        expected: expected.clone(),
        holdout,
    })
}

/// M11-04: list eval cases. When `include_holdout` is false, holdout cases
/// are excluded - this is the prompt-generation read path (M11-05: holdout
/// never enters prompt generation context).
pub fn list_eval_cases(
    conn: &Connection,
    include_holdout: bool,
) -> DbResult<Vec<EvalCase>> {
    let mut stmt = if include_holdout {
        conn.prepare(
            "SELECT id, case_kind, input_json, expected_json, holdout
             FROM eval_cases ORDER BY id",
        )?
    } else {
        conn.prepare(
            "SELECT id, case_kind, input_json, expected_json, holdout
             FROM eval_cases WHERE holdout = 0 ORDER BY id",
        )?
    };
    let rows = stmt.query_map([], |row| {
        let kind_str: String = row.get(1)?;
        let case_kind = EvalCaseKind::parse(&kind_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Text,
                format!("unknown eval case kind: {kind_str}").into(),
            )
        })?;
        let input_text: String = row.get(2)?;
        let expected_text: String = row.get(3)?;
        let input: serde_json::Value =
            serde_json::from_str(&input_text).unwrap_or(serde_json::Value::Null);
        let expected: serde_json::Value =
            serde_json::from_str(&expected_text).unwrap_or(serde_json::Value::Null);
        let holdout_val: i64 = row.get(4)?;
        Ok(EvalCase {
            id: row.get(0)?,
            case_kind,
            input,
            expected,
            holdout: holdout_val != 0,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// === Candidate Lifecycle ===

/// M11-05: propose a candidate. Creates a candidate_promotions row at
/// status=proposed. The target version must exist in draft/eval status.
pub fn propose_candidate(
    conn: &Connection,
    command: &ProposeCandidateCommand,
) -> DbResult<CandidatePromotion> {
    require_text(&command.target_version_id, "target_version_id")?;
    require_text(&command.proposed_by, "proposed_by")?;
    require_value(&command.proposal, "proposal")?;
    // Verify the target version exists and is not already active/rollback.
    verify_candidate_target(conn, command.target_kind, &command.target_version_id)?;
    let id = format!("cp-{}", Uuid::new_v4());
    let now = now_rfc3339();
    let proposal_text = serde_json::to_string(&command.proposal)
        .map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO candidate_promotions
           (id, target_kind, target_version_id, proposal_json, status,
            proposed_by, approved_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'proposed', ?5, NULL, ?6, ?6)",
        params![
            id,
            command.target_kind.as_str(),
            command.target_version_id,
            proposal_text,
            command.proposed_by,
            now
        ],
    )?;
    Ok(CandidatePromotion {
        id,
        target_kind: command.target_kind,
        target_version_id: command.target_version_id.clone(),
        proposal: command.proposal.clone(),
        status: CandidateStatus::Proposed,
        proposed_by: command.proposed_by.clone(),
        approved_by: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

fn verify_candidate_target(
    conn: &Connection,
    target_kind: CandidateTargetKind,
    target_version_id: &str,
) -> DbResult<()> {
    let (table, id_col) = match target_kind {
        CandidateTargetKind::Prompt => ("prompt_versions", "id"),
        CandidateTargetKind::Skill => ("skill_versions", "id"),
    };
    let sql = format!(
        "SELECT status FROM {table} WHERE {id_col} = ?1"
    );
    let status_str: String = conn
        .query_row(&sql, params![target_version_id], |row| row.get(0))
        .map_err(|_| {
            DbError::Validation(format!(
                "{target_kind:?} version not found: {target_version_id}"
            ))
        })?;
    let status = VersionStatus::parse(&status_str)
        .ok_or_else(|| DbError::Validation(format!("unknown version status: {status_str}")))?;
    match status {
        VersionStatus::Draft | VersionStatus::Eval | VersionStatus::Holdout | VersionStatus::Shadow => Ok(()),
        VersionStatus::Active => Err(DbError::Validation(
            "target version is already active; cannot propose".into(),
        )),
        VersionStatus::Canary => Ok(()),
        VersionStatus::Rollback => Err(DbError::Validation(
            "target version is rolled back; cannot propose".into(),
        )),
    }
}

fn load_candidate(conn: &Connection, candidate_id: &str) -> DbResult<CandidatePromotion> {
    require_text(candidate_id, "candidate_id")?;
    conn.query_row(
        "SELECT id, target_kind, target_version_id, proposal_json, status,
                proposed_by, approved_by, created_at, updated_at
         FROM candidate_promotions WHERE id = ?1",
        params![candidate_id],
        |row| {
            let kind_str: String = row.get(1)?;
            let target_kind = CandidateTargetKind::parse(&kind_str).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Text,
                    format!("unknown candidate target kind: {kind_str}").into(),
                )
            })?;
            let status_str: String = row.get(4)?;
            let status = CandidateStatus::parse(&status_str).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    format!("unknown candidate status: {status_str}").into(),
                )
            })?;
            let proposal_text: String = row.get(3)?;
            let proposal: serde_json::Value =
                serde_json::from_str(&proposal_text).unwrap_or(serde_json::Value::Null);
            Ok(CandidatePromotion {
                id: row.get(0)?,
                target_kind,
                target_version_id: row.get(2)?,
                proposal,
                status,
                proposed_by: row.get(5)?,
                approved_by: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(Into::into)
}

// === Eval Run ===

/// M11-05: run the offline eval for a candidate. Records an eval run + per-
/// case results. The candidate advances to eval_passed only when all cases
/// pass. A failing case leaves the candidate at proposed.
///
/// M11-05: holdout cases ARE included here (they are the held-out evaluation
/// set that scores candidate versions) - they just never enter the
/// prompt-generation read path (`get_active_prompt_version`).
pub fn run_eval(
    conn: &Connection,
    command: &RunEvalCommand,
) -> DbResult<EvalRunOutcome> {
    require_text(&command.candidate_id, "candidate_id")?;
    let candidate = load_candidate(conn, &command.candidate_id)?;
    // Only a proposed candidate (or one already eval_passed that is being
    // re-evaluated) may be evaluated.
    match candidate.status {
        CandidateStatus::Proposed | CandidateStatus::EvalPassed => {}
        other => {
            return Err(DbError::Validation(format!(
                "candidate cannot be evaluated in status: {}",
                other.as_str()
            )));
        }
    }
    if command.results.is_empty() {
        return Err(DbError::Validation("eval requires at least one case".into()));
    }
    let run_id = format!("er-{}", Uuid::new_v4());
    let now = now_rfc3339();
    // Verify each case exists.
    for grading in &command.results {
        require_text(&grading.case_id, "case_id")?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM eval_cases WHERE id = ?1",
            params![grading.case_id],
            |row| row.get(0),
        )?;
        if count != 1 {
            return Err(DbError::Validation(format!(
                "eval case not found: {}",
                grading.case_id
            )));
        }
    }
    let all_passed = command.results.iter().all(|g| g.passed);
    let metrics = serde_json::json!({
        "caseCount": command.results.len(),
        "passed": command.results.iter().filter(|g| g.passed).count(),
        "allPassed": all_passed,
    });
    let metrics_text = serde_json::to_string(&metrics)
        .map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO eval_runs
           (id, candidate_promotion_id, status, metrics_json, started_at,
            finished_at, error_json, created_at)
         VALUES (?1, ?2, 'completed', ?3, ?4, ?4, NULL, ?4)",
        params![run_id, candidate.id, metrics_text, now],
    )?;
    let mut results = Vec::with_capacity(command.results.len());
    for grading in &command.results {
        let result_id = format!("erl-{}", Uuid::new_v4());
        let grading_text = serde_json::to_string(&grading.grading)
            .map_err(|error| DbError::Message(error.to_string()))?;
        conn.execute(
            "INSERT INTO eval_results
               (id, eval_run_id, case_id, passed, score, grading_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                result_id,
                run_id,
                grading.case_id,
                grading.passed as i64,
                grading.score,
                grading_text
            ],
        )?;
        results.push(EvalResult {
            id: result_id,
            eval_run_id: run_id.clone(),
            case_id: grading.case_id.clone(),
            passed: grading.passed,
            score: grading.score,
            grading: grading.grading.clone(),
        });
    }
    let candidate_advanced = all_passed;
    if all_passed {
        conn.execute(
            "UPDATE candidate_promotions SET status = 'eval_passed', updated_at = ?2
             WHERE id = ?1",
            params![candidate.id, now],
        )?;
    }
    Ok(EvalRunOutcome {
        run: EvalRun {
            id: run_id,
            candidate_promotion_id: candidate.id.clone(),
            status: EvalRunStatus::Completed,
            metrics: Some(metrics),
            started_at: Some(now.clone()),
            finished_at: Some(now.clone()),
            error: None,
            created_at: now,
        },
        results,
        candidate_advanced,
    })
}

/// M11-05: approve a candidate (manual gate). Requires eval_passed status.
pub fn approve_candidate(
    conn: &Connection,
    command: &ApproveCandidateCommand,
) -> DbResult<CandidatePromotion> {
    require_text(&command.candidate_id, "candidate_id")?;
    require_text(&command.approved_by, "approved_by")?;
    let candidate = load_candidate(conn, &command.candidate_id)?;
    if candidate.status != CandidateStatus::EvalPassed {
        return Err(DbError::Validation(format!(
            "candidate cannot be approved in status: {}; requires eval_passed",
            candidate.status.as_str()
        )));
    }
    let now = now_rfc3339();
    conn.execute(
        "UPDATE candidate_promotions SET status = 'approved', approved_by = ?2,
            updated_at = ?3 WHERE id = ?1",
        params![candidate.id, command.approved_by, now],
    )?;
    Ok(CandidatePromotion {
        status: CandidateStatus::Approved,
        approved_by: Some(command.approved_by.clone()),
        updated_at: now,
        ..candidate
    })
}

// === Promote / Rollback ===

/// M11-05: promote a candidate. Requires approved status. Sets the candidate
/// to promoted and the underlying version to active. The previously active
/// version for the same template/definition is marked rollback (exact
/// rollback lineage). Only one version per template/definition may be active.
pub fn promote_candidate(
    conn: &Connection,
    command: &PromoteCandidateCommand,
) -> DbResult<CandidateDecision> {
    require_text(&command.candidate_id, "candidate_id")?;
    let candidate = load_candidate(conn, &command.candidate_id)?;
    if candidate.status != CandidateStatus::Approved {
        return Err(DbError::Validation(format!(
            "candidate cannot be promoted in status: {}; requires approved",
            candidate.status.as_str()
        )));
    }
    let tx = conn.unchecked_transaction()?;
    // Find the template/definition id for the target version.
    let (id_col, version_table) = match candidate.target_kind {
        CandidateTargetKind::Prompt => ("template_id", "prompt_versions"),
        CandidateTargetKind::Skill => ("skill_definition_id", "skill_versions"),
    };
    let parent_id: String = tx.query_row(
        &format!("SELECT {id_col} FROM {version_table} WHERE id = ?1"),
        params![candidate.target_version_id],
        |row| row.get(0),
    )?;
    // Mark any currently-active version for this parent as rollback.
    tx.execute(
        &format!(
            "UPDATE {version_table} SET status = 'rollback'
             WHERE {id_col} = ?1 AND status = 'active'"
        ),
        params![parent_id],
    )?;
    // Promote the target version to active.
    tx.execute(
        &format!(
            "UPDATE {version_table} SET status = 'active' WHERE id = ?1"
        ),
        params![candidate.target_version_id],
    )?;
    let now = now_rfc3339();
    tx.execute(
        "UPDATE candidate_promotions SET status = 'promoted', updated_at = ?2
         WHERE id = ?1",
        params![candidate.id, now],
    )?;
    tx.commit()?;
    Ok(CandidateDecision {
        candidate_id: candidate.id,
        status: CandidateStatus::Promoted,
    })
}

/// M11-05: exact rollback. Marks the currently active version rollback and
/// reinstates the most recent PREVIOUSLY-ACTIVE version as active. Returns the
/// reinstated version id, or None when there is no prior active version to
/// reinstate (the active version is simply rolled back to the const fallback).
///
/// Round-3 audit (A2): this used to pick the reinstatement target with
/// `ORDER BY version DESC LIMIT 1` and NO status filter, which made rollback a
/// privilege-escalation path rather than a reversal:
///
/// - `create_prompt_version` assigns `MAX(version) + 1` and status `draft`.
/// - So the newest version for a template is typically an unevaluated draft.
/// - Rollback would select that draft and set it `active`.
///
/// A draft that never ran an eval and was never approved could therefore become
/// the live prompt, bypassing the entire `propose -> eval -> holdout -> shadow ->
/// approve -> promote` gate that `promote_candidate` enforces. The old doc
/// comment described the target as "the most recent non-rollback, non-active
/// version", which is both what the code did not do and the wrong rule anyway:
/// `rollback` status is precisely the marker `promote_candidate` leaves on a
/// version it superseded, so `rollback` rows are the ONLY valid reinstatement
/// targets.
///
/// The gate is now:
///
/// 1. `rolled_back_by` is required, so the activation is attributable — the
///    same standard `approve_candidate` holds for `approved_by`.
/// 2. The destination must already carry `rollback` status, i.e. it was active
///    at some earlier point and therefore already passed the promote gate.
///    Rollback is strictly non-escalating: it cannot activate anything that was
///    not already blessed.
///
/// Rollback deliberately does NOT require a fresh approval record. It is the
/// emergency reversal path and the M11 contract requires it stay available; the
/// safety property comes from constraining the destination, not from blocking
/// the operation.
pub fn rollback_version(
    conn: &Connection,
    command: &RollbackCommand,
) -> DbResult<RollbackOutcome> {
    require_text(&command.target_version_id, "target_version_id")?;
    require_text(&command.rolled_back_by, "rolled_back_by")?;
    let (version_table, id_col) = match command.target_kind {
        CandidateTargetKind::Prompt => ("prompt_versions", "template_id"),
        CandidateTargetKind::Skill => ("skill_versions", "skill_definition_id"),
    };
    // The target version must currently be active.
    let status_str: String = conn
        .query_row(
            &format!("SELECT status FROM {version_table} WHERE id = ?1"),
            params![command.target_version_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            DbError::Validation(format!(
                "{:?} version not found: {}",
                command.target_kind, command.target_version_id
            ))
        })?;
    if status_str != VersionStatus::Active.as_str() {
        return Err(DbError::Validation(format!(
            "cannot rollback a version that is not active (current: {status_str})"
        )));
    }
    let parent_id: String = conn.query_row(
        &format!("SELECT {id_col} FROM {version_table} WHERE id = ?1"),
        params![command.target_version_id],
        |row| row.get(0),
    )?;
    let tx = conn.unchecked_transaction()?;
    // Find the prior version to reinstate: the most recent version for the
    // same parent that ALREADY carries `rollback` status. That status is only
    // ever written by `promote_candidate` when it supersedes the version that
    // was active, so it is exactly the set of versions that previously passed
    // the promote gate. Any other status (draft/eval/holdout/shadow/canary)
    // has never been active and must never become active here.
    let prior_id: Option<String> = tx
        .query_row(
            &format!(
                "SELECT id FROM {version_table}
                 WHERE {id_col} = ?1 AND id != ?2 AND status = 'rollback'
                 ORDER BY version DESC LIMIT 1"
            ),
            params![parent_id, command.target_version_id],
            |row| row.get(0),
        )
        .optional()?;
    // Mark the target rollback.
    tx.execute(
        &format!("UPDATE {version_table} SET status = 'rollback' WHERE id = ?1"),
        params![command.target_version_id],
    )?;
    if let Some(ref prior) = prior_id {
        tx.execute(
            &format!("UPDATE {version_table} SET status = 'active' WHERE id = ?1"),
            params![prior],
        )?;
    }
    tx.commit()?;
    Ok(RollbackOutcome {
        target_kind: command.target_kind,
        rolled_back_version_id: command.target_version_id.clone(),
        reinstated_version_id: prior_id,
    })
}

/// M11-05: record a shadow run. Asserts no_user_visible_side_effect = TRUE;
/// a shadow run that produced a side effect is a contract violation and is
/// rejected before persistence.
pub fn record_shadow_run(
    conn: &Connection,
    candidate_id: &str,
    input_hash: &str,
    output_diff: &serde_json::Value,
    no_user_visible_side_effect: bool,
) -> DbResult<()> {
    require_text(candidate_id, "candidate_id")?;
    require_text(input_hash, "input_hash")?;
    require_value(output_diff, "output_diff")?;
    if !no_user_visible_side_effect {
        return Err(DbError::Validation(
            "shadow run produced a user-visible side effect; rejected".into(),
        ));
    }
    let id = format!("shr-{}", Uuid::new_v4());
    let now = now_rfc3339();
    let diff_text = serde_json::to_string(output_diff)
        .map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO shadow_runs
           (id, candidate_promotion_id, input_hash, output_diff_json,
            no_user_visible_side_effect, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![id, candidate_id, input_hash, diff_text, now],
    )?;
    Ok(())
}
