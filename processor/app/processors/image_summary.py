from __future__ import annotations

from io import BytesIO
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from ..contracts import ExecuteRequest, OutputValue
from ..registry import register

MANIFEST = {
    "code": "image_summary",
    "version": "1",
    "name": "图片基础统计",
    "description": "读取单张图片并输出尺寸、平均亮度和图片摘要，用于验证数据处理流程。",
    "category": "image",
    "execution": {"mode": "media_each_input"},
    "target_types": ["device", "site"],
    "required_capability": "",
    "inputs": [
        {"code": "image", "name": "图片", "kind": "media", "required": True},
    ],
    "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
    "alignment": {"mode": "single"},
    "triggers": ["each_input"],
    "ui": {"analysis_roi": {"required": False, "shape": "rectangle"}},
    "outputs": [
        {"code": "width", "name": "图片宽度", "kind": "metric", "unit": "px"},
        {"code": "height", "name": "图片高度", "kind": "metric", "unit": "px"},
        {"code": "mean_brightness", "name": "平均亮度", "kind": "metric", "unit": "%"},
        {"code": "summary", "name": "图片摘要", "kind": "record"},
    ],
}


def _read(value_url: str | None) -> bytes:
    if not value_url:
        raise ValueError("image input URL is required")
    if value_url.startswith("file://"):
        return Path(value_url[7:]).read_bytes()
    response = httpx.get(value_url, timeout=60)
    response.raise_for_status()
    return response.content


def run(request: ExecuteRequest) -> list[OutputValue]:
    value = next((item for item in request.inputs if item.slot_code == "image"), None)
    if value is None:
        raise ValueError("image input is required")

    with Image.open(BytesIO(_read(value.url))) as source:
        width, height = source.size
        image_format = source.format or "unknown"
        color_mode = source.mode
        grayscale = np.asarray(source.convert("L"), dtype=np.float32)

    brightness = round(float(np.mean(grayscale) / 255.0 * 100.0), 2)
    return [
        OutputValue(code="width", kind="metric", value=width, unit="px", observed_at=value.observed_at),
        OutputValue(code="height", kind="metric", value=height, unit="px", observed_at=value.observed_at),
        OutputValue(code="mean_brightness", kind="metric", value=brightness, unit="%", observed_at=value.observed_at),
        OutputValue(
            code="summary",
            kind="record",
            value={"format": image_format, "color_mode": color_mode, "width": width, "height": height},
            observed_at=value.observed_at,
        ),
    ]


def register_processor() -> None:
    register(MANIFEST, run)
