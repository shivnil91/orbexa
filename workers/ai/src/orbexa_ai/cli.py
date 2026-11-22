"""Read a job from stdin and write the fixture result as JSON."""

from __future__ import annotations

import base64
import json
import sys

from orbexa_ai.job import run_tender_job


def main() -> None:
    payload = json.load(sys.stdin)
    files = {
        name: base64.b64decode(encoded) for name, encoded in payload["files"].items()
    }
    _state, result = run_tender_job(files, service_level=str(payload["service_level"]))
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
