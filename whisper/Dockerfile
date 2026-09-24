# Lokale Spracherkennung (faster-whisper, CPU, int8). Das Modell (~1,6 GB) wird beim
# ersten Start nach /modelle geladen und liegt dann im Volume.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 WHISPER_CACHE=/modelle HF_HOME=/modelle/hf
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
RUN useradd --uid 10002 --create-home whisper && mkdir -p /modelle && chown whisper /modelle
USER whisper
EXPOSE 9000
HEALTHCHECK --interval=60s --timeout=5s --start-period=15m CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9000/gesund')"
CMD ["python", "server.py"]
