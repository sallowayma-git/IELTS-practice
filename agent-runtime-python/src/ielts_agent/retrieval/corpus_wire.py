"""Closed Rust corpus DTOs, converted only at the host boundary.

Asset category is not a trust tier. Both exported reference categories map to
curated data (never system instructions); normal is local/internal, not public.
The version labels describe the contract, not a content revision. Sync still
checks every chunk hash, independently of manifest timestamps.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .types import CorpusChunk, CorpusManifest, Sensitivity, SourceKind


class _Wire(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class HostCorpusManifest(_Wire):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    chunking_version: Literal[1] = Field(alias="chunkingVersion")
    generated_at: str = Field(alias="generatedAt")
    asset_count: int = Field(alias="assetCount", ge=0)
    chunk_count: int = Field(alias="chunkCount", ge=0)
    source_kinds: list[Literal["reading_asset", "writing_topic"]] = Field(alias="sourceKinds")

    def to_index(self) -> CorpusManifest:
        return CorpusManifest(
            corpus_version="schema-1:chunking-1",
            chunk_count=self.chunk_count,
            exported_at=self.generated_at,
        )


class HostCorpusChunk(_Wire):
    chunk_id: str = Field(alias="chunkId")
    source_kind: Literal["reading_asset", "writing_topic"] = Field(alias="sourceKind")
    source_id: str = Field(alias="sourceId")
    source_version: int = Field(alias="sourceVersion", ge=0)
    activity: Literal["reading", "writing"]
    content_hash: str = Field(alias="contentHash")
    sensitivity: Literal["normal", "public", "internal", "restricted", "private"]
    text: str
    updated_at: str = Field(alias="updatedAt")

    def to_index(self) -> CorpusChunk:
        expected_activity = "reading" if self.source_kind == "reading_asset" else "writing"
        if self.activity != expected_activity:
            raise ValueError("corpus sourceKind/activity mismatch")
        return CorpusChunk(
            chunk_id=self.chunk_id,
            source_kind=SourceKind.CURATED,
            source_id=self.source_id,
            source_version=str(self.source_version),
            activity=self.activity,
            content_hash=self.content_hash,
            sensitivity=Sensitivity.INTERNAL if self.sensitivity == "normal" else Sensitivity(self.sensitivity),
            text=self.text,
            updated_at=self.updated_at,
        )


class HostCorpusPage(_Wire):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    chunking_version: Literal[1] = Field(alias="chunkingVersion")
    generated_at: str = Field(alias="generatedAt")
    chunks: list[HostCorpusChunk]
    next_cursor: str | None = Field(alias="nextCursor")
    truncated: bool
