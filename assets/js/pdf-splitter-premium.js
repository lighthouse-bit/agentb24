(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MAX_PREVIEWS = 150;
  const state = { file: null, bytes: null, pdf: null, previewPdf: null, total: 0, selected: new Set(), mode: 'extract', busy: false, renderToken: 0 };

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

  function parseRange(value, total) {
    const source = String(value || '').trim();
    if (!source) return { valid: false, pages: [], message: 'Enter a page or range first.' };
    const pages = [];
    const seen = new Set();
    for (const rawPart of source.split(',')) {
      const part = rawPart.trim();
      const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) return { valid: false, pages: [], message: `“${part || rawPart}” is not a valid page range.` };
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      if (start < 1 || end > total) return { valid: false, pages: [], message: `Choose pages between 1 and ${total}.` };
      if (start > end) return { valid: false, pages: [], message: `Range ${part} is backwards.` };
      for (let page = start; page <= end; page += 1) if (!seen.has(page)) { seen.add(page); pages.push(page); }
    }
    pages.sort((a, b) => a - b);
    return { valid: Boolean(pages.length), pages, message: pages.length ? '' : 'Select at least one page.' };
  }

  function cleanBaseName() {
    const raw = $('output-name').value.trim().replace(/\.(pdf|zip)$/i, '');
    return raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim() || (state.mode === 'extract' ? 'extracted-pages' : 'split-pages');
  }

  function selectedPages() { return Array.from(state.selected).sort((a, b) => a - b); }
  function fileCount() {
    const count = state.selected.size;
    if (state.mode === 'extract') return count ? 1 : 0;
    if (state.mode === 'individual') return count;
    return count ? Math.ceil(count / validChunkSize()) : 0;
  }
  function validChunkSize() { return Math.max(1, Math.min(999, Number($('chunk-size').value) || 1)); }

  function showStatus(message, type) {
    const node = $('status-msg');
    node.textContent = message;
    node.className = `splitter-status visible ${type || 'info'}`;
  }
  function clearStatus() { $('status-msg').className = 'splitter-status'; $('status-msg').textContent = ''; }
  function setProgress(percent, label) {
    const safe = Math.max(0, Math.min(100, Math.round(percent)));
    $('progress-shell').hidden = false;
    $('progress-bar').style.width = `${safe}%`;
    $('progress-percent').textContent = `${safe}%`;
    $('progress-label').textContent = label;
  }

  async function loadFile(file) {
    if (state.busy) return;
    if (!file || !(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { showStatus('Please choose a PDF file.', 'error'); return; }
    clearStatus();
    showStatus(`Reading ${file.name}…`, 'info');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      const total = pdf.getPageCount();
      if (!total) throw new Error('This PDF contains no pages.');
      if (state.previewPdf) { try { await state.previewPdf.destroy(); } catch (_) {} }
      const previewPdf = window.pdfjsLib ? await pdfjsLib.getDocument({ data: bytes.slice() }).promise : null;
      Object.assign(state, { file, bytes, pdf, previewPdf, total, selected: new Set(Array.from({ length: total }, (_, i) => i + 1)), renderToken: state.renderToken + 1 });
      $('file-name').textContent = file.name;
      $('file-meta').textContent = `${total} page${total === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
      $('drop-zone').hidden = true;
      $('document-workspace').hidden = false;
      $('new-file-btn').hidden = false;
      $('page-range').value = `1-${total}`;
      $('range-message').textContent = 'All pages are selected. Click a preview to exclude it.';
      $('range-message').className = 'range-message';
      clearStatus();
      renderPageGrid();
      updateUI();
    } catch (error) {
      console.error(error);
      showStatus('This PDF could not be opened. It may be damaged or password-protected.', 'error');
    } finally { $('pdf-input').value = ''; }
  }

  function resetFile() {
    state.renderToken += 1;
    if (state.previewPdf) { try { state.previewPdf.destroy(); } catch (_) {} }
    Object.assign(state, { file: null, bytes: null, pdf: null, previewPdf: null, total: 0, selected: new Set() });
    $('drop-zone').hidden = false;
    $('document-workspace').hidden = true;
    $('new-file-btn').hidden = true;
    $('page-grid').innerHTML = '';
    $('progress-shell').hidden = true;
    clearStatus();
    updateUI();
  }

  function renderPageGrid() {
    const limit = Math.min(state.total, MAX_PREVIEWS);
    $('page-grid').innerHTML = Array.from({ length: limit }, (_, index) => {
      const page = index + 1;
      return `<button type="button" class="page-card${state.selected.has(page) ? ' selected' : ''}" data-page="${page}" aria-pressed="${state.selected.has(page)}"><i class="page-check">✓</i><div class="page-preview"><span class="page-placeholder">PDF</span><canvas id="page-canvas-${page}" aria-label="Preview of page ${page}"></canvas></div><span>Page ${page}</span></button>`;
    }).join('');
    $('preview-limit').hidden = state.total <= MAX_PREVIEWS;
    if (state.total > MAX_PREVIEWS) $('preview-limit').textContent = `Showing previews for the first ${MAX_PREVIEWS} of ${state.total} pages. Use the range field to select pages beyond the preview.`;
    renderThumbnails(state.renderToken, limit);
  }

  async function renderThumbnails(token, limit) {
    if (!state.previewPdf) return;
    const queue = Array.from({ length: limit }, (_, i) => i + 1);
    async function worker() {
      while (queue.length && token === state.renderToken) {
        const pageNumber = queue.shift();
        try {
          const page = await state.previewPdf.getPage(pageNumber);
          if (token !== state.renderToken) return;
          const canvas = $(`page-canvas-${pageNumber}`);
          if (!canvas) continue;
          const viewport = page.getViewport({ scale: 0.3 });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          canvas.previousElementSibling?.remove();
        } catch (_) { /* A numbered placeholder remains if a preview fails. */ }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
  }

  function syncCards() {
    document.querySelectorAll('.page-card').forEach((card) => {
      const selected = state.selected.has(Number(card.dataset.page));
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
  }

  function updateUI() {
    const count = state.selected.size;
    $('selected-count').textContent = count;
    $('panel-total').textContent = state.total;
    $('panel-selected').textContent = count;
    $('panel-files').textContent = fileCount();
    $('split-btn').disabled = state.busy || !state.file || !count;
    const labels = { extract: 'Extract selected pages', individual: 'Create page ZIP', chunks: 'Create PDF parts' };
    $('split-btn').querySelector('span').textContent = state.busy ? 'Processing…' : labels[state.mode];
    $('chunk-setting').hidden = state.mode !== 'chunks';
    $('output-extension').textContent = state.mode === 'extract' ? '.pdf' : '.zip';
    document.querySelectorAll('.mode-card').forEach((card) => {
      const active = card.dataset.mode === state.mode;
      card.classList.toggle('active', active);
      card.setAttribute('aria-checked', String(active));
    });
    document.querySelectorAll('.selection-btn').forEach((button) => button.classList.remove('active'));
    if (count === state.total && state.total) document.querySelector('[data-select="all"]')?.classList.add('active');
    if (!count) document.querySelector('[data-select="none"]')?.classList.add('active');
  }

  function applyPreset(type) {
    if (!state.file) return;
    if (type === 'all') state.selected = new Set(Array.from({ length: state.total }, (_, i) => i + 1));
    if (type === 'none') state.selected = new Set();
    if (type === 'odd') state.selected = new Set(Array.from({ length: state.total }, (_, i) => i + 1).filter((page) => page % 2));
    if (type === 'even') state.selected = new Set(Array.from({ length: state.total }, (_, i) => i + 1).filter((page) => page % 2 === 0));
    $('range-message').textContent = `${state.selected.size} page${state.selected.size === 1 ? '' : 's'} selected.`;
    $('range-message').className = 'range-message success';
    syncCards(); updateUI();
  }

  function applyRange() {
    const result = parseRange($('page-range').value, state.total);
    if (!result.valid) { $('range-message').textContent = result.message; $('range-message').className = 'range-message error'; return; }
    state.selected = new Set(result.pages);
    $('range-message').textContent = `${result.pages.length} page${result.pages.length === 1 ? '' : 's'} selected from your range.`;
    $('range-message').className = 'range-message success';
    syncCards(); updateUI();
  }

  function copyMetadata(target) {
    const pairs = [['getTitle', 'setTitle'], ['getAuthor', 'setAuthor'], ['getSubject', 'setSubject'], ['getKeywords', 'setKeywords']];
    pairs.forEach(([getter, setter]) => { try { const value = state.pdf[getter](); if (value) target[setter](value); } catch (_) {} });
    target.setProducer('AgentB24 PDF Splitter');
    target.setModificationDate(new Date());
  }

  async function makePdf(pageNumbers, metadata) {
    const output = await PDFLib.PDFDocument.create();
    if (metadata) copyMetadata(output);
    const pages = await output.copyPages(state.pdf, pageNumbers.map((page) => page - 1));
    pages.forEach((page) => output.addPage(page));
    return output.save({ useObjectStreams: true });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function runSplit() {
    if ($('split-btn').disabled || state.busy) return;
    const pages = selectedPages();
    const base = cleanBaseName();
    state.busy = true; clearStatus(); updateUI();
    try {
      if (state.mode === 'extract') {
        setProgress(15, 'Copying selected pages…');
        const bytes = await makePdf(pages, true);
        setProgress(92, 'Preparing download…');
        download(new Blob([bytes], { type: 'application/pdf' }), `${base}.pdf`);
        setProgress(100, 'Extraction complete');
        showStatus(`${pages.length} page${pages.length === 1 ? '' : 's'} extracted successfully.`, 'success');
      } else {
        if (!window.JSZip) throw new Error('The ZIP library did not load. Check your connection and try again.');
        const zip = new JSZip();
        if (state.mode === 'individual') {
          for (let index = 0; index < pages.length; index += 1) {
            setProgress(5 + ((index + 1) / pages.length) * 72, `Creating page ${pages[index]}…`);
            const bytes = await makePdf([pages[index]], false);
            zip.file(`${base}-page-${String(pages[index]).padStart(2, '0')}.pdf`, bytes);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } else {
          const size = validChunkSize();
          const groups = [];
          for (let index = 0; index < pages.length; index += size) groups.push(pages.slice(index, index + size));
          for (let index = 0; index < groups.length; index += 1) {
            setProgress(5 + ((index + 1) / groups.length) * 72, `Creating part ${index + 1} of ${groups.length}…`);
            const bytes = await makePdf(groups[index], index === 0);
            zip.file(`${base}-part-${String(index + 1).padStart(2, '0')}.pdf`, bytes);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        setProgress(82, 'Packaging ZIP file…');
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } }, (meta) => setProgress(82 + meta.percent * 0.17, 'Packaging ZIP file…'));
        download(blob, `${base}.zip`);
        setProgress(100, 'Download ready');
        showStatus(`${fileCount()} PDF file${fileCount() === 1 ? '' : 's'} created and packaged successfully.`, 'success');
      }
    } catch (error) {
      console.error(error);
      $('progress-shell').hidden = true;
      showStatus(`The PDF could not be split: ${error.message || 'unknown error'}`, 'error');
    } finally { state.busy = false; updateUI(); }
  }

  const dropZone = $('drop-zone');
  dropZone.addEventListener('click', () => { if (!state.busy) $('pdf-input').click(); });
  dropZone.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && !state.busy) { event.preventDefault(); $('pdf-input').click(); } });
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));
  $('pdf-input').addEventListener('change', (event) => loadFile(event.target.files[0]));
  $('new-file-btn').addEventListener('click', resetFile);
  $('page-grid').addEventListener('click', (event) => {
    const card = event.target.closest('.page-card');
    if (!card || state.busy) return;
    const page = Number(card.dataset.page);
    if (state.selected.has(page)) state.selected.delete(page); else state.selected.add(page);
    $('range-message').textContent = `${state.selected.size} page${state.selected.size === 1 ? '' : 's'} selected.`;
    $('range-message').className = 'range-message';
    syncCards(); updateUI();
  });
  document.querySelectorAll('.selection-btn').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.select)));
  $('apply-range-btn').addEventListener('click', applyRange);
  $('page-range').addEventListener('keydown', (event) => { if (event.key === 'Enter') applyRange(); });
  document.querySelectorAll('.mode-card').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.mode; clearStatus(); $('progress-shell').hidden = true; if (state.mode === 'extract' && $('output-name').value === 'split-pages') $('output-name').value = 'extracted-pages'; if (state.mode !== 'extract' && $('output-name').value === 'extracted-pages') $('output-name').value = 'split-pages'; updateUI(); }));
  $('chunk-size').addEventListener('input', () => { $('chunk-size').value = validChunkSize(); updateUI(); });
  $('chunk-minus').addEventListener('click', () => { $('chunk-size').value = Math.max(1, validChunkSize() - 1); updateUI(); });
  $('chunk-plus').addEventListener('click', () => { $('chunk-size').value = Math.min(999, validChunkSize() + 1); updateUI(); });
  $('split-btn').addEventListener('click', runSplit);
  document.querySelectorAll('.faq-section details').forEach((detail) => detail.addEventListener('toggle', () => { if (detail.open) document.querySelectorAll('.faq-section details').forEach((other) => { if (other !== detail) other.open = false; }); }));
  updateUI();
}());
