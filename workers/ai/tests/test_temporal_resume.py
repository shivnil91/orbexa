import asyncio
import base64
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from orbexa_ai.cli import ACTIVITIES
from orbexa_ai.office import read_docx_paragraphs, read_xlsx_rows
from orbexa_ai.pack import write_pack
from orbexa_ai.tender_workflow import TenderJob


def test_killing_the_worker_mid_extract_resumes_and_completes_once(tmp_path: Path) -> None:
    result, killed = asyncio.run(_run(tmp_path))
    store = tmp_path / "store"
    assert (store / "extract-computes").read_text(encoding="utf-8") == "1"
    attempts = [
        int(line)
        for line in (store / "extract-attempts").read_text(encoding="utf-8").splitlines()
        if line
    ]
    assert attempts[0] == killed
    assert any(pid != killed for pid in attempts[1:])
    docx = base64.b64decode(str(result["deliverables"]["docx_base64"]))
    xlsx = base64.b64decode(str(result["deliverables"]["xlsx_base64"]))
    prose = "\n".join(read_docx_paragraphs(docx))
    grid = "\n".join(row["text"] for row in read_xlsx_rows(xlsx))
    assert "950 mm" in prose
    assert "regulatory certificate" in grid
    assert "invitation.pdf page 1" in grid
    assert result["status"] == "waiting_for_buyer"


async def _run(tmp_path: Path) -> tuple[dict[str, object], int]:
    pack = tmp_path / "pack"
    store = tmp_path / "store"
    write_pack(pack)
    store.mkdir()
    (store / "kill-extract").write_text("1", encoding="utf-8")
    payload = {
        "store_dir": str(store),
        "pack_dir": str(pack),
        "service_level": "expert_verified",
        "job_id": uuid4().hex,
    }
    log_path = tmp_path / "worker.log"
    async with await WorkflowEnvironment.start_time_skipping() as env:
        target = env.client.service_client.config.target_host
        with log_path.open("w", encoding="utf-8") as log:
            first = subprocess.Popen(
                [sys.executable, "-m", "orbexa_ai.serve", target, "orbexa-resume"],
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        try:
            handle = await env.client.start_workflow(
                TenderJob.run,
                payload,
                id=f"resume-{payload['job_id']}",
                task_queue="orbexa-resume",
            )
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if (store / "extract-holding").exists() and (store / "extract.json").exists():
                    break
                if first.poll() is not None:
                    raise AssertionError(log_path.read_text(encoding="utf-8"))
                await asyncio.sleep(0.05)
            else:
                detail = log_path.read_text(encoding="utf-8") or "extract did not persist"
                raise AssertionError(detail)
            await asyncio.sleep(0.3)
            os.kill(first.pid, signal.SIGKILL)
            first.wait(timeout=5)
        finally:
            if first.poll() is None:
                os.kill(first.pid, signal.SIGKILL)
                first.wait(timeout=5)
        async with Worker(
            env.client,
            task_queue="orbexa-resume",
            workflows=[TenderJob],
            activities=ACTIVITIES,
            max_cached_workflows=0,
        ):
            await handle.signal(TenderJob.approve)
            result = await asyncio.wait_for(handle.result(), timeout=30)
    if not isinstance(result, dict):
        raise TypeError(result)
    saved = json.loads((store / "extract.json").read_text(encoding="utf-8"))
    requirements = saved["requirements"]
    assert isinstance(requirements, list)
    assert len(requirements) == 3
    return result, first.pid
