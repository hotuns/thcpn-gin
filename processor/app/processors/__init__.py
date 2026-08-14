from . import image_summary, ndvi, vegetation_cover


def load() -> None:
    image_summary.register_processor()
    ndvi.register_processor()
    vegetation_cover.register_processor()
