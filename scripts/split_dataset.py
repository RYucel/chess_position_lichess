#!/usr/bin/env python3
"""Split a monolithic position JSON file into phase files plus a manifest.

Usage:
    python scripts/split_dataset.py --input public/data/curated_positions.json
    python scripts/split_dataset.py --input /tmp/all.json --out-dir public/data
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from dataset_io import write_split

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEFAULT_INPUT = ROOT / "public" / "data" / "curated_positions.json"
DEFAULT_OUT_DIR = ROOT / "public" / "data"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="monolithic position dataset")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="split dataset directory")
    args = parser.parse_args()

    data = json.loads(args.input.read_text(encoding="utf-8"))
    positions = data.get("positions")
    if not isinstance(positions, list) or not positions:
        raise SystemExit(f"No positions found in {args.input}")

    manifest = write_split(
        positions,
        args.out_dir,
        generated_at=data.get("generatedAt"),
        month=data.get("month"),
        source=data.get("source", "Lichess/chess-position-evaluations via DuckDB"),
    )
    print(f"Wrote {manifest['positionCount']} positions to {args.out_dir}")
    print("Phase counts:", manifest["phaseCounts"])
    print("Manifest:", args.out_dir / "manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
