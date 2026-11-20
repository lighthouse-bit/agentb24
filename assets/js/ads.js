(function () {
  'use strict';

  if (/\/?admin\.html(?:$|\?)/i.test(location.pathname)) return;

  const CONFIG = {
    topDesktop: {
      key: '8a2e51cd5a685c37fa2ef6280ba55a9c',
      width: 728,
      height: 90
    },
    topMobile: {
      key: '798e21ed1cecd2089dd3844cecb58be0',
      width: 320,
      height: 50
    },
    rectangle: {
      key: 'a26916631f40c1ba447e6cd48e8997c6',
      width: 300,
      height: 250
    },
    native: {
      key: '6ca6e2b688c6759a250311bb1d4d5fad',
      src: 'https://pl30376200.effectivecpmnetwork.com/6ca6e2b688c6759a250311bb1d4d5fad/invoke.js',
      containerId: 'container-6ca6e2b688c6759a250311bb1d4d5fad'
    },
    social: {
      src: 'https://pl30514492.effectivecpmnetwork.com/18/cd/e3/18cde38305a6fc4b599e057cc6d3e4b5.js'
    }
  };

  const ready = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  };

  function makeSlot(kind, label) {
    const slot = document.createElement('aside');
    slot.className = `adsterra-slot adsterra-${kind}`;
    slot.setAttribute('aria-label', label || 'Advertisement');
    return slot;
  }

  function placeAfterHeader(node) {
    const header = document.querySelector('header');
    const target = header || document.body.firstElementChild;
    if (target && target.parentNode) {
      target.parentNode.insertBefore(node, target.nextSibling);
    } else {
      document.body.prepend(node);
    }
  }

  function placeBeforeFooter(node) {
    const footer = document.querySelector('footer');
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(node, footer);
    } else {
      document.body.appendChild(node);
    }
  }

  function loadBanner(slot, unit) {
    return new Promise((resolve) => {
      if (!slot || !unit) return resolve();

      const options = document.createElement('script');
      options.text = `atOptions = {'key':'${unit.key}','format':'iframe','height':${unit.height},'width':${unit.width},'params':{}};`;

      const invoke = document.createElement('script');
      invoke.src = `https://www.highperformanceformat.com/${unit.key}/invoke.js`;
      invoke.async = false;
      invoke.onload = resolve;
      invoke.onerror = resolve;

      slot.appendChild(options);
      slot.appendChild(invoke);
    });
  }

  function loadNative(slot) {
    if (!slot || document.getElementById(CONFIG.native.containerId)) return;

    const container = document.createElement('div');
    container.id = CONFIG.native.containerId;
    slot.appendChild(container);

    const invoke = document.createElement('script');
    invoke.async = true;
    invoke.dataset.cfasync = 'false';
    invoke.src = CONFIG.native.src;
    slot.appendChild(invoke);
  }

  function loadSocialBanner() {
    if (document.querySelector('script[data-agentb24-social-ad]')) return;

    const invoke = document.createElement('script');
    invoke.src = CONFIG.social.src;
    invoke.async = true;
    invoke.dataset.agentb24SocialAd = 'true';
    document.body.appendChild(invoke);
  }

  ready(async () => {
    if (!document.body || document.body.dataset.adsDisabled === 'true') return;

    const topUnit = matchMedia('(max-width: 760px)').matches ? CONFIG.topMobile : CONFIG.topDesktop;
    const top = makeSlot('top', 'Advertisement banner');
    top.style.setProperty('--ad-width', `${topUnit.width}px`);
    top.style.setProperty('--ad-height', `${topUnit.height}px`);
    placeAfterHeader(top);
    await loadBanner(top, topUnit);

    const lowerWrap = document.createElement('section');
    lowerWrap.className = 'adsterra-lower-wrap';

    const native = makeSlot('native', 'Advertisement');
    const rectangle = makeSlot('rectangle', 'Advertisement banner');
    rectangle.style.setProperty('--ad-width', `${CONFIG.rectangle.width}px`);
    rectangle.style.setProperty('--ad-height', `${CONFIG.rectangle.height}px`);

    lowerWrap.append(native, rectangle);
    placeBeforeFooter(lowerWrap);

    loadNative(native);
    await loadBanner(rectangle, CONFIG.rectangle);
    loadSocialBanner();
  });
})();
