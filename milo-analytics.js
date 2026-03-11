(function () {
  var STORAGE_KEY = 'milo_attribution_v1';
  var SESSION_KEY = 'milo_session_id_v1';
  var TRACK_ENDPOINT = '/api/track';

  function nowIso() {
    return new Date().toISOString();
  }

  function safeParse(value) {
    try { return JSON.parse(value); } catch (e) { return null; }
  }

  function getSessionId() {
    try {
      var existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      var id = 'milo_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, id);
      return id;
    } catch (e) {
      return 'milo_fallback_session';
    }
  }

  function readAttribution() {
    try {
      return safeParse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function writeAttribution(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function captureAttribution() {
    var params = new URLSearchParams(window.location.search);
    var existing = readAttribution();
    var next = {
      first_landing_path: existing.first_landing_path || window.location.pathname,
      first_landing_at: existing.first_landing_at || nowIso(),
      latest_path: window.location.pathname,
      latest_at: nowIso(),
      referrer: existing.referrer || document.referrer || '',
      utm_source: params.get('utm_source') || existing.utm_source || '',
      utm_medium: params.get('utm_medium') || existing.utm_medium || '',
      utm_campaign: params.get('utm_campaign') || existing.utm_campaign || '',
      utm_content: params.get('utm_content') || existing.utm_content || '',
      utm_term: params.get('utm_term') || existing.utm_term || '',
      ref: params.get('ref') || existing.ref || '',
      offer: params.get('offer') || existing.offer || ''
    };
    writeAttribution(next);
    return next;
  }

  function withBasePayload(eventName, props) {
    var attribution = readAttribution();
    var payload = {
      event: eventName,
      timestamp: nowIso(),
      session_id: getSessionId(),
      page_path: window.location.pathname,
      page_title: document.title,
      page_url: window.location.href,
      referrer: document.referrer || attribution.referrer || '',
      attribution: attribution,
      properties: props || {}
    };
    return payload;
  }

  function sendPayload(payload) {
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(TRACK_ENDPOINT, blob);
        return;
      }
    } catch (e) {}

    try {
      fetch(TRACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      });
    } catch (e) {}
  }

  function track(eventName, props) {
    sendPayload(withBasePayload(eventName, props));
  }

  function buildTrackedHref(href) {
    try {
      var url = new URL(href, window.location.origin);
      var attribution = readAttribution();
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'offer'].forEach(function (key) {
        if (attribution[key] && !url.searchParams.get(key)) {
          url.searchParams.set(key, attribution[key]);
        }
      });
      if (!url.searchParams.get('landing')) url.searchParams.set('landing', attribution.first_landing_path || window.location.pathname);
      if (!url.searchParams.get('session_id')) url.searchParams.set('session_id', getSessionId());
      return url.toString();
    } catch (e) {
      return href;
    }
  }

  function bindTrackedClicks() {
    document.querySelectorAll('[data-track]').forEach(function (el) {
      el.addEventListener('click', function () {
        var props = {
          label: el.getAttribute('data-track') || '',
          location: el.getAttribute('data-track-location') || '',
          destination: el.getAttribute('href') || '',
          text: (el.textContent || '').trim().slice(0, 120)
        };
        var href = el.getAttribute('href') || '';
        if (href && (/^https:\/\/cal\.com\//.test(href) || /^https:\/\/buy\.stripe\.com\//.test(href))) {
          el.setAttribute('href', buildTrackedHref(href));
          props.destination = el.getAttribute('href');
        }
        track('cta_clicked', props);
      }, { passive: true });
    });
  }

  var attribution = captureAttribution();
  window.miloTrack = track;
  window.miloAttribution = attribution;

  document.addEventListener('DOMContentLoaded', function () {
    track('page_view', { page_type: document.body.getAttribute('data-page-type') || '' });
    bindTrackedClicks();
  });
})();
