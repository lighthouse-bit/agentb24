(() => {
  'use strict';

  const API = 'https://api.mail.tm';
  const GUERRILLA_API = 'https://api.guerrillamail.com/ajax.php';
  const POLL = 10000;
  const STORE = 'agentb24_temp_mail_session';
  const NAME_STORE = 'agentb24_temp_mail_name_seed';
  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  let account = null;
  let token = '';
  let messages = [];
  let active = null;
  let pollTimer = null;
  let countTimer = null;
  let nextCheck = 0;
  let busy = false;
  let toastTimer;

  function storageGet(storage, key) {
    try { return storage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function storageSet(storage, key, value) {
    try { storage.setItem(key, value); } catch (_) {}
  }

  function storageRemove(storage, key) {
    try { storage.removeItem(key); } catch (_) {}
  }

  function toast(text) {
    const el = $('tm-toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function extract(data) {
    return data?.['hydra:member'] || data?.member || (Array.isArray(data) ? data : []);
  }

  function friendlyError(error) {
    if (!navigator.onLine) return 'You appear to be offline. Connect to the internet and try again.';
    if (error?.status === 429) return 'The temporary email provider is rate-limiting requests. Please wait a minute and try again.';
    if (error?.status === 422) return 'That address is already taken. Try again or change the name text.';
    if (error?.message === 'Failed to fetch' || error?.name === 'TypeError') {
      return 'Could not reach the temporary email providers. An ad blocker, privacy extension, or network filter may be blocking disposable email APIs.';
    }
    return error?.message || 'Temporary email is unavailable right now. Please try again.';
  }

  async function request(path, options = {}) {
    const headers = {
      Accept: 'application/ld+json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.auth !== false && token ? { Authorization: `Bearer ${token}` } : {})
    };

    let res;
    try {
      res = await fetch(API + path, {
        ...options,
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        headers: { ...headers, ...options.headers }
      });
    } catch (error) {
      throw new Error(friendlyError(error));
    }

    if (res.status === 204) return null;

    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body['hydra:description'] || body.detail || body.message || '';
      } catch (_) {}
      const error = new Error(detail || `Request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }

    return options.raw ? res.blob() : res.json();
  }

  async function requestJson(url) {
    let res;
    try {
      res = await fetch(url, {
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' }
      });
    } catch (error) {
      throw new Error(friendlyError(error));
    }

    if (!res.ok) {
      const error = new Error(`Fallback provider request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }

    return res.json();
  }

  function randomString(length, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') {
    if (window.crypto?.getRandomValues) {
      const values = new Uint32Array(length);
      crypto.getRandomValues(values);
      return [...values].map((n) => alphabet[n % alphabet.length]).join('');
    }

    let output = '';
    for (let i = 0; i < length; i++) output += alphabet[Math.floor(Math.random() * alphabet.length)];
    return output;
  }

  function cleanSeed(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
  }

  function nameSeed() {
    const input = $('name-seed');
    const raw = input?.value || storageGet(localStorage, NAME_STORE);
    const clean = cleanSeed(raw);
    return clean.length >= 2 ? clean : '';
  }

  function previewNameSeed() {
    const seed = nameSeed();
    const preview = $('name-preview');
    if (preview) {
      preview.textContent = seed
        ? `Next address will start like ${seed}${randomString(3)}@...`
        : 'Leave blank for a random short address.';
    }
    return seed;
  }

  function saveNameSeed() {
    const input = $('name-seed');
    if (!input) return '';
    const clean = cleanSeed(input.value);
    input.value = clean;
    if (clean) storageSet(localStorage, NAME_STORE, clean);
    else storageRemove(localStorage, NAME_STORE);
    previewNameSeed();
    return clean.length >= 2 ? clean : '';
  }

  function save() {
    if (account) storageSet(sessionStorage, STORE, JSON.stringify(account));
    else storageRemove(sessionStorage, STORE);
  }

  async function authenticate() {
    if (account?.provider === 'guerrilla') {
      token = '';
      return;
    }

    const data = await request('/token', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ address: account.address, password: account.password })
    });
    token = data.token;
    if (!token) throw new Error('The inbox could not be authenticated.');
  }

  function localPart(seed) {
    if (!seed) return `ab24${randomString(6)}`;
    const suffixLength = Math.max(3, Math.min(5, 12 - seed.length));
    return `${seed}${randomString(suffixLength)}`.slice(0, 12);
  }

  async function createMailTmInbox() {
    const response = await request('/domains', { auth: false });
    const domains = extract(response).filter((domain) => domain.isActive !== false && domain.domain);
    if (!domains.length) throw new Error('No temporary email domains are available right now.');

    const seed = previewNameSeed();
    let lastError;

    for (let attempt = 0; attempt < 20; attempt++) {
      const domain = domains[attempt % domains.length].domain;
      const address = `${localPart(seed)}@${domain}`;
      const password = `A!${randomString(22, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-')}9`;

      try {
        const created = await request('/accounts', {
          method: 'POST',
          auth: false,
          body: JSON.stringify({ address, password })
        });
        account = { id: created.id, address, password };
        save();
        await authenticate();
        return;
      } catch (error) {
        lastError = error;
        if (error.status !== 422) throw error;
      }
    }

    throw lastError || new Error('A new inbox could not be created.');
  }

  async function createGuerrillaInbox() {
    const seed = previewNameSeed();
    let data = await requestJson(`${GUERRILLA_API}?f=get_email_address&lang=en`);

    if (!data?.sid_token || !data?.email_addr) {
      throw new Error('The fallback temporary email provider could not create an address right now.');
    }

    if (seed) {
      const customUser = localPart(seed);
      try {
        const customized = await requestJson(`${GUERRILLA_API}?f=set_email_user&email_user=${encodeURIComponent(customUser)}&sid_token=${encodeURIComponent(data.sid_token)}&lang=en`);
        if (customized?.email_addr) data = { ...data, ...customized };
      } catch (error) {
        console.warn('[AgentB24 Temp Mail] Could not personalize fallback address.', error);
      }
    }

    account = {
      provider: 'guerrilla',
      id: data.sid_token,
      address: data.email_addr,
      sidToken: data.sid_token
    };
    token = '';
    save();
  }

  async function createInbox() {
    let mailTmError;

    try {
      await createMailTmInbox();
      return;
    } catch (error) {
      mailTmError = error;
      console.warn('[AgentB24 Temp Mail] Mail.tm unavailable, trying fallback provider.', error);
    }

    try {
      await createGuerrillaInbox();
      toast('Using fallback temporary email provider');
      return;
    } catch (fallbackError) {
      console.error('[AgentB24 Temp Mail] Fallback provider failed.', fallbackError);
      throw fallbackError || mailTmError;
    }
  }

  function setupState(title, message, error = false) {
    $('setup-view').hidden = false;
    $('address-view').hidden = true;
    $('setup-title').textContent = title;
    $('setup-message').textContent = message;
    $('retry-btn').hidden = !error;
    const spinner = document.querySelector('.tm-spinner');
    if (spinner) spinner.hidden = error;
  }

  function readyState() {
    $('setup-view').hidden = true;
    $('address-view').hidden = false;
    $('email-address').textContent = account.address;
    setConnection(true, 'Inbox connected');
  }

  function setConnection(ok, label) {
    const live = document.querySelector('.tm-live');
    if (live) live.classList.toggle('offline', !ok);
    $('connection-label').textContent = label;
  }

  async function restoreStoredAccount() {
    const stored = storageGet(sessionStorage, STORE);
    if (!stored) return false;

    try {
      account = JSON.parse(stored);
      const local = (account?.address || '').split('@')[0] || '';
      if (!/^[a-z0-9]{5,12}$/i.test(local)) throw new Error('Old inbox format');
      await authenticate();
      return true;
    } catch (_) {
      account = null;
      token = '';
      save();
      return false;
    }
  }

  async function init() {
    const input = $('name-seed');
    if (input && !input.dataset.bound) {
      input.dataset.bound = 'true';
      input.value = cleanSeed(storageGet(localStorage, NAME_STORE));
      input.addEventListener('input', previewNameSeed);
      input.addEventListener('change', saveNameSeed);
      previewNameSeed();
    }

    setupState('Preparing your inbox', 'Checking for an existing address...');

    try {
      const restored = await restoreStoredAccount();
      if (!restored) {
        setupState('Creating your private inbox', 'Requesting a short temporary address...');
        await createInbox();
      }
      readyState();
      startPolling();
    } catch (error) {
      setupState('Inbox unavailable', friendlyError(error), true);
      console.error('[AgentB24 Temp Mail]', error);
    }
  }

  async function replaceInbox() {
    if (busy) return;

    const seed = saveNameSeed();
    busy = true;
    stopPolling();
    $('new-address-btn').disabled = true;
    setupState('Creating a fresh inbox', 'Retiring the previous address...');

    const old = { ...account };
    const oldToken = token;

    try {
      if (old?.id && oldToken) {
        await request(`/accounts/${encodeURIComponent(old.id)}`, { method: 'DELETE' }).catch(() => {});
      }
      account = null;
      token = '';
      messages = [];
      active = null;
      save();
      renderList();
      await createInbox();
      readyState();
      startPolling();
      toast(seed ? 'Personalized temporary address created' : 'New temporary address created');
    } catch (error) {
      setupState('Could not create a new inbox', friendlyError(error), true);
      console.error('[AgentB24 Temp Mail]', error);
    } finally {
      busy = false;
      $('new-address-btn').disabled = false;
    }
  }

  function startPolling() {
    stopPolling();
    checkInbox();
    nextCheck = Date.now() + POLL;
    pollTimer = setInterval(() => {
      checkInbox();
      nextCheck = Date.now() + POLL;
    }, POLL);
    countTimer = setInterval(updateCountdown, 250);
    updateCountdown();
  }

  function stopPolling() {
    clearInterval(pollTimer);
    clearInterval(countTimer);
  }

  function updateCountdown() {
    const left = Math.max(0, nextCheck - Date.now());
    const pct = Math.min(100, (left / POLL) * 100);
    $('refresh-progress').style.width = `${pct}%`;
    $('refresh-label').textContent = busy ? 'Checking...' : `Next check in ${Math.ceil(left / 1000)}s`;
  }

  async function checkInbox(manual = false) {
    if (!account || busy) return;
    busy = true;
    $('refresh-btn').disabled = true;
    setConnection(true, 'Checking inbox');

    try {
      let stubs;

      if (account.provider === 'guerrilla') {
        const data = await requestJson(`${GUERRILLA_API}?f=check_email&seq=0&sid_token=${encodeURIComponent(account.sidToken)}`);
        const list = Array.isArray(data?.list) ? data.list : [];
        stubs = list.map((message) => ({
          id: String(message.mail_id),
          provider: 'guerrilla',
          from: message.mail_from || 'Unknown sender',
          subject: message.mail_subject || '(No subject)',
          intro: message.mail_excerpt || message.mail_subject || 'Open this message to read it.',
          createdAt: message.mail_date || ''
        }));
      } else {
        let data;
        try {
          data = await request('/messages?page=1');
        } catch (error) {
          if (error.status !== 401) throw error;
          await authenticate();
          data = await request('/messages?page=1');
        }
        stubs = extract(data).map((message) => ({ ...message, provider: 'mailtm' }));
      }

      const existing = new Map(messages.map((message) => [message.id, message]));
      messages = stubs.map((stub) => ({ ...existing.get(stub.id), ...stub }));
      renderList();
      setConnection(true, 'Inbox connected');
      $('last-checked').textContent = `Checked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      if (manual) toast(messages.length ? `${messages.length} message${messages.length === 1 ? '' : 's'} in the inbox` : 'Inbox is up to date');
    } catch (error) {
      setConnection(false, 'Connection problem');
      $('last-checked').textContent = friendlyError(error);
      if (manual) toast('Could not refresh the inbox');
      console.error('[AgentB24 Temp Mail]', error);
    } finally {
      busy = false;
      $('refresh-btn').disabled = false;
      nextCheck = Date.now() + POLL;
      updateCountdown();
    }
  }

  function sender(message) {
    const from = message.from || {};
    return typeof from === 'string'
      ? from
      : (from.name ? `${from.name} <${from.address || ''}>` : from.address || 'Unknown sender');
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function renderList() {
    const list = $('inbox-list');
    list.innerHTML = '';
    $('message-count').textContent = messages.length;

    if (!messages.length) {
      const empty = document.createElement('div');
      empty.id = 'empty-inbox';
      empty.className = 'tm-empty';
      empty.innerHTML = '<div class="tm-empty-icon"><i></i></div><h3>Your inbox is waiting</h3><p>Use the address above. New messages will appear automatically.</p>';
      list.append(empty);
      return;
    }

    messages.forEach((message) => {
      const item = document.createElement('article');
      item.className = `tm-message${message.seen ? '' : ' unread'}`;
      item.dataset.id = message.id;

      const avatar = document.createElement('div');
      avatar.className = 'tm-avatar';
      avatar.textContent = (sender(message).match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();

      const body = document.createElement('div');
      body.className = 'tm-msg-body';
      const top = document.createElement('div');
      top.className = 'tm-msg-top';
      const from = document.createElement('span');
      from.className = 'tm-msg-from';
      from.textContent = sender(message);
      top.append(from);

      if (!message.seen) {
        const dot = document.createElement('i');
        dot.className = 'tm-unread';
        top.append(dot);
      }

      const subject = document.createElement('strong');
      subject.className = 'tm-msg-subject';
      subject.textContent = message.subject || '(No subject)';
      const preview = document.createElement('span');
      preview.className = 'tm-msg-preview';
      preview.textContent = message.intro || 'Open this message to read it.';
      body.append(top, subject, preview);

      const time = document.createElement('time');
      time.className = 'tm-msg-time';
      time.textContent = formatTime(message.createdAt);
      item.append(avatar, body, time);
      item.onclick = () => openMessage(message.id);
      list.append(item);
    });
  }

  function htmlValue(value) {
    return Array.isArray(value) ? value.join('\n') : (typeof value === 'string' ? value : '');
  }

  function plainFromHtml(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  }

  function safeDocument(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,form,meta,base,link,video,audio,source').forEach((el) => el.remove());
    doc.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith('on') || name === 'srcset' || (name === 'src' && !/^(data:|cid:)/i.test(value)) || (name === 'href' && !/^(https?:|mailto:|tel:|#)/i.test(value))) {
          el.removeAttribute(attr.name);
        }
      });
      if (el.tagName === 'A' && el.hasAttribute('href')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'"><style>body{margin:0;padding:18px;color:#263249;font:14px/1.65 Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%!important}a{color:#5547cf;text-decoration:underline;cursor:pointer}</style></head><body>${doc.body.innerHTML}</body></html>`;
  }

  async function openMessage(id) {
    let stub = messages.find((message) => message.id === id);
    if (!stub) return;
    try {
      let full;

      if (account.provider === 'guerrilla') {
        const data = await requestJson(`${GUERRILLA_API}?f=fetch_email&email_id=${encodeURIComponent(id)}&sid_token=${encodeURIComponent(account.sidToken)}`);
        full = {
          provider: 'guerrilla',
          id: String(data.mail_id || id),
          from: data.mail_from || stub.from || 'Unknown sender',
          subject: data.mail_subject || stub.subject || '(No subject)',
          createdAt: data.mail_date || stub.createdAt || '',
          text: data.mail_body || '',
          html: data.mail_body || '',
          attachments: Array.isArray(data.mail_attachments) ? data.mail_attachments.map((file) => ({
            ...file,
            provider: 'guerrilla',
            filename: file.filename || file.name || 'attachment',
            size: file.size || 0
          })) : []
        };
      } else {
        full = await request(`/messages/${encodeURIComponent(id)}`);
        full.provider = 'mailtm';
      }

      stub = Object.assign(stub, full);
      active = stub;
      stub.seen = true;
      if (account.provider !== 'guerrilla') {
        request(`/messages/${encodeURIComponent(id)}`, { method: 'PATCH' }).catch(() => {});
      }
      renderList();
      renderViewer();
    } catch (_) {
      toast('Could not load this message');
    }
  }

  function renderViewer() {
    if (!active) return;
    const html = htmlValue(active.html);
    const text = htmlValue(active.text) || plainFromHtml(html) || active.intro || '';
    $('message-subject').textContent = active.subject || '(No subject)';
    $('message-from').textContent = sender(active);
    $('message-date').textContent = active.createdAt ? new Date(active.createdAt).toLocaleString() : '';
    $('message-frame').srcdoc = safeDocument(html || `<pre>${escapeHtml(text)}</pre>`);
    $('message-text').textContent = text || 'This message has no readable body.';
    renderAttachments();
    $('message-viewer').hidden = false;
    setMessageTab(html ? 'html' : 'text');
    $('message-viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAttachments() {
    const wrap = $('attachment-list');
    const items = Array.isArray(active?.attachments) ? active.attachments : [];
    wrap.innerHTML = '';
    wrap.hidden = !items.length;
    items.forEach((file) => {
      const button = document.createElement('button');
      button.textContent = `Attachment: ${file.filename || 'download'} (${formatBytes(file.size)})`;
      button.onclick = () => downloadAttachment(file);
      wrap.append(button);
    });
  }

  async function downloadAttachment(file) {
    if (!active) return;
    try {
      toast('Preparing attachment...');
      let url;

      if (account.provider === 'guerrilla') {
        const filename = file.filename || file.name || file.id;
        url = `${GUERRILLA_API}?f=get_email_attachment&sid_token=${encodeURIComponent(account.sidToken)}&email_id=${encodeURIComponent(active.id)}&file=${encodeURIComponent(filename)}`;
      } else {
        const blob = await request(`/messages/${encodeURIComponent(active.id)}/attachment/${encodeURIComponent(file.id)}`, { raw: true });
        url = URL.createObjectURL(blob);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      const a = document.createElement('a');
      a.href = url;
      a.download = (file.filename || 'attachment').replace(/[\\/:*?"<>|]/g, '-');
      a.click();
    } catch (_) {
      toast('The attachment could not be downloaded');
    }
  }

  function setMessageTab(view) {
    $$('.tm-message-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    $('message-frame').hidden = view !== 'html';
    $('message-text').hidden = view !== 'text';
  }

  async function deleteActive() {
    if (!active || busy) return;
    busy = true;
    $('delete-message').disabled = true;
    try {
      if (account.provider !== 'guerrilla') {
        await request(`/messages/${encodeURIComponent(active.id)}`, { method: 'DELETE' });
      }
      messages = messages.filter((message) => message.id !== active.id);
      active = null;
      $('message-viewer').hidden = true;
      renderList();
      toast(account.provider === 'guerrilla' ? 'Message removed from this view' : 'Message deleted');
    } catch (_) {
      toast('Could not delete this message');
    } finally {
      busy = false;
      $('delete-message').disabled = false;
    }
  }

  function escapeHtml(value) {
    const d = document.createElement('div');
    d.textContent = value || '';
    return d.innerHTML;
  }

  function formatBytes(n = 0) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB'];
    const i = Math.min(2, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  async function copy(value, success) {
    try {
      await navigator.clipboard.writeText(value);
      toast(success);
    } catch (_) {
      toast('Clipboard access is unavailable');
    }
  }

  $('retry-btn').onclick = () => init();
  $('copy-address').onclick = () => copy(account?.address || '', 'Address copied');
  $('refresh-btn').onclick = () => checkInbox(true);
  $('new-address-btn').onclick = replaceInbox;
  $('close-message').onclick = () => {
    $('message-viewer').hidden = true;
    active = null;
  };
  $('copy-message').onclick = () => copy($('message-text').textContent, 'Message text copied');
  $('delete-message').onclick = deleteActive;
  $$('.tm-message-tabs button').forEach((button) => {
    button.onclick = () => setMessageTab(button.dataset.view);
  });
  $$('.tm-faq details').forEach((details) => {
    details.ontoggle = () => {
      if (details.open) {
        $$('.tm-faq details').forEach((other) => {
          if (other !== details) other.open = false;
        });
      }
    };
  });
  window.addEventListener('beforeunload', stopPolling);
  init();
})();
