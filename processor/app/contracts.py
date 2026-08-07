from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class InputValue(BaseModel):
    slot_code: str
    kind: Literal["media", "timeseries", "metric", "record", "artifact"]
    url: str | None = None
    value: Any = None
    observed_at: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExecuteRequest(BaseModel):
    request_id: str
    processor_code: str
    processor_version: str
    inputs: list[InputValue]
    parameters: dict[str, Any] = Field(default_factory=dict)
    output_uploads: dict[str, str] = Field(default_factory=dict)


class OutputValue(BaseModel):
    code: str
    kind: Literal["metric", "record", "artifact"]
    value: Any = None
    unit: str | None = None
    observed_at: str | None = None
    url: str | None = None
    content_type: str | None = None


class ExecutionState(BaseModel):
    execution_id: str
    request_id: str
    status: Literal["queued", "running", "success", "failed"]
    outputs: list[OutputValue] = Field(default_factory=list)
    error: str = ""
