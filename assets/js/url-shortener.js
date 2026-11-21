(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const key = 'agentb24_short_links';
  let history = [];
  let current = null;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(saved)) history = saved.filter(validRecord).slice(0, 10);
  } catch (_) {}
  function validRecord(record) {
    if (!record || typeof record.shortUrl !== 'string' || typeof record.destination !== 'string') return false;
    try {
      const url = new URL(record.shortUrl);
      return ['http:', 'https:'].includes(url.protocol) && (url.hostname === 'agentb24.com' || url.origin === location.origin);
    } catch (_) { return false; }
  }
  function status(message, kind = '') { $('short-status').textContent = message; $('short-status').dataset.kind = kind; }
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      status('Short link copied.', 'success');
    } catch (_) {
      $('short-output').value = value;
      $('result-empty').hidden = true;
      $('result-content').hidden = false;
      $('short-output').focus(); $('short-output').select();
      status('Copy is unavailable in this browser. Select the link above and copy it manually.');
    }
  }
  function renderResult(record) {
    current = record;
    $('result-empty').hidden = true;
    $('result-content').hidden = false;
    $('short-output').value = record.shortUrl;
    $('open-link').href = record.shortUrl;
    $('result-destination').textContent = 'Destination: ' + record.destination;
    $('result-expiry').textContent = record.expiresAt ? 'Expires: ' + new Date(record.expiresAt).toLocaleString() : 'No scheduled expiry. Availability depends on the service remaining online.';
    $('short-qr').replaceChildren();
    $('download-qr').disabled = true;
    $('qr-status').textContent = '';
    if (typeof QRCode === 'undefined') {
      $('qr-status').textContent = 'The QR library could not load. Your short link still works.';
      return;
    }
    try {
      new QRCode($('short-qr'), { text: record.shortUrl, width: 128, height: 128, colorDark: '#18243b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      $('download-qr').disabled = !$('short-qr').querySelector('canvas');
    } catch (_) { $('qr-status').textContent = 'QR generation is unavailable. You can still copy your link.'; }
  }
  function renderHistory() {
    const list = $('short-history-list'); list.replaceChildren();
    $('clear-history').disabled = history.length === 0;
    if (!history.length) {
      const empty = document.createElement('p'); empty.className = 'short-help'; empty.textContent = 'No links created in this browser yet.'; list.append(empty); return;
    }
    history.forEach(record => {
      const row = document.createElement('div'); row.className = 'short-history-item';
      const details = document.createElement('div');
      const link = document.createElement('a'); link.href = record.shortUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = record.shortUrl;
      const url = document.createElement('p'); url.textContent = record.destination; url.title = record.destination;
      if (record.expiresAt && new Date(record.expiresAt) <= new Date()) url.textContent = 'Expired — ' + record.destination;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'short-secondary'; button.textContent = 'View'; button.addEventListener('click', () => { renderResult(record); $('result-heading').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      details.append(link, url); row.append(details, button); list.append(row);
    });
  }
  $('short-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('create-link').disabled) return;
    const input = $('destination').value.trim();
    let destination;
    try {
      destination = new URL(input);
      if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password) throw Error();
    } catch (_) { status('Enter a complete http:// or https:// URL without embedded passwords.', 'error'); return; }
    $('create-link').disabled = true;
    $('create-link').textContent = 'Creating your link…'; status('Saving your short link…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('../short-link.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: destination.href, alias: $('alias').value.trim(), days: Number($('expiry').value) }), signal: controller.signal });
      let record;
      try { record = await response.json(); } catch (_) { throw Error('The server returned an invalid response. Please try again later.'); }
      if (!response.ok) throw Error(record.error || 'The short link could not be created.');
      if (!validRecord(record)) throw Error('The server did not return a valid short link.');
      renderResult(record);
      history = [record, ...history.filter(item => item.shortUrl !== record.shortUrl)].slice(0, 10);
      let saved = true;
      try { localStorage.setItem(key, JSON.stringify(history)); } catch (_) { saved = false; }
      renderHistory();
      status(saved ? 'Your short link is ready to share.' : 'Your link is ready. Browser history could not be saved; copy your link now.', 'success');
    } catch (error) {
      status(error.name === 'AbortError' ? 'The request timed out. It may have been saved, so a custom ending might already be reserved. Check the connection before trying again.' : error.message, 'error');
    } finally { clearTimeout(timer); $('create-link').disabled = false; $('create-link').textContent = 'Shorten my link ↗'; }
  });
  $('copy-link').addEventListener('click', () => { if (current) copy(current.shortUrl); });
  $('download-qr').addEventListener('click', () => {
    const source = $('short-qr').querySelector('canvas'); if (!source || !current) return;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 320, 320); ctx.imageSmoothingEnabled = false; ctx.drawImage(source, 32, 32, 256, 256);
    const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = 'agentb24-short-link-qr.png'; link.click();
  });
  $('clear-history').addEventListener('click', () => { history = []; try { localStorage.removeItem(key); } catch (_) {} renderHistory(); });
  renderHistory();
})();
