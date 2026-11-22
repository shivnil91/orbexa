"""Poll one Temporal task queue until the process is stopped."""

from __future__ import annotations

import asyncio
import sys

from temporalio.client import Client
from temporalio.worker import Worker

from orbexa_ai.cli import ACTIVITIES
from orbexa_ai.tender_workflow import TenderJob


async def serve(target: str, task_queue: str) -> None:
    client = await Client.connect(target)
    worker = Worker(
        client,
        task_queue=task_queue,
        workflows=[TenderJob],
        activities=ACTIVITIES,
        max_cached_workflows=0,
    )
    await worker.run()


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m orbexa_ai.serve HOST:PORT TASK_QUEUE")
    asyncio.run(serve(sys.argv[1], sys.argv[2]))


if __name__ == "__main__":
    main()
