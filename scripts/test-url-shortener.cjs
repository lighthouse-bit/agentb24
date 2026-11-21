const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

(async () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'tools/url-shortener.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'assets/js/url-shortener.js'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML IDs');
  for (const m of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(m[1]), 'Missing element: ' + m[1]);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  assert.ok(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').includes('/tools/url-shortener.html'));
  assert.ok(fs.readFileSync(path.join(root, '.htaccess'), 'utf8').includes('short-link.php?code=$1 [END]'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentb24-shortener-test-'));
  const php = process.env.PHP_BINARY || (process.platform === 'win32' ? 'C:\\xampp\\php\\php.exe' : 'php');
  fs.copyFileSync(path.join(root, 'short-link.php'), path.join(dir, 'short-link.php'));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  let server, closed;
  async function start() {
    server = spawn(php, ['-S', '127.0.0.1:' + port, '-t', dir], { stdio: 'ignore' });
    closed = new Promise(resolve => server.on('exit', resolve));
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(base + '/short-link.php')).status === 404) return; } catch {}
      await delay(100);
    }
    throw Error('PHP test server did not start');
  }
  const create = (body, origin = base) => fetch(base + '/short-link.php', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  const lookup = (code, method = 'GET') => fetch(base + '/short-link.php?code=' + encodeURIComponent(code), { redirect: 'manual', method });
  try {
    await start();
    for (const url of ['javascript:alert(1)', 'https://user:password@example.com', 'http://127.0.0.1/', 'http://192.168.0.1/', 'https://example.com/\r\nLocation:bad', 'https://agentb24.com/s/another', 'ftp://example.com/file', 'http://localhost/']) {
      assert.equal((await create({ url })).status, 400, 'Unsafe URL accepted: ' + url);
    }
    assert.equal((await create({ url: 'https://example.com', alias: 'a' })).status, 400);
    assert.equal((await create({ url: 'https://example.com', days: 2 })).status, 400);
    assert.equal((await create({ url: 'https://example.com' }, 'https://foreign.example')).status, 403);
    const url = 'https://example.com/path?utm_source=email&v=a%20b#section';
    const response = await create({ url, alias: 'My-Launch', days: 7 });
    assert.equal(response.status, 201);
    const record = await response.json();
    assert.equal(record.code, 'my-launch');
    assert.equal(record.destination, url);
    assert.ok(new Date(record.expiresAt) > new Date());
    let redirect = await lookup(record.code);
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), url);
    assert.equal(redirect.headers.get('cache-control'), 'no-store');
    assert.equal(redirect.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await lookup(record.code, 'HEAD')).status, 302);
    assert.equal((await create({ url: 'https://other.example', alias: 'my-launch' })).status, 409);
    assert.equal((await lookup('missing-code')).status, 404);
    server.kill(); await closed;
    await start();
    assert.equal((await lookup(record.code)).headers.get('location'), url, 'Link lost on restart');
    execFileSync(php, ['-r', '$db = new PDO("sqlite:" . $argv[1]); $db->exec("UPDATE links SET expires_at = 1");', path.join(dir, 'data/short-links.sqlite')]);
    assert.equal((await lookup(record.code)).status, 410);
    assert.equal((await create({ url, alias: 'my-launch' })).status, 409, 'Expired code was reassigned');
    for (let i = 0; i < 9; i++) {
      const generated = await create({ url });
      assert.equal(generated.status, 201);
      const item = await generated.json();
      assert.match(item.code, /^[a-f0-9]{10}$/);
      assert.equal(item.expiresAt, null);
    }
    const limited = await create({ url });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    console.log('URL shortener passed: HTML wiring, schema, URL validation, aliases, redirects, expiry, restart persistence and rate limits.');
  } finally {
    if (server && server.exitCode === null) { server.kill(); await closed; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
