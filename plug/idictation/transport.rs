//! Product-owned requests in an isolated WebView. Remote pages receive no Atlas IPC.
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl};

pub const WINDOW: &str = "idictation-product";
const ORIGIN: &str = "https://www.idictation.cn";
const BRIDGE: &str = include_str!("product-bridge.js");
const ARTICLE_AUDIO: &str = include_str!("article-audio.js");

pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.show().map_err(|_| "无法显示爱听写登录窗口")?;
        return window.set_focus().map_err(|_| "无法聚焦爱听写登录窗口".into());
    }
    let paths = app.state::<crate::app::state::AppPaths>();
    WebviewWindowBuilder::new(app, WINDOW,
        WebviewUrl::External(format!("{ORIGIN}/main/book").parse().unwrap()))
        .title("爱听写 · 登录并连接 IELTS Atlas")
        .inner_size(1100.0, 780.0)
        .data_directory(paths.app_data.join("providers").join("idictation"))
        .on_navigation(|url| url.origin().ascii_serialization() == ORIGIN)
        .build().map(|_| ()).map_err(|_| "无法打开爱听写登录窗口".into())
}

pub async fn ensure_open(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(WINDOW).is_some() {
        return Ok(());
    }
    open(app)?;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let handle = app.get_webview_window(WINDOW).ok_or("爱听写窗口已关闭")?;
            if handle.url().ok().is_some_and(|url| url.origin().ascii_serialization() == ORIGIN) {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }).await.map_err(|_| "爱听写页面加载超时，请检查原站窗口")?
}

fn window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let window = app.get_webview_window(WINDOW).ok_or("请先打开爱听写登录窗口")?;
    let url = window.url().map_err(|_| "无法确认爱听写页面")?;
    if url.origin().ascii_serialization() != ORIGIN {
        return Err("请在爱听写原站完成登录后重试".into());
    }
    Ok(window)
}

async fn evaluate(window: &WebviewWindow, script: String) -> Result<Value, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = Arc::new(Mutex::new(Some(send)));
    window.eval_with_callback(script, move |raw| {
        if let Ok(mut sender) = send.lock() {
            if let Some(sender) = sender.take() { let _ = sender.send(raw); }
        }
    }).map_err(|_| "爱听写窗口已关闭")?;
    let raw = tokio::time::timeout(Duration::from_secs(5), receive).await
        .map_err(|_| "爱听写窗口暂时没有响应")?
        .map_err(|_| "爱听写窗口已关闭")?;
    if raw.len() > 8 * 1024 * 1024 { return Err("爱听写章节响应过大".into()); }
    serde_json::from_str(&raw).map_err(|_| "爱听写窗口返回格式异常".into())
}

// Also runs if the start callback times out or the command future is dropped.
// Cleanup is queued after evaluation on the same WebView's UI thread.
struct RequestSlot<'a> {
    window: &'a WebviewWindow,
    key: String,
    keep_audio: bool,
}

impl Drop for RequestSlot<'_> {
    fn drop(&mut self) {
        let _ = self.window.eval(format!(
            "(()=>{{const s=window[{}];if(s){{s.keepAudio={};s.cancel();}}delete window[{}];}})();", self.key, self.keep_audio, self.key));
    }
}

/// Internal closed operation set: callers cannot supply a URL, signing fields,
/// payment request, script, or arbitrary body from the main frontend.
pub async fn read(app: &AppHandle, operation: &'static str, body: Value) -> Result<Value, String> {
    if !matches!(operation, "account" | "books" | "chapters" | "words" | "readerCatalog" | "readerDocument"
        | "trainingWords" | "trainingDictionary" | "trainingPreferences" | "trainingAnswer" | "trainingAudio"
        | "trainingFinish" | "trainingMastery" | "articleChapters" | "articleDocument" | "articleAudio"
        | "readingCatalog" | "readingExam" | "readingSubmit") {
        return Err("不支持的爱听写读取操作".into());
    }
    let window = window(app)?;
    let slot = format!("__atlas_read_{}", uuid::Uuid::new_v4().simple());
    let slot_json = json!(slot).to_string();
    let start = format!("(()=>{{{ARTICLE_AUDIO};{BRIDGE};return startIdictationRead({slot_json},{},{});}})()",
        json!(operation), body);
    let mut cleanup = RequestSlot { window: &window, key: slot_json.clone(), keep_audio:false };
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match evaluate(&window, start.clone()).await? {
                Value::Bool(true) => return Ok::<(), String>(()),
                Value::String(status) if status == "loading" => {},
                Value::String(status) if status == "version" =>
                    return Err("爱听写页面版本已变化，请更新适配器".into()),
                _ => return Err("爱听写页面已离开原站，请重新打开登录窗口".into()),
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }).await.map_err(|_| "爱听写页面尚未加载完成，请稍后重试".to_owned())??;
    let poll = format!("(()=>{{const s=window[{slot_json}];return s?.ready?s.result:null;}})()");
    let result = tokio::time::timeout(Duration::from_secs(55), async {
        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let value = evaluate(&window, poll.clone()).await?;
            if !value.is_null() { return Ok::<Value, String>(value); }
        }
    }).await.map_err(|_| "爱听写读取超时，未重试请求".to_owned()).and_then(|r| r);
    let response = result?;
    if response["ok"] == true {
        cleanup.keep_audio = matches!(operation,"trainingAudio"|"articleAudio");
        return Ok(response["value"].clone());
    }
    Err(match response["error"].as_str() {
        Some("expired") => "爱听写会话已过期，请在登录窗口重新登录",
        Some("version") => "爱听写页面版本已变化，请更新适配器",
        Some("account") => "爱听写账号已改变，已停止写入，请重新连接",
        _ => "爱听写未返回可用数据，请检查原站登录状态和权限",
    }.into())
}

pub fn disconnect(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.close().map_err(|_| "无法关闭爱听写窗口")?;
    }
    Ok(())
}

pub fn stop_audio(app: &AppHandle) {
    stop_session_audio(app,None)
}

pub fn stop_article_audio(app:&AppHandle,session:Option<&str>){
    if let Ok(window)=window(app){let scope=json!(session);let _=window.eval(format!(
        "(()=>{{const id={scope};if(id)window.__atlasArticleStoppedSession=id;const p=window.__atlasArticleAudioRequest;if(p&&(!id||p.sessionId===id))p.cancel();const s=window.__atlasArticleAudio;if(s&&(!id||s.sessionId===id)){{s.dispose();delete window.__atlasArticleAudio;}}}})();"));}
}
pub fn pause_article_audio(app:&AppHandle,session:&str){
    if let Ok(window)=window(app){let scope=json!(session);let _=window.eval(format!(
        "(()=>{{const id={scope};window.__atlasArticlePausedSession=id;const p=window.__atlasArticleAudioRequest;if(p?.sessionId===id)p.cancel();const s=window.__atlasArticleAudio;if(s?.sessionId===id)s.pause();}})();"));}
}
pub fn prepare_article_play(app:&AppHandle,session:&str){
    if let Ok(window)=window(app){let scope=json!(session);let _=window.eval(format!("if(window.__atlasArticlePausedSession==={scope})delete window.__atlasArticlePausedSession;"));}
}
pub async fn article_audio_control(app:&AppHandle,session:&str,action:&str,value:Option<f64>)->Result<Value,String>{
    if !matches!(action,"state"|"pause"|"seek"|"rate"){return Err("不支持的播放操作".into());}
    if action=="rate"&&!value.is_some_and(|v|v.is_finite()&&(0.5..=2.0).contains(&v)){return Err("播放速度无效".into());}
    if action=="seek"&&!value.is_some_and(|v|v.is_finite()&&v>=0.0){return Err("播放位置无效".into());}
    let window=window(app)?;
    evaluate(&window,format!("(()=>{{const s=window.__atlasArticleAudio;if(!s||s.sessionId!=={})return null;const action={},value={};if(action==='pause')s.pause();if(action==='seek'){{if(!Number.isFinite(s.audio.duration))return null;s.audio.currentTime=Math.max(s.start,Math.min(value,s.end??s.audio.duration));}}if(action==='rate')s.audio.playbackRate=value;return s.snapshot();}})()",json!(session),json!(action),json!(value))).await
}

pub fn stop_session_audio(app: &AppHandle, session: Option<&str>) {
    if let Ok(window) = window(app) {
        let scope=json!(session);
        let _ = window.eval(format!("(()=>{{const id={scope};if(id)window.__atlasVocabularyStoppedSession=id;const pending=window.__atlasVocabularyAudioRequest;if(pending&&(!id||pending.sessionId===id))pending.cancel();const audio=window.__atlasVocabularyAudio;if(audio&&(!id||audio.atlasSessionId===id)){{audio.pause();audio.src='';delete window.__atlasVocabularyAudio;}}}})();"));
    }
}
