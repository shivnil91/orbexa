"""Run one tender job on the Temporal test server."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

from temporalio.runtime import (
    LogForwardingConfig,
    LoggingConfig,
    Runtime,
    TelemetryConfig,
)
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from orbexa_ai.startup import refuse_live_stripe_keys
from orbexa_ai.tender_activities import (
    deliver_activity,
    draft_activity,
    extract_activity,
    matrix_activity,
)
from orbexa_ai.tender_workflow import TenderJob

ACTIVITIES = [extract_activity, matrix_activity, draft_activity, deliver_activity]


def _runtime() -> Runtime:
    # Core logs must not share stdout with the JSON result.
    logger = logging.getLogger("orbexa.temporal")
    if not logger.handlers:
        logger.addHandler(logging.StreamHandler(sys.stderr))
        logger.setLevel(logging.WARNING)
    return Runtime(
        telemetry=TelemetryConfig(
            logging=LoggingConfig(
                filter=LoggingConfig.default.filter,
                forwarding=LogForwardingConfig(logger=logger),
            )
        )
    )


async def run_on_temporal(files: dict[str, bytes], service_level: str) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="orbexa-tender-") as directory:
        root = Path(directory)
        pack = root / "pack"
        pack.mkdir()
        for name, data in files.items():
            (pack / name).write_bytes(data)
        payload = {
            "store_dir": str(root / "store"),
            "pack_dir": str(pack),
            "service_level": service_level,
            "job_id": uuid4().hex,
        }
        async with await WorkflowEnvironment.start_time_skipping(runtime=_runtime()) as env:
            async with Worker(
                env.client,
                task_queue="orbexa-tender",
                workflows=[TenderJob],
                activities=ACTIVITIES,
            ):
                handle = await env.client.start_workflow(
                    TenderJob.run,
                    payload,
                    id=f"tender-{payload['job_id']}",
                    task_queue="orbexa-tender",
                )
                if service_level != "autonomous":
                    await handle.signal(TenderJob.approve)
                result = await handle.result()
                if not isinstance(result, dict):
                    raise TypeError("workflow result")
                return result


def main() -> None:
    refuse_live_stripe_keys(os.environ)
    request = json.load(sys.stdin)
    files = {name: base64.b64decode(encoded) for name, encoded in request["files"].items()}
    result = asyncio.run(run_on_temporal(files, str(request["service_level"])))
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
