// ============================================
//   MAIN.JS — Shared JavaScript for all pages
// ============================================

// --- Mobile Menu Toggle ---
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');

if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    mobileMenu.classList.toggle('open');
  });
}

// --- Active Nav Link Highlighter ---
// Automatically highlights the correct nav link based on current page
const currentPath = window.location.pathname;
const navLinks = document.querySelectorAll('.nav-links a, .mobile-menu a');
navLinks.forEach(link => {
  if (link.getAttribute('href') === currentPath ||
      currentPath.includes(link.getAttribute('href')) && link.getAttribute('href') !== '/') {
    link.classList.add('active');
  }
});

// --- Toast Notification System ---
// Usage: showToast('Copied!', 'success')  or  showToast('Error!', 'error')
function showToast(message, type = 'success') {
  // Remove existing toast if any
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Show it
  setTimeout(() => toast.classList.add('show'), 10);

  // Hide after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- Copy to Clipboard Helper ---
// Usage: copyToClipboard('some text')
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('✅ Copied to clipboard!', 'success');
    });
  } else {
    // Fallback for older browsers
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('✅ Copied to clipboard!', 'success');
  }
}

// --- FAQ Accordion ---
// Automatically works on any page that has .faq-question elements
document.querySelectorAll('.faq-question').forEach(question => {
  question.addEventListener('click', () => {
    const answer = question.nextElementSibling;
    const isOpen = answer.classList.contains('open');

    // Close all open FAQs
    document.querySelectorAll('.faq-answer').forEach(a => a.classList.remove('open'));
    document.querySelectorAll('.faq-question').forEach(q => q.classList.remove('active'));

    // Open the clicked one (if it wasn't already open)
    if (!isOpen) {
      answer.classList.add('open');
      question.classList.add('active');
    }
  });
});

// --- Tool Search (Homepage) ---
const searchInput = document.getElementById('tool-search');
if (searchInput) {
  const runSearch = function () {
    const query = this.value.toLowerCase().trim();
    const toolCards = document.querySelectorAll('.tool-card, .category-card');

    toolCards.forEach(card => {
      const searchable = card.textContent.toLowerCase();
      card.style.display = searchable.includes(query) ? 'flex' : 'none';
    });
  };
  searchInput.addEventListener('input', runSearch);
  const searchButton = searchInput.closest('.search-bar')?.querySelector('button');
  if (searchButton) searchButton.addEventListener('click', () => {
    runSearch.call(searchInput);
    document.querySelector('.tools-section')?.scrollIntoView({ behavior: 'smooth' });
  });
}

// Shared helpers used by lightweight browser tools before their page shell
// is enhanced by tool-suite.js.
if (typeof window.suiteStatus !== 'function') {
  window.suiteStatus = function (message, type = 'ok') {
    const el = document.getElementById('suite-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'suite-status show ' + type;
  };
}
if (typeof window.downloadBlob !== 'function') {
  window.downloadBlob = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
}
if (typeof window.formatBytes !== 'function') {
  window.formatBytes = function (bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
  };
}
