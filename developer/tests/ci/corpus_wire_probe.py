"""Real Rust export on stdin -> production Python sync -> Rust query on stdout."""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "agent-runtime-python" / "src"))
from ielts_agent.retrieval import IndexStore, sync_corpus
from ielts_agent.retrieval import ContextTaskInput, build_context_plan, rewrite_query, run_retrieval


class Bridge:
    def __init__(self, wire):
        self.wire = wire
        self.requests = []
        self.started = []

    def invoke(self, method, params, **kwargs):
        self.started.append(kwargs["started_at"])
        if method == "retrieval.corpus_manifest":
            assert params == {}
            return self.wire["manifest"]
        assert method == "retrieval.export_chunks"
        self.requests.append(params)
        cursor = params["query"]["cursor"]
        return next(page for page in self.wire["pages"] if page["cursor"] == cursor)["result"]


def main():
    bridge = Bridge(json.load(sys.stdin))
    with tempfile.TemporaryDirectory() as directory:
        with IndexStore(Path(directory) / "index.sqlite") as store:
            result = sync_corpus(bridge, store, trace_id="wire", deadline_ms=10000, page_limit=1)
            assert result.status == "ok", result.detail
            assert result.added == bridge.wire["manifest"]["chunkCount"]
            rows = store.open().execute("SELECT source_kind,source_version,sensitivity,text FROM chunks ORDER BY chunk_id").fetchall()
            assert all(row["source_kind"] == "curated" and row["sensitivity"] == "internal" for row in rows)
            assert all(row["source_version"] == "2" and row["text"] for row in rows)
            assert len(set(bridge.started)) == 1, "pagination must share the deadline origin"
            query = rewrite_query("Canonical", task_kind="reading_review")
            retrieval = run_retrieval(store, query)
            assert len(retrieval.candidates) == len(rows), "synced text must really be searchable"
            current_id = retrieval.candidates[0].chunk_id
            plan = build_context_plan(ContextTaskInput(task_kind="reading_review",
                current_task_item_ids=[current_id]), retrieval, total_token_budget=4000)
            selected = [item for section in plan.sections for item in section.item_ids]
            assert selected == plan.ranked_item_ids
            assert selected.count(current_id) == 1
    print(json.dumps({"requests": bridge.requests, "plan": plan.to_wire()}))


if __name__ == "__main__":
    main()
