# Haim's hosted copy on Cloud Run (npm run deploy). The bucket with his data is mounted at /data.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dev dev
COPY src src
ENV HOST=0.0.0.0 GYMBOT_DATA_DIR=/data
CMD ["node", "dev/server.mjs", "--live"]
