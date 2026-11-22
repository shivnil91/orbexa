"""Temporal workflow for one tender: extract, matrix, draft, review, deliver."""

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from orbexa_ai.tender_activities import (
        deliver_activity,
        draft_activity,
        extract_activity,
        matrix_activity,
    )

_RETRY = RetryPolicy(
    maximum_attempts=5,
    initial_interval=timedelta(milliseconds=20),
    backoff_coefficient=1,
)


@workflow.defn
class TenderJob:
    def __init__(self) -> None:
        self.approved = False

    @workflow.run
    async def run(self, payload: dict[str, str]) -> dict[str, Any]:
        timeout = timedelta(seconds=30)
        # A heartbeat starts only when the activity asks for one. The kill
        # test does that after the extract result is durable, so a dead worker
        # is retried in about two seconds. The normal path never heartbeats.
        extracted = await workflow.execute_activity(
            extract_activity,
            payload,
            start_to_close_timeout=timeout,
            heartbeat_timeout=timedelta(seconds=2),
            retry_policy=_RETRY,
        )
        matrix = await workflow.execute_activity(
            matrix_activity,
            payload,
            start_to_close_timeout=timeout,
            retry_policy=_RETRY,
        )
        drafted = await workflow.execute_activity(
            draft_activity,
            payload,
            start_to_close_timeout=timeout,
            retry_policy=_RETRY,
        )
        if payload["service_level"] != "autonomous":
            await workflow.wait_condition(lambda: self.approved)
        delivered = await workflow.execute_activity(
            deliver_activity,
            payload,
            start_to_close_timeout=timeout,
            retry_policy=_RETRY,
        )
        chunks = extracted["chunks"] if "chunks" in extracted else []
        return {
            "requirements": extracted["requirements"],
            "matrix": matrix["rows"],
            "paragraphs": drafted["paragraphs"],
            "claims": drafted["claims"],
            "chunks": chunks,
            "deliverables": delivered,
            "workflow_id": workflow.info().workflow_id,
            "status": "waiting_for_buyer",
        }

    @workflow.signal
    def approve(self) -> None:
        self.approved = True
