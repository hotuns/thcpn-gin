from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .contracts import ExecuteRequest, OutputValue

Runner = Callable[[ExecuteRequest], list[OutputValue]]


@dataclass(frozen=True)
class Processor:
    manifest: dict[str, Any]
    run: Runner


_processors: dict[tuple[str, str], Processor] = {}


def register(manifest: dict[str, Any], runner: Runner) -> None:
    key = (str(manifest["code"]), str(manifest["version"]))
    if key in _processors:
        raise RuntimeError(f"processor already registered: {key[0]}@{key[1]}")
    _processors[key] = Processor(manifest=manifest, run=runner)


def catalog() -> list[dict[str, Any]]:
    return [item.manifest for item in _processors.values()]


def get(code: str, version: str) -> Processor:
    try:
        return _processors[(code, version)]
    except KeyError as exc:
        raise ValueError(f"unknown processor: {code}@{version}") from exc
