#!/usr/bin/env python3
"""Shared helpers for writing the split CandidateMaster dataset.

The runtime dataset is stored as three phase files plus a small manifest:

    public/data/manifest.json
    public/data/opening.json
    public/data/middlegame.json
    public/data/endgame.json

Keeping the files separate makes the monthly refresh diff smaller, lets the
browser cache phases independently, and keeps one large JSON file out of the
critical path.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

PHASES = ("opening", "middlegame", "endgame")
DEFAULT_SOURCE = "Lichess/chess-position-evaluations via DuckDB"


def position_key(fen: str) -> str:
    """The first four FEN fields identify a board state, ignoring move clocks."""
    return " ".join(fen.split()[:4])


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def write_split(
    positions: Iterable[dict[str, Any]],
    out_dir: str | Path,
    *,
    generated_at: str | None = None,
    month: str | None = None,
    source: str = DEFAULT_SOURCE,
    refresh: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write phase files and a manifest, returning the manifest."""
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    generated_at = generated_at or utc_now()
    month = month or generated_at[:7]
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    ids: set[str] = set()
    fens: set[str] = set()

    for position in positions:
        phase = position.get("phase")
        if phase not in PHASES:
            raise ValueError(f"Unknown phase: {phase!r}")
        position_id = position.get("id")
        if not position_id or position_id in ids:
            raise ValueError(f"Missing or duplicate position id: {position_id!r}")
        ids.add(position_id)
        fen = position.get("fen")
        if not fen or not isinstance(fen, str):
            raise ValueError(f"Missing FEN for {position_id}")
        key = position_key(fen)
        if key in fens:
            raise ValueError(f"Duplicate board state for {position_id}: {key}")
        fens.add(key)
        grouped[phase].append(position)

    empty = [phase for phase in PHASES if not grouped[phase]]
    if empty:
        raise ValueError(f"No positions for phase(s): {', '.join(empty)}")

    files = {phase: f"{phase}.json" for phase in PHASES}
    phase_counts = {phase: len(grouped[phase]) for phase in PHASES}

    for phase in PHASES:
        payload = {
            "version": 1,
            "generatedAt": generated_at,
            "phase": phase,
            "positionCount": phase_counts[phase],
            "positions": grouped[phase],
        }
        (out_path / files[phase]).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    manifest: dict[str, Any] = {
        "version": 1,
        "generatedAt": generated_at,
        "month": month,
        "source": source,
        "positionCount": sum(phase_counts.values()),
        "phaseCounts": phase_counts,
        "files": files,
    }
    if refresh:
        manifest["refresh"] = refresh

    (out_path / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest
