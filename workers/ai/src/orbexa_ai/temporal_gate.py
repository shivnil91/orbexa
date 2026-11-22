"""A Temporal workflow that waits for an expert signal.

The hospital-bed slice itself uses the in-process runner in workflow.py.
This module is the proof that the Temporal test server can host the same gate.
"""

from datetime import timedelta

from temporalio import activity, workflow


@activity.defn
async def record_step(name: str) -> str:
    return name


@workflow.defn
class TenderGate:
    def __init__(self) -> None:
        self.approved = False

    @workflow.run
    async def run(self) -> list[str]:
        extracted = await workflow.execute_activity(
            record_step,
            "extract",
            start_to_close_timeout=timedelta(seconds=10),
        )
        await workflow.wait_condition(lambda: self.approved)
        return [extracted, "accepted"]

    @workflow.signal
    def approve(self) -> None:
        self.approved = True
