use super::super::service::Session;
use super::*;

/// Source text stays in the runtime cache. These fields identify and classify answers.
pub(super) fn metadata(payload: &Value, owner: &str) -> Value {
    json!({"jiufenOwner":owner,"remoteProvider":"jiufen",
        "remoteQuestions":payload["jiufen"]["questions"],
        "remoteSections":ielts_db::load_sections(payload),
        "sourceFingerprint":source_fingerprint(payload)})
}

pub(super) fn source_fingerprint(payload: &Value) -> String {
    // Sentence translations and expiring media URLs do not define the submitted question.
    digest(
        json!([
            payload["passage"],
            payload["questionGroups"],
            payload["jiufen"]
        ])
        .to_string()
        .as_bytes(),
    )
}

pub(crate) fn migrate_local_records(db: &AppDb) -> Result<(), String> {
    db.with_conn(|conn| {
        let ids = {
            let mut stmt = conn.prepare(
                "SELECT id FROM practice_assets WHERE id LIKE 'jiufen-native-%'
                 AND json_extract(metadata_json,'$.remoteProvider') IS NULL",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let cached: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM settings WHERE namespace=?1
             AND (key LIKE 'review-v1-%' OR key LIKE 'material-v1-%'))",
            [NS],
            |row| row.get(0),
        )?;
        if !ids.is_empty() || cached {
            let root = db
                .path
                .parent()
                .and_then(|path| path.parent())
                .ok_or_else(|| DbError::Validation("database directory unavailable".into()))?;
            ielts_db::snapshot_before(conn, &root.join("backups"), "jiufen-remote-records")?;
        }
        for id in ids {
            migrate_asset(conn, db, &id)?;
        }
        // Recover old receipts from official history using retained attempt facts.
        conn.execute(
            "DELETE FROM settings WHERE namespace=?1
             AND (key LIKE 'review-v1-%' OR key LIKE 'material-v1-%')",
            [NS],
        )?;
        Ok(())
    })
    .map_err(|error| error.to_string())
}

fn migrate_asset(conn: &rusqlite::Connection, db: &AppDb, id: &str) -> ielts_db::DbResult<()> {
    let mut asset = ielts_db::get_practice_asset(conn, id)?;
    let loaded = if asset.activity == Activity::Listening {
        ielts_db::load_listening_payload(conn, id)?
    } else {
        ielts_db::load_practice_asset_payload(conn, id)?
    };
    let owner = asset
        .metadata
        .as_ref()
        .and_then(|meta| meta["jiufenOwner"].as_str())
        .ok_or_else(|| DbError::Validation("九分题源缺少账号归属".into()))?
        .to_owned();
    let old_path = asset.content_ref.take();
    asset.metadata = Some(metadata(&loaded.payload, &owner));
    let tx = conn.unchecked_transaction()?;
    ielts_db::upsert_practice_asset(&tx, &asset)?;
    let attempts = {
        let mut stmt = tx.prepare(
            "SELECT id FROM attempts WHERE asset_id=?1 AND status='completed' ORDER BY completed_at,id",
        )?;
        let rows = stmt.query_map([id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for attempt_id in attempts {
        let attempt = ielts_db::get_history_detail(&tx, &attempt_id)?.attempt;
        ielts_db::persist_completed_attempt(&tx, &attempt, &asset.fingerprint)?;
    }
    tx.commit()?;
    if let Some(path) = old_path {
        remove_migrated_file(db, id, &path);
    }
    Ok(())
}

fn remove_migrated_file(db: &AppDb, id: &str, path: &str) {
    let Some(root) = db.path.parent().and_then(|path| path.parent()) else {
        return;
    };
    let (Ok(root), Ok(path)) = (
        root.join("imports").join("jiufen").canonicalize(),
        std::path::Path::new(path).canonicalize(),
    ) else {
        return;
    };
    if !path.starts_with(root)
        || path.file_name().and_then(|name| name.to_str()) != Some(format!("{id}.json").as_str())
    {
        return;
    }
    if let Err(error) = std::fs::remove_file(path) {
        tracing::warn!(%error, "could not remove migrated remote payload");
    }
}

pub(super) fn completed(db: &AppDb, attempt: &str) -> Result<bool, String> {
    db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM attempts WHERE id=?1 AND status='completed')",
            [attempt],
            |r| r.get(0),
        )?)
    })
    .map_err(|e| e.to_string())
}

pub(super) async fn payload(
    db: &AppDb,
    session: &mut Option<Session>,
    asset_id: &str,
) -> Result<PracticeAssetV2Payload, String> {
    if !asset_id.starts_with(PREFIX) {
        return Err("题目不属于九分学长".into());
    }
    let asset = db
        .with_conn(|conn| ielts_db::get_practice_asset(conn, asset_id))
        .map_err(|e| e.to_string())?;
    check_owner(&asset, &session.as_ref().ok_or("请先登录九分学长")?.owner)?;
    if let Ok(payload) = db.with_conn(|conn| ielts_db::transient_assets::get(conn, asset_id)) {
        return Ok(PracticeAssetV2Payload { asset, payload });
    }
    let (_, mut payload) = bound_unit(session, &asset).await?;
    payload["examId"] = json!(asset_id);
    // A converter upgrade may add transient study fields. The submitted core is checked above.
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "jiufen", asset_id, payload.clone()))
        .map_err(|e| e.to_string())?;
    Ok(PracticeAssetV2Payload { asset, payload })
}

pub(super) async fn bound_unit(
    session: &mut Option<Session>,
    asset: &PracticeAssetV2,
) -> Result<(Value, Value), String> {
    let unit = asset.source_key.as_deref().ok_or("缺少题源标识")?;
    let unit = identifier(&json!(unit)).ok_or("题源标识无效")?;
    let response = authorized(session, &format!("/practice/v1/units/{unit}/exam"), None).await?;
    if !same_identifier(&response["data"]["id"], &unit)
        || activity(string(&response["data"], "channel"))? != asset.activity
    {
        return Err("返回题面不匹配".into());
    }
    let payload = exam(&response["data"])?;
    let meta = asset.metadata.as_ref().ok_or("缺少本机题源映射")?;
    if meta["sourceFingerprint"] != source_fingerprint(&payload) {
        return Err("官方题面已更新，当前版本与这次作答不一致".into());
    }
    Ok((response["data"].clone(), payload))
}

pub(super) fn command(attempt: &AttemptRecord) -> Submit {
    Submit {
        asset_id: attempt.asset_id.clone().unwrap_or_default(),
        attempt_id: attempt.id.clone(),
        channel: if attempt.activity == Activity::Reading {
            "reading"
        } else {
            "listening"
        }
        .into(),
        answers: attempt
            .answers
            .iter()
            .map(|a| (a.question_id.clone(), a.answer.clone()))
            .collect(),
        marked_questions: attempt
            .answers
            .iter()
            .filter(|a| a.marked)
            .map(|a| a.question_id.clone())
            .collect(),
        duration_ms: Some(attempt.duration_ms),
        question_timeline: vec![],
    }
}

fn verify_retained(attempt: &AttemptRecord, official: &AttemptRecord) -> Result<(), String> {
    if attempt.completed_at != official.completed_at
        || attempt.correct_count != official.correct_count
        || attempt.question_count != official.question_count
        || attempt.score_value != official.score_value
        || attempt.answers.len() != official.answers.len()
        || attempt.answers.iter().any(|a| {
            !official
                .answers
                .iter()
                .any(|b| a.question_id == b.question_id && a.is_correct == b.is_correct)
        })
    {
        return Err("官方复盘与本地成绩不一致".into());
    }
    Ok(())
}

async fn find_receipt(
    session: &mut Option<Session>,
    loaded: &PracticeAssetV2Payload,
    attempt: &AttemptRecord,
    cmd: &Submit,
    questions: &[SourceQuestion],
    owner: &str,
) -> Result<String, String> {
    let time = attempt
        .completed_at
        .as_deref()
        .ok_or("本地作答缺少交卷时间")?;
    let date = time
        .get(..10)
        .filter(|d| d.bytes().all(|b| b.is_ascii_digit() || b == b'-'))
        .ok_or("交卷时间无效")?;
    let unit = loaded.asset.source_key.as_deref().ok_or("缺少题源标识")?;
    let mut matches = std::collections::BTreeSet::new();
    let mut page = 1;
    loop {
        let response = authorized(session,&format!("/practice/v1/me/practice-history/records?date={date}&pageNo={page}&pageSize=100&historyMode=regular&includeEntryModes=memory_link,spelling_recall"),None).await?;
        for row in array(&response["data"], "records") {
            if !same_identifier(&row["unitId"], unit) || row["channel"] != cmd.channel {
                continue;
            }
            let target = &row["reviewTarget"];
            let Some(receipt) =
                identifier(&target["resultId"]).or_else(|| identifier(&target["attemptId"]))
            else {
                continue;
            };
            let response = authorized(
                session,
                &format!("/practice/v1/results/{receipt}/review"),
                None,
            )
            .await?;
            let pending = Pending {
                asset_id: loaded.asset.id.clone(),
                body: submission(unit, questions, cmd)?,
                receipt: Some(receipt.clone()),
                ..Default::default()
            };
            if let Ok((official, _, _)) = official_result(
                loaded,
                cmd,
                questions,
                &pending,
                owner,
                &response["data"],
                &HashMap::new(),
            ) {
                if verify_retained(attempt, &official).is_ok() {
                    matches.insert(receipt);
                }
            }
        }
        let pages = response["data"]["totalPages"]
            .as_u64()
            .ok_or("历史分页信息缺失")?;
        if page >= pages {
            break;
        }
        page += 1;
        if page > 100 {
            return Err("该日历史记录过多，无法自动匹配旧回执".into());
        }
    }
    if matches.len() != 1 {
        return Err("无法唯一匹配这次作答的官方回执".into());
    }
    Ok(matches.into_iter().next().unwrap())
}

pub(super) async fn review(
    db: &AppDb,
    session: &mut Option<Session>,
    loaded: &PracticeAssetV2Payload,
    attempt_id: &str,
    retry_listening_analyses: bool,
) -> Result<Value, String> {
    let attempt = db
        .with_conn(|conn| Ok(ielts_db::get_history_detail(conn, attempt_id)?.attempt))
        .map_err(|e| e.to_string())?;
    if attempt.asset_id.as_deref() != Some(loaded.asset.id.as_str())
        || attempt.status != AttemptStatus::Completed
    {
        return Err("复盘与题目不匹配".into());
    }
    let owner = session.as_ref().ok_or("请先登录九分学长")?.owner.clone();
    check_owner(&loaded.asset, &owner)?;
    if let Some(cached) = session.as_ref().unwrap().reviews.get(attempt_id) {
        return Ok(cached.clone());
    }
    let cmd = command(&attempt);
    let questions = source_questions(loaded)?;
    let listening = loaded.asset.activity == Activity::Listening;
    if listening {
        let current = session.as_mut().unwrap();
        if let Some(result) = listening_review::result(current, loaded, attempt_id, &questions) {
            if !retry_listening_analyses || result["analysesComplete"] == true {
                return Ok(result);
            }
            listening_review::analyses(current, loaded, attempt_id, &questions, true).await;
            return listening_review::result(current, loaded, attempt_id, &questions)
                .ok_or_else(|| "听力复盘缓存已失效，请重试".into());
        }
    }
    let key = scoped_key("receipt-v2", attempt_id)?;
    let receipt_record = load_setting(db, &key)?;
    let recovered_draft = receipt_record.as_ref().and_then(|value| value.get("recoveredDraftId")).cloned().unwrap_or(Value::Null);
    let receipt = match receipt_record {
        Some(value) => {
            if value["assetId"] != loaded.asset.id || value["owner"] != owner_scope(&owner) {
                return Err("回执归属不匹配".into());
            }
            identifier(&value["receipt"]).ok_or("回执损坏")?
        }
        None => find_receipt(session, loaded, &attempt, &cmd, &questions, &owner).await?,
    };
    let data = authorized(
        session,
        &format!("/practice/v1/results/{receipt}/review"),
        None,
    )
    .await?;
    let pending = Pending {
        asset_id: loaded.asset.id.clone(),
        body: submission(
            loaded.asset.source_key.as_deref().ok_or("缺少题源标识")?,
            &questions,
            &cmd,
        )?,
        receipt: Some(receipt.clone()),
        ..Default::default()
    };
    let (official, _, _) = official_result(
        loaded,
        &cmd,
        &questions,
        &pending,
        &owner,
        &data["data"],
        &HashMap::new(),
    )?;
    verify_retained(&attempt, &official)?;
    let requests = analysis_requests(&questions);
    let analyses = if listening {
        listening_review::analyses(
            session.as_mut().unwrap(), loaded, attempt_id, &questions, retry_listening_analyses,
        ).await
    } else {
        question_analyses(session.as_ref().unwrap(), requests.clone()).await
    };
    let (_, _, mut result) = official_result(
        loaded,
        &cmd,
        &questions,
        &pending,
        &owner,
        &data["data"],
        &analyses,
    )?;
    result["attempt"] = json!(attempt);
    result["recoveredDraftId"] = recovered_draft.clone();
    result["analysesComplete"] = json!(analyses.len() == requests.len());
    save_setting(
        db,
        &key,
        &json!({"assetId":loaded.asset.id,"receipt":receipt,"owner":owner_scope(&owner),"recoveredDraftId":recovered_draft}),
    )?;
    if listening {
        let current = session.as_mut().unwrap();
        listening_review::remember(current, loaded, attempt_id, &result);
        return listening_review::result(current, loaded, attempt_id, &questions)
            .ok_or_else(|| "听力复盘缓存已失效，请重试".into());
    }
    let mut material = loaded.payload["studyMaterial"].clone();
    for q in &questions {
        if let Some(response) = analyses.get(&q.key) {
            let row = response.get("question").unwrap_or(response);
            material["questions"][&q.key] =
                super::super::material::question(&material, &q.part_id, row);
        }
    }
    result["studyMaterial"] = material;
    if analyses.len() == requests.len() {
        let cache = &mut session.as_mut().unwrap().reviews;
        if cache.len() >= 16 {
            cache.clear();
        }
        cache.insert(attempt_id.into(), result.clone());
    }
    Ok(result)
}

pub(crate) async fn prepare_coach_context(
    account: &Account,
    db: &AppDb,
    cmd: &ielts_db::RunCoachCommand,
) -> Result<Option<ielts_db::ResolvedCoachContext>, String> {
    let thread = db
        .with_conn(|conn| ielts_db::get_thread(conn, &cmd.thread_id))
        .map_err(|e| e.to_string())?;
    let bound_asset = match thread.asset_id.clone() {
        Some(id) => Some(id),
        None => match thread.attempt_id.as_deref() {
            Some(id) => db
                .with_conn(|conn| Ok(ielts_db::get_history_detail(conn, id)?.attempt.asset_id))
                .map_err(|e| e.to_string())?,
            None => None,
        },
    };
    let Some(asset_id) = bound_asset.as_deref().filter(|id| id.starts_with(PREFIX)) else {
        return Ok(None);
    };
    let attempt = thread.attempt_id.as_deref().ok_or("Coach缺少作答记录")?;
    let mut session = account.0.lock().await;
    let loaded = payload(db, &mut session, asset_id).await?;
    let result = review(db, &mut session, &loaded, attempt, true).await?;
    if result["analysesComplete"] != true {
        return Err("官方解析尚未加载完整，请重试".into());
    }
    let mut evidence = loaded.payload;
    evidence["studyMaterial"] = result["studyMaterial"].clone();
    if let Some(material) = session
        .as_ref()
        .unwrap()
        .materials
        .get(&format!("{asset_id}:{attempt}"))
    {
        evidence["studyMaterial"] = material.clone();
    }
    evidence["answerKey"] = result["review"]["answerKey"].clone();
    evidence["reviewExplanations"] = result["review"]["reviewExplanations"].clone();
    db.with_conn(|conn| {
        ielts_db::resolve_provider_coach_context(
            conn,
            &cmd.thread_id,
            cmd.question_context.as_ref(),
            &evidence,
            &loaded.asset.fingerprint,
        )
    })
    .map(Some)
    .map_err(|e| e.to_string())
}
