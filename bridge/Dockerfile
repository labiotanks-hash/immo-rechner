# WhatsApp-Bridge (whatsmeow, SQLite über cgo)
FROM golang:1.26-bookworm AS bau
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /bridge .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
# gleiche UID wie die App, damit beide das gemeinsame Volume lesen/schreiben können
RUN useradd --system --uid 10001 --home /store bridge && mkdir -p /store && chown bridge /store
COPY --from=bau /bridge /usr/local/bin/bridge
USER bridge
ENV STORE_DIR=/store TZ=Europe/Berlin
VOLUME /store
CMD ["bridge"]
