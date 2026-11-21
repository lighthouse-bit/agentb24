const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { randomBytes } = require('node:crypto');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentb24-analytics-test-'));
  const php = process.env.PHP_BINARY || (process.platform === 'win32' ? 'C:\\xampp\\php\\php.exe' : 'php');
  const password = randomBytes(24).toString('hex');
  const hash = execFileSync(php, ['-r', 'echo password_hash(stream_get_contents(STDIN), PASSWORD_DEFAULT);'], { input: password, encoding: 'utf8' });
  for (const file of ['tracker.php', 'get-visits.php', 'analytics-store.php']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'admin-config.php'), "<?php define('AGENTB24_ADMIN_PASSWORD_HASH', '" + hash + "');");
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const server = spawn(php, ['-S', '127.0.0.1:' + port, '-t', dir], { stdio: 'ignore' });
  const closed = new Promise(resolve => server.on('exit', resolve));
  const post = (file, data, origin = base) => fetch(base + '/' + file, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(data) });
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(base + '/tracker.php')).status === 405) { ready = true; break; } } catch {}
      await delay(100);
    }
    assert.ok(ready, 'PHP test server did not start');
    assert.equal((await post('get-visits.php', { password: 'wrong' })).status, 403);
    const event = { version: 2, visitorId: 'test-browser', eventId: 'view-1', sessionId: 'session-1', page: 'Homepage', path: '/', isNew: true };
    assert.equal((await post('tracker.php', event, 'https://unrelated.example')).status, 403);
    await Promise.all(Array.from({ length: 12 }, async () => assert.equal((await post('tracker.php', event)).status, 200)));
    let data = await (await post('get-visits.php', { password })).json();
    assert.equal(data.visits.length, 1);
    assert.equal(data.pageviews, 1);
    await Promise.all(Array.from({ length: 12 }, async (_, i) => assert.equal((await post('tracker.php', { ...event, eventId: 'other-' + i })).status, 200)));
    data = await (await post('get-visits.php', { password })).json();
    assert.equal(data.visits.length, 13);
    assert.equal(data.sessions, 1);
    assert.ok(data.storageBytes > 0);
    assert.equal((await post('tracker.php', { ...event, country: '<script>bad</script>' })).status, 200);
    data = await (await post('get-visits.php', { password })).json();
    assert.ok(!data.visits[0].country.includes('<script>'));
    const file = path.join(dir, 'data', 'visits.json');
    fs.writeFileSync(file, '{invalid-test-data');
    assert.equal((await post('tracker.php', event)).status, 500);
    assert.equal((await post('get-visits.php', { password })).status, 500);
    assert.equal(fs.readFileSync(file, 'utf8'), '{invalid-test-data');
    console.log('HTTP integration passed: authentication, origin checks, retries, page views, sessions, escaping and corrupt-file protection.');
  } finally {
    server.kill();
    await closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
