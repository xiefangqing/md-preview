import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/** 操作接口必须拒绝跨站、无来源和 GET 请求，且不改变当前文件 */
test("local operations require same-origin POST", { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "md-preview-test-"));
  await writeFile(join(directory, "first.md"), "# First");
  await writeFile(join(directory, "second.md"), "# Second");

  const child = spawn(process.execPath, [
    fileURLToPath(new URL("../bin/cli.mjs", import.meta.url)),
    join(directory, "first.md"), "--no-open",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  t.after(async () => {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  });

  let output = "";
  const base = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`server exited: ${code}`)));
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (address) resolve(address[0]);
    });
  });

  for (const endpoint of ["/api/switch?path=" + encodeURIComponent(join(directory, "second.md")), "/api/open"]) {
    for (const options of [
      { method: "GET" },
      { method: "GET", headers: { origin: base } },
      { method: "POST" },
      { method: "POST", headers: { origin: "https://example.com" } },
      { method: "POST", headers: { origin: "null" } },
    ]) {
      const response = await fetch(base + endpoint, options);
      assert.equal(response.status, 403, `${endpoint} ${JSON.stringify(options)}`);
      const content = await (await fetch(base + "/api/content")).json();
      assert.equal(content.content, "# First");
    }
  }

  const switched = await fetch(base + "/api/switch?path=" + encodeURIComponent(join(directory, "second.md")), {
    method: "POST", headers: { origin: base },
  });
  assert.equal(switched.status, 200);
  const content = await (await fetch(base + "/api/content")).json();
  assert.equal(content.name, "second.md");
  assert.equal(content.content, "# Second");
});
