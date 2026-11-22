import asyncio

from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from orbexa_ai.temporal_gate import TenderGate, record_step


def test_temporal_test_server_waits_for_the_expert_signal() -> None:
    assert asyncio.run(_run()) == ["extract", "accepted"]


async def _run() -> list[str]:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="orbexa-test",
            workflows=[TenderGate],
            activities=[record_step],
        ):
            handle = await env.client.start_workflow(
                TenderGate.run,
                id="hospital-beds-gate",
                task_queue="orbexa-test",
            )
            await handle.signal(TenderGate.approve)
            result = await handle.result()
            return list(result)
