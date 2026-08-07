from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .contracts import ExecuteRequest, ExecutionState
from .processors import load
from .registry import catalog, get

load()
app = FastAPI(title="THCPN Processor", version="0.1.0")
artifact_dir = Path(os.getenv("PROCESSOR_ARTIFACT_DIR", "var/processor-artifacts"))
artifact_dir.mkdir(parents=True, exist_ok=True)
app.mount("/artifacts", StaticFiles(directory=artifact_dir), name="artifacts")
executions: dict[str, ExecutionState] = {}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/processors")
def processors() -> dict[str, list[dict]]:
    return {"items": catalog()}


async def _run(execution_id: str, request: ExecuteRequest) -> None:
    state = executions[execution_id]
    state.status = "running"
    try:
        processor = get(request.processor_code, request.processor_version)
        state.outputs = await asyncio.to_thread(processor.run, request)
        state.status = "success"
    except Exception as exc:
        state.status = "failed"
        state.error = str(exc)


@app.post("/v1/executions", status_code=202)
async def submit(request: ExecuteRequest) -> ExecutionState:
    try:
        get(request.processor_code, request.processor_version)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    execution_id = str(uuid4())
    state = ExecutionState(execution_id=execution_id, request_id=request.request_id, status="queued")
    executions[execution_id] = state
    asyncio.create_task(_run(execution_id, request))
    return state


@app.get("/v1/executions/{execution_id}")
def execution(execution_id: str) -> ExecutionState:
    state = executions.get(execution_id)
    if state is None:
        raise HTTPException(status_code=404, detail="execution not found")
    return state
