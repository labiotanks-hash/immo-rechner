// HTML → PDF mit Chromium headless, derselbe Aufruf wie in kalkulation_pdf.py.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { config } from "../config.js";

const KANDIDATEN = [
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  "/opt/pw-browsers/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function chromePfad() {
  if (config.chromePath) return config.chromePath;
  return KANDIDATEN.find((p) => existsSync(p)) || null;
}

export function druckePdf(htmlPfad, pdfPfad) {
  const chrome = chromePfad();
  if (!chrome) return Promise.reject(new Error("Chromium nicht gefunden (CHROME_PATH setzen)"));
  const args = ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
    "--run-all-compositor-stages-before-draw", `--print-to-pdf=${pdfPfad}`, pathToFileURL(htmlPfad).href];
  return new Promise((resolve, reject) => {
    execFile(chrome, args, { timeout: 90_000 }, (err, _out, stderr) => {
      if (err || !existsSync(pdfPfad)) reject(new Error(`PDF-Druck fehlgeschlagen: ${err?.message || stderr}`));
      else resolve(pdfPfad);
    });
  });
}
