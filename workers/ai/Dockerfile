# syntax=docker/dockerfile:1
# Multi-arch (linux/amd64 and linux/arm64).
# ANTHROPIC_API_KEY and OPENAI_API_KEY are read from the process environment
# only. They are not build arguments and this image sets neither variable.

FROM python:3.12-slim-bookworm AS build
ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /src
COPY pyproject.toml ./
COPY src ./src
RUN pip install --upgrade "pip>=26.2" \
  && pip install --no-cache-dir --target /opt/orbexa .

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/orbexa \
    HOME=/home/orbexa
COPY --from=build /opt/orbexa /opt/orbexa
RUN groupadd --gid 10001 orbexa \
  && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin orbexa
WORKDIR /home/orbexa
USER orbexa
# No ENTRYPOINT: the ECS command replaces CMD and must stay
# python -m orbexa_ai.serve 127.0.0.1:7233 orbexa-dev
CMD ["python", "-m", "orbexa_ai.serve", "127.0.0.1:7233", "orbexa-dev"]
