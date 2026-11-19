//! Shared listening fixtures for the integration suites.
//!
//! A listening pack is a manifest plus exam JSON plus audio. The tests build
//! one on disk so seeding exercises the same path the shipped pack will use.

#![allow(dead_code)]

use std::fs;
use std::path::Path;

use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

use ielts_db::{migrate, open_connection, DbOpenOptions};

pub fn open_db() -> (TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

/// A 48-byte canonical RIFF/WAVE file: header plus four bytes of silence.
pub fn wav_bytes() -> Vec<u8> {
    let mut bytes = Vec::with_capacity(48);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&40u32.to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&8_000u32.to_le_bytes());
    bytes.extend_from_slice(&16_000u32.to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&4u32.to_le_bytes());
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes
}

/// Six questions over four sections covering the scoring families:
/// completion with alternatives, single choice, multi choice (two answers),
/// and matching.
pub fn sample_payload() -> Value {
    json!({
        "schemaVersion": 1,
        "examId": "l1-test",
        "meta": {
            "title": "Listening Test 1",
            "category": "Section 1-4",
            "difficulty": "medium",
            "frequency": "high",
            "audio": "audio/exam.wav",
            "durationSeconds": 1800
        },
        "questionCount": 6,
        "questionOrder": ["q1", "q2", "q3", "q4", "q5", "q6"],
        "questionGroups": [
            {
                "groupId": "g1",
                "section": 1,
                "kind": "form_completion",
                "questionIds": ["q1", "q2"],
                "leadHtml": "<p>Complete the form.</p>",
                "bodyHtml": "<p>1 <input name=\"q1\" data-answer=\"waterproof\"></p><p>2 <input name=\"q2\" data-answer=\"silk\"></p>"
            },
            {
                "groupId": "g2",
                "section": 2,
                "kind": "single_choice",
                "questionIds": ["q3"],
                "leadHtml": "<p>Choose one.</p>",
                "bodyHtml": "<p>3 A B C</p>"
            },
            {
                "groupId": "g3",
                "section": 3,
                "kind": "multi_choice",
                "questionIds": ["q4"],
                "leadHtml": "<p>Choose two.</p>",
                "bodyHtml": "<p>4 A B C</p>"
            },
            {
                "groupId": "g4",
                "section": 4,
                "kind": "matching",
                "questionIds": ["q5", "q6"],
                "leadHtml": "<p>Match each item.</p>",
                "bodyHtml": "<p>5 A B</p>"
            }
        ],
        "interactionModel": {
            "q3": { "control": "radio" },
            "q4": { "control": "checkbox" }
        },
        "answerKey": {
            "q1": ["waterproof", "water proof"],
            "q2": "silk",
            "q3": "B",
            "q4": ["A", "C"],
            "q5": "A",
            "q6": "B"
        },
        "questionDisplayMap": {},
        "reviewExplanations": {}
    })
}

/// Write a valid pack (manifest, exam JSON, audio) and return the exam sha256.
pub fn write_pack(root: &Path, payload: &Value, audio: &[u8]) -> String {
    fs::create_dir_all(root.join("audio")).unwrap();
    fs::write(root.join("audio/exam.wav"), audio).unwrap();
    fs::write(
        root.join("exam.json"),
        serde_json::to_string_pretty(payload).unwrap(),
    )
    .unwrap();
    let raw = fs::read_to_string(root.join("exam.json")).unwrap();
    let sha = hex::encode(Sha256::digest(raw.as_bytes()));
    write_manifest(
        root,
        json!([{ "id": payload["examId"], "file": "exam.json", "sha256": sha }]),
    );
    sha
}

pub fn write_manifest(root: &Path, assets: Value) {
    let manifest = json!({ "schemaVersion": 1, "assets": assets });
    fs::write(
        root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
}

/// Rewrite the exam file for an already-indexed asset and return its new sha.
/// Used to reach states the seeder refuses to create (audio outside the pack).
pub fn rewrite_exam(root: &Path, payload: &Value) -> String {
    let raw = serde_json::to_string_pretty(payload).unwrap();
    fs::write(root.join("exam.json"), &raw).unwrap();
    hex::encode(Sha256::digest(raw.as_bytes()))
}

/// Insert an indexed listening asset without going through the seeder.
pub fn insert_listening_asset(conn: &Connection, root: &Path, payload: &Value) -> String {
    let sha = rewrite_exam(root, payload);
    let exam_path = root.join("exam.json").display().to_string();
    conn.execute(
        "INSERT INTO practice_assets (
            id, activity, source_kind, source_key, title, category, difficulty, frequency,
            content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at, updated_at
         ) VALUES (
            ?1, 'listening', 'builtin', ?1, 'Listening Test 1', NULL, NULL, NULL,
            ?2, 2, ?3, 0, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
         )",
        rusqlite::params![payload["examId"].as_str().unwrap(), exam_path, sha],
    )
    .unwrap();
    sha
}
