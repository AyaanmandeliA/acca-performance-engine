"""Part of ../PROJECT.md — JSON-line oracle for Worker/Python equivalence tests."""

from __future__ import annotations

import json
import sys

from manual_pilot_service import build_packet, process_diagnostic


def main() -> int:
    request = json.load(sys.stdin)
    action = request.get("action")
    if action == "packet":
        result = build_packet(request["source"])
    elif action == "process":
        result = process_diagnostic(request["packet"], request["diagnostic"])
    else:
        raise ValueError("Unknown oracle action")
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
