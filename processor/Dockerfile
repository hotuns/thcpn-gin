FROM python:3.12-slim
ARG PIP_INDEX_URL=https://pypi.org/simple
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir --index-url "${PIP_INDEX_URL}" .
COPY app ./app
ENV PROCESSOR_ARTIFACT_DIR=/var/lib/thcpn-processor/artifacts
EXPOSE 8090
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
