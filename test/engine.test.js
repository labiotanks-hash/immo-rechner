import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("berechneFixFlip wird aus einer index.html gezogen, wenn FIXFLIP_DIR gesetzt ist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fixflip-"));
  writeFileSync(join(dir, "index.html"), `<html><script>
const KFW_FOERDERUNG = {
  eh55: 20,
};
function berechneFixFlip(i, profil = PROFIL) {
  return { bruttogewinn: i.zielverkaufspreis - i.kaufpreis, kfw: KFW_FOERDERUNG.eh55 };
}
function andereFunktion() {}
</script></html>`);
  process.env.FIXFLIP_DIR = dir;
  const { engine } = await import(`../lib/engine.js?t=${Date.now()}`);
  const e = engine();
  assert.equal(e.quelle, "original");
  assert.deepEqual(e.rechne({ kaufpreis: 100, zielverkaufspreis: 150 }, {}), { bruttogewinn: 50, kfw: 20 });
});
