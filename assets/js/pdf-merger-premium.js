(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const input = $('pdf-input');
  const dropZone = $('drop-zone');
  const fileList = $('file-list');
  const mergeButton = $('merge-btn');
  const status = $('status-msg');
  const progressShell = $('progress-shell');
  const progressBar = $('progress-bar');
  const progressLabel = $('progress-label');
  const progressPercent = $('progress-percent');
  let documents = [];
  let nextId = 1;
  let draggedId = null;
  let busy = false;

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function parseRange(value, totalPages) {
    const source = String(value || '').trim().toLowerCase();
    if (!source || source === 'all') return { valid: true, pages: Array.from({ length: totalPages }, (_, i) => i) };
    const selected = [];
    const seen = new Set();
    const parts = source.split(',').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return { valid: false, pages: [], message: 'Enter all or a page range.' };
    for (const part of parts) {
      const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) return { valid: false, pages: [], message: `“${part}” is not a valid range.` };
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      if (start < 1 || end < 1 || start > totalPages || end > totalPages) return { valid: false, pages: [], message: `Use pages 1–${totalPages}.` };
      if (start > end) return { valid: false, pages: [], message: `Range ${part} is backwards.` };
      for (let page = start; page <= end; page += 1) {
        const index = page - 1;
        if (!seen.has(index)) { seen.add(index); selected.push(index); }
      }
    }
    return { valid: Boolean(selected.length), pages: selected, message: selected.length ? '' : 'Select at least one page.' };
  }

  async function makePreview(bytes) {
    if (!window.pdfjsLib) return '';
    try {
      const task = pdfjsLib.getDocument({ data: bytes.slice() });
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.28 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const url = canvas.toDataURL('image/jpeg', 0.78);
      await pdf.destroy();
      return url;
    } catch (_) {
      return '';
    }
  }

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `merger-status visible ${type || 'info'}`;
  }

  function clearStatus() {
    status.textContent = '';
    status.className = 'merger-status';
  }

  function setProgress(percent, label) {
    const safe = Math.max(0, Math.min(100, Math.round(percent)));
    progressShell.hidden = false;
    progressBar.style.width = `${safe}%`;
    progressPercent.textContent = `${safe}%`;
    progressLabel.textContent = label;
  }

  async function addFiles(fileCollection) {
    if (busy) return;
    const incoming = Array.from(fileCollection || []);
    const pdfFiles = incoming.filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
    if (!pdfFiles.length) { showStatus('Please choose PDF files.', 'error'); return; }
    clearStatus();
    let rejected = 0;
    let duplicates = 0;
    for (const file of pdfFiles) {
      const duplicate = documents.some((doc) => doc.file.name === file.name && doc.file.size === file.size && doc.file.lastModified === file.lastModified);
      if (duplicate) { duplicates += 1; continue; }
      showStatus(`Reading ${file.name}…`, 'info');
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pdf = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
        const pageCount = pdf.getPageCount();
        if (!pageCount) throw new Error('This PDF has no pages.');
        const doc = { id: nextId++, file, bytes, pdf, pageCount, range: 'all', rangeResult: parseRange('all', pageCount), preview: '' };
        documents.push(doc);
        render();
        doc.preview = await makePreview(bytes);
        render();
      } catch (error) {
        rejected += 1;
        console.warn('Could not add PDF:', file.name, error);
      }
    }
    input.value = '';
    if (rejected) showStatus(`${rejected} PDF${rejected === 1 ? '' : 's'} could not be opened. Password-protected or damaged files must be fixed first.`, 'error');
    else if (duplicates) showStatus(`${duplicates} duplicate PDF${duplicates === 1 ? ' was' : 's were'} skipped.`, 'info');
    else clearStatus();
    render();
  }

  function selectedPageCount() {
    return documents.reduce((total, doc) => total + (doc.rangeResult.valid ? doc.rangeResult.pages.length : 0), 0);
  }

  function totalSize() {
    return documents.reduce((total, doc) => total + doc.file.size, 0);
  }

  function hasInvalidRange() {
    return documents.some((doc) => !doc.rangeResult.valid);
  }

  function render() {
    fileList.innerHTML = documents.map((doc, index) => {
      const range = doc.rangeResult;
      const preview = doc.preview ? `<img src="${doc.preview}" alt="Preview of ${escapeHtml(doc.file.name)}" />` : '<span class="pdf-fallback">PDF</span>';
      return `<article class="pdf-card" draggable="true" data-id="${doc.id}">
        <button type="button" class="drag-handle" title="Drag to reorder" aria-label="Drag ${escapeHtml(doc.file.name)} to reorder">⠿</button>
        <div class="pdf-thumb">${preview}<small>${doc.pageCount}p</small></div>
        <div class="pdf-info"><strong class="pdf-name" title="${escapeHtml(doc.file.name)}">${escapeHtml(doc.file.name)}</strong><div class="pdf-meta"><span>${formatBytes(doc.file.size)}</span><span>${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}</span><span>Position ${index + 1}</span></div><div class="range-row"><label for="range-${doc.id}">Pages</label><input class="range-input${range.valid ? '' : ' invalid'}" id="range-${doc.id}" data-range-id="${doc.id}" value="${escapeHtml(doc.range)}" placeholder="all or 1-3, 5" aria-invalid="${!range.valid}" /><span class="range-feedback${range.valid ? '' : ' error'}">${range.valid ? `${range.pages.length} selected` : escapeHtml(range.message)}</span></div></div>
        <div class="card-controls"><button type="button" class="file-control" data-action="up" data-id="${doc.id}" title="Move up" aria-label="Move ${escapeHtml(doc.file.name)} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="file-control" data-action="down" data-id="${doc.id}" title="Move down" aria-label="Move ${escapeHtml(doc.file.name)} down" ${index === documents.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="file-control remove" data-action="remove" data-id="${doc.id}" title="Remove file">Remove</button></div>
      </article>`;
    }).join('');
    const pages = selectedPageCount();
    const bytes = totalSize();
    const fileLabel = `${documents.length} file${documents.length === 1 ? '' : 's'}`;
    $('file-count').textContent = fileLabel;
    $('page-count').textContent = `${pages} page${pages === 1 ? '' : 's'} selected`;
    $('size-count').textContent = `${formatBytes(bytes)} total`;
    $('panel-files').textContent = documents.length;
    $('panel-pages').textContent = pages;
    $('panel-size').textContent = formatBytes(bytes);
    $('file-toolbar').hidden = !documents.length;
    $('workspace-actions').hidden = !documents.length;
    $('empty-hint').hidden = Boolean(documents.length);
    dropZone.classList.toggle('compact', Boolean(documents.length));
    dropZone.querySelector('h3').textContent = documents.length ? 'Drop more PDFs here' : 'Drop your PDF files here';
    mergeButton.disabled = busy || documents.length < 2 || hasInvalidRange() || !pages;
  }

  function moveDocument(id, direction) {
    const index = documents.findIndex((doc) => doc.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= documents.length) return;
    [documents[index], documents[target]] = [documents[target], documents[index]];
    clearStatus();
    render();
  }

  function sanitizedFilename() {
    const raw = $('output-name').value.trim().replace(/\.pdf$/i, '');
    const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
    return `${cleaned || 'merged-document'}.pdf`;
  }

  function copyFirstMetadata(target, source) {
    const setters = [['getTitle', 'setTitle'], ['getAuthor', 'setAuthor'], ['getSubject', 'setSubject'], ['getCreator', 'setCreator'], ['getKeywords', 'setKeywords']];
    setters.forEach(([getter, setter]) => {
      try { const value = source[getter](); if (value && target[setter]) target[setter](value); } catch (_) { /* Metadata is optional. */ }
    });
  }

  async function mergeDocuments() {
    if (mergeButton.disabled || busy) return;
    busy = true;
    clearStatus();
    render();
    mergeButton.querySelector('span').textContent = 'Merging…';
    try {
      setProgress(4, 'Creating your document…');
      const merged = await PDFLib.PDFDocument.create();
      if ($('keep-metadata').checked && documents[0]) copyFirstMetadata(merged, documents[0].pdf);
      for (let index = 0; index < documents.length; index += 1) {
        const doc = documents[index];
        setProgress(8 + (index / documents.length) * 76, `Adding ${doc.file.name}…`);
        const copiedPages = await merged.copyPages(doc.pdf, doc.rangeResult.pages);
        copiedPages.forEach((page) => merged.addPage(page));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      merged.setProducer('AgentB24 PDF Merger');
      merged.setModificationDate(new Date());
      setProgress(88, 'Optimizing the final PDF…');
      const bytes = await merged.save({ useObjectStreams: true });
      setProgress(97, 'Starting download…');
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = sanitizedFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setProgress(100, 'Merge complete');
      showStatus(`Success — ${selectedPageCount()} pages merged into ${sanitizedFilename()}.`, 'success');
    } catch (error) {
      console.error(error);
      showStatus(`The PDFs could not be merged: ${error.message || 'unknown error'}`, 'error');
      progressShell.hidden = true;
    } finally {
      busy = false;
      mergeButton.querySelector('span').textContent = 'Merge PDFs';
      render();
    }
  }

  dropZone.addEventListener('click', () => { if (!busy) input.click(); });
  dropZone.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && !busy) { event.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); if (!busy) dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
  input.addEventListener('change', () => addFiles(input.files));
  $('add-more-btn').addEventListener('click', () => input.click());
  $('clear-btn').addEventListener('click', () => { if (!documents.length || confirm('Remove all PDFs from this merge?')) { documents = []; clearStatus(); progressShell.hidden = true; render(); } });
  $('sort-btn').addEventListener('click', () => { documents.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true })); clearStatus(); render(); });
  $('reverse-btn').addEventListener('click', () => { documents.reverse(); clearStatus(); render(); });
  mergeButton.addEventListener('click', mergeDocuments);

  fileList.addEventListener('input', (event) => {
    const id = Number(event.target.dataset.rangeId);
    if (!id) return;
    const doc = documents.find((item) => item.id === id);
    if (!doc) return;
    doc.range = event.target.value;
    doc.rangeResult = parseRange(doc.range, doc.pageCount);
    render();
    const restored = $(`range-${id}`);
    if (restored) { restored.focus(); restored.setSelectionRange(doc.range.length, doc.range.length); }
  });

  fileList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || busy) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === 'remove') { documents = documents.filter((doc) => doc.id !== id); clearStatus(); render(); }
    if (button.dataset.action === 'up') moveDocument(id, -1);
    if (button.dataset.action === 'down') moveDocument(id, 1);
  });

  fileList.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.pdf-card');
    if (!card || busy) return;
    draggedId = Number(card.dataset.id);
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  fileList.addEventListener('dragover', (event) => {
    const card = event.target.closest('.pdf-card');
    if (!card || Number(card.dataset.id) === draggedId) return;
    event.preventDefault();
    fileList.querySelectorAll('.drag-over').forEach((item) => item.classList.remove('drag-over'));
    card.classList.add('drag-over');
  });
  fileList.addEventListener('drop', (event) => {
    const card = event.target.closest('.pdf-card');
    if (!card || draggedId === null) return;
    event.preventDefault();
    const from = documents.findIndex((doc) => doc.id === draggedId);
    const to = documents.findIndex((doc) => doc.id === Number(card.dataset.id));
    if (from >= 0 && to >= 0 && from !== to) {
      const [moved] = documents.splice(from, 1);
      documents.splice(to, 0, moved);
    }
    draggedId = null;
    render();
  });
  fileList.addEventListener('dragend', () => { draggedId = null; render(); });

  document.querySelectorAll('.faq-section details').forEach((detail) => detail.addEventListener('toggle', () => {
    if (!detail.open) return;
    document.querySelectorAll('.faq-section details').forEach((other) => { if (other !== detail) other.open = false; });
  }));

  render();
}());
