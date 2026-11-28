use crate::app::state::AppDb;
use ielts_db::{settings, DbError};
use reqwest::{Client, Method};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::Mutex;

const BASE: &str = "https://www.9fnnn.com/api";
pub(super) const NS: &str = "jiufen.online";

// Foreground operations keep their existing ordering. Background refreshes use
// a separate lock and only briefly hold the session lock to publish results.
#[derive(Default)]
pub struct Account(pub(super) Mutex<Option<Session>>, pub(super) Mutex<()>);
pub(super) struct Session {
    generation: uuid::Uuid,
    pub owner: String,
    credential: String,
    renewed: Option<std::time::Instant>,
    token: reqwest::header::HeaderValue,
    pub catalog: super::catalog::Access,
    pub materials: std::collections::HashMap<String, Value>,
    pub reviews: std::collections::HashMap<String, Value>,
    pub listening_reviews: std::collections::HashMap<String, super::practice::ListeningReviewEntry>,
    #[cfg(test)]
    transport: Option<test_transport::Transport>,
}

pub(super) fn identifier(value: &Value) -> Option<String> {
    if let Some(n) = value.as_u64() {
        return Some(n.to_string());
    }
    value
        .as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 128
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        })
        .map(str::to_owned)
}

impl Session {
    fn parse(data: &Value) -> Result<Self, String> {
        let data = data.get("data").filter(|v| v.is_object()).unwrap_or(data);
        let user = ["user", "wxUser", "student", "userInfo"]
            .iter()
            .find_map(|k| data.get(k).filter(|v| v.is_object()))
            .ok_or("登录响应缺少账号")?;
        let a = identifier(&user["userId"]);
        let b = identifier(&user["id"]);
        if a.is_some() && b.is_some() && a != b {
            return Err("登录响应的账号标识冲突".into());
        }
        let owner = a.or(b).ok_or("登录响应缺少稳定账号标识")?;
        let raw = ["token", "accessToken", "studentToken"]
            .iter()
            .find_map(|k| data[k].as_str().filter(|s| !s.is_empty()))
            .ok_or("登录响应缺少会话")?;
        let mut token = reqwest::header::HeaderValue::from_str(raw).map_err(|_| "会话格式异常")?;
        token.set_sensitive(true);
        Ok(Self {
            generation: uuid::Uuid::new_v4(),
            owner,
            credential: String::new(),
            renewed: None,
            token,
            catalog: Default::default(),
            materials: Default::default(),
            reviews: Default::default(),
            listening_reviews: Default::default(),
            #[cfg(test)]
            transport: None,
        })
    }

    pub(super) fn snapshot(&self) -> Self {
        Self {
            generation: self.generation,
            owner: self.owner.clone(),
            token: self.token.clone(),
            // A detached request must never clear another session's credentials/cache.
            credential: String::new(),
            renewed: self.renewed,
            catalog: Default::default(),
            materials: Default::default(),
            reviews: Default::default(),
            listening_reviews: Default::default(),
            #[cfg(test)]
            transport: self.transport.clone(),
        }
    }
}

pub(super) fn same_session(current: &Option<Session>, snapshot: &Session) -> bool {
    current
        .as_ref()
        .is_some_and(|s| s.generation == snapshot.generation)
}

pub(super) fn expire(session: &mut Option<Session>) {
    if let Some(previous) = session.take() {
        if !previous.credential.is_empty() {
            ielts_db::transient_assets::clear_provider("jiufen");
            let _ = clear_saved(&previous.credential);
        }
    }
}

#[derive(Debug)]
pub(super) enum Failure {
    Expired,
    RejectedBeforeWrite,
    SubmissionConflict,
    Cooldown(u64),
    Message(String),
}
impl Failure {
    pub(super) fn message(self) -> String {
        match self {
            Self::Expired => "九分学长会话已过期，请重新登录原账号".into(),
            Self::RejectedBeforeWrite => {
                "提交内容未通过校验，服务端确认尚未写入。作答已保留，请修正后重新提交".into()
            }
            Self::SubmissionConflict => {
                "本次提交与首次请求冲突。作答已保留，请核对首次结果，不要另开提交".into()
            }
            Self::Cooldown(s) => format!("请在 {s} 秒后再次请求验证码"),
            Self::Message(text) => text,
        }
    }
}
fn seconds(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|v| *v > 0)
}
fn classify(status: u16, v: &Value, auth: bool) -> Result<(), Failure> {
    match v["data"]["submissionState"]
        .as_str()
        .or_else(|| v["submissionState"].as_str())
    {
        Some("rejected_before_write") => return Err(Failure::RejectedBeforeWrite),
        Some("conflict") => return Err(Failure::SubmissionConflict),
        _ => {}
    }
    let code = identifier(&v["code"]).unwrap_or_default();
    if auth
        && (matches!(status, 401 | 403)
            || matches!(code.as_str(), "401" | "403" | "10401" | "10403"))
    {
        return Err(Failure::Expired);
    }
    if (200..300).contains(&status) && code == "200" {
        return Ok(());
    }
    let reasons = [
        v["msg"].as_str().unwrap_or(""),
        v["message"].as_str().unwrap_or(""),
        code.as_str(),
    ];
    let has = |what: &str| {
        reasons.iter().any(|s| {
            s.split(|c: char| !(c.is_ascii_uppercase() || c == '_'))
                .any(|part| part == what)
        })
    };
    if status == 429 || has("EMAIL_CODE_RATE_LIMITED") || has("EMAIL_CODE_COOLDOWN") {
        let default = if has("EMAIL_CODE_COOLDOWN") { 60 } else { 3600 };
        return Err(Failure::Cooldown(
            ["retryAfterSeconds", "cooldownSeconds", "ttlSeconds"]
                .iter()
                .find_map(|k| seconds(&v["data"][k]))
                .unwrap_or(default),
        ));
    }
    let text = if has("EMAIL_CODE_INVALID") {
        "验证码错误"
    } else if has("EMAIL_CODE_EXPIRED") {
        "验证码已过期"
    } else if has("EMAIL_CODE_ATTEMPTS_EXHAUSTED") {
        "请重新获取验证码"
    } else {
        "九分学长请求失败"
    };
    Err(Failure::Message(format!("{text}（HTTP {status}）")))
}

async fn request(
    path: &str,
    body: Option<&Value>,
    session: Option<&Session>,
    client_id: Option<&str>,
) -> Result<Value, Failure> {
    #[cfg(test)]
    if let Some(transport) = session.and_then(|s| s.transport.as_ref()) {
        return transport.request(path, body).await;
    }
    let failure = |text: &str| Failure::Message(text.into());
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(if path.ends_with("/renew") {
            10
        } else {
            30
        }))
        .build()
        .map_err(|_| failure("无法建立 HTTPS 客户端"))?;
    let mut req = client.request(
        if body.is_some() {
            Method::POST
        } else {
            Method::GET
        },
        format!("{BASE}{path}"),
    );
    if let Some(id) = client_id {
        req = req.header("X-XXGG-Client-Id", id);
    }
    if let Some(session) = session {
        req = req.header("token", session.token.clone());
    }
    if let Some(body) = body {
        req = req.json(body);
    }
    let mut res = req
        .send()
        .await
        .map_err(|_| failure("连接九分学长失败或请求超时"))?;
    let status = res.status().as_u16();
    if session.is_some() && matches!(status, 401 | 403) {
        return Err(Failure::Expired);
    }
    let mut raw = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| failure("读取响应中断"))? {
        if raw.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(failure("响应超过单篇阅读大小限制"));
        }
        raw.extend_from_slice(&chunk);
    }
    let envelope = serde_json::from_slice(&raw).unwrap_or(Value::Null);
    classify(status, &envelope, session.is_some())?;
    Ok(envelope)
}

pub(super) async fn authorized(
    session: &mut Option<Session>,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, String> {
    authorized_result(session, path, body)
        .await
        .map_err(Failure::message)
}

pub(super) async fn authorized_result(
    session: &mut Option<Session>,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, Failure> {
    let current = session
        .as_ref()
        .ok_or_else(|| Failure::Message("请先登录九分学长账号".into()))?;
    request(path, body, Some(current), None)
        .await
        .map_err(|err| {
            if matches!(err, Failure::Expired) {
                expire(session);
            }
            err
        })
}

// The authenticated review has already established which questions belong to this attempt.
pub(super) async fn question_analyses(
    session: &Session,
    requests: Vec<(String, String)>,
) -> std::collections::HashMap<String, Value> {
    let mut analyses = std::collections::HashMap::new();
    let mut requests = requests.into_iter();
    let mut tasks = tokio::task::JoinSet::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(12);
    loop {
        while tasks.len() < 4 {
            let Some((key, path)) = requests.next() else {
                break;
            };
            let authorization = session.snapshot();
            tasks.spawn(
                async move { (key, request(&path, None, Some(&authorization), None).await) },
            );
        }
        match tokio::time::timeout_at(deadline, tasks.join_next()).await {
            Ok(Some(Ok((key, Ok(response))))) => {
                analyses.insert(key, response["data"].clone());
            }
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => break,
        }
    }
    analyses
}

fn valid_email(email: &str) -> Result<&str, String> {
    let email = email.trim();
    let (local, domain) = email.split_once('@').ok_or("请输入有效邮箱")?;
    if local.is_empty()
        || !domain.contains('.')
        || domain.contains('@')
        || email.chars().any(char::is_whitespace)
        || email.len() > 254
    {
        return Err("请输入有效邮箱".into());
    }
    Ok(email)
}

fn install_id(db: &AppDb) -> Result<String, String> {
    db.with_conn(|conn| {
        if let Some(row) = settings::get_setting(conn, NS, "installId")? {
            return identifier(&row.value)
                .ok_or_else(|| DbError::Validation("安装标识损坏".into()));
        }
        let id = format!("atlas-{}", uuid::Uuid::new_v4());
        settings::upsert_setting(conn, NS, "installId", &json!(id))?;
        Ok(id)
    })
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    sent: bool,
    cooldown_seconds: u64,
}

#[tauri::command]
pub async fn jiufen_send_code(
    db: tauri::State<'_, AppDb>,
    account: tauri::State<'_, Account>,
    email: String,
) -> Result<SendResult, String> {
    let _guard = account.0.lock().await;
    let body = json!({"email":valid_email(&email)?,"purpose":"login"});
    match request(
        "/user-auth/v1/email-code/send",
        Some(&body),
        None,
        Some(&install_id(&db)?),
    )
    .await
    {
        Ok(v) => Ok(SendResult {
            sent: true,
            cooldown_seconds: seconds(&v["data"]["cooldownSeconds"]).unwrap_or(60),
        }),
        Err(Failure::Cooldown(s)) => Ok(SendResult {
            sent: false,
            cooldown_seconds: s,
        }),
        Err(e) => Err(e.message()),
    }
}

#[tauri::command]
pub async fn jiufen_login(
    db: tauri::State<'_, AppDb>,
    account: tauri::State<'_, Account>,
    email: String,
    code: String,
) -> Result<(), String> {
    let mut session = account.0.lock().await;
    if code.len() != 6 || !code.bytes().all(|c| c.is_ascii_digit()) {
        return Err("请输入 6 位数字验证码".into());
    }
    let body = json!({"email":valid_email(&email)?, "code":code});
    let result = request("/user-auth/v1/email-code/login", Some(&body), None, None)
        .await
        .map_err(Failure::message)?;
    let mut next = Session::parse(&result["data"])?;
    next.credential = install_id(&db)?;
    save_session(&next)?;
    next.renewed = Some(std::time::Instant::now());
    ielts_db::transient_assets::clear_provider("jiufen");
    *session = Some(next);
    Ok(())
}

fn credential(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.ieltsatlas.jiufen.session", id)
        .map_err(|_| "无法访问系统凭据库".into())
}
fn clear_saved(id: &str) -> Result<(), String> {
    match credential(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("清除系统凭据失败".into()),
    }
}
fn save_session(s: &Session) -> Result<(), String> {
    let token = s.token.to_str().map_err(|_| "会话格式异常")?;
    credential(&s.credential)?
        .set_password(&json!({"user":{"id":s.owner},"token":token}).to_string())
        .map_err(|_| "保存登录状态失败".into())
}
fn restore_saved(id: String) -> Result<Option<Session>, String> {
    match credential(&id)?.get_password() {
        Ok(raw) => {
            let mut s = Session::parse(&serde_json::from_str(&raw).map_err(|_| "登录状态损坏")?)?;
            s.credential = id;
            Ok(Some(s))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("暂时无法读取系统凭据库".into()),
    }
}

#[tauri::command]
pub async fn jiufen_restore(
    db: tauri::State<'_, AppDb>,
    account: tauri::State<'_, Account>,
) -> Result<bool, String> {
    restore(&db, &account).await
}

async fn restore(db: &AppDb, account: &Account) -> Result<bool, String> {
    let _refresh = account.1.lock().await;
    let mut session = account.0.lock().await;
    if session.is_none() {
        *session = restore_saved(install_id(&db)?)?;
    }
    let Some(current) = session.as_ref() else {
        return Ok(false);
    };
    if current
        .renewed
        .is_some_and(|t| t.elapsed() < Duration::from_secs(1800))
    {
        return Ok(true);
    }
    let snapshot = current.snapshot();
    let mut detached = Some(current.snapshot());
    drop(session);
    let response = authorized(
        &mut detached,
        "/user-auth/v1/session/renew",
        Some(&json!({})),
    )
    .await;
    let mut session = account.0.lock().await;
    if !same_session(&session, &snapshot) {
        return Err("登录状态已变化，请重试同步".into());
    }
    if detached.is_none() {
        expire(&mut session);
    }
    let response = response?;
    let mut next = Session::parse(&response["data"])?;
    if next.owner != snapshot.owner {
        expire(&mut session);
        return Err("账号已改变，请重新登录".into());
    }
    next.credential = session.as_ref().unwrap().credential.clone();
    next.renewed = Some(std::time::Instant::now());
    save_session(&next)?;
    if let Some(current) = session.as_mut() {
        next.catalog = std::mem::take(&mut current.catalog);
        next.materials = std::mem::take(&mut current.materials);
        next.reviews = std::mem::take(&mut current.reviews);
        next.listening_reviews = std::mem::take(&mut current.listening_reviews);
    }
    *session = Some(next);
    Ok(true)
}

#[tauri::command]
pub async fn jiufen_is_connected(account: tauri::State<'_, Account>) -> Result<bool, String> {
    Ok(account.0.lock().await.is_some())
}

#[tauri::command]
pub async fn jiufen_disconnect(
    db: tauri::State<'_, AppDb>,
    account: tauri::State<'_, Account>,
) -> Result<(), String> {
    let mut session = account.0.lock().await;
    clear_saved(&install_id(&db)?)?;
    ielts_db::transient_assets::clear_provider("jiufen");
    *session = None;
    Ok(())
}

#[cfg(test)]
#[path = "../../developer/tests/rust/jiufen_protocol.rs"]
mod tests;

#[cfg(test)]
#[path = "../../developer/tests/rust/jiufen_api_audit.rs"]
mod api_audit;

#[cfg(test)]
#[path = "../../developer/tests/rust/jiufen_localization.rs"]
mod localization_tests;

#[cfg(test)]
#[path = "../../developer/tests/rust/jiufen_transport.rs"]
mod test_transport;

#[cfg(test)]
#[path = "../../developer/tests/rust/jiufen_recovery.rs"]
mod recovery_tests;
