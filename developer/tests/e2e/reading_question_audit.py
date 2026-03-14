#!/usr/bin/env python3
"""逐题自动排查（静态结构 + UI真值回放）"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import sys
import traceback
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = REPO_ROOT / "index.html"
INDEX_URL = f"{INDEX_PATH.as_uri()}?test_env=1"
UNIFIED_READING_PATH = REPO_ROOT / "assets" / "generated" / "reading-exams" / "reading-practice-unified.html"
GENERATED_READING_DIR = REPO_ROOT / "assets" / "generated" / "reading-exams"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
SCREENSHOT_DIR = REPORT_DIR / "reading-question-audit-failures"
NODE_EXPORTER = REPO_ROOT / "developer" / "tests" / "tools" / "reading-json" / "export_generated_reading_dataset.node.js"

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_ERROR = 2

try:
    from playwright.async_api import (  # type: ignore[import-untyped]
        Browser,
        ConsoleMessage,
        Error as PlaywrightError,
        Page,
        TimeoutError as PlaywrightTimeoutError,
        async_playwright,
    )
except ModuleNotFoundError:
    VENV_DIR = (REPO_ROOT / ".venv").resolve()
    VENV_PYTHON = REPO_ROOT / ".venv" / "bin" / "python"
    CURRENT_PREFIX = Path(sys.prefix).resolve()
    if VENV_PYTHON.exists() and CURRENT_PREFIX != VENV_DIR:
        completed = subprocess.run(
            [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]],
            cwd=str(REPO_ROOT),
        )
        raise SystemExit(completed.returncode)
    print("Playwright Python 未安装且无法切换到 .venv，审计无法执行。", file=sys.stderr)
    raise SystemExit(EXIT_ERROR)


def log_step(message: str, level: str = "INFO") -> None:
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    prefix = {
        "INFO": "ℹ️",
        "SUCCESS": "✅",
        "WARNING": "⚠️",
        "ERROR": "❌",
        "DEBUG": "🔍",
    }.get(level, "•")
    print(f"[{timestamp}] {prefix} {message}")


@dataclass
class ConsoleEntry:
    page: str
    level: str
    text: str
    timestamp: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_question_id(raw_value: Any) -> str:
    if raw_value is None:
        return ""
    match = re.search(r"q(\d+)", str(raw_value).strip().lower())
    return f"q{match.group(1)}" if match else ""


def _normalize_text(raw_value: Any) -> str:
    value = str(raw_value or "")
    value = re.sub(r"^[A-Za-z]\.\s*", "", value.strip())
    value = re.sub(r"\s+", " ", value)
    return value.strip().lower()


def _snippet(text: str, start: int, end: Optional[int] = None, radius: int = 64) -> str:
    if end is None:
        end = start
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    excerpt = text[left:right]
    return re.sub(r"\s+", " ", excerpt).strip()


def _run_cmd_json(cmd: Sequence[str], cwd: Path = REPO_ROOT) -> Dict[str, Any]:
    completed = subprocess.run(
        list(cmd),
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"command_failed: {' '.join(cmd)} :: {stderr}")
    output = completed.stdout.strip()
    if not output:
        return {}
    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"command_output_not_json: {' '.join(cmd)} :: {exc}") from exc


def _run_git_changed_exam_ids() -> Set[str]:
    completed = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return set()
    changed = set()
    for raw_line in completed.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            continue
        path = parts[1].strip()
        match = re.match(r"assets/generated/reading-exams/(.+)\.js$", path)
        if match:
            changed.add(match.group(1))
    return changed


def _parse_frequency(exam_id: str) -> str:
    match = re.match(r"^p[123]-(high|medium|low)-", exam_id)
    return match.group(1) if match else ""


def _collect_manifest_entries() -> List[Dict[str, Any]]:
    payload = _run_cmd_json(["node", str(NODE_EXPORTER), "--list"])
    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise RuntimeError("manifest_entries_missing")
    return [entry for entry in entries if isinstance(entry, dict) and entry.get("examId")]


def _load_dataset(exam_id: str) -> Dict[str, Any]:
    payload = _run_cmd_json(["node", str(NODE_EXPORTER), "--exam-id", exam_id])
    if not isinstance(payload, dict) or not payload.get("examId"):
        raise RuntimeError(f"dataset_invalid:{exam_id}")
    return payload


def _extract_html_fragments(dataset: Dict[str, Any]) -> List[Tuple[str, str]]:
    fragments: List[Tuple[str, str]] = []
    intro = dataset.get("metaQuestionIntroHtml")
    if isinstance(intro, str) and intro.strip():
        fragments.append(("meta.questionIntroHtml", intro))
    for group in dataset.get("questionGroups") or []:
        if not isinstance(group, dict):
            continue
        group_id = str(group.get("groupId") or "unknown")
        lead = group.get("leadHtml")
        body = group.get("bodyHtml")
        if isinstance(lead, str) and lead.strip():
            fragments.append((f"{group_id}.leadHtml", lead))
        if isinstance(body, str) and body.strip():
            fragments.append((f"{group_id}.bodyHtml", body))
    return fragments


def _question_order_set(question_order: Sequence[Any]) -> Tuple[List[str], Set[str]]:
    normalized: List[str] = []
    for item in question_order:
        qid = _normalize_question_id(item)
        if qid:
            normalized.append(qid)
    return normalized, set(normalized)


def _expected_question_order(length: int) -> List[str]:
    return [f"q{i}" for i in range(1, length + 1)]


def _static_audit_exam(exam_id: str, dataset: Dict[str, Any], raw_script: str) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    question_order_raw = dataset.get("questionOrder") or []
    if not isinstance(question_order_raw, list):
        issues.append({
            "type": "question_order_invalid",
            "message": "questionOrder 不是数组"
        })
        question_order_raw = []

    question_order, question_set = _question_order_set(question_order_raw)
    expected = _expected_question_order(len(question_order))
    if question_order != expected:
        issues.append({
            "type": "question_order_not_contiguous",
            "message": "questionOrder 非 q1..qN 连续序列",
            "actual": question_order,
            "expected": expected,
        })

    answer_key_raw = dataset.get("answerKey")
    if not isinstance(answer_key_raw, dict):
        issues.append({
            "type": "answer_key_invalid",
            "message": "answerKey 不是对象"
        })
        answer_key_raw = {}

    answer_key_keys = sorted({
        _normalize_question_id(key) for key in answer_key_raw.keys()
        if _normalize_question_id(key)
    }, key=lambda item: int(item[1:]))
    answer_key_set = set(answer_key_keys)
    if answer_key_set != question_set:
        issues.append({
            "type": "answer_key_question_order_mismatch",
            "message": "answerKey 键集合与 questionOrder 不一致",
            "questionOrderOnly": sorted(question_set - answer_key_set, key=lambda item: int(item[1:])),
            "answerKeyOnly": sorted(answer_key_set - question_set, key=lambda item: int(item[1:])),
        })

    fragments = _extract_html_fragments(dataset)
    ref_rules = [
        ("name", re.compile(r'name\s*=\s*["\'](q\d+)["\']', re.IGNORECASE)),
        ("data-question", re.compile(r'data-question\s*=\s*["\'](q\d+)["\']', re.IGNORECASE)),
        ("data-target", re.compile(r'data-target\s*=\s*["\'](q\d+)["\']', re.IGNORECASE)),
    ]

    seen_ref_issues: Set[Tuple[str, str, str]] = set()
    for source, html in fragments:
        for attr_name, pattern in ref_rules:
            for match in pattern.finditer(html):
                qid = _normalize_question_id(match.group(1))
                if not qid or qid in question_set:
                    continue
                key = (source, attr_name, qid)
                if key in seen_ref_issues:
                    continue
                seen_ref_issues.add(key)
                issues.append({
                    "type": "dom_reference_outside_question_order",
                    "message": f"{attr_name} 引用 {qid} 不在 questionOrder 内",
                    "source": source,
                    "questionId": qid,
                    "snippet": _snippet(html, match.start(), match.end()),
                })

        drop_target_pattern = re.compile(
            r"<(?P<tag>[a-zA-Z0-9]+)\b(?P<attrs>[^>]*class\s*=\s*[\"'][^\"']*\bdrop-target-summary\b[^\"']*[\"'][^>]*)>",
            re.IGNORECASE,
        )
        for tag_match in drop_target_pattern.finditer(html):
            attrs = tag_match.group("attrs")
            dq = re.search(r'data-question\s*=\s*["\'](q\d+)["\']', attrs, re.IGNORECASE)
            if not dq:
                issues.append({
                    "type": "drop_target_summary_missing_data_question",
                    "message": "drop-target-summary 缺少 data-question",
                    "source": source,
                    "snippet": _snippet(html, tag_match.start(), tag_match.end()),
                })
                continue
            qid = _normalize_question_id(dq.group(1))
            if qid not in question_set:
                issues.append({
                    "type": "drop_target_summary_invalid_question",
                    "message": f"drop-target-summary data-question={qid} 不在 questionOrder 内",
                    "source": source,
                    "questionId": qid,
                    "snippet": _snippet(html, tag_match.start(), tag_match.end()),
                })

    combined_html = "\n".join([text for _, text in fragments])
    legacy_button_pattern = re.compile(
        r"<button[^>]*>\s*(Submit Answers|Reset|Notes)\s*</button>",
        re.IGNORECASE,
    )
    legacy_onclick_pattern = re.compile(
        r'onclick\s*=\s*["\'][^"\']*(submitAnswers|resetAll|toggleNotes)\s*\(',
        re.IGNORECASE,
    )
    if legacy_button_pattern.search(combined_html):
        issues.append({
            "type": "legacy_buttons_found",
            "message": "检测到旧按钮 Submit Answers/Reset/Notes",
        })
    if legacy_onclick_pattern.search(combined_html) or legacy_onclick_pattern.search(raw_script):
        issues.append({
            "type": "legacy_onclick_found",
            "message": "检测到旧 onclick 提交/重置/笔记入口",
        })

    return issues


def _build_quick_ui_targets(entries: Sequence[Dict[str, Any]]) -> List[str]:
    exam_ids = sorted([str(entry["examId"]) for entry in entries if entry.get("examId")], key=lambda item: item)
    selected: Set[str] = set()
    stratified: Dict[Tuple[str, str], str] = {}
    for exam_id in exam_ids:
        freq = _parse_frequency(exam_id)
        category = (exam_id.split("-", 1)[0] or "").upper()
        if not freq or not category:
            continue
        key = (category, freq)
        if key not in stratified:
            stratified[key] = exam_id
    selected.update(stratified.values())

    changed = _run_git_changed_exam_ids()
    selected.update([exam_id for exam_id in changed if exam_id in exam_ids])

    # quick 兜底：至少覆盖 12 题（不足时从头补齐）
    if len(selected) < 12:
        for exam_id in exam_ids:
            selected.add(exam_id)
            if len(selected) >= 12:
                break

    return sorted(selected, key=lambda item: item)


def _collect_answer_tokens(answer: Any, for_checkbox: bool) -> List[str]:
    if answer is None:
        return []
    if isinstance(answer, list):
        values = [str(item).strip() for item in answer if str(item).strip()]
        return values
    value = str(answer).strip()
    if not value:
        return []
    if "," in value:
        return [item.strip() for item in value.split(",") if item.strip()]
    if for_checkbox and re.fullmatch(r"[A-Za-z]{2,}", value):
        return list(value)
    return [value]


JS_APPLY_ANSWER = r"""
({ questionId, displayId, answer }) => {
  const normalize = (value) => String(value == null ? '' : value)
    .replace(/^[A-Za-z]\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const safeQueryAll = (selector, root = document) => {
    if (!selector || !root || typeof root.querySelectorAll !== 'function') {
      return [];
    }
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (_) {
      return [];
    }
  };

  const answerAsText = String(answer == null ? '' : answer);
  const primaryAliases = Array.from(new Set([
    String(questionId || '').trim()
  ].filter(Boolean)));
  const secondaryAliases = Array.from(new Set([
    displayId ? `q${String(displayId).trim()}` : '',
    displayId ? String(displayId).trim() : ''
  ].filter(Boolean))).filter((alias) => !primaryAliases.includes(alias));
  const aliases = [...primaryAliases, ...secondaryAliases];
  const normalizeQuestionId = (rawValue) => {
    if (rawValue == null) return '';
    const rawText = String(rawValue).trim().toLowerCase();
    if (!rawText) return '';
    const direct = rawText.match(/^q(\d+)$/);
    if (direct) return `q${direct[1]}`;
    const digits = rawText.match(/(\d+)/);
    return digits ? `q${digits[1]}` : '';
  };
  const expandQuestionSequence = (rawValue) => {
    if (!rawValue) return [];
    const value = String(rawValue).trim().toLowerCase();
    const numbers = (value.match(/\d+/g) || []).map((entry) => Number(entry));
    if ((value.includes('-') || value.includes('–')) && numbers.length > 2) {
      return numbers.map((entry) => `q${entry}`);
    }
    if ((value.includes('-') || value.includes('–')) && numbers.length === 2 && numbers[1] >= numbers[0]) {
      const ids = [];
      for (let current = numbers[0]; current <= numbers[1]; current += 1) {
        ids.push(`q${current}`);
      }
      return ids;
    }
    if (value.includes('_') && numbers.length >= 2) {
      return numbers.map((entry) => `q${entry}`);
    }
    const normalized = normalizeQuestionId(value);
    return normalized ? [normalized] : [];
  };

  const findRadiosByAliases = (aliasList) => aliasList.map((alias) => ({
    alias,
    nodes: safeQueryAll(`input[type="radio"][name="${alias}"]`)
  })).find((entry) => entry.nodes.length > 0);
  const radiosByAlias = findRadiosByAliases(primaryAliases) || findRadiosByAliases(secondaryAliases);

  if (radiosByAlias) {
    const token = normalize(answerAsText);
    const selected = radiosByAlias.nodes.find((node) => normalize(node.value) === token)
      || radiosByAlias.nodes.find((node) => normalize(node.value).startsWith(token))
      || radiosByAlias.nodes.find((node) => {
        const label = node.closest('label');
        return label && normalize(label.textContent || '') === token;
      });
    if (!selected) {
      return {
        ok: false,
        type: 'radio',
        message: 'radio_option_not_found',
        alias: radiosByAlias.alias,
        available: radiosByAlias.nodes.map((node) => node.value || '')
      };
    }
    selected.checked = true;
    selected.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, type: 'radio', alias: radiosByAlias.alias, value: selected.value || '' };
  }

  const checkboxGroups = (() => {
    const grouped = new Map();
    safeQueryAll('input[type="checkbox"][name]').forEach((node) => {
      const name = String(node.name || '').trim();
      if (!name) return;
      if (!grouped.has(name)) {
        grouped.set(name, []);
      }
      grouped.get(name).push(node);
    });
    return grouped;
  })();
  const findCheckboxesByAliases = (aliasList) => {
    for (const alias of aliasList) {
      const aliasRaw = String(alias || '').trim();
      if (!aliasRaw) continue;
      const normalizedAlias = normalizeQuestionId(aliasRaw);

      if (checkboxGroups.has(aliasRaw)) {
        return {
          alias: aliasRaw,
          name: aliasRaw,
          nodes: checkboxGroups.get(aliasRaw),
          questionIds: expandQuestionSequence(aliasRaw)
        };
      }

      for (const [name, nodes] of checkboxGroups.entries()) {
        const questionIds = expandQuestionSequence(name);
        if (normalizedAlias && questionIds.includes(normalizedAlias)) {
          return {
            alias: aliasRaw,
            name,
            nodes,
            questionIds
          };
        }
      }
    }
    return null;
  };
  const checkboxesByAlias = findCheckboxesByAliases(primaryAliases) || findCheckboxesByAliases(secondaryAliases);

  if (checkboxesByAlias && checkboxesByAlias.nodes.length > 0) {
    let tokens = [];
    if (Array.isArray(answer)) {
      tokens = answer.map((item) => String(item).trim()).filter(Boolean);
    } else if (answerAsText.includes(',')) {
      tokens = answerAsText.split(',').map((item) => item.trim()).filter(Boolean);
    } else if (/^[A-Za-z]{2,}$/.test(answerAsText.trim())) {
      tokens = answerAsText.trim().split('');
    } else {
      tokens = [answerAsText.trim()].filter(Boolean);
    }
    const normalizedTokens = tokens.map((item) => normalize(item));
    const isGrouped = Array.isArray(checkboxesByAlias.questionIds) && checkboxesByAlias.questionIds.length > 1;
    checkboxesByAlias.nodes.forEach((node) => {
      const shouldCheck = normalizedTokens.includes(normalize(node.value));
      if (isGrouped) {
        // grouped checkbox sets (e.g. q1_2 / q11-12-13) should accumulate choices across per-question replay calls
        if (shouldCheck) {
          node.checked = true;
        }
      } else {
        node.checked = shouldCheck;
      }
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const checked = checkboxesByAlias.nodes.filter((node) => node.checked).length;
    return {
      ok: checked > 0,
      type: 'checkbox',
      alias: checkboxesByAlias.alias,
      name: checkboxesByAlias.name,
      checked,
      grouped: isGrouped
    };
  }

  const textCandidates = [];
  const collectTextCandidates = (aliasList) => {
    const candidates = [];
    aliasList.forEach((alias) => {
      candidates.push(...safeQueryAll(`input:not([type="radio"]):not([type="checkbox"])[name="${alias}"], textarea[name="${alias}"], select[name="${alias}"]`));
      candidates.push(
        ...[
          document.getElementById(`${alias}_input`),
          document.getElementById(`${alias}-input`),
          document.getElementById(`${alias}_answer`)
        ].filter(Boolean)
      );
    });
    return candidates;
  };
  textCandidates.push(...collectTextCandidates(primaryAliases));
  const hasPrimaryDropzoneTarget = primaryAliases.some((alias) => (
    safeQueryAll(`.match-dropzone[data-question="${alias}"], .drop-target-summary[data-question="${alias}"], .dropzone[data-target="${alias}"], .dropzone[data-question="${alias}"]`).length > 0
    || !!document.getElementById(`${alias}-anchor`)
  ));
  if (textCandidates.length === 0 && secondaryAliases.length > 0 && !hasPrimaryDropzoneTarget) {
    textCandidates.push(...collectTextCandidates(secondaryAliases));
  }
  const textFields = Array.from(new Set(textCandidates)).filter((node) => node instanceof HTMLElement);
  if (textFields.length > 0) {
    const arrayTokens = Array.isArray(answer)
      ? answer.map((item) => String(item == null ? '' : item).trim()).filter(Boolean)
      : [];
    const scalarValue = Array.isArray(answer)
      ? (arrayTokens[0] || '')
      : answerAsText;
    textFields.forEach((field, index) => {
      const value = arrayTokens.length > 1
        ? (arrayTokens[index] || arrayTokens[arrayTokens.length - 1] || '')
        : scalarValue;
      if (field.tagName === 'SELECT') {
        const options = Array.from(field.options || []);
        const selected = options.find((opt) => normalize(opt.value) === normalize(value))
          || options.find((opt) => normalize(opt.textContent || '') === normalize(value));
        if (selected) {
          field.value = selected.value;
        } else {
          field.value = value;
        }
      } else {
        field.value = value;
      }
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return { ok: true, type: 'textual', fields: textFields.length, value: scalarValue || answerAsText };
  }

  const resolvePoolCandidate = (tokenRaw) => {
    const token = normalize(tokenRaw);
    const poolSelectors = [
      '.pool-items .drag-item',
      '#word-options .draggable-word',
      '#word-options .drag-item',
      '.options-pool .drag-item',
      '.cardpool .card',
      '.cardpool .drag-item',
      '.draggable-word',
      '.drag-item'
    ].join(',');
    const candidates = safeQueryAll(poolSelectors);
    const fromNode = (node) => {
      const dataValue = node.dataset.option || node.dataset.word || node.dataset.key
        || node.dataset.value || node.dataset.answerValue || node.dataset.heading || '';
      const text = (node.textContent || '').trim();
      const leadingLetterMatch = text.match(/^([A-Za-z])[\.\s]/);
      const leadingLetter = leadingLetterMatch ? leadingLetterMatch[1] : '';
      return {
        label: text || tokenRaw,
        value: dataValue || leadingLetter || String(tokenRaw || '').trim()
      };
    };

    const exact = candidates.find((node) => normalize(node.dataset.option || node.dataset.word || node.dataset.key || node.dataset.value || node.dataset.answerValue || node.dataset.heading || '') === token)
      || candidates.find((node) => normalize(node.textContent || '') === token)
      || candidates.find((node) => normalize(node.textContent || '').startsWith(token))
      || candidates.find((node) => {
        const text = (node.textContent || '').trim();
        const leadingLetterMatch = text.match(/^([A-Za-z])[\.\s]/);
        const leadingLetter = leadingLetterMatch ? leadingLetterMatch[1] : '';
        return normalize(leadingLetter) === token;
      });
    if (exact) {
      return fromNode(exact);
    }
    return {
      label: String(tokenRaw || '').trim(),
      value: String(tokenRaw || '').trim()
    };
  };

  const targetCandidates = [];
  aliases.forEach((alias) => {
    targetCandidates.push(...safeQueryAll(`.match-dropzone[data-question="${alias}"], .drop-target-summary[data-question="${alias}"], .dropzone[data-target="${alias}"], .dropzone[data-question="${alias}"]`));
    const summaryTarget = document.getElementById(`${alias}-target`);
    if (summaryTarget && summaryTarget.classList.contains('drop-target-summary')) {
      targetCandidates.push(summaryTarget);
    }
    const anchor = document.getElementById(`${alias}-anchor`);
    if (anchor) {
      targetCandidates.push(...safeQueryAll('.paragraph-dropzone, .match-dropzone, .drop-target-summary, .dropzone', anchor.parentElement));
      targetCandidates.push(...safeQueryAll('.paragraph-dropzone, .match-dropzone, .drop-target-summary, .dropzone', anchor.closest('.question-item, .group, section, div')));
    }
  });
  const target = targetCandidates.find(Boolean);

  if (!target) {
    return { ok: false, type: 'unresolved', message: 'question_target_not_found', aliases };
  }

  const resolved = resolvePoolCandidate(answerAsText);
  const value = String(resolved.value || answerAsText || '').trim();
  const label = String(resolved.label || value).trim();

  const createItem = (className) => {
    const node = document.createElement('div');
    node.className = className;
    node.textContent = label;
    node.dataset.option = value;
    node.dataset.value = value;
    node.dataset.answerValue = value;
    node.dataset.answerLabel = label;
    node.dataset.heading = value;
    node.dataset.word = value;
    node.dataset.key = value;
    return node;
  };

  if (target.classList.contains('drop-target-summary')) {
    target.innerHTML = '';
    target.appendChild(createItem('drag-item'));
    target.dataset.answerValue = value;
    target.dataset.answerLabel = label;
    return { ok: true, type: 'drop-target-summary', value };
  }

  if (target.classList.contains('paragraph-dropzone')) {
    let holder = target.querySelector('.dropped-items');
    if (!holder) {
      holder = document.createElement('div');
      holder.className = 'dropped-items';
      target.appendChild(holder);
    }
    holder.innerHTML = '';
    holder.appendChild(createItem('drag-item'));
    target.dataset.answerValue = value;
    return { ok: true, type: 'paragraph-dropzone', value };
  }

  if (target.classList.contains('match-dropzone')) {
    target.innerHTML = '';
    target.appendChild(createItem('drag-item'));
    target.dataset.answerValue = value;
    return { ok: true, type: 'match-dropzone', value };
  }

  if (target.classList.contains('dropzone')) {
    target.innerHTML = '';
    target.appendChild(createItem('drag-item card'));
    target.dataset.answerValue = value;
    return { ok: true, type: 'dropzone', value };
  }

  return { ok: false, type: 'unresolved', message: 'unsupported_target_type' };
}
"""

JS_READ_RESULTS = r"""
() => {
  const resultsEl = document.getElementById('results');
  const rows = Array.from(resultsEl?.querySelectorAll('tbody tr') || []).map((row) => {
    const cells = Array.from(row.querySelectorAll('td'));
    const question = (cells[0]?.textContent || '').trim();
    const userAnswer = (cells[1]?.textContent || '').trim();
    const correctAnswer = (cells[2]?.textContent || '').trim();
    const statusCell = cells[3];
    const statusText = (statusCell?.textContent || '').trim();
    const isCorrect = !!statusCell && (
      statusCell.classList.contains('result-correct')
      || /✓/u.test(statusText)
    );
    return { question, userAnswer, correctAnswer, statusText, isCorrect };
  });

  const scoreText = (resultsEl?.querySelector('p')?.textContent || '').trim();
  const scoreMatch = scoreText.match(/得分\s*(\d+)\s*\/\s*(\d+)/);
  const scoreCorrect = scoreMatch ? Number(scoreMatch[1]) : null;
  const scoreTotal = scoreMatch ? Number(scoreMatch[2]) : null;

  const unansweredRows = rows.filter((item) => !item.userAnswer || item.userAnswer === '未作答' || /No Answer/i.test(item.userAnswer));
  const incorrectRows = rows.filter((item) => !item.isCorrect);

  return {
    scoreText,
    scoreCorrect,
    scoreTotal,
    rowsCount: rows.length,
    unansweredRows,
    incorrectRows
  };
}
"""


def _collect_console(page: Page, store: List[ConsoleEntry]) -> None:
    def _handler(message: ConsoleMessage) -> None:
        level = message.type
        store.append(
            ConsoleEntry(
                page=page.url,
                level=level,
                text=message.text,
                timestamp=_now_iso(),
            )
        )

    page.on("console", _handler)


async def _launch_browser(playwright_obj) -> Browser:
    try:
        return await playwright_obj.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"],
        )
    except Exception as exc:  # pragma: no cover - defensive fallback
        log_step(f"Chromium 参数启动失败，回退默认参数: {exc}", "WARNING")
        return await playwright_obj.chromium.launch(headless=True)


def _ui_exam_ids(entries: Sequence[Dict[str, Any]], mode: str) -> List[str]:
    all_exam_ids = sorted([str(entry.get("examId", "")).strip() for entry in entries if entry.get("examId")], key=lambda item: item)
    if mode == "full":
        return all_exam_ids
    return _build_quick_ui_targets(entries)


async def _audit_single_exam_ui(
    context,
    exam_id: str,
    dataset: Dict[str, Any],
    screenshot_root: Path,
) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "examId": exam_id,
        "status": "pass",
        "fillFailures": [],
        "warnings": [],
        "error": "",
        "durationSec": 0.0,
    }
    started = datetime.now()
    console_entries: List[ConsoleEntry] = []
    page: Optional[Page] = None
    try:
        page = await context.new_page()
        page.set_default_timeout(30000)
        _collect_console(page, console_entries)

        exam_url = f"{UNIFIED_READING_PATH.as_uri()}?examId={exam_id}&test_env=1"
        await page.goto(exam_url, wait_until="load")
        await page.wait_for_selector("#question-groups", timeout=30000)
        await page.wait_for_selector("#submit-btn", timeout=30000)
        await page.wait_for_function(
            "() => document.querySelectorAll('#question-groups .unified-group').length > 0",
            timeout=30000,
        )

        question_order = dataset.get("questionOrder") if isinstance(dataset.get("questionOrder"), list) else []
        answer_key = dataset.get("answerKey") if isinstance(dataset.get("answerKey"), dict) else {}
        display_map = dataset.get("questionDisplayMap") if isinstance(dataset.get("questionDisplayMap"), dict) else {}

        for question_id in question_order:
            normalized_id = _normalize_question_id(question_id)
            if not normalized_id:
                continue
            answer = answer_key.get(normalized_id)
            response = await page.evaluate(
                JS_APPLY_ANSWER,
                {
                    "questionId": normalized_id,
                    "displayId": str(display_map.get(normalized_id, "")),
                    "answer": answer,
                },
            )
            if not isinstance(response, dict) or not response.get("ok"):
                result["fillFailures"].append({
                    "questionId": normalized_id,
                    "answer": answer,
                    "detail": response,
                })

        await page.click("#submit-btn")
        await page.wait_for_function(
            "() => { const el = document.getElementById('results'); return !!(el && el.style.display !== 'none' && el.querySelectorAll('tbody tr').length > 0); }",
            timeout=30000,
        )
        ui_result = await page.evaluate(JS_READ_RESULTS)
        if not isinstance(ui_result, dict):
            raise RuntimeError("ui_result_invalid")

        rows_count = int(ui_result.get("rowsCount") or 0)
        unanswered = ui_result.get("unansweredRows") or []
        incorrect = ui_result.get("incorrectRows") or []
        score_correct = ui_result.get("scoreCorrect")
        score_total = ui_result.get("scoreTotal")
        expected_rows = len(question_order)

        assertion_failures: List[str] = []
        if rows_count < expected_rows:
            assertion_failures.append(f"rows_count_mismatch:{rows_count}<{expected_rows}")
        if unanswered:
            assertion_failures.append(f"unanswered_rows:{len(unanswered)}")
        if incorrect:
            assertion_failures.append(f"incorrect_rows:{len(incorrect)}")
        if score_correct is None or score_total is None:
            assertion_failures.append("score_parse_failed")
        elif int(score_correct) != int(score_total):
            assertion_failures.append(f"score_not_full:{score_correct}/{score_total}")

        result["uiResult"] = ui_result
        if assertion_failures:
            result["status"] = "fail"
            result["error"] = ";".join(assertion_failures)
            result["failureType"] = "assertion"

        warning_logs = [
            {
                "level": item.level,
                "text": item.text,
                "timestamp": item.timestamp,
            }
            for item in console_entries
            if item.level in {"warning", "error"}
        ]
        if warning_logs:
            result["warnings"] = warning_logs[:20]

        if result["status"] == "fail":
            screenshot_root.mkdir(parents=True, exist_ok=True)
            screenshot_path = screenshot_root / f"{exam_id}.png"
            await page.screenshot(path=str(screenshot_path), full_page=True)
            result["screenshot"] = str(screenshot_path.relative_to(REPO_ROOT))

    except PlaywrightTimeoutError as exc:
        result["status"] = "fail"
        result["error"] = f"timeout:{exc}"
        result["failureType"] = "timeout"
        if page is not None:
            screenshot_root.mkdir(parents=True, exist_ok=True)
            screenshot_path = screenshot_root / f"{exam_id}-timeout.png"
            try:
                await page.screenshot(path=str(screenshot_path), full_page=True)
                result["screenshot"] = str(screenshot_path.relative_to(REPO_ROOT))
            except Exception:
                pass
    except PlaywrightError as exc:
        result["status"] = "fail"
        result["error"] = f"playwright_error:{exc}"
        result["failureType"] = "playwright_error"
    except Exception as exc:  # pragma: no cover - defensive
        result["status"] = "fail"
        result["error"] = f"unexpected:{exc}"
        result["failureType"] = "unexpected"
    finally:
        finished = datetime.now()
        result["durationSec"] = round((finished - started).total_seconds(), 3)
        if page is not None and not page.is_closed():
            await page.close()
    return result


def _make_markdown_report(report: Dict[str, Any]) -> str:
    summary = report.get("summary", {})
    static_failures = report.get("staticFailures", [])
    ui_failures = report.get("uiFailures", [])
    flaky_candidates = report.get("flakyCandidates", [])
    lines = [
        "# Reading Question Audit",
        "",
        f"- Mode: `{report.get('mode', '')}`",
        f"- Generated: `{report.get('generatedAt', '')}`",
        f"- Static audited: `{summary.get('staticAudited', 0)}`",
        f"- Static passed: `{summary.get('staticPassed', 0)}`",
        f"- Static failed: `{summary.get('staticFailed', 0)}`",
        f"- UI audited: `{summary.get('uiAudited', 0)}`",
        f"- UI passed: `{summary.get('uiPassed', 0)}`",
        f"- UI failed: `{summary.get('uiFailed', 0)}`",
        f"- Static pass rate: `{summary.get('staticPassRate', 0)}%`",
        f"- UI pass rate: `{summary.get('uiPassRate', 0)}%`",
        f"- UI average duration: `{summary.get('uiAverageDurationSec', 0)}s`",
        f"- Exit code: `{summary.get('exitCode', '')}`",
        "",
    ]

    lines.append("## Static Failures")
    if not static_failures:
        lines.append("- None")
    else:
        for item in static_failures:
            lines.append(f"- `{item.get('examId')}`: {len(item.get('issues') or [])} issues")
    lines.append("")

    lines.append("## UI Failures")
    if not ui_failures:
        lines.append("- None")
    else:
        for item in ui_failures:
            error = item.get("error", "")
            screenshot = item.get("screenshot", "")
            if screenshot:
                lines.append(f"- `{item.get('examId')}`: {error} (`{screenshot}`)")
            else:
                lines.append(f"- `{item.get('examId')}`: {error}")
    lines.append("")

    lines.append("## Flaky Candidates")
    if not flaky_candidates:
        lines.append("- None")
    else:
        for item in flaky_candidates:
            lines.append(f"- `{item.get('examId')}`: {item.get('error')}")
    lines.append("")
    return "\n".join(lines)


async def run_audit(mode: str) -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

    log_step("读取 manifest 并收集题目列表")
    entries = _collect_manifest_entries()
    entries_by_exam: Dict[str, Dict[str, Any]] = {str(entry["examId"]): entry for entry in entries}
    all_exam_ids = sorted(entries_by_exam.keys(), key=lambda item: item)
    ui_exam_ids = _ui_exam_ids(entries, mode)
    log_step(f"manifest 题目数: {len(all_exam_ids)}")
    log_step(f"UI审计题目数({mode}): {len(ui_exam_ids)}")

    datasets: Dict[str, Dict[str, Any]] = {}
    static_failures: List[Dict[str, Any]] = []
    static_results: List[Dict[str, Any]] = []

    log_step("阶段A: 静态结构审计开始")
    for index, exam_id in enumerate(all_exam_ids, start=1):
        try:
            dataset = _load_dataset(exam_id)
            datasets[exam_id] = dataset
            script_rel = str(dataset.get("script") or entries_by_exam[exam_id].get("script") or "")
            script_path = GENERATED_READING_DIR / script_rel.replace("./", "")
            if not script_path.exists():
                issues = [{
                    "type": "dataset_script_missing",
                    "message": f"题源脚本不存在: {script_rel}",
                }]
            else:
                raw_script = script_path.read_text(encoding="utf-8")
                issues = _static_audit_exam(exam_id, dataset, raw_script)
        except Exception as exc:
            issues = [{
                "type": "dataset_load_failed",
                "message": str(exc),
            }]

        status = "pass" if not issues else "fail"
        static_results.append({
            "examId": exam_id,
            "status": status,
            "issues": issues,
        })
        if issues:
            static_failures.append({
                "examId": exam_id,
                "issues": issues,
            })
        if index % 25 == 0 or index == len(all_exam_ids):
            log_step(f"静态审计进度: {index}/{len(all_exam_ids)}")

    log_step(f"阶段A完成: 失败 {len(static_failures)} / {len(all_exam_ids)}", "SUCCESS" if not static_failures else "WARNING")

    log_step("阶段B: UI真值回放审计开始")
    ui_results: List[Dict[str, Any]] = []
    ui_failures: List[Dict[str, Any]] = []
    flaky_candidates: List[Dict[str, Any]] = []

    async with async_playwright() as playwright_obj:
        browser = await _launch_browser(playwright_obj)
        context = await browser.new_context(ignore_https_errors=True)
        # 先打开 index 验证 file:// 环境初始化（与既有 E2E 一致）
        bootstrap_page = await context.new_page()
        await bootstrap_page.goto(INDEX_URL, wait_until="load")
        await bootstrap_page.close()

        for index, exam_id in enumerate(ui_exam_ids, start=1):
            dataset = datasets.get(exam_id)
            if not dataset:
                try:
                    dataset = _load_dataset(exam_id)
                    datasets[exam_id] = dataset
                except Exception as exc:
                    fail_result = {
                        "examId": exam_id,
                        "status": "fail",
                        "error": f"dataset_load_failed:{exc}",
                        "failureType": "dataset_load_failed",
                        "durationSec": 0.0,
                    }
                    ui_results.append(fail_result)
                    ui_failures.append(fail_result)
                    continue

            log_step(f"UI审计 {index}/{len(ui_exam_ids)}: {exam_id}")
            result = await _audit_single_exam_ui(context, exam_id, dataset, SCREENSHOT_DIR)
            ui_results.append(result)
            if result.get("status") != "pass":
                ui_failures.append(result)
                if result.get("failureType") in {"timeout", "playwright_error"}:
                    flaky_candidates.append({
                        "examId": exam_id,
                        "error": result.get("error", ""),
                        "failureType": result.get("failureType", ""),
                    })

        await context.close()
        await browser.close()

    static_passed = len(all_exam_ids) - len(static_failures)
    ui_passed = len(ui_exam_ids) - len(ui_failures)
    static_pass_rate = round((static_passed / len(all_exam_ids)) * 100, 2) if all_exam_ids else 0.0
    ui_pass_rate = round((ui_passed / len(ui_exam_ids)) * 100, 2) if ui_exam_ids else 0.0
    ui_total_duration_sec = round(sum(float(item.get("durationSec", 0.0) or 0.0) for item in ui_results), 3)
    ui_average_duration_sec = round(ui_total_duration_sec / len(ui_results), 3) if ui_results else 0.0

    static_issue_distribution = Counter()
    for item in static_failures:
        for issue in item.get("issues") or []:
            static_issue_distribution[str(issue.get("type") or "unknown")] += 1

    ui_failure_distribution = Counter()
    ui_assertion_distribution = Counter()
    for item in ui_failures:
        failure_type = str(item.get("failureType") or "unknown")
        ui_failure_distribution[failure_type] += 1
        if failure_type == "assertion":
            for token in str(item.get("error") or "").split(";"):
                token = token.strip()
                if not token:
                    continue
                key = token.split(":", 1)[0]
                ui_assertion_distribution[key] += 1

    exit_code = EXIT_OK if (not static_failures and not ui_failures) else EXIT_FAIL

    report: Dict[str, Any] = {
        "generatedAt": _now_iso(),
        "mode": mode,
        "summary": {
            "staticAudited": len(all_exam_ids),
            "staticPassed": static_passed,
            "staticFailed": len(static_failures),
            "staticPassRate": static_pass_rate,
            "uiAudited": len(ui_exam_ids),
            "uiPassed": ui_passed,
            "uiFailed": len(ui_failures),
            "uiPassRate": ui_pass_rate,
            "uiTotalDurationSec": ui_total_duration_sec,
            "uiAverageDurationSec": ui_average_duration_sec,
            "staticIssueDistribution": dict(static_issue_distribution),
            "uiFailureDistribution": dict(ui_failure_distribution),
            "uiAssertionDistribution": dict(ui_assertion_distribution),
            "exitCode": exit_code,
        },
        "staticFailures": static_failures,
        "uiFailures": ui_failures,
        "flakyCandidates": flaky_candidates,
        "staticResults": static_results,
        "uiResults": ui_results,
    }

    json_report_path = REPORT_DIR / f"reading-question-audit-{mode}.json"
    md_report_path = REPORT_DIR / f"reading-question-audit-{mode}.md"
    json_report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_report_path.write_text(_make_markdown_report(report) + "\n", encoding="utf-8")

    log_step(f"JSON 报告: {json_report_path.relative_to(REPO_ROOT)}")
    log_step(f"Markdown 报告: {md_report_path.relative_to(REPO_ROOT)}")
    if ui_failures:
        log_step(f"UI失败: {len(ui_failures)}", "WARNING")
    if static_failures:
        log_step(f"静态失败: {len(static_failures)}", "WARNING")
    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description="Reading 逐题自动排查脚本")
    parser.add_argument(
        "--mode",
        choices=["quick", "full"],
        default="quick",
        help="quick: PR/本地快速；full: 全量",
    )
    args = parser.parse_args()

    try:
        return asyncio.run(run_audit(args.mode))
    except Exception:
        traceback.print_exc()
        return EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
