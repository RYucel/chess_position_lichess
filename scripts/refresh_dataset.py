#!/usr/bin/env python3
"""Build a fresh monthly split dataset from a rotating Lichess parquet shard.

The app deliberately replaces its position set every month. A fixed set would
eventually be memorized by frequent users, so the scheduled refresh rotates
the source shard and uses a month-based sampling seed.

Examples:
    python scripts/refresh_dataset.py --dry-run --total 30 --scan-limit 200000
    python scripts/refresh_dataset.py --month 2026-11
    python scripts/refresh_dataset.py --month 2026-11 --total 5000

Requirements: duckdb >= 1.2 and python-chess.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import build_dataset as bd
from dataset_io import PHASES, write_split

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEFAULT_OUT_DIR = ROOT / "public" / "data"
DEFAULT_TOTAL = 5000
SHARD_COUNT = 20
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def current_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def shard_for_month(month: str) -> int:
    """Rotate through the 20 source shards, offset from the initial build."""
    year, month_number = (int(part) for part in month.split("-"))
    month_index = year * 12 + (month_number - 1)
    return (month_index + 1) % SHARD_COUNT


def phase_targets(total: int) -> dict[str, int]:
    base, remainder = divmod(total, len(PHASES))
    return {
        phase: base + (1 if index < remainder else 0)
        for index, phase in enumerate(PHASES)
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--month", default=current_month(), help="dataset month, YYYY-MM")
    parser.add_argument("--total", type=int, default=DEFAULT_TOTAL, help="exact position count")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="split dataset directory")
    parser.add_argument("--shard-start", type=int, default=None, help="override the monthly shard")
    parser.add_argument("--scan-limit", type=int, default=1_000_000, help="candidate rows read")
    parser.add_argument("--seed", type=int, default=None, help="override the deterministic seed")
    parser.add_argument("--dry-run", action="store_true", help="build and validate without writing files")
    parser.add_argument("--quiet", action="store_true", help="only print the summary")
    args = parser.parse_args(argv)

    if not MONTH_RE.match(args.month):
        raise SystemExit("--month must look like YYYY-MM")
    if args.total < len(PHASES):
        raise SystemExit(f"--total must be at least {len(PHASES)}")

    targets = phase_targets(args.total)
    shard = shard_for_month(args.month) if args.shard_start is None else args.shard_start
    seed = args.seed if args.seed is not None else int(args.month.replace("-", "")) * 100 + args.total
    source = bd.source_sql([], shard, 1)

    if not args.quiet:
        print(f"Dataset month: {args.month}")
        print(f"Source shard: data_{shard:04d}.parquet")
        print(f"Target counts: {targets} (total {args.total})")
        print(f"Seed: {seed}")

    con = bd.connect_duckdb(False)
    try:
        rows = bd.fetch_rows(con, source, 22, 300, args.scan_limit)
    finally:
        con.close()

    if not rows:
        raise SystemExit("No rows matched. Try a larger --scan-limit or another shard.")

    build_args = SimpleNamespace(
        min_depth=22,
        max_gap=150,
        eval_band=300,
        max_pvs=4,
        limit_per_phase=max(targets.values()),
        seed=seed,
        quiet=args.quiet,
    )
    positions, skipped = bd.build_positions(rows, build_args)
    grouped: dict[str, list[dict]] = defaultdict(list)
    for position in positions:
        grouped[position["phase"]].append(position)

    selected: list[dict] = []
    for phase in PHASES:
        available = len(grouped[phase])
        need = targets[phase]
        if available < need:
            raise SystemExit(
                f"Not enough {phase} positions: need {need}, available {available}. "
                "Raise --scan-limit or choose another --shard-start."
            )
        selected.extend(grouped[phase][:need])

    selected.sort(
        key=lambda position: (
            PHASES.index(position["phase"]),
            hashlib.sha1(position["fen"].encode()).hexdigest(),
        )
    )
    for index, position in enumerate(selected, start=1):
        position["id"] = f"cm-{index:04d}"
        position["label"] = f"Lichess konum {index:04d}"

    if not args.quiet:
        print(f"Selected {len(selected)} positions; skipped {sum(skipped.values())} grouped rows")

    if args.dry_run:
        print(f"Dry run complete: {len(selected)} positions validated, nothing written.")
        return 0

    manifest = write_split(
        selected,
        args.out_dir,
        month=args.month,
        source="Lichess/chess-position-evaluations via DuckDB",
        refresh={
            "month": args.month,
            "shardStart": shard,
            "scanLimit": args.scan_limit,
            "seed": seed,
            "total": args.total,
        },
    )
    print(f"Wrote {manifest['positionCount']} positions to {args.out_dir}")
    print("Phase counts:", manifest["phaseCounts"])
    print("Manifest:", args.out_dir / "manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
