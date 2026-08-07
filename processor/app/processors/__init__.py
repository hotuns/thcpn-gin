from . import ndvi


def load() -> None:
    ndvi.register_processor()
