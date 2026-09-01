"""Length-prefixed JSON framing for the local sidecar protocol."""

from __future__ import annotations

import json
import struct
from typing import Any, BinaryIO


DEFAULT_MAX_FRAME_BYTES = 1024 * 1024


class FrameError(ValueError):
    """A frame is malformed, incomplete, or outside the negotiated bound."""


def encode_frame(message: Any, max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES) -> bytes:
    payload = json.dumps(
        message,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    if len(payload) > max_frame_bytes:
        raise FrameError(f"frame_too_large: {len(payload)} > {max_frame_bytes}")
    return struct.pack(">I", len(payload)) + payload


def write_frame(
    stream: BinaryIO,
    message: Any,
    max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES,
) -> None:
    stream.write(encode_frame(message, max_frame_bytes))
    stream.flush()


def read_frame(
    stream: BinaryIO,
    max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES,
) -> Any | None:
    header = _read_exact(stream, 4, allow_clean_eof=True)
    if header is None:
        return None
    length = struct.unpack(">I", header)[0]
    if length == 0:
        raise FrameError("empty_frame")
    if length > max_frame_bytes:
        raise FrameError(f"frame_too_large: {length} > {max_frame_bytes}")
    payload = _read_exact(stream, length)
    try:
        message = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FrameError(f"invalid_json: {error}") from error
    if not isinstance(message, dict):
        raise FrameError("frame_must_be_object")
    return message


def _read_exact(stream: BinaryIO, size: int, allow_clean_eof: bool = False) -> bytes | None:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = stream.read(size - len(chunks))
        if not chunk:
            if allow_clean_eof and not chunks:
                return None
            raise FrameError("truncated_frame")
        chunks.extend(chunk)
    return bytes(chunks)
