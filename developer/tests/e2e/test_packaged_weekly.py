"""Pure weekly helpers of the packaged flow: fake clock and fake weekly answer."""
import json
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone

import packaged_tauri_flow as flow

PLUS_8 = timezone(timedelta(hours=8))


def weekly_body(user_content: str, system: str = "You are the weekly reviewer of an IELTS learner's practice.") -> dict:
    return {"messages": [{"role": "system", "content": system}, {"role": "user", "content": user_content}]}


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


class FakeWeeklyAnswerTests(unittest.TestCase):
    def test_weekly_request_matches_system_message_case_insensitively(self):
        self.assertTrue(flow.is_weekly_request(weekly_body("{}", "Context. You are the Weekly Reviewer.")))
        self.assertFalse(flow.is_weekly_request({"messages": [{"role": "user", "content": "weekly reviewer"}]}))
        self.assertFalse(flow.is_weekly_request({"messages": []}))

    def test_answer_names_every_pack_block_with_number_free_text(self):
        pack = {"instructions": "x", "pack": {"blocks": [
            {"id": "volume", "kind": "volume", "data": {"readingAttempts": 3}},
            {"id": "accuracy", "kind": "accuracy", "data": {"rate": 0.5}},
            {"id": "volume", "kind": "volume", "data": {}}]}}
        answer = json.loads(flow.weekly_answer(weekly_body(json.dumps(pack))))
        self.assertEqual(answer["title"], flow.WEEKLY_TITLE)
        self.assertEqual(list(answer["sentences"]), ["volume", "accuracy"])
        self.assertEqual(answer["mutations"], [])
        self.assertFalse(any(char.isdigit() for char in json.dumps(answer, ensure_ascii=False)))

    def test_pack_after_a_text_prefix_and_missing_pack_fall_back(self):
        prefixed = 'Weekly pack:\n{"pack": {"blocks": [{"id": "question_types"}]}}'
        self.assertEqual(flow.weekly_block_ids(weekly_body(prefixed)), ["question_types"])
        self.assertEqual(flow.weekly_block_ids(weekly_body("no json here")), [])
        answer = json.loads(flow.weekly_answer(weekly_body('{"pack": {}}')))
        self.assertEqual(answer["sentences"], {})

    def test_agent_provider_answers_weekly_with_content(self):
        provider = flow.FakeAgentProvider("unused")
        provider.start()
        self.addCleanup(provider.close)
        body = weekly_body(json.dumps({"pack": {"blocks": [{"id": "volume"}]}}))
        request = urllib.request.Request(provider.base_url + "/chat/completions", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            message = json.loads(response.read())["choices"][0]["message"]
        self.assertEqual(json.loads(message["content"])["sentences"], {"volume": flow.WEEKLY_SENTENCE})
        self.assertEqual(flow.model_calls(provider), 0)


if __name__ == "__main__":
    unittest.main()
