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
from .image_regions import crop

MANIFEST = {
    "code": "vegetation_cover",
    "version": "1",
    "name": "植物盖度识别",
    "description": "基于可见光图像的颜色特征识别植物区域，输出植物覆盖度和分类假彩色图。",
    "category": "image",
    "execution": {"mode": "media_each_input"},
    "target_types": ["device", "site"],
    "required_capability": "image_capture",
    "inputs": [
        {"code": "image", "name": "可见光图片", "kind": "media", "required": True},
    ],
    "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
    "alignment": {"mode": "single"},
    "triggers": ["each_input"],
    "ui": {"analysis_roi": {"required": True, "shape": "rectangle", "label": "分析区域"}},
    "outputs": [
        {"code": "vegetation_cover", "name": "植物盖度", "kind": "metric", "unit": "%"},
        {"code": "summary", "name": "识别摘要", "kind": "record"},
        {"code": "false_color", "name": "盖度假彩色图", "kind": "artifact", "content_type": "image/png"},
    ],
}


def _read(value_url: str | None) -> bytes:
    if not value_url:
        raise ValueError("visible-light image input URL is required")
    if value_url.startswith("file://"):
        return Path(value_url[7:]).read_bytes()
    response = httpx.get(value_url, timeout=60)
    response.raise_for_status()
    return response.content


def _save_artifact(request: ExecuteRequest, image: Image.Image) -> str:
    artifact_dir = Path(os.getenv("PROCESSOR_ARTIFACT_DIR", "var/processor-artifacts"))
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_name = f"{uuid4()}.png"
    artifact_path = artifact_dir / artifact_name
    image.save(artifact_path, format="PNG")
    upload_url = request.output_uploads.get("false_color")
    if upload_url:
        with artifact_path.open("rb") as handle:
            response = httpx.put(
                upload_url,
                content=handle.read(),
                headers={"Content-Type": "image/png"},
                timeout=60,
            )
            response.raise_for_status()
    return upload_url or f"/artifacts/{artifact_name}"


def run(request: ExecuteRequest) -> list[OutputValue]:
    value = next((item for item in request.inputs if item.slot_code == "image"), None)
    if value is None:
        raise ValueError("visible-light image input is required")

    with Image.open(BytesIO(_read(value.url))) as source:
        rgb = np.asarray(source.convert("RGB"), dtype=np.float32) / 255.0
    roi = request.parameters.get("interaction", {}).get("roi")
    rgb = crop(rgb, roi, "analysis ROI")

    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    total = red + green + blue + 1e-6
    red_norm, green_norm, blue_norm = red / total, green / total, blue / total
    excess_green = 2.0 * green_norm - red_norm - blue_norm
    threshold = 0.10
    vegetation = (
        (excess_green >= threshold)
        & (green >= red * 1.03)
        & (green >= blue * 1.02)
        & (green >= 0.08)
    )

    coverage = float(np.count_nonzero(vegetation) / vegetation.size * 100.0)
    false_color = np.empty((*vegetation.shape, 3), dtype=np.uint8)
    false_color[vegetation] = (35, 210, 80)
    false_color[~vegetation] = (190, 45, 145)
    artifact_url = _save_artifact(request, Image.fromarray(false_color, mode="RGB"))

    return [
        OutputValue(
            code="vegetation_cover",
            kind="metric",
            value=round(coverage, 2),
            unit="%",
            observed_at=value.observed_at,
        ),
        OutputValue(
            code="summary",
            kind="record",
            value={
                "method": "visible_normalized_excess_green",
                "threshold": round(threshold, 4),
                "vegetation_pixels": int(np.count_nonzero(vegetation)),
                "total_pixels": int(vegetation.size),
            },
            observed_at=value.observed_at,
        ),
        OutputValue(
            code="false_color",
            kind="artifact",
            url=artifact_url,
            content_type="image/png",
            observed_at=value.observed_at,
        ),
    ]


def register_processor() -> None:
    register(MANIFEST, run)
