//! Source writing prompts become ordinary, locally editable Atlas topics.
use super::{
    exam,
    service::{verify, Account},
    transport,
};
use crate::app::state::AppDb;
use ielts_domain::{domain::WritingTaskType, dto::UpsertWritingTopicCommand};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::{AppHandle, State};

#[derive(Default)]
pub(super) struct WritingSession {
    catalog: HashMap<String, Suite>,
    supplemental: HashMap<String, Supplemental>,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Bank {
    #[default]
    Academic,
    Jijing,
    General,
}

struct Supplemental {
    bank: Bank,
    task: WritingTaskType,
    test_id: Option<u64>,
    paper_id: u64,
    inline: Value,
}

struct Suite {
    book_id: u64,
    task1: Option<u64>,
    task2: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCard {
    test_id: String,
    title: String,
    has_task1: bool,
    has_task2: bool,
}

fn catalog(value: &Value, session: &mut WritingSession) -> Result<Vec<CatalogCard>, String> {
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= 200)
        .ok_or("爱听写写作目录格式异常")?;
    let mut grants = HashMap::new();
    let mut cards = Vec::new();
    for row in rows {
        let test_id = exam::number(row, "id")?.to_string();
        let title = row["title"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.len() <= 300)
            .ok_or("爱听写写作目录缺少标题")?;
        let book_id = exam::number(row, "bookId")?;
        let task1 = (!row["task1"].is_null())
            .then(|| exam::number(row, "task1"))
            .transpose()?;
        let task2 = (!row["task2"].is_null())
            .then(|| exam::number(row, "task2"))
            .transpose()?;
        if task1.is_none() && task2.is_none() {
            continue;
        }
        if grants
            .insert(
                test_id.clone(),
                Suite {
                    book_id,
                    task1,
                    task2,
                },
            )
            .is_some()
        {
            return Err("爱听写写作目录存在重复套卷".into());
        }
        cards.push(CatalogCard {
            test_id,
            title: title.into(),
            has_task1: task1.is_some(),
            has_task2: task2.is_some(),
        });
    }
    session.catalog = grants;
    Ok(cards)
}

fn supplemental_catalog(
    value: &Value,
    bank: Bank,
    task: WritingTaskType,
    session: &mut WritingSession,
) -> Result<Vec<CatalogCard>, String> {
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= 2000)
        .ok_or("爱听写写作目录格式异常")?;
    let mut grants = HashMap::new();
    let mut cards = Vec::new();
    for row in rows {
        let paper_id = exam::number(row, "paperId")?;
        let id = paper_id.to_string();
        if grants.contains_key(&id) {
            continue;
        }
        let test_id = (!row["testId"].is_null())
            .then(|| exam::number(row, "testId"))
            .transpose()?;
        let inline = row["inline"].clone();
        if !inline["content"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty())
            && test_id.is_none()
        {
            continue;
        }
        let title = row["title"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.len() <= 300)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("写作题 {paper_id}"));
        grants.insert(
            id.clone(),
            Supplemental {
                bank,
                task,
                test_id,
                paper_id,
                inline,
            },
        );
        cards.push(CatalogCard {
            test_id: id,
            title,
            has_task1: task == WritingTaskType::Task1,
            has_task2: task == WritingTaskType::Task2,
        });
    }
    session.supplemental = grants;
    Ok(cards)
}

fn paper(suite: &Suite, task: WritingTaskType) -> Option<u64> {
    match task {
        WritingTaskType::Task1 => suite.task1,
        WritingTaskType::Task2 => suite.task2,
    }
}

fn store_topic(
    conn: &rusqlite::Connection,
    command: &UpsertWritingTopicCommand,
) -> ielts_db::DbResult<String> {
    use ielts_db::writing::{get_writing_topic, upsert_writing_topic};
    let id = command
        .id
        .as_deref()
        .ok_or_else(|| ielts_db::DbError::Validation("爱听写写作题目缺少本地身份".into()))?;
    if let Some(existing) = get_writing_topic(conn, id)? {
        return Ok(existing.id);
    }
    upsert_writing_topic(conn, command).map(|topic| topic.id)
}

fn topic(
    owner: &str,
    test_id: &str,
    task: WritingTaskType,
    suite: &Suite,
    raw: &Value,
) -> Result<UpsertWritingTopicCommand, String> {
    let paper_id = paper(suite, task).ok_or("所选套卷没有此任务")?;
    if exam::number(raw, "testId")?.to_string() != test_id
        || exam::number(raw, "bookId")? != suite.book_id
        || exam::number(raw, "paperId")? != paper_id
    {
        return Err("爱听写写作题目与目录不一致，请重新加载".into());
    }
    make_topic(
        raw,
        task,
        "idictation_academic",
        &[json!(owner), json!(test_id), json!(task), json!(paper_id)],
    )
}

fn make_topic(
    raw: &Value,
    task: WritingTaskType,
    category: &str,
    identity: &[Value],
) -> Result<UpsertWritingTopicCommand, String> {
    let prompt = raw["prompt"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 24 * 1024)
        .ok_or("爱听写写作题干缺失或过长")?;
    let image = raw["image"].as_str();
    if image.is_some_and(|url| {
        ![
            "data:image/png;base64,",
            "data:image/jpeg;base64,",
            "data:image/webp;base64,",
        ]
        .iter()
        .any(|prefix| url.starts_with(prefix))
    }) {
        return Err("爱听写写作图表格式无效".into());
    }
    if task == WritingTaskType::Task1 && image.is_none() {
        return Err("原站未返回可用图表，本次未加入 Task 1".into());
    }
    let paragraphs = prompt
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| json!({"type":"paragraph","content":[{"type":"text","text":line}]}))
        .collect::<Vec<_>>();
    let title_json = json!({"type":"doc","content":paragraphs}).to_string();
    let mut revision_parts = identity.to_vec();
    revision_parts.extend([json!(title_json), json!(image)]);
    let revision = hex::encode(Sha256::digest(json!(revision_parts).to_string()));
    Ok(UpsertWritingTopicCommand {
        id: Some(format!("idictation-writing-{revision}")),
        task_type: task,
        category: category.into(),
        difficulty: 3,
        title_json,
        image_path: image.map(str::to_owned),
        is_official: Some(false),
    })
}

#[tauri::command]
pub async fn idictation_writing_catalog(
    app: AppHandle,
    account: State<'_, Account>,
    bank: Option<Bank>,
    task: Option<WritingTaskType>,
) -> Result<Vec<CatalogCard>, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let bank = bank.unwrap_or_default();
    if bank != Bank::Academic {
        let task = task.ok_or("请选择写作任务类型")?;
        let (operation, body) = match (bank, task) {
            (Bank::Jijing, WritingTaskType::Task1) => (
                "writingJijingTask1",
                json!({"type":0,"content_category":""}),
            ),
            (Bank::Jijing, WritingTaskType::Task2) => (
                "writingJijingTask2",
                json!({"type":0,"content_category":""}),
            ),
            (Bank::General, WritingTaskType::Task2) => {
                ("writingGeneralTask2", json!({"content_category":""}))
            }
            _ => return Err("此写作类型暂未接入 Atlas 评分流程".into()),
        };
        session.writing.supplemental.clear();
        let value = transport::read(&app, operation, body).await?;
        verify(&app, &mut session).await?;
        return supplemental_catalog(&value, bank, task, &mut session.writing);
    }
    session.writing.catalog.clear();
    let value = transport::read(&app, "writingCatalog", json!({})).await?;
    verify(&app, &mut session).await?;
    catalog(&value, &mut session.writing)
}

#[tauri::command]
pub async fn idictation_writing_import(
    app: AppHandle,
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    test_id: String,
    task: WritingTaskType,
    bank: Option<Bank>,
) -> Result<String, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let bank = bank.unwrap_or_default();
    if bank != Bank::Academic {
        let grant = session
            .writing
            .supplemental
            .get(&test_id)
            .filter(|grant| grant.bank == bank && grant.task == task)
            .ok_or("请从当前来源的写作目录选择该题")?;
        let value = transport::read(&app, "writingExtraPrompt", json!({
            "bank":bank,"task":task,"testId":grant.test_id,"paperId":grant.paper_id,"inline":grant.inline
        })).await?;
        let paper_id = grant.paper_id;
        let upstream_test = grant.test_id;
        verify(&app, &mut session).await?;
        let owner = session.owner.as_deref().ok_or("请先连接爱听写账号")?;
        let category = if bank == Bank::Jijing {
            "idictation_jijing"
        } else {
            "idictation_general"
        };
        let command = make_topic(
            &value,
            task,
            category,
            &[
                json!(owner),
                json!(bank),
                json!(upstream_test),
                json!(task),
                json!(paper_id),
            ],
        )?;
        return db
            .with_conn(|conn| store_topic(conn, &command))
            .map_err(|error| error.to_string());
    }
    let suite = session
        .writing
        .catalog
        .get(&test_id)
        .ok_or("请先从当前账号的爱听写目录选择写作任务")?;
    let paper_id = paper(suite, task).ok_or("所选套卷没有此任务")?;
    let value = transport::read(
        &app,
        "writingExam",
        json!({"testId":test_id,"task":task,"bookId":suite.book_id,"paperId":paper_id}),
    )
    .await?;
    verify(&app, &mut session).await?;
    let suite = session
        .writing
        .catalog
        .get(&test_id)
        .ok_or("爱听写写作目录已失效")?;
    let owner = session.owner.as_deref().ok_or("请先连接爱听写账号")?;
    let command = topic(owner, &test_id, task, suite, &value)?;
    db.with_conn(|conn| store_topic(conn, &command))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_writing.rs"]
mod tests;
