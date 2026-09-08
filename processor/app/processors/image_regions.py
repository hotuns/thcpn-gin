from __future__ import annotations

from typing import Any

import numpy as np


def rectangle(value: Any, label: str) -> tuple[float, float, float, float]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} is required")
    try:
        x, y, width, height = (float(value[key]) for key in ("x", "y", "width", "height"))
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"{label} is invalid") from error
    if x < 0 or y < 0 or width < 0.005 or height < 0.005 or x + width > 1 or y + height > 1:
        raise ValueError(f"{label} is outside the image")
    return x, y, width, height


def crop(image: np.ndarray, value: Any, label: str) -> np.ndarray:
    x, y, width, height = rectangle(value, label)
    image_height, image_width = image.shape[:2]
    left, top = round(x * image_width), round(y * image_height)
    right, bottom = round((x + width) * image_width), round((y + height) * image_height)
    result = image[top:bottom, left:right]
    if result.size == 0:
        raise ValueError(f"{label} is too small")
    return result
