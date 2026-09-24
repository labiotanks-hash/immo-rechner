"""Lokale Spracherkennung für den Immo-Rechner: OpenAI-kompatibler Endpunkt
POST /v1/audio/transcriptions (multipart: file, model, language, response_format)
mit faster-whisper auf der CPU. Nur im internen Docker-Netz erreichbar.
"""
import os
import tempfile
import threading

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

MODELL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
RECHENART = os.environ.get("WHISPER_COMPUTE", "int8")
THREADS = int(os.environ.get("WHISPER_THREADS", "2"))
MAX_MB = int(os.environ.get("WHISPER_MAX_MB", "100"))

app = FastAPI(title="A2O Whisper", docs_url=None, redoc_url=None)
_modell = None
_sperre = threading.Lock()  # eine Aufnahme nach der anderen — der Server hat nur 2 Kerne


def modell():
    global _modell
    if _modell is None:
        from faster_whisper import WhisperModel

        _modell = WhisperModel(MODELL, device="cpu", compute_type=RECHENART, cpu_threads=THREADS,
                               download_root=os.environ.get("WHISPER_CACHE", "/modelle"))
    return _modell


@app.get("/gesund")
def gesund():
    return {"ok": True, "modell": MODELL, "geladen": _modell is not None}


@app.post("/v1/audio/transcriptions")
def transkribiere(file: UploadFile = File(...), model: str = Form(None), language: str = Form("de"),
                  response_format: str = Form("json"), prompt: str = Form(None)):
    endung = os.path.splitext(file.filename or "")[1][:8] or ".ogg"
    with tempfile.NamedTemporaryFile(suffix=endung) as tmp:
        groesse = 0
        while block := file.file.read(1 << 20):
            groesse += len(block)
            if groesse > MAX_MB << 20:
                raise HTTPException(413, "Datei zu groß")
            tmp.write(block)
        tmp.flush()
        with _sperre:
            try:
                segmente, info = modell().transcribe(tmp.name, language=language or None, vad_filter=True,
                                                    beam_size=5, initial_prompt=prompt or None)
                text = " ".join(s.text.strip() for s in segmente).strip()
            except Exception as fehler:  # kaputte oder unbekannte Datei
                raise HTTPException(400, f"Audio nicht lesbar: {fehler}") from fehler
    if response_format == "text":
        from fastapi.responses import PlainTextResponse

        return PlainTextResponse(text)
    return {"text": text, "language": info.language, "duration": info.duration}


if __name__ == "__main__":
    # Modell beim Start laden (erster Start lädt ~1,6 GB herunter), dann Anfragen annehmen
    if os.environ.get("WHISPER_VORLADEN", "1") == "1":
        modell()
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "9000")), workers=1)
