from __future__ import annotations

from io import BytesIO
import os
from pathlib import Path
from uuid import uuid4

import httpx
import joblib
import numpy as np
import pandas as pd
from PIL import Image

from ..contracts import ExecuteRequest, OutputValue
from ..registry import register
from .image_regions import crop

MODEL_PATH = Path(__file__).with_name("random_forest_model.joblib")

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
        rgb = np.asarray(source.convert("RGB"), dtype=np.uint8)
    roi = request.parameters.get("interaction", {}).get("roi")
    rgb = crop(rgb, roi, "analysis ROI")

    pixels = rgb.reshape(-1, 3)
    frame = pd.DataFrame(pixels, columns=["R", "G", "B"])
    frame[["R", "G", "B"]] = frame[["R", "G", "B"]].replace(0, 1e-10).astype(float)
    total = frame["R"] + frame["G"] + frame["B"]
    frame["rr"] = 3 * frame["R"] / total
    frame["rg"] = 3 * frame["G"] / total
    frame["rb"] = 3 * frame["B"] / total
    frame["gr_ratio"] = frame["G"] / frame["R"]
    frame["gb_ratio"] = frame["G"] / frame["B"]
    frame["br_ratio"] = frame["B"] / frame["R"]
    features = ["R", "G", "B", "rr", "rg", "rb", "gr_ratio", "gb_ratio", "br_ratio"]
    vegetation = joblib.load(MODEL_PATH).predict(frame[features]).reshape(rgb.shape[:2]) == "veg"

    coverage = float(np.count_nonzero(vegetation) / vegetation.size * 100.0)
    false_color = np.zeros((*vegetation.shape, 3), dtype=np.uint8)
    false_color[vegetation] = (0, 255, 0)
    false_color[~vegetation] = (255, 255, 0)
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
                "method": "random_forest_rgb",
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
