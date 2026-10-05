use std::fs;

use ielts_db::{
    corpus_manifest, export_corpus_chunks, fetch_corpus_chunks, fingerprint_payload, migrate,
    open_connection, DbOpenOptions,
};
use ielts_domain::{CorpusExportQuery, CorpusFetchQuery};
use rusqlite::{params, Connection};
use serde_json::json;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("corpus.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn insert_reading_asset(conn: &Connection, dir: &std::path::Path, id: &str, passage_html: &str) {
    let payload = json!({
        "schemaVersion": "ReadingExamSourceV1",
        "examId": id,
        "meta": { "title": format!("Passage {id}"), "category": "P1", "frequency": "low" },
        "passage": { "blocks": [{ "blockId": "p", "kind": "html", "html": passage_html }] },
        "questionGroups": [{ "groupId": "g1", "kind": "matching", "questionIds": ["q1"],
            "bodyHtml": "<p>Choose the correct heading.</p>" }],
        "answerKey": { "q1": "i" }
    });
    let path = dir.join(format!("{id}.json"));
    fs::write(&path, serde_json::to_string(&payload).unwrap()).unwrap();
    let fingerprint = fingerprint_payload(&payload);
    let now = "2026-08-14T00:00:00Z";
    conn.execute(
        "INSERT INTO practice_assets
         (id,activity,source_kind,title,category,difficulty,frequency,content_ref,
          schema_version,fingerprint,pdf_only,created_at,updated_at)
         VALUES (?1,'reading','builtin',?2,'P1',NULL,'low',?3,2,?4,0,?5,?5)",
        params![
            id,
            format!("Passage {id}"),
            path.display().to_string(),
            fingerprint,
            now
        ],
    )
    .unwrap();
}

fn insert_writing_topic(conn: &Connection, id: &str, prompt: &str) {
    let title_json = json!({
        "type": "doc",
        "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": prompt }] }]
    })
    .to_string();
    let now = "2026-08-14T00:00:00Z";
    conn.execute(
        "INSERT INTO practice_assets
         (id,activity,source_kind,title,content_ref,schema_version,fingerprint,pdf_only,created_at,updated_at)
         VALUES (?1,'writing','builtin',?2,NULL,2,'fingerprint-writing',0,?3,?3)",
        params![id, prompt, now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO writing_topics (asset_id,task_type,title_json,is_official,created_at,updated_at)
         VALUES (?1,'task2',?2,0,?3,?3)",
        params![id, title_json, now],
    )
    .unwrap();
}

#[test]
fn manifest_counts_reading_and_writing_chunkable_assets() {
    let (dir, conn) = open_db();
    insert_reading_asset(&conn, dir.path(), "p-a", "<p>Passage A text.</p>");
    insert_reading_asset(&conn, dir.path(), "p-b", "<p>Passage B text.</p>");
    insert_writing_topic(&conn, "bc-w-1", "Governments should act.");
    let manifest = corpus_manifest(&conn).unwrap();
    assert_eq!(manifest.asset_count, 3);
    assert_eq!(manifest.chunk_count, 3);
    assert!(manifest.source_kinds.iter().any(|k| k == "reading_asset"));
    assert!(manifest.source_kinds.iter().any(|k| k == "writing_topic"));
}

#[test]
fn export_produces_deterministic_chunks_with_cursor_pagination() {
    let (dir, conn) = open_db();
    insert_reading_asset(&conn, dir.path(), "p-a", "<p>Alpha passage.</p>");
    insert_reading_asset(&conn, dir.path(), "p-b", "<p>Beta passage.</p>");
    insert_writing_topic(&conn, "bc-w-1", "Governments should act.");

    let first = export_corpus_chunks(
        &conn,
        &CorpusExportQuery {
            cursor: None,
            limit: 2,
        },
    )
    .unwrap();
    assert_eq!(first.chunks.len(), 2);
    assert!(first.truncated);
    assert!(first.next_cursor.is_some());
    // reading assets sort before writing topics.
    assert_eq!(first.chunks[0].source_kind, "reading_asset");
    assert_eq!(
        first.chunks[0].text,
        "Alpha passage.\nChoose the correct heading."
    );

    let second = export_corpus_chunks(
        &conn,
        &CorpusExportQuery {
            cursor: first.next_cursor,
            limit: 2,
        },
    )
    .unwrap();
    assert_eq!(second.chunks.len(), 1);
    assert!(!second.truncated);
    assert_eq!(second.chunks[0].source_kind, "writing_topic");
    assert_eq!(second.chunks[0].text, "Governments should act.");

    let all = export_corpus_chunks(
        &conn,
        &CorpusExportQuery {
            cursor: None,
            limit: 100,
        },
    )
    .unwrap();
    assert_eq!(all.chunks.len(), 3);
    let chunk_ids: Vec<_> = all.chunks.iter().map(|c| c.chunk_id.clone()).collect();
    assert_eq!(
        chunk_ids,
        vec![
            "reading:p-a:v1:0",
            "reading:p-b:v1:0",
            "writing:bc-w-1:v1:0"
        ]
    );
}

#[test]
fn fetch_returns_stable_chunks_and_missing_ids() {
    let (dir, conn) = open_db();
    insert_reading_asset(
        &conn,
        dir.path(),
        "p-a",
        "<p>Alpha <strong>passage</strong>.</p>",
    );
    let result = fetch_corpus_chunks(
        &conn,
        &CorpusFetchQuery {
            ids: vec![
                "reading:p-a:v1:0".into(),
                "reading:missing:v1:0".into(),
                "bogus".into(),
            ],
        },
    )
    .unwrap();
    assert_eq!(result.chunks.len(), 1);
    assert_eq!(result.chunks[0].source_id, "p-a");
    assert_eq!(
        result.chunks[0].text,
        "Alpha passage.\nChoose the correct heading."
    );
    assert_eq!(
        result.missing_ids,
        vec!["reading:missing:v1:0".to_string(), "bogus".to_string()]
    );
}

#[test]
fn pdf_only_reading_assets_are_excluded() {
    let (dir, conn) = open_db();
    insert_reading_asset(&conn, dir.path(), "p-a", "<p>Text.</p>");
    let now = "2026-08-14T00:00:00Z";
    conn.execute(
        "INSERT INTO practice_assets
         (id,activity,source_kind,title,content_ref,schema_version,fingerprint,pdf_only,created_at,updated_at)
         VALUES ('p-pdf','reading','builtin','PDF Only','x.pdf',2,'fp-pdf',1,?1,?1)",
        params![now],
    )
    .unwrap();
    let all = export_corpus_chunks(
        &conn,
        &CorpusExportQuery {
            cursor: None,
            limit: 100,
        },
    )
    .unwrap();
    assert_eq!(all.chunks.len(), 1);
    assert_eq!(all.chunks[0].source_id, "p-a");
}

#[test]
fn production_rust_wire_drives_python_sync_and_python_queries_decode_in_rust() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let (dir, conn) = open_db();
    insert_reading_asset(&conn, dir.path(), "p-a", "<p>Canonical reading body.</p>");
    insert_writing_topic(&conn, "w-a", "Canonical writing prompt.");
    let mut pages = vec![];
    let mut cursor = None;
    loop {
        let page = export_corpus_chunks(
            &conn,
            &CorpusExportQuery {
                cursor: cursor.clone(),
                limit: 1,
            },
        )
        .unwrap();
        pages.push(json!({"cursor": cursor, "result": page}));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    let wire = json!({"manifest": corpus_manifest(&conn).unwrap(), "pages": pages});
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut child = Command::new("python")
        .arg(root.join("developer/tests/ci/corpus_wire_probe.py"))
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(wire.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let requests = response["requests"].as_array().unwrap();
    assert_eq!(requests.len(), 2);
    for (request, page) in requests.iter().zip(pages.iter()) {
        let query: CorpusExportQuery = serde_json::from_value(request["query"].clone()).unwrap();
        assert_eq!(query.limit, 1);
        assert_eq!(serde_json::to_value(query.cursor).unwrap(), page["cursor"]);
    }
    let plan: ielts_domain::ContextPlan = serde_json::from_value(response["plan"].clone()).unwrap();
    assert_eq!(plan.ranked_item_ids.len(), 2);
    let selected: Vec<_> = plan
        .sections
        .iter()
        .flat_map(|section| section.item_ids.clone())
        .collect();
    assert_eq!(selected, plan.ranked_item_ids);
    assert!(plan.sections.iter().any(|section| section.section
        == ielts_domain::ContextSection::CurrentTask
        && section.item_ids.len() == 1));
}
