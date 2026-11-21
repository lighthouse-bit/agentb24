const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !/src=|application\/ld\+json/i.test(m[1]));
const ui = { document: { addEventListener() {} }, console, Blob, setInterval() {}, localStorage: { getItem() { return null; } } };
vm.createContext(ui);
scripts.forEach(m => vm.runInContext(m[2], ui));
const rows = [
  { visitorId: 'a', sessionId: 's1', isNew: true, isSession: true },
  { visitorId: 'a', sessionId: 's1', isNew: false },
  { visitorId: 'b', sessionId: 's2', isNew: false },
  { visitorId: 'b', sessionId: 's3', isNew: false }
];
assert.equal(ui.getUniqueVisitors(rows), 2);
assert.equal(ui.sessionCount(rows), 3);
assert.equal(ui.visitorCounts(rows).fresh, 1);
assert.equal(ui.visitorCounts(rows).returning, 1);
assert.equal(ui.visitorCounts([]).returning, 0);
const today = new Date(); today.setHours(0, 0, 0, 0);
assert.equal(ui.filterByDate([{ timestamp: today.toISOString() }, { timestamp: new Date(today - 1).toISOString() }, { timestamp: new Date(Date.now() + 86400000).toISOString() }], 1).length, 1);
assert.equal(ui.filterByDate([{ timestamp: 'invalid' }], 0).length, 0);
let values = {};
ui.setText = (id, value) => { values[id] = value; };
ui.makeChart = () => {};
ui.renderList = () => {};
ui.showEmpty = () => {};
ui.renderVisitors(rows.map(v => ({ ...v, timestamp: new Date().toISOString() })));
assert.equal(values['v-total'], '2');
assert.equal(values['v-new'], '1');
assert.equal(values['v-returning'], '1');
assert.equal(values['v-avg-pages'], '1.3');
ui.renderVisitors([]);
assert.equal(values['v-ret-pct'], '0.0% of total');

const tracker = fs.readFileSync(path.join(root, 'assets/js/tracker.js'), 'utf8');
function client(storageBlocked = false, pathname = '/') {
  const sent = [], listeners = {}, memory = {};
  let clock = 0, interval, lookup;
  const document = { currentScript: { src: 'https://agentb24.com/assets/js/tracker.js?v=2' }, visibilityState: 'visible', referrer: 'https://www.google.com/search', addEventListener: (key, fn) => { listeners[key] = fn; } };
  const context = { document, location: { pathname, hostname: 'agentb24.com' }, navigator: { userAgent: 'iPhone Mac OS X Safari', maxTouchPoints: 1, language: 'en', sendBeacon: () => false }, screen: { width: 390, height: 844 }, localStorage: { getItem: key => { if (storageBlocked) throw Error('blocked'); return memory[key] || null; }, setItem: (key, val) => { if (storageBlocked) throw Error('blocked'); memory[key] = val; } }, URL, Blob, Intl, console, performance: { now: () => clock }, setInterval: fn => { interval = fn; }, fetch: (url, options) => { sent.push(JSON.parse(options.body)); return Promise.resolve({ ok: true }); }, XMLHttpRequest: function () { lookup = this; this.open = () => {}; this.send = () => {}; }, addEventListener: (key, fn) => { listeners[key] = fn; } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(tracker, context);
  return { sent, listeners, document, lookup, runAgain: () => vm.runInContext(tracker, context), tick: ms => { clock = ms; interval(); } };
}
const c = client();
assert.equal(c.sent.length, 1, 'Initial view must not wait for geo');
assert.equal(c.sent[0].os, 'iOS');
c.tick(30000);
assert.equal(c.sent[1].timeOnPage, 30);
assert.equal(c.sent[0].eventId, c.sent[1].eventId);
c.document.visibilityState = 'hidden'; c.listeners.visibilitychange();
c.tick(90000);
assert.equal(c.sent.length, 3, 'Hidden page sent heartbeat');
c.document.visibilityState = 'visible'; c.listeners.visibilitychange();
assert.equal(c.sent.at(-1).timeOnPage, 30, 'Hidden time counted');
c.lookup.status = 200; c.lookup.responseText = JSON.stringify({ country_name: 'Nigeria', country_code: 'NG' }); c.lookup.onload();
assert.equal(c.sent.at(-1).eventId, c.sent[0].eventId);
assert.equal(c.sent.at(-1).country, 'Nigeria');
const before = c.sent.length; c.runAgain(); assert.equal(c.sent.length, before);
assert.equal(client(true).sent.length, 1, 'Storage blocking stopped tracking');
assert.equal(client(false, '/admin.html').sent.length, 0);
assert.equal(client(false, '/admin').sent.length, 0);
console.log('Dashboard and tracker tests passed: distinct counts, date boundaries, fallback delivery, visible time, geo and admin exclusion.');
