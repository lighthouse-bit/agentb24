(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { stream: null, image: null, rotation: 0, pages: [], ocrText: '' };
  const canvas = $('scan-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const controls = ['brightness', 'contrast', 'threshold', 'crop-left', 'crop-right', 'crop-top', 'crop-bottom'];

  function toast(message) {
    const el = $('scan-toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  function status(message, type = 'info') {
    const el = $('scan-status');
    el.textContent = message;
    el.className = `scan-status show ${type}`;
  }

  function bytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB'];
    const i = Math.min(2, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  function setCameraStatus(text) {
    $('camera-status').textContent = text;
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      status('Camera capture is not supported in this browser. Upload a photo instead.', 'error');
      return;
    }

    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      $('camera-feed').srcObject = state.stream;
      await $('camera-feed').play();
      document.querySelector('.scan-camera').classList.add('active');
      $('capture-photo').disabled = false;
      $('stop-camera').disabled = false;
      $('start-camera').disabled = true;
      setCameraStatus('Camera ready');
      status('Camera started. Place the document on a contrasting background and capture.', 'success');
    } catch (error) {
      status(`Camera could not start: ${error.message || 'permission denied'}`, 'error');
    }
  }

  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    $('camera-feed').srcObject = null;
    document.querySelector('.scan-camera').classList.remove('active');
    $('capture-photo').disabled = true;
    $('stop-camera').disabled = true;
    $('start-camera').disabled = false;
    setCameraStatus('Camera off');
  }

  function imageFromCanvas(sourceCanvas) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = sourceCanvas.toDataURL('image/png');
    });
  }

  async function capturePhoto() {
    const video = $('camera-feed');
    if (!video.videoWidth) return;
    const temp = document.createElement('canvas');
    temp.width = video.videoWidth;
    temp.height = video.videoHeight;
    temp.getContext('2d').drawImage(video, 0, 0);
    state.image = await imageFromCanvas(temp);
    state.rotation = 0;
    resetCrop();
    renderScan();
    status('Photo captured. Adjust enhancement and add it as a page.', 'success');
  }

  async function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return false;
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        state.image = img;
        state.rotation = 0;
        resetCrop();
        renderScan();
        status(`${file.name} loaded. Adjust the scan or add it as a page.`, 'success');
        resolve(true);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        status('This image could not be loaded by the browser.', 'error');
        resolve(false);
      };
      img.src = url;
    });
  }

  function resetCrop() {
    ['crop-left', 'crop-right', 'crop-top', 'crop-bottom'].forEach((id) => { $(id).value = 0; });
    syncLabels();
  }

  function syncLabels() {
    controls.forEach((id) => {
      const el = $(id);
      const label = $(`${id}-value`);
      if (!label) return;
      label.textContent = id.startsWith('crop') ? `${el.value}%` : el.value;
    });
    $('quality-value').textContent = `${$('image-quality').value}%`;
  }

  function drawRotatedToTemp() {
    const img = state.image;
    const rotated = Math.abs(state.rotation % 180) === 90;
    const temp = document.createElement('canvas');
    temp.width = rotated ? img.naturalHeight : img.naturalWidth;
    temp.height = rotated ? img.naturalWidth : img.naturalHeight;
    const tctx = temp.getContext('2d');
    tctx.translate(temp.width / 2, temp.height / 2);
    tctx.rotate((state.rotation * Math.PI) / 180);
    tctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    return temp;
  }

  function renderScan() {
    if (!state.image) return;
    const source = drawRotatedToTemp();
    const left = +$('crop-left').value / 100;
    const right = +$('crop-right').value / 100;
    const top = +$('crop-top').value / 100;
    const bottom = +$('crop-bottom').value / 100;
    const sx = Math.round(source.width * left);
    const sy = Math.round(source.height * top);
    const sw = Math.max(80, Math.round(source.width * (1 - left - right)));
    const sh = Math.max(80, Math.round(source.height * (1 - top - bottom)));
    canvas.width = sw;
    canvas.height = sh;
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    enhanceCanvas();
    document.querySelector('.scan-preview-wrap').classList.add('has-scan');
    setExportState(true);
  }

  function enhanceCanvas() {
    const mode = $('scan-mode').value;
    const brightness = +$('brightness').value;
    const contrast = +$('contrast').value;
    const threshold = +$('threshold').value;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = data.data;
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < pixels.length; i += 4) {
      let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      r = contrastFactor * (r - 128) + 128 + brightness;
      g = contrastFactor * (g - 128) + 128 + brightness;
      b = contrastFactor * (b - 128) + 128 + brightness;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;

      if (mode === 'gray') {
        r = g = b = gray;
      } else if (mode === 'bw') {
        r = g = b = gray > 170 - threshold ? 255 : 0;
      } else if (mode === 'document') {
        if (gray > 205 - threshold) r = g = b = 255;
        else if (gray < 70 + threshold / 2) r = g = b = Math.max(0, gray - 18);
        else r = g = b = gray * 0.92;
      }

      pixels[i] = Math.max(0, Math.min(255, r));
      pixels[i + 1] = Math.max(0, Math.min(255, g));
      pixels[i + 2] = Math.max(0, Math.min(255, b));
    }
    ctx.putImageData(data, 0, 0);
  }

  function autoCrop() {
    if (!state.image) return;
    resetCrop();
    const source = drawRotatedToTemp();
    const sample = document.createElement('canvas');
    const max = 700;
    const scale = Math.min(1, max / Math.max(source.width, source.height));
    sample.width = Math.round(source.width * scale);
    sample.height = Math.round(source.height * scale);
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(source, 0, 0, sample.width, sample.height);
    const data = sctx.getImageData(0, 0, sample.width, sample.height).data;
    let minX = sample.width, minY = sample.height, maxX = 0, maxY = 0;

    for (let y = 0; y < sample.height; y += 2) {
      for (let x = 0; x < sample.width; x += 2) {
        const i = (y * sample.width + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < 235) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX <= minX || maxY <= minY) {
      status('Auto crop could not find document edges. Adjust crop sliders manually.', 'error');
      return;
    }

    const pad = 8;
    $('crop-left').value = Math.max(0, Math.round(((minX - pad) / sample.width) * 100));
    $('crop-right').value = Math.max(0, Math.round((1 - (maxX + pad) / sample.width) * 100));
    $('crop-top').value = Math.max(0, Math.round(((minY - pad) / sample.height) * 100));
    $('crop-bottom').value = Math.max(0, Math.round((1 - (maxY + pad) / sample.height) * 100));
    syncLabels();
    renderScan();
    status('Auto crop applied. Fine-tune with the crop sliders if needed.', 'success');
  }

  function setExportState(hasScan) {
    ['rotate-left', 'rotate-right', 'add-page', 'download-image', 'run-ocr'].forEach((id) => { $(id).disabled = !hasScan; });
    $('download-pdf').disabled = !state.pages.length && !hasScan;
  }

  function currentBlob(type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function addPage() {
    if (!canvas.width) return;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    const page = { id: Date.now() + Math.random(), dataUrl, width: canvas.width, height: canvas.height };
    state.pages.push(page);
    renderPages();
    $('download-pdf').disabled = false;
    toast('Page added to scanned document');
  }

  function renderPages() {
    const list = $('page-list');
    $('page-count').textContent = state.pages.length;
    list.innerHTML = '';
    if (!state.pages.length) {
      list.innerHTML = '<p>No pages added yet.</p>';
      return;
    }
    state.pages.forEach((page, index) => {
      const item = document.createElement('div');
      item.className = 'scan-thumb';
      item.innerHTML = `<img src="${page.dataUrl}" alt="Page ${index + 1}"><div><b>Page ${index + 1}</b><small>${page.width} × ${page.height}</small></div><button type="button" aria-label="Remove page">×</button>`;
      item.querySelector('button').onclick = () => {
        state.pages = state.pages.filter((p) => p.id !== page.id);
        renderPages();
        $('download-pdf').disabled = !state.pages.length && !canvas.width;
      };
      list.append(item);
    });
  }

  async function downloadImage() {
    if (!canvas.width) return;
    const type = $('image-format').value;
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const blob = await currentBlob(type, +$('image-quality').value / 100);
    if (!blob) {
      status('This browser could not export that image format. Try PNG or JPG instead.', 'error');
      return;
    }
    downloadBlob(blob, `document-scan.${ext}`);
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function exportPdf() {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) {
      status('PDF library could not load. Check your connection and try again.', 'error');
      return;
    }
    const pages = state.pages.length ? state.pages : [{ dataUrl: canvas.toDataURL('image/jpeg', 0.94), width: canvas.width, height: canvas.height }];
    if (!pages[0].width) return;
    const paper = $('paper-size').value;
    let pdf;
    pages.forEach((page, index) => {
      let format = 'a4';
      let orientation = page.width > page.height ? 'landscape' : 'portrait';
      if (paper === 'letter') format = 'letter';
      if (paper === 'fit') format = [page.width, page.height];
      if (!pdf) pdf = new jsPDF({ orientation, unit: paper === 'fit' ? 'px' : 'mm', format });
      else pdf.addPage(format, orientation);
      const w = pdf.internal.pageSize.getWidth();
      const h = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(w / page.width, h / page.height);
      const imgW = page.width * ratio;
      const imgH = page.height * ratio;
      pdf.addImage(page.dataUrl, 'JPEG', (w - imgW) / 2, (h - imgH) / 2, imgW, imgH);
    });
    pdf.save('scanned-document.pdf');
  }

  async function runOcr() {
    if (!canvas.width) return;
    if (!window.Tesseract) {
      status('OCR library could not load. Check your connection and try again.', 'error');
      return;
    }
    $('run-ocr').disabled = true;
    status('Recognizing text… this can take a moment on large scans.');
    try {
      const result = await Tesseract.recognize(canvas.toDataURL('image/png'), 'eng', {
        logger: (m) => {
          if (m.status) status(`${m.status}${m.progress ? ` ${Math.round(m.progress * 100)}%` : ''}`);
        }
      });
      state.ocrText = (result.data.text || '').trim();
      $('ocr-output').value = state.ocrText;
      const hasText = !!state.ocrText;
      ['download-txt', 'download-doc', 'download-html'].forEach((id) => { $(id).disabled = !hasText; });
      status(hasText ? 'OCR complete. Text export is ready.' : 'OCR finished, but no clear text was detected.', hasText ? 'success' : 'error');
    } catch (error) {
      status(`OCR failed: ${error.message || 'unknown error'}`, 'error');
    } finally {
      $('run-ocr').disabled = false;
    }
  }

  function exportText(kind) {
    const text = $('ocr-output').value.trim();
    if (!text) return;
    if (kind === 'txt') downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'scanned-text.txt');
    if (kind === 'html') {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Scanned Text</title></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'scanned-text.html');
    }
    if (kind === 'doc') {
      const doc = `<html><head><meta charset="utf-8"><title>Scanned Text</title></head><body>${escapeHtml(text).replace(/\n/g, '<br>')}</body></html>`;
      downloadBlob(new Blob([doc], { type: 'application/msword;charset=utf-8' }), 'scanned-text.doc');
    }
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  $('start-camera').onclick = startCamera;
  $('stop-camera').onclick = stopCamera;
  $('capture-photo').onclick = capturePhoto;
  $('file-input').onchange = async () => {
    const files = [...$('file-input').files];
    if (!files.length) return;
    if (files.length === 1) {
      await loadFile(files[0]);
      return;
    }
    let added = 0;
    for (const file of files) {
      const loaded = await loadFile(file);
      if (loaded) {
        await addPage();
        added++;
      }
    }
    status(`${added} uploaded images were enhanced and added as document pages.`, added ? 'success' : 'error');
  };
  $('auto-crop').onclick = autoCrop;
  $('rotate-left').onclick = () => { state.rotation = (state.rotation + 270) % 360; renderScan(); };
  $('rotate-right').onclick = () => { state.rotation = (state.rotation + 90) % 360; renderScan(); };
  $('add-page').onclick = addPage;
  $('download-image').onclick = downloadImage;
  $('download-pdf').onclick = exportPdf;
  $('run-ocr').onclick = runOcr;
  $('download-txt').onclick = () => exportText('txt');
  $('download-doc').onclick = () => exportText('doc');
  $('download-html').onclick = () => exportText('html');
  [...controls, 'scan-mode'].forEach((id) => $(id).addEventListener('input', () => { syncLabels(); renderScan(); }));
  $('image-quality').addEventListener('input', syncLabels);
  window.addEventListener('beforeunload', stopCamera);
  syncLabels();
})();
