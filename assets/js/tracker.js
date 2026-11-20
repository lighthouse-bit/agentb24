// ================================================
//  PIXLIT TRACKER — assets/js/tracker.js
//  Sends visitor data to tracker.php on server
// ================================================

(function() {
  'use strict';

  // ---- Skip admin page & bots ----
  if (window.location.pathname.indexOf('admin') > -1) return;
  var bots = /bot|crawl|spider|slurp|mediapartners/i;
  if (bots.test(navigator.userAgent)) return;

  // ---- Visitor ID stored in localStorage ----
  function getVisitorId() {
    var id = localStorage.getItem('pixlit_vid');
    if (!id) {
      id = 'v_' + Date.now() + '_' +
           Math.random().toString(36).substr(2, 9);
      localStorage.setItem('pixlit_vid', id);
    }
    return id;
  }

  // ---- Session check (30 min window) ----
  function isNewSession() {
    var SESSION_KEY = 'pixlit_sess';
    var last        = sessionStorage.getItem(SESSION_KEY);
    var now         = Date.now();
    if (!last || (now - parseInt(last)) > 1800000) {
      sessionStorage.setItem(SESSION_KEY, String(now));
      return true;
    }
    sessionStorage.setItem(SESSION_KEY, String(now));
    return false;
  }

  // ---- Device detection ----
  function getDevice() {
    var ua = navigator.userAgent;
    if (/tablet|ipad|playbook|silk/i.test(ua))        return 'Tablet';
    if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua))
      return 'Mobile';
    return 'Desktop';
  }

  // ---- Browser detection ----
  function getBrowser() {
    var ua = navigator.userAgent;
    if (ua.indexOf('Edg/')     > -1) return 'Edge';
    if (ua.indexOf('Chrome/')  > -1) return 'Chrome';
    if (ua.indexOf('Firefox/') > -1) return 'Firefox';
    if (ua.indexOf('Safari/')  > -1 &&
        ua.indexOf('Chrome/')  < 0)  return 'Safari';
    if (ua.indexOf('OPR/')     > -1) return 'Opera';
    return 'Other';
  }

  // ---- OS detection ----
  function getOS() {
    var ua = navigator.userAgent;
    if (ua.indexOf('Windows NT 10')  > -1) return 'Windows 10/11';
    if (ua.indexOf('Windows')        > -1) return 'Windows';
    if (ua.indexOf('Mac OS X')       > -1) return 'macOS';
    if (ua.indexOf('Android')        > -1) return 'Android';
    if (ua.indexOf('iPhone')         > -1 ||
        ua.indexOf('iPad')           > -1) return 'iOS';
    if (ua.indexOf('Linux')          > -1) return 'Linux';
    return 'Other';
  }

  // ---- Page name ----
  function getPageName() {
    var path = window.location.pathname;
    if (path === '/' || path.indexOf('index') > -1) return 'Homepage';
    var parts = path.split('/');
    var file  = parts[parts.length - 1]
                  .replace('.html', '')
                  .replace(/-/g, ' ');
    if (!file) return 'Homepage';
    return file.charAt(0).toUpperCase() + file.slice(1);
  }

  // ---- Referrer ----
  function getReferrer() {
    var ref = document.referrer;
    if (!ref) return 'Direct';
    try {
      var host = new URL(ref).hostname.replace('www.', '');
      if (host.indexOf('google')    > -1) return 'Google';
      if (host.indexOf('bing')      > -1) return 'Bing';
      if (host.indexOf('facebook')  > -1) return 'Facebook';
      if (host.indexOf('twitter')   > -1 ||
          host.indexOf('t.co')      > -1) return 'Twitter/X';
      if (host.indexOf('linkedin')  > -1) return 'LinkedIn';
      if (host.indexOf('reddit')    > -1) return 'Reddit';
      if (host.indexOf('youtube')   > -1) return 'YouTube';
      if (host.indexOf('instagram') > -1) return 'Instagram';
      if (host.indexOf('tiktok')    > -1) return 'TikTok';
      return host;
    } catch(e) {
      return 'Other';
    }
  }

  // ---- Send data to server ----
  function sendToServer(visitData) {
    // Use sendBeacon for reliability
    var url     = '/tracker.php';
    var payload = JSON.stringify(visitData);

    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    } else {
      // Fallback to fetch
      fetch(url, {
        method      : 'POST',
        headers     : { 'Content-Type': 'application/json' },
        body        : payload,
        keepalive   : true
      }).catch(function() {});
    }
  }

  // ---- Main tracking function ----
  function track() {
    var newSession = isNewSession();

    // Check if returning visitor
    var isNew = !localStorage.getItem('pixlit_returning');
    if (isNew) localStorage.setItem('pixlit_returning', '1');

    // Try geo from cache first
    var cachedGeo = sessionStorage.getItem('pixlit_geo');

    function buildAndSend(geo) {
      geo = geo || {};
      var visitData = {
        visitorId   : getVisitorId(),
        page        : getPageName(),
        path        : window.location.pathname,
        referrer    : getReferrer(),
        device      : getDevice(),
        browser     : getBrowser(),
        os          : getOS(),
        screenW     : screen.width,
        screenH     : screen.height,
        language    : navigator.language || 'unknown',
        country     : geo.country_name  || 'Unknown',
        countryCode : geo.country_code  || 'XX',
        region      : geo.region        || 'Unknown',
        city        : geo.city          || 'Unknown',
        timezone    : geo.timezone      ||
                      (Intl && Intl.DateTimeFormat ?
                       Intl.DateTimeFormat().resolvedOptions().timeZone
                       : 'Unknown'),
        isNew       : isNew,
        isSession   : newSession
      };
      sendToServer(visitData);
    }

    if (cachedGeo) {
      buildAndSend(JSON.parse(cachedGeo));
      return;
    }

    // Fetch geo data
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://ipapi.co/json/', true);
    xhr.timeout = 3000;
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            var geo = JSON.parse(xhr.responseText);
            sessionStorage.setItem('pixlit_geo', JSON.stringify(geo));
            buildAndSend(geo);
          } catch(e) {
            buildAndSend({});
          }
        } else {
          buildAndSend({});
        }
      }
    };
    xhr.ontimeout = function() { buildAndSend({}); };
    xhr.onerror   = function() { buildAndSend({}); };
    xhr.send();
  }

  // ---- Track time on page ----
  var pageStart = Date.now();
  window.addEventListener('beforeunload', function() {
    var timeSpent = Math.round((Date.now() - pageStart) / 1000);
    if (timeSpent > 0) {
      sendToServer({
        type        : 'time',
        visitorId   : getVisitorId(),
        page        : getPageName(),
        timeOnPage  : timeSpent
      });
    }
  });

  // ---- Start tracking ----
  track();

})();