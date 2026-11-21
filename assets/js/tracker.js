(function () {
  'use strict';
  if (window.__agentb24Tracking || /\/admin(?:\.html)?\/?$/i.test(location.pathname) || /bot|crawl|spider|slurp|mediapartners/i.test(navigator.userAgent)) return;
  window.__agentb24Tracking = true;
  var endpoint = document.currentScript ? new URL('../../tracker.php', document.currentScript.src).href : '/tracker.php';
  var memory = {};
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return memory[key] || null; } }
  function write(key, value) { memory[key] = value; try { localStorage.setItem(key, value); } catch (e) {} }
  function id() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function parse(value) { try { return JSON.parse(value); } catch (e) { return null; } }
  var visitorId = read('pixlit_vid');
  var isNew = !read('pixlit_returning');
  if (!visitorId) { visitorId = 'v_' + id(); write('pixlit_vid', visitorId); }
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var tablet = /tablet|ipad|playbook|silk/i.test(ua) || (ios && !/iPhone|iPod/.test(ua));
  function source() {
    if (!document.referrer) return 'Direct';
    try {
      var host = new URL(document.referrer).hostname.replace(/^www\./, '');
      if (host === location.hostname.replace(/^www\./, '')) return 'Direct';
      var known = { 'google.com': 'Google', 'bing.com': 'Bing', 'facebook.com': 'Facebook', 't.co': 'Twitter/X', 'x.com': 'Twitter/X', 'twitter.com': 'Twitter/X', 'linkedin.com': 'LinkedIn', 'reddit.com': 'Reddit', 'youtube.com': 'YouTube', 'instagram.com': 'Instagram', 'tiktok.com': 'TikTok' };
      for (var domain in known) if (host === domain || host.endsWith('.' + domain)) return known[domain];
      return host;
    } catch (e) { return 'Direct'; }
  }
  var session = parse(read('agentb24_session'));
  var now = Date.now();
  var newSession = !session || !session.id || now - session.last > 1800000;
  if (newSession) session = { id: id(), last: now, source: source() };
  session.last = now;
  write('agentb24_session', JSON.stringify(session));
  var path = location.pathname === '/index.html' ? '/' : location.pathname;
  var page = path === '/' ? 'Homepage' : path.split('/').pop().replace(/\.html$/, '').replace(/-/g, ' ');
  page = page.charAt(0).toUpperCase() + page.slice(1);
  var base = {
    version: 2, eventId: id(), visitorId: visitorId, sessionId: session.id,
    page: page, path: path, referrer: session.source || 'Direct', isNew: isNew, isSession: newSession,
    device: tablet ? 'Tablet' : /mobile|android|iphone|ipod/i.test(ua) ? 'Mobile' : 'Desktop',
    browser: /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Other',
    os: ios ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other',
    screenW: screen.width, screenH: screen.height, language: navigator.language || 'Unknown',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown'
  };
  var geo = {};
  var elapsed = 0;
  var visibleStart = document.visibilityState === 'hidden' ? null : performance.now();
  function seconds() { return Math.floor((elapsed + (visibleStart === null ? 0 : performance.now() - visibleStart)) / 1000); }
  function send(beacon) {
    var body = JSON.stringify(Object.assign({}, base, geo, { timeOnPage: seconds() }));
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) return; } catch (e) {}
    }
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true })
      .then(function (response) {
        if (!response.ok) throw new Error('Tracking HTTP ' + response.status);
        write('pixlit_returning', '1');
      }).catch(function (error) { console.warn('AgentB24 analytics:', error.message); });
  }
  // Retries, geolocation and heartbeats share a page-view ID and cannot add views.
  send(false);
  setInterval(function () {
    if (document.visibilityState === 'hidden') return;
    var current = parse(read('agentb24_session'));
    if (current && current.id === session.id) { current.last = Date.now(); write('agentb24_session', JSON.stringify(current)); }
    send(false);
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (visibleStart !== null) elapsed += performance.now() - visibleStart;
      visibleStart = null;
      send(true);
    } else { visibleStart = performance.now(); send(false); }
  });
  window.addEventListener('pagehide', function () { send(true); });
  // Optional enrichment never delays tracking. Unavailable location stays Unknown.
  var cached = parse(read('agentb24_geo'));
  function applyGeo(value) {
    if (!value || value.error || !value.country_name) return;
    geo = { country: value.country_name, countryCode: value.country_code, region: value.region, city: value.city };
    send(false);
  }
  if (cached && Date.now() - cached.at < 3600000) applyGeo(cached.value);
  else {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://ipapi.co/json/', true);
    xhr.timeout = 3000;
    xhr.onload = function () {
      if (xhr.status !== 200) return;
      var value = parse(xhr.responseText);
      if (value && !value.error && value.country_name) {
        write('agentb24_geo', JSON.stringify({ at: Date.now(), value: value }));
        applyGeo(value);
      }
    };
    xhr.send();
  }
})();
