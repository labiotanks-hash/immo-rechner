FROM node:22-bookworm-slim

# Chromium für die PDFs (wie der Mac-Workflow mit Chrome headless), Liberation als Arial-Ersatz,
# Python für eure optionale FixFlip-Pro-build.py
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY vorlagen ./vorlagen

ENV NODE_ENV=production PORT=8080 DATA_DIR=/daten CHROME_PATH=/usr/bin/chromium
RUN useradd --system --uid 10001 --home /daten app && mkdir -p /daten && chown app /daten
USER app
VOLUME /daten
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
