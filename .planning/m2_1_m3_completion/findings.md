# Findings

- M3 persistence and proposal validation exist; direct WebView submission exposed forged `sourceClass/runId` and must be replaced by host-owned generation.
- Python generate uses nested synchronous `tool.invoke` and `model.invoke`; the Rust host originally treated every frame as a response, making the production path impossible.
- M2.1 still lacks the mandated 10k/50k/100k performance report and failed projection-run retention proof.
- Static/E2E gates still encode pre-sidecar assumptions and packaged staging must include externalBin.
