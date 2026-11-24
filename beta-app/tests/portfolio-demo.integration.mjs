// Part of [PROJECT.md](../../PROJECT.md) — exercise the actual exported artifact over HTTP.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
const directory = new URL('../portfolio-demo-dist/', import.meta.url);
const files = await readdir(directory);
assert.deepEqual(files, ['index.html']);
const html = await readFile(new URL('index.html', directory), 'utf8');
assert.match(html, /connect-src &#x27;none&#x27;/);
assert.match(html, /script-src &#x27;none&#x27;/);
assert.match(html, /form-action &#x27;none&#x27;/);
assert.doesNotMatch(html, /<(script|form|iframe|input|textarea)\b/i);
assert.doesNotMatch(html, /\s(?:src|action|on[a-z]+)=|href="(?!#)|\/api\/|\/internal\//i);
for (const copy of ['Fictional, read-only', 'does not perform live AI analysis', 'What you did well', 'What to improve', 'Success check:', '<details', 'No account is required']) assert.ok(html.includes(copy), copy);
assert.doesNotMatch(html, /@import\s|url\(/i);
// A dedicated static host must return no application route or data, including POSTs.
const server = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type':'text/html'}); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin)).status, 200);
  for (const path of ['/api/attempts', '/api/review', '/api/analyse', '/internal/review', '/internal/analytics', '/enrol']) {
    for (const method of ['GET','POST']) assert.equal((await fetch(origin+path, {method})).status, 404);
  }
} finally { await new Promise(resolve => server.close(resolve)); }
console.log('Static artifact isolation, disclosure and HTTP negative checks passed.');
