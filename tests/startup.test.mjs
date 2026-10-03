import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("Hostinger-style module import starts the HTTP server", async (t) => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", "import('./server.mjs')"], {
    cwd: root,
    env: { ...process.env, PORT: "0", STRIPE_SECRET_KEY: "sk_test_example", PUBLIC_BASE_URL: "http://127.0.0.1",
      R2_ACCOUNT_ID: "a".repeat(32), R2_BUCKET: "nova-omnis-stl", R2_ACCESS_KEY_ID: "test-access",
      R2_SECRET_ACCESS_KEY: "test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    let output = "";
    let error = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not listen: ${error}`)), 3000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/Nova Omnis listening on port (\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${error}`)); });
  });
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  const home = await response.text();
  assert.match(home, /Nova Omnis/);
  assert.match(home, /<header[^>]*>[\s\S]*?class="wordmark"[\s\S]*?class="site-logo"/);
  const order = await fetch(`http://127.0.0.1:${port}/order.html`);
  assert.match(await order.text(), /<header[^>]*>[\s\S]*?class="wordmark"[\s\S]*?class="site-logo"/);
  const logo = await fetch(`http://127.0.0.1:${port}/assets/images/novaomnis-logo.svg`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/svg+xml");
  assert.match(await logo.text(), /<svg/);
});
