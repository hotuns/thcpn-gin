from __future__ import annotations

from io import BytesIO
import os
from pathlib import Path
from uuid import uuid4

import httpx
import numpy as np
from PIL import Image

from ..contracts import ExecuteRequest, OutputValue
from ..registry import register

MANIFEST = {
    "code": "ndvi",
    "version": "1",
    "name": "NDVI",
    "description": "基于红光和近红外图片生成 NDVI 指标与伪彩色图。",
    "target_types": ["device", "site"],
    "required_capability": "ndvi_processing",
    "inputs": [
        {"code": "red", "name": "红光图片", "kind": "media", "required": True},
        {"code": "nir", "name": "近红外图片", "kind": "media", "required": True},
    ],
    "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
    "alignment": {"mode": "nearest", "tolerance_seconds": 120},
    "triggers": ["each_input"],
    "outputs": [
        {"code": "ndvi_mean", "name": "NDVI 均值", "kind": "metric", "unit": "1"},
        {"code": "ndvi_min", "name": "NDVI 最小值", "kind": "metric", "unit": "1"},
        {"code": "ndvi_max", "name": "NDVI 最大值", "kind": "metric", "unit": "1"},
        {"code": "summary", "name": "NDVI 分布", "kind": "record"},
        {"code": "false_color", "name": "NDVI 伪彩色图", "kind": "artifact", "content_type": "image/png"},
    ],
}

COLOR_BINS = np.array([-0.2, 0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], dtype=np.float32)
COLOR_PALETTE = np.array([
    [0, 0, 0], [165, 0, 38], [215, 48, 39], [244, 109, 67],
    [253, 174, 97], [254, 224, 139], [255, 255, 191], [217, 239, 139],
    [166, 217, 106], [102, 189, 99], [26, 152, 80], [0, 104, 55],
], dtype=np.uint8)


def _read(value_url: str | None) -> bytes:
    if not value_url:
        raise ValueError("NDVI image input URL is required")
    if value_url.startswith("file://"):
        return Path(value_url[7:]).read_bytes()
    response = httpx.get(value_url, timeout=60)
    response.raise_for_status()
    return response.content


def _linear_gray(data: bytes) -> np.ndarray:
    rgb = np.asarray(Image.open(BytesIO(data)).convert("RGB"), dtype=np.float32) / 255.0
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    return np.mean(linear, axis=2)


def run(request: ExecuteRequest) -> list[OutputValue]:
    values = {item.slot_code: item for item in request.inputs}
    red = _linear_gray(_read(values.get("red").url if values.get("red") else None))
    nir = _linear_gray(_read(values.get("nir").url if values.get("nir") else None))
    if nir.shape != red.shape:
        image = Image.fromarray(np.clip(nir * 255, 0, 255).astype(np.uint8), mode="L")
        nir = np.asarray(image.resize((red.shape[1], red.shape[0]), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
    ndvi = np.clip((nir - red) / (nir + red + 1e-6), -1.0, 1.0)
    observed_at = values["red"].observed_at
    low = float(np.count_nonzero(ndvi < 0.2) / ndvi.size * 100)
    medium = float(np.count_nonzero((ndvi >= 0.2) & (ndvi < 0.5)) / ndvi.size * 100)
    high = float(np.count_nonzero(ndvi >= 0.5) / ndvi.size * 100)
    image = Image.fromarray(COLOR_PALETTE[np.digitize(ndvi, COLOR_BINS, right=True)], mode="RGB")
    artifact_dir = Path(os.getenv("PROCESSOR_ARTIFACT_DIR", "var/processor-artifacts"))
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_name = f"{uuid4()}.png"
    image.save(artifact_dir / artifact_name, format="PNG")
    upload_url = request.output_uploads.get("false_color")
    if upload_url:
        with (artifact_dir / artifact_name).open("rb") as handle:
            response = httpx.put(upload_url, content=handle.read(), headers={"Content-Type": "image/png"}, timeout=60)
            response.raise_for_status()
    artifact_url = upload_url or f"/artifacts/{artifact_name}"
    return [
        OutputValue(code="ndvi_mean", kind="metric", value=round(float(np.mean(ndvi)), 4), unit="1", observed_at=observed_at),
        OutputValue(code="ndvi_min", kind="metric", value=round(float(np.min(ndvi)), 4), unit="1", observed_at=observed_at),
        OutputValue(code="ndvi_max", kind="metric", value=round(float(np.max(ndvi)), 4), unit="1", observed_at=observed_at),
        OutputValue(code="summary", kind="record", value={"low_ratio": round(low, 1), "medium_ratio": round(medium, 1), "high_ratio": round(high, 1)}, observed_at=observed_at),
        OutputValue(code="false_color", kind="artifact", url=artifact_url, content_type="image/png", observed_at=observed_at),
    ]


def register_processor() -> None:
    register(MANIFEST, run)
