# ACAIAMUSIC no Hugging Face Spaces (servidor grátis, ligado 24h)
FROM node:22-slim

# Python + ferramenta do Kaggle (o app liga o estúdio de música no Kaggle sozinho)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
 && pip3 install --break-system-packages --no-cache-dir kaggle six "yt-dlp[default]" \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R 1000:1000 /app

# o Hugging Face roda os Spaces com o usuário 1000
USER 1000
ENV PORT=7860 NODE_ENV=production HOME=/app PYTHON=python3
EXPOSE 7860
CMD ["node", "server.js"]
