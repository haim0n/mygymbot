# Haim's hosted copy on Cloud Run (npm run deploy). The bucket with his data is mounted at /data.

# The web app: bundle src/ with its page.
FROM node:22-slim AS web
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tailwind.config.js ./
COPY web web
COPY src src
RUN npm run build

# The Python server that serves it.
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY server server
COPY web/index.html web/index.html
COPY --from=web /app/web/dist web/dist
ENV HOST=0.0.0.0 GYMBOT_DATA_DIR=/data \
    GYMBOT_IAP_AUDIENCE=/projects/83264737603/locations/me-west1/services/gymbot
CMD [".venv/bin/python", "-m", "server"]
