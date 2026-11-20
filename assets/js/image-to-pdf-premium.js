(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { images: [], nextId: 1, draggedId: null, busy: false };
  const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const paperSizes = { a4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6], a3: [297, 420], square: [210, 210] };

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
  }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function totalSize() { return state.images.reduce((sum, image) => sum + image.file.size, 0); }
  function rotatedDimensions(image) { return image.rotation % 180 ? [image.height, image.width] : [image.width, image.height]; }
  function showStatus(message, type) { const node = $('status-msg'); node.textContent = message; node.className = `converter-status visible ${type || 'info'}`; }
  function clearStatus() { $('status-msg').textContent = ''; $('status-msg').className = 'converter-status'; }
  function setProgress(percent, label) { const safe = Math.max(0, Math.min(100, Math.round(percent))); $('progress-shell').hidden = false; $('progress-bar').style.width = `${safe}%`; $('progress-percent').textContent = `${safe}%`; $('progress-label').textContent = label; }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onload = () => {
        const element = new Image();
        element.onerror = () => reject(new Error('The image could not be decoded.'));
        element.onload = () => resolve({ dataUrl: reader.result, width: element.naturalWidth, height: element.naturalHeight });
        element.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function addImages(files) {
    if (state.busy) return;
    const incoming = Array.from(files || []);
    const valid = incoming.filter((file) => acceptedTypes.has(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name));
    if (!valid.length) { showStatus('Choose JPG, PNG or WebP image files.', 'error'); return; }
    clearStatus();
    let duplicates = 0, rejected = 0;
    for (const file of valid) {
      if (state.images.some((image) => image.file.name === file.name && image.file.size === file.size && image.file.lastModified === file.lastModified)) { duplicates += 1; continue; }
      showStatus(`Reading ${file.name}…`, 'info');
      try {
        const decoded = await readImage(file);
        state.images.push({ id: state.nextId++, file, dataUrl: decoded.dataUrl, width: decoded.width, height: decoded.height, rotation: 0 });
        render();
      } catch (_) { rejected += 1; }
    }
    $('image-input').value = '';
    if (rejected) showStatus(`${rejected} image${rejected === 1 ? '' : 's'} could not be opened.`, 'error');
    else if (duplicates) showStatus(`${duplicates} duplicate image${duplicates === 1 ? ' was' : 's were'} skipped.`, 'info');
    else clearStatus();
    render();
  }

  function render() {
    $('image-grid').innerHTML = state.images.map((image, index) => `<article class="image-card" draggable="true" data-id="${image.id}"><div class="image-preview"><span class="page-number">${index + 1}</span><button type="button" class="drag-handle" title="Drag to reorder" aria-label="Drag ${escapeHtml(image.file.name)} to reorder">⠿</button><img src="${image.dataUrl}" alt="Preview of ${escapeHtml(image.file.name)}" style="transform:rotate(${image.rotation}deg)" /></div><div class="image-details"><strong class="image-name" title="${escapeHtml(image.file.name)}">${escapeHtml(image.file.name)}</strong><div class="image-meta">${image.width} × ${image.height} px · ${formatBytes(image.file.size)}</div></div><div class="image-controls"><button type="button" class="image-control" data-action="up" data-id="${image.id}" title="Move page left" ${index === 0 ? 'disabled' : ''}>←</button><button type="button" class="image-control" data-action="down" data-id="${image.id}" title="Move page right" ${index === state.images.length - 1 ? 'disabled' : ''}>→</button><button type="button" class="image-control" data-action="rotate" data-id="${image.id}" title="Rotate clockwise">↻</button><button type="button" class="image-control remove" data-action="remove" data-id="${image.id}" title="Remove image">×</button></div></article>`).join('');
    const count = state.images.length, bytes = totalSize();
    $('image-count').textContent = `${count} image${count === 1 ? '' : 's'}`;
    $('size-count').textContent = `${formatBytes(bytes)} total`;
    $('page-count').textContent = `${count} PDF page${count === 1 ? '' : 's'}`;
    $('panel-images').textContent = count; $('panel-pages').textContent = count; $('panel-size').textContent = formatBytes(bytes);
    $('image-toolbar').hidden = !count; $('workspace-actions').hidden = !count; $('empty-hint').hidden = Boolean(count);
    $('drop-zone').classList.toggle('compact', Boolean(count));
    $('drop-zone').querySelector('h3').textContent = count ? 'Drop more images here' : 'Drop your images here';
    $('convert-btn').disabled = state.busy || !count;
  }

  function moveImage(id, direction) {
    const index = state.images.findIndex((image) => image.id === id), target = index + direction;
    if (index < 0 || target < 0 || target >= state.images.length) return;
    [state.images[index], state.images[target]] = [state.images[target], state.images[index]];
    render();
  }

  function getPageSpec(image) {
    let [imageWidth, imageHeight] = rotatedDimensions(image);
    const pageSize = $('page-size').value;
    if (pageSize === 'fit') {
      const margin = Number($('margin-range').value) || 0;
      let contentWidth = Math.max(20, imageWidth * 0.264583);
      let contentHeight = Math.max(20, imageHeight * 0.264583);
      const largest = Math.max(contentWidth, contentHeight);
      const available = 2000 - margin * 2;
      if (largest > available) { const scale = available / largest; contentWidth *= scale; contentHeight *= scale; }
      return [contentWidth + margin * 2, contentHeight + margin * 2];
    }
    let [shortSide, longSide] = paperSizes[pageSize] || paperSizes.a4;
    const orientation = $('orientation').value;
    const landscape = orientation === 'landscape' || (orientation === 'auto' && imageWidth > imageHeight);
    if (shortSide === longSide) return [shortSide, longSide];
    return landscape ? [longSide, shortSide] : [shortSide, longSide];
  }

  function loadElement(dataUrl) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = dataUrl; }); }
  function rotatedCanvas(element, rotation) {
    const swap = rotation % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? element.naturalHeight : element.naturalWidth;
    canvas.height = swap ? element.naturalWidth : element.naturalHeight;
    const context = canvas.getContext('2d');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(element, -element.naturalWidth / 2, -element.naturalHeight / 2);
    return canvas;
  }
  function cropCanvas(source, targetAspect) {
    const sourceAspect = source.width / source.height;
    let sx = 0, sy = 0, sw = source.width, sh = source.height;
    if (sourceAspect > targetAspect) { sw = source.height * targetAspect; sx = (source.width - sw) / 2; }
    else { sh = source.width / targetAspect; sy = (source.height - sh) / 2; }
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sw)); canvas.height = Math.max(1, Math.round(sh));
    canvas.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  function flattenCanvas(source, background, quality) {
    const maxDimension = quality === 'small' ? 1800 : quality === 'balanced' ? 2600 : 4000;
    const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d'); context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const qualities = { high: 0.94, balanced: 0.82, small: 0.65 };
    return canvas.toDataURL('image/jpeg', qualities[quality] || 0.92);
  }

  async function prepareImage(image, pageWidth, pageHeight, margin) {
    const fit = $('image-fit').value, quality = $('quality').value, background = $('page-color').value;
    const element = await loadElement(image.dataUrl);
    let source = image.rotation ? rotatedCanvas(element, image.rotation) : element;
    const contentWidth = Math.max(1, pageWidth - margin * 2), contentHeight = Math.max(1, pageHeight - margin * 2);
    if (fit === 'fill') {
      if (!(source instanceof HTMLCanvasElement)) { const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight; canvas.getContext('2d').drawImage(element, 0, 0); source = canvas; }
      source = cropCanvas(source, contentWidth / contentHeight);
    }
    let dataUrl, format;
    if (quality === 'original' && image.rotation === 0 && fit !== 'fill') {
      dataUrl = image.dataUrl; format = image.file.type === 'image/png' ? 'PNG' : image.file.type === 'image/webp' ? 'WEBP' : 'JPEG';
    } else {
      if (!(source instanceof HTMLCanvasElement)) { const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight; canvas.getContext('2d').drawImage(element, 0, 0); source = canvas; }
      dataUrl = flattenCanvas(source, background, quality === 'original' ? 'high' : quality); format = 'JPEG';
    }
    let drawWidth = contentWidth, drawHeight = contentHeight, x = margin, y = margin;
    if (fit === 'contain') {
      const ratio = Math.min(contentWidth / source.width, contentHeight / source.height);
      drawWidth = source.width * ratio; drawHeight = source.height * ratio; x = margin + (contentWidth - drawWidth) / 2; y = margin + (contentHeight - drawHeight) / 2;
    }
    return { dataUrl, format, x, y, width: drawWidth, height: drawHeight };
  }

  function hexToRgb(hex) { const value = hex.replace('#', ''); return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]; }
  function cleanFilename() { const raw = $('output-name').value.trim().replace(/\.pdf$/i, ''); return `${raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim() || 'images-document'}.pdf`; }
  function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }

  async function createPdf() {
    if ($('convert-btn').disabled || state.busy) return;
    state.busy = true; clearStatus(); render(); $('convert-btn').querySelector('span').textContent = 'Creating…';
    try {
      if (!window.jspdf?.jsPDF) throw new Error('The PDF library did not load. Check your connection and try again.');
      const { jsPDF } = window.jspdf;
      const margin = Number($('margin-range').value) || 0, color = hexToRgb($('page-color').value);
      let pdf = null;
      for (let index = 0; index < state.images.length; index += 1) {
        const image = state.images[index], requested = getPageSpec(image), orientation = requested[0] > requested[1] ? 'landscape' : 'portrait', format = [Math.min(...requested), Math.max(...requested)];
        setProgress(5 + (index / state.images.length) * 78, `Preparing ${image.file.name}…`);
        if (!pdf) pdf = new jsPDF({ unit: 'mm', format, orientation, compress: true }); else pdf.addPage(format, orientation);
        const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
        pdf.setFillColor(...color); pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        const prepared = await prepareImage(image, pageWidth, pageHeight, margin);
        pdf.addImage(prepared.dataUrl, prepared.format, prepared.x, prepared.y, prepared.width, prepared.height, undefined, 'FAST');
        if ($('page-numbers').checked) { const dark = color[0] + color[1] + color[2] < 380; pdf.setTextColor(dark ? 235 : 90); pdf.setFontSize(8); pdf.text(String(index + 1), pageWidth / 2, pageHeight - Math.max(3, margin / 3), { align: 'center' }); }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      setProgress(88, 'Finalizing the PDF…');
      const title = $('document-title').value.trim();
      pdf.setProperties({ title: title || cleanFilename().replace(/\.pdf$/i, ''), creator: 'AgentB24 Image to PDF', producer: 'AgentB24' });
      const blob = pdf.output('blob');
      setProgress(97, 'Starting download…'); downloadBlob(blob, cleanFilename()); setProgress(100, 'PDF ready');
      showStatus(`Success — ${state.images.length} image${state.images.length === 1 ? '' : 's'} converted into ${cleanFilename()}.`, 'success');
    } catch (error) {
      console.error(error); $('progress-shell').hidden = true; showStatus(`The PDF could not be created: ${error.message || 'unknown error'}`, 'error');
    } finally { state.busy = false; $('convert-btn').querySelector('span').textContent = 'Create PDF'; render(); }
  }

  const dropZone = $('drop-zone');
  dropZone.addEventListener('click', () => { if (!state.busy) $('image-input').click(); });
  dropZone.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && !state.busy) { event.preventDefault(); $('image-input').click(); } });
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', (event) => addImages(event.dataTransfer.files));
  $('image-input').addEventListener('change', (event) => addImages(event.target.files));
  $('add-more-btn').addEventListener('click', () => $('image-input').click());
  $('clear-btn').addEventListener('click', () => { if (!state.images.length || confirm('Remove all images from this PDF?')) { state.images = []; clearStatus(); $('progress-shell').hidden = true; render(); } });
  $('sort-btn').addEventListener('click', () => { state.images.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true })); render(); });
  $('reverse-btn').addEventListener('click', () => { state.images.reverse(); render(); });
  $('image-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]'); if (!button || state.busy) return;
    const id = Number(button.dataset.id), image = state.images.find((item) => item.id === id);
    if (button.dataset.action === 'remove') state.images = state.images.filter((item) => item.id !== id);
    if (button.dataset.action === 'rotate' && image) image.rotation = (image.rotation + 90) % 360;
    if (button.dataset.action === 'up') moveImage(id, -1);
    if (button.dataset.action === 'down') moveImage(id, 1);
    clearStatus(); render();
  });
  $('image-grid').addEventListener('dragstart', (event) => { const card = event.target.closest('.image-card'); if (!card || state.busy) return; state.draggedId = Number(card.dataset.id); card.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; });
  $('image-grid').addEventListener('dragover', (event) => { const card = event.target.closest('.image-card'); if (!card || Number(card.dataset.id) === state.draggedId) return; event.preventDefault(); document.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over')); card.classList.add('drag-over'); });
  $('image-grid').addEventListener('drop', (event) => { const card = event.target.closest('.image-card'); if (!card || state.draggedId === null) return; event.preventDefault(); const from = state.images.findIndex((item) => item.id === state.draggedId), to = state.images.findIndex((item) => item.id === Number(card.dataset.id)); if (from >= 0 && to >= 0 && from !== to) { const [moved] = state.images.splice(from, 1); state.images.splice(to, 0, moved); } state.draggedId = null; render(); });
  $('image-grid').addEventListener('dragend', () => { state.draggedId = null; render(); });
  $('margin-range').addEventListener('input', () => { $('margin-label').textContent = `${$('margin-range').value} mm`; });
  $('page-color').addEventListener('input', () => { $('color-value').textContent = $('page-color').value.toUpperCase(); document.querySelectorAll('.color-preset').forEach((button) => button.classList.toggle('active', button.dataset.color === $('page-color').value.toLowerCase())); });
  document.querySelectorAll('.color-preset').forEach((button) => button.addEventListener('click', () => { $('page-color').value = button.dataset.color; $('page-color').dispatchEvent(new Event('input')); }));
  $('convert-btn').addEventListener('click', createPdf);
  document.querySelectorAll('.faq-section details').forEach((detail) => detail.addEventListener('toggle', () => { if (detail.open) document.querySelectorAll('.faq-section details').forEach((other) => { if (other !== detail) other.open = false; }); }));
  render();
}());
