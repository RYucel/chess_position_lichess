#!/usr/bin/env python3
"""Build the CandidateMaster position dataset from Lichess cloud evaluations.

Source: https://huggingface.co/datasets/Lichess/chess-position-evaluations

The Hugging Face dataset stores one row per principal variation:

    fen, line, depth, knodes, cp, mate

Several rows share a FEN (one row per MultiPV line). This script groups those
rows back into positions, ranks the lines from the side-to-move perspective,
and keeps calm, non-tactical decisions that are suitable for candidate-move
training:

  * depth >= 22
  * no mate scores
  * |white-perspective cp| <= 300
  * at least 3 legal PV lines
  * best and second-best mover evaluations no more than 150 cp apart

It reads parquet shards over HTTPS with DuckDB's httpfs extension, so the
multi-gigabyte shards never have to be downloaded in full. The output matches
public/data/curated_positions.json and the TypeScript PositionDataset type.

Examples:
    python scripts/build_dataset.py --limit-per-phase 20
    python scripts/build_dataset.py --out public/data/curated_positions.json
    python scripts/build_dataset.py --local scripts/data/data_0000.parquet
    python scripts/build_dataset.py --shard-count 2 --scan-limit 600000

Requirements: duckdb >= 1.2 and python-chess (both optional to the app build).
    pip install duckdb chess
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
DEFAULT_OUT = PROJECT_ROOT / "public" / "data" / "curated_positions.json"

HF_BASE = "https://huggingface.co/datasets/Lichess/chess-position-evaluations/resolve/main"
UCI_RE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")
CASTLING = {
    "e1h1": "e1g1",
    "e1a1": "e1c1",
    "e8h8": "e8g8",
    "e8a8": "e8c8",
}
PHASES = ("opening", "middlegame", "endgame")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output JSON path")
    parser.add_argument("--limit-per-phase", type=int, default=20, help="maximum positions per phase")
    parser.add_argument("--min-depth", type=int, default=22, help="minimum Stockfish depth")
    parser.add_argument("--max-gap", type=int, default=150, help="maximum PV1-PV2 gap in cp")
    parser.add_argument("--eval-band", type=int, default=300, help="keep |cp| within this band")
    parser.add_argument("--max-pvs", type=int, default=4, help="PV lines stored per position")
    parser.add_argument("--scan-limit", type=int, default=350_000, help="candidate rows read per source")
    parser.add_argument("--shard-start", type=int, default=0, help="first remote parquet shard (0000-based)")
    parser.add_argument("--shard-count", type=int, default=1, help="number of remote parquet shards to read")
    parser.add_argument("--local", action="append", default=[], help="local parquet path or glob; repeatable")
    parser.add_argument("--seed", type=int, default=42, help="deterministic sampling seed")
    parser.add_argument("--quiet", action="store_true", help="only print the summary")
    return parser.parse_args(argv)


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def source_sql(local: list[str], shard_start: int, shard_count: int) -> str:
    if local:
        paths = ", ".join(sql_literal(path) for path in local)
        return f"read_parquet([{paths}])"
    urls = [
        f"{HF_BASE}/data/data_{index:04d}.parquet"
        for index in range(shard_start, shard_start + shard_count)
    ]
    return f"read_parquet([{', '.join(sql_literal(url) for url in urls)}])"


def connect_duckdb(local: bool) -> Any:
    try:
        import duckdb
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise SystemExit("duckdb is required: pip install duckdb") from exc

    con = duckdb.connect()
    if not local:
        try:
            con.execute("INSTALL httpfs")
            con.execute("LOAD httpfs")
        except Exception as exc:  # pragma: no cover - network dependent
            raise SystemExit(
                "Could not enable DuckDB httpfs. Check your network/proxy, or download a "
                "parquet shard manually and pass --local path/to/data_0000.parquet.\n"
                f"DuckDB said: {exc}"
            ) from exc
    con.execute("SET threads=4")
    return con


def fetch_rows(con: Any, source: str, min_depth: int, eval_band: int, scan_limit: int) -> list[tuple]:
    query = f"""
        SELECT fen, line, depth, knodes, cp, mate
        FROM {source}
        WHERE depth >= ?
          AND mate IS NULL
          AND cp IS NOT NULL
          AND abs(cp) <= ?
        LIMIT ?
    """
    return con.execute(query, [min_depth, eval_band, scan_limit]).fetchall()


def normalize_line(line: str | None) -> list[str]:
    if not line:
        return []
    moves: list[str] = []
    for raw in str(line).replace(",", " ").split():
        token = raw.strip().lower()
        if not token:
            continue
        if token in {"1-0", "0-1", "1/2-1/2", "*"}:
            continue
        if re.fullmatch(r"\d+\.+", token):
            continue
        token = CASTLING.get(token, token)
        if UCI_RE.fullmatch(token):
            moves.append(token)
    return moves


def piece_counts(fen: str) -> tuple[int, int]:
    board = fen.split(" ", 1)[0]
    pieces = sum(1 for char in board if char.isalpha())
    queens = board.count("Q") + board.count("q")
    return pieces, queens


def normalise_fen(fen: str) -> str:
    """Lichess stores four-field FENs; the app's chess.js wants six fields."""
    fields = fen.strip().split()
    if len(fields) == 4:
        return fen.strip() + " 0 1"
    return fen.strip()


def classify_phase(fen: str) -> str:
    # The source FEN only carries four fields, so phase is material-based.
    pieces, queens = piece_counts(fen)
    if pieces <= 14 or (queens == 0 and pieces <= 20):
        return "endgame"
    if pieces >= 26 and queens == 2:
        return "opening"
    return "middlegame"


def validated_line(fen: str, moves: list[str]) -> tuple[bool, list[str]]:
    """Return whether the PV is legal and its castling-normalised UCI moves."""
    normalised = [CASTLING.get(move, move) for move in moves]
    try:
        import chess  # type: ignore
    except ImportError:
        # Without python-chess we can still keep syntactically valid UCI moves.
        return bool(normalised), normalised

    try:
        board = chess.Board(fen)
    except ValueError:
        return False, normalised

    for move in normalised:
        try:
            board.push_uci(move)
        except ValueError:
            return False, normalised
    return True, normalised


def rank_key(row: dict[str, Any], side_to_move: str) -> float:
    cp = float(row["cp"])
    mover_cp = cp if side_to_move == "w" else -cp
    # Prefer the deepest line when two rows share the same first move.
    return mover_cp


def build_positions(rows: list[tuple], args: argparse.Namespace) -> tuple[list[dict[str, Any]], dict[str, int]]:
    grouped: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    skipped = defaultdict(int)

    for fen, line, depth, knodes, cp, mate in rows:
        if not fen or not line or cp is None or mate is not None:
            skipped["empty"] += 1
            continue
        fen = normalise_fen(str(fen))
        moves = normalize_line(str(line))
        if len(moves) < 3:
            skipped["short-line"] += 1
            continue
        legal, moves = validated_line(fen, moves)
        if not legal:
            skipped["illegal-line"] += 1
            continue

        fields = fen.split()
        side = fields[1] if len(fields) > 1 else "w"
        first = moves[0]
        row = {
            "move": first,
            "line": " ".join(moves),
            "depth": int(depth or 0),
            "knodes": int(knodes or 0),
            "cp": int(cp),
            "mate": None,
            "side": side,
            "moverCp": rank_key({"cp": cp}, side),
        }
        current = grouped[fen].get(first)
        if current is None or (row["depth"], row["knodes"]) > (current["depth"], current["knodes"]):
            grouped[fen][first] = row

    candidates: dict[str, list[dict[str, Any]]] = {phase: [] for phase in PHASES}
    for fen, lines in grouped.items():
        ordered = sorted(lines.values(), key=lambda item: (-item["moverCp"], -item["depth"], item["move"]))
        if len(ordered) < 3:
            skipped["few-pvs"] += 1
            continue
        best = ordered[0]
        if best["depth"] < args.min_depth:
            skipped["shallow"] += 1
            continue
        gap = best["moverCp"] - ordered[1]["moverCp"]
        if gap < 0 or gap > args.max_gap:
            skipped["gap"] += 1
            continue
        phase = classify_phase(fen)
        pieces = piece_counts(fen)[0]
        candidates[phase].append(
            {
                "fen": fen,
                "phase": phase,
                "sideToMove": best["side"],
                "pieces": pieces,
                "evalCp": best["cp"],
                "gapCp": int(round(gap)),
                "depth": max(item["depth"] for item in ordered),
                "knodes": max(item["knodes"] for item in ordered),
                "pvs": [
                    {
                        "move": item["move"],
                        "line": item["line"],
                        "depth": item["depth"],
                        "knodes": item["knodes"],
                        "cp": item["cp"],
                        "mate": None,
                    }
                    for item in ordered[: args.max_pvs]
                ],
            }
        )

    rng = random.Random(args.seed)
    selected: list[dict[str, Any]] = []
    for phase in PHASES:
        pool = candidates[phase]
        rng.shuffle(pool)
        selected.extend(pool[: args.limit_per_phase])
        if not args.quiet:
            print(f"  {phase:10s}: {len(pool):5d} valid, {min(len(pool), args.limit_per_phase)} selected")

    selected.sort(key=lambda item: (PHASES.index(item["phase"]), hashlib.sha1(item["fen"].encode()).hexdigest()))
    for index, position in enumerate(selected, start=1):
        position["id"] = f"cm-{index:04d}"
        position["source"] = "lichess-position-evaluations"
        position["label"] = f"Lichess konum {index:04d}"

    ordered_positions = []
    for position in selected:
        ordered_positions.append(
            {
                "id": position["id"],
                "fen": position["fen"],
                "phase": position["phase"],
                "sideToMove": position["sideToMove"],
                "pieces": position["pieces"],
                "evalCp": position["evalCp"],
                "gapCp": position["gapCp"],
                "depth": position["depth"],
                "knodes": position["knodes"],
                "pvs": position["pvs"],
                "source": position["source"],
                "label": position["label"],
            }
        )

    if not args.quiet:
        print("  skipped:", dict(sorted(skipped.items())))
    return ordered_positions, dict(skipped)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if args.limit_per_phase < 1:
        raise SystemExit("--limit-per-phase must be >= 1")

    local = bool(args.local)
    source = source_sql(args.local, args.shard_start, args.shard_count)
    if not args.quiet:
        print(f"Reading {source}")
        print(
            f"Filters: depth >= {args.min_depth}, |cp| <= {args.eval_band}, "
            f"gap <= {args.max_gap}, scan limit {args.scan_limit:,}"
        )

    con = connect_duckdb(local)
    try:
        rows = fetch_rows(con, source, args.min_depth, args.eval_band, args.scan_limit)
    finally:
        con.close()

    if not rows:
        raise SystemExit("No rows matched. Try a larger --scan-limit or another shard.")

    if not args.quiet:
        print(f"  read {len(rows):,} PV rows")
    positions, _skipped = build_positions(rows, args)
    if not positions:
        raise SystemExit("No positions survived the filters. Lower --max-gap or raise --scan-limit.")

    phase_counts: dict[str, int] = defaultdict(int)
    for position in positions:
        phase_counts[position["phase"]] += 1

    dataset = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "Lichess/chess-position-evaluations via DuckDB",
        "positionCount": len(positions),
        "phaseCounts": {phase: phase_counts.get(phase, 0) for phase in PHASES if phase_counts.get(phase)},
        "positions": positions,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(positions)} positions to {args.out}")
    print("Phase counts:", dataset["phaseCounts"])
    if any(count < 3 for count in dataset["phaseCounts"].values()):
        print("Note: one phase has fewer than 3 positions; expose more shards or raise --scan-limit.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
