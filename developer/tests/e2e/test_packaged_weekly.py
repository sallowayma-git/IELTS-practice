"""Pure helpers of the packaged weekly flow: fake clock, v3 answer and question kinds."""
import json
import re
import sqlite3
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone

import packaged_tauri_flow as flow

PLUS_8 = timezone(timedelta(hours=8))
WEEKLY_SYSTEM = (
    "Write one evidence-grounded weekly journal in Simplified Chinese. Return strict JSON."
)
ASCII_DIGITS = re.compile(r"[0-9]")
CHINESE_COUNT = re.compile(r"[一二两三四五六七八九十几]+(?:多|余)?[次套篇道题分]")
QUOTES = re.compile(r"[\"“”「」]")


def weekly_body(user_content: str, system: str = WEEKLY_SYSTEM) -> dict:
    return {"messages": [{"role": "system", "content": system}, {"role": "user", "content": user_content}]}


def fact(value, fmt: str = "number", asset_ids: list[str] | None = None) -> dict:
    return {
        "value": value,
        "label": "测试事实",
        "format": fmt,
        "source": "test",
        "provenance": {"assetIds": asset_ids} if asset_ids else {},
    }


class FakeClockTests(unittest.TestCase):
    def test_weekday_moves_to_the_coming_sunday_morning(self):
        now = datetime(2026, 10, 13, 15, 30, tzinfo=PLUS_8)  # Tuesday
        self.assertEqual(flow.weekly_fake_now(now).isoformat(timespec="seconds"), "2026-10-18T10:00:00+08:00")
        self.assertEqual(flow.weekday_fake_now(now).isoformat(timespec="seconds"), "2026-10-14T10:00:00+08:00")

    def test_sunday_before_ten_is_today_and_after_ten_is_next_week(self):
        early = datetime(2026, 10, 18, 9, 59, tzinfo=PLUS_8)
        late = datetime(2026, 10, 18, 10, 0, tzinfo=PLUS_8)
        self.assertEqual(flow.weekly_fake_now(early), datetime(2026, 10, 18, 10, tzinfo=PLUS_8))
        self.assertEqual(flow.weekly_fake_now(late), datetime(2026, 10, 25, 10, tzinfo=PLUS_8))

    def test_result_is_always_a_later_sunday_and_pin_is_a_weekday(self):
        start = datetime(2026, 10, 12, 0, 0, tzinfo=timezone(timedelta(hours=-5)))
        for hours in range(0, 24 * 14, 5):
            now = start + timedelta(hours=hours)
            sunday = flow.weekly_fake_now(now)
            self.assertEqual(sunday.weekday(), 6)
            self.assertTrue(now < sunday <= now + timedelta(days=7))
            self.assertEqual(sunday.utcoffset(), now.utcoffset())
            self.assertLess(flow.weekday_fake_now(now).weekday(), 5)


class WeeklyEvidenceTests(unittest.TestCase):
    def test_counts_only_scored_current_projection_in_the_window(self):
        with sqlite3.connect(":memory:") as conn:
            conn.execute("CREATE TABLE learner_observations (user_id, projector_key, projector_version, "
                         "observation_type, polarity, observed_at)")
            row = ["local", "learning_observation_v1", 2, "reading.question.outcome", 1, "2026-10-20T10:00:00Z"]
            rows = [row, row[:4] + [-1, row[5]], row[:4] + [None, row[5]]]
            for index, value in [(0, "other"), (1, "old"), (2, 1), (3, "reading.attempt.score"),
                                 (5, "2026-10-01T00:00:00Z"), (5, "2026-10-26T00:00:00Z")]:
                changed = row.copy()
                changed[index] = value
                rows.append(changed)
            conn.executemany("INSERT INTO learner_observations VALUES (?,?,?,?,?,?)", rows)
            count = conn.execute(flow.SCORED_READING_OBSERVATIONS,
                                 ("2026-10-01T00:00:00Z", "2026-10-25T00:00:00Z")).fetchone()[0]
            self.assertEqual(count, 2)


class FakeWeeklyAnswerTests(unittest.TestCase):
    def test_weekly_request_matches_only_the_v3_system_marker(self):
        self.assertTrue(flow.is_weekly_request(weekly_body("{}")))
        self.assertFalse(flow.is_weekly_request(
            weekly_body("{}", "You write the learner's daily journal.")))
        self.assertFalse(flow.is_weekly_request(
            {"messages": [{"role": "user", "content": "Write one weekly journal."}]}))
        self.assertFalse(flow.is_weekly_request({"messages": []}))

    def test_answer_is_a_number_free_v3_digest_with_a_soul_edit(self):
        pack = {"facts": {
            "volume.reading": fact(4),
            "accuracy.rate": fact(0.75, "percent"),
            "repeated.true_false_not_given.wrong": fact(3, asset_ids=["p1", "p2", "p1"]),
        }}
        answer = json.loads(flow.weekly_answer(weekly_body(json.dumps({"pack": pack}))))
        self.assertEqual(answer["digest"]["title"], flow.WEEKLY_TITLE)
        self.assertEqual(answer["digest"]["body"], [
            "这一周读了 {{f:volume.reading}} 篇。",
            "阅读正确率是 {{f:accuracy.rate}}。同类题的错误值得回看原文依据。",
        ])
        self.assertEqual(answer["digest"]["changes"], [])
        self.assertEqual(answer["digest"]["nextSteps"], [{
            "text": "下一周再做两组同类题。",
            "target": {"type": "kind", "key": "reading.tfng"},
        }])
        self.assertEqual(answer["digest"]["strengths"], ["练习记录完整，阅读和写作都有覆盖。"])
        self.assertEqual(answer["digest"]["weaknesses"], ["同类题在不同文章里出错。"])
        self.assertEqual(answer["profileEdits"], [{
            "key": "soul.companionNotes",
            "value": "先看错题，再开始新的练习。",
            "evidenceIds": ["repeated.true_false_not_given.wrong"],
            "reason": "同类题在两篇文章里都有错题。",
        }])
        self.assertEqual(answer["mutations"], [])

        prose = [answer["digest"]["title"], *answer["digest"]["body"], *answer["digest"]["strengths"],
                 *answer["digest"]["weaknesses"],
                 *(item["text"] for item in answer["digest"]["nextSteps"])]
        for text in prose:
            self.assertIsNone(ASCII_DIGITS.search(text), text)
            self.assertIsNone(QUOTES.search(text), text)
        # nextSteps is the one group the host lets carry a Chinese count.
        for text in prose[:-1]:
            self.assertIsNone(CHINESE_COUNT.search(text), text)

    def test_answer_without_facts_stays_number_free_and_skips_the_soul_edit(self):
        answer = json.loads(flow.weekly_answer(weekly_body(json.dumps({"pack": {"facts": {}}}))))
        digest = answer["digest"]
        self.assertEqual(digest["body"], [
            "这一周保持练习，记录已经整理好了。",
            "同类题的错误值得回看原文依据。",
        ])
        self.assertEqual(answer["profileEdits"], [])
        for text in [digest["title"], *digest["body"], *digest["strengths"], *digest["weaknesses"]]:
            self.assertNotIn("{{f:", text)
            self.assertIsNone(ASCII_DIGITS.search(text), text)
            self.assertIsNone(CHINESE_COUNT.search(text), text)

    def test_pack_helpers_read_the_first_user_json_and_fact_evidence(self):
        facts = {
            "a.only_asset": {"value": 1, "provenance": {"assetId": "p1"}},
            "b.duplicate_assets": {"value": 2, "provenance": {"assetIds": ["p1", "p2", "p1", ""]}},
            "c.more_assets": {"value": 3, "provenance": {"assetIds": ["p3", "p4"]}},
        }
        pack = {"blocks": [{"id": "volume"}], "facts": facts}
        body = weekly_body("Weekly context.\n" + json.dumps({"pack": pack}))
        self.assertEqual(flow.weekly_pack(body), pack)
        self.assertEqual(flow.weekly_facts(body), facts)
        self.assertEqual(flow.weekly_evidence_fact(body), "b.duplicate_assets")
        self.assertEqual(flow.weekly_pack(weekly_body(json.dumps(pack))), pack)
        self.assertIsNone(flow.weekly_pack(weekly_body("no json here")))
        self.assertEqual(flow.weekly_facts(weekly_body("no json here")), {})
        self.assertIsNone(flow.weekly_evidence_fact(
            weekly_body(json.dumps({"pack": {"facts": {}}}))))

    def test_agent_provider_answers_weekly_with_a_v3_digest(self):
        provider = flow.FakeAgentProvider("unused")
        provider.start()
        self.addCleanup(provider.close)
        body = weekly_body(json.dumps({"pack": {"facts": {"volume.reading": fact(3)}}}))
        request = urllib.request.Request(provider.base_url + "/chat/completions", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            message = json.loads(response.read())["choices"][0]["message"]
        answer = json.loads(message["content"])
        self.assertEqual(answer["digest"]["title"], flow.WEEKLY_TITLE)
        self.assertEqual(answer["digest"]["body"][0], "这一周读了 {{f:volume.reading}} 篇。")
        self.assertEqual(answer["profileEdits"], [])
        self.assertEqual(flow.model_calls(provider), 0)


class WeeklyQuestionKindTests(unittest.TestCase):
    def test_question_kind_resolves_generic_matching_from_the_instruction_text(self):
        cases = [
            ("<p>Choose the correct heading for each paragraph from the <b>list of headings</b> below.</p>",
             "matching_headings"),
            ("<p>Which paragraph contains the following information?</p>", "matching_information"),
            ("<p>Look at the following statements. Match each statement with the correct researcher, "
             "A&nbsp;-&nbsp;E.</p>", "matching_features"),
            ("<p>Complete each sentence with the correct ending, A-G, below.</p>",
             "matching_sentence_endings"),
            ("<p>Complete the summary using the list of words, A-K, below.</p>", "summary_completion"),
            ("<p>Classify the following statements as referring to</p>", "classification"),
            ("<p>Choose the correct option.</p>", "matching"),
        ]
        for html, expected in cases:
            self.assertEqual(flow.question_kind({"kind": "matching", "bodyHtml": html}), expected, html)
        self.assertEqual(flow.question_kind(
            {"kind": "true_false_not_given", "bodyHtml": "<p>list of headings</p>"}),
            "true_false_not_given")
        self.assertEqual(flow.question_kind({"kind": "summary_completion"}), "summary_completion")

    def test_shared_kind_is_stable_and_prefers_typed_kinds(self):
        self.assertEqual(flow.choose_shared_kind({
            "p1": {"summary_completion", "single_choice"},
            "p2": {"true_false_not_given", "summary_completion"},
            "p3": {"true_false_not_given", "single_choice"},
        }), "true_false_not_given")
        self.assertEqual(flow.choose_shared_kind({
            "p1": {"zeta", "alpha"},
            "p2": {"zeta", "beta"},
            "p3": {"alpha", "beta"},
        }), "alpha")
        self.assertEqual(flow.choose_shared_kind({
            "p1": {"matching", "single_choice"},
            "p2": {"matching", "single_choice"},
        }), "single_choice")
        self.assertIsNone(flow.choose_shared_kind({"p1": {"single_choice"}}))
        self.assertIsNone(flow.choose_shared_kind({}))

    def test_attempt_answers_mark_only_the_chosen_kind_wrong(self):
        payload = {
            "answerKey": {"q1": "A", "q2": "B", "q3": "C"},
            "questionGroups": [
                {"kind": "single_choice", "questionIds": ["q1"]},
                {"kind": "matching", "questionIds": ["q2"],
                 "bodyHtml": "<p>Choose the correct heading for each paragraph.</p>"},
                {"kind": "matching", "questionIds": ["q3"],
                 "bodyHtml": "<p>Match each statement with a researcher.</p>"},
            ],
        }
        self.assertEqual(flow.weekly_wrong_question_ids(payload, "matching_headings"), {"q2"})
        self.assertEqual(flow.weekly_attempt_answers(payload, "matching_headings"), {
            "q1": "A", "q2": flow.PACKAGED_WRONG_ANSWER, "q3": "C",
        })
        self.assertEqual(flow.weekly_attempt_answers(payload, "single_choice"), {
            "q1": flow.PACKAGED_WRONG_ANSWER, "q2": "B", "q3": "C",
        })
        self.assertEqual(flow.weekly_attempt_answers({}, "matching"), {})

    def test_fact_display_matches_the_page_rendering(self):
        self.assertEqual(flow.fact_display({"value": 0.125, "format": "percent"}), "13%")
        self.assertEqual(flow.fact_display({"value": 0.5, "format": "percent"}), "50%")
        self.assertEqual(flow.fact_display({"value": 42, "format": "minutes"}), "42 分钟")
        self.assertEqual(flow.fact_display({"value": 4.0, "format": "number"}), "4")
        self.assertEqual(flow.fact_display({"value": 6.5, "format": "band"}), "6.5")


class FinalWeeklyRunTests(unittest.TestCase):
    def test_accepts_only_a_completed_v3_final_with_a_narrative_body(self):
        def row(run_id: str, digest: dict) -> dict:
            return {"id": run_id, "status": "completed", "input_hash": f"weekly:{run_id}",
                    "digest_json": json.dumps(digest, ensure_ascii=False)}

        rows = [
            {"id": "running", "status": "running", "input_hash": "weekly:0", "digest_json": None},
            row("v2", {"schemaVersion": 2, "state": "final", "displayTitle": "旧周记",
                       "facts": {}, "narrative": {"body": ["旧正文"]}}),
            row("live", {"schemaVersion": 3, "state": "live", "displayTitle": "进行中",
                         "facts": {}, "narrative": None}),
            row("empty", {"schemaVersion": 3, "state": "final", "displayTitle": "没有正文",
                          "facts": {}, "narrative": {"body": []}}),
            row("ok", {"schemaVersion": 3, "state": "final", "displayTitle": flow.WEEKLY_TITLE,
                       "facts": {"volume.reading": {"value": 4}},
                       "narrative": {"body": ["这一周读了 {{f:volume.reading}} 篇。"]}}),
        ]
        self.assertEqual(flow.final_weekly_run(rows), {
            "runId": "ok",
            "inputHash": "weekly:ok",
            "displayTitle": flow.WEEKLY_TITLE,
            "facts": {"volume.reading": {"value": 4}},
            "narrativeBody": ["这一周读了 {{f:volume.reading}} 篇。"],
        })
        self.assertIsNone(flow.final_weekly_run(rows[:4]))


if __name__ == "__main__":
    unittest.main()
