// Nachgebaute Claude-API für Tests: beantwortet /v1/messages als SSE-Stream nach einem
// Drehbuch (Liste von Antworten) und /v1/files mit einer file_id.
import { createServer } from "node:http";

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}

function streamEvents(antwort, n) {
  const ev = [{ type: "message_start", message: {
    id: `msg_${n}`, type: "message", role: "assistant", model: "claude-opus-5", content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 },
  } }];
  antwort.bloecke.forEach((b, i) => {
    if (b.type === "text") {
      ev.push({ type: "content_block_start", index: i, content_block: { type: "text", text: "" } });
      ev.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } });
    } else if (b.type === "tool_use") {
      ev.push({ type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      const json = JSON.stringify(b.input);
      for (let k = 0; k < json.length; k += 400)
        ev.push({ type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: json.slice(k, k + 400) } });
    }
    ev.push({ type: "content_block_stop", index: i });
  });
  ev.push({ type: "message_delta", delta: { stop_reason: antwort.stop, stop_sequence: null }, usage: { output_tokens: 50 } });
  ev.push({ type: "message_stop" });
  return ev;
}

export async function starteMock(drehbuch) {
  const anfragen = [];
  let n = 0, f = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (req.url.startsWith("/v1/files")) {
        f++;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `file_${f}`, type: "file", filename: "x", mime_type: "application/pdf", size_bytes: body.length, created_at: new Date().toISOString(), downloadable: false }));
        return;
      }
      const daten = JSON.parse(body || "{}");
      anfragen.push({ url: req.url, headers: req.headers, body: daten });
      const antwort = drehbuch[Math.min(n, drehbuch.length - 1)];
      n++;
      sse(res, streamEvents(antwort, n));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, anfragen, schliessen: () => server.close() };
}
