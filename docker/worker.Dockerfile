FROM python:3.12-slim AS base

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

COPY apps/worker/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY apps/worker ./apps/worker
COPY packages ./packages

RUN useradd --create-home --uid 1000 appuser
USER appuser

CMD ["python", "-m", "apps.worker.worker"]
