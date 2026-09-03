// wenxin-pjax.js - PJAX 无刷新导航：拦截链接、替换内容、管理生命周期
(function () {
  'use strict';

  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  var cache = new Map();
  var MAX_CACHE_SIZE = 20;
  var navVersion = 0;
  // Scroll position to restore on pop (back/forward) navigation.
  // Set by the popstate handler from history.state.scrollY, consumed in
  // the post-swap RAF, then cleared.
  var pendingScrollRestore = 0;

  // Homepage path from the current DOM's brand link (always points home).
  function getHomePath() {
    var el = document.querySelector('.brand-block a, .brand-block, .site-title a');
    if (!el || !el.href) return '';
    try { return new URL(el.getAttribute('href'), location.origin).pathname; }
    catch (_) { return ''; }
  }

  function trackPageview(url, isPop) {
    // Google Analytics — gtag queue is available immediately. GA's own
    // send_page_view is disabled (see head.html), so unlike Umami below,
    // every SPA nav — push and pop alike — must be reported manually here.
    if (typeof window.gtag === 'function' && window.gaMeasurementId) {
      window.gtag('event', 'page_view', {
        page_location: url,
        page_title: document.title
      });
    }
    // Umami — the tracker hooks history.pushState/replaceState and records
    // push-navigations itself; it does NOT listen on popstate, so only
    // back/forward (isPop) needs a manual pageview here. Tracking both would
    // double-count forward navigations.
    if (isPop && window.umami && typeof window.umami.track === 'function') {
      window.umami.track({ url: url, title: document.title });
    }
  }

  var progressBar = document.createElement('div');
  progressBar.className = 'nav-progress';
  progressBar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progressBar);

  function progressStart() {
    progressBar.classList.remove('is-complete');
    progressBar.style.width = '';
    progressBar.classList.add('is-loading');
  }

  function progressDone() {
    progressBar.classList.remove('is-loading');
    progressBar.classList.add('is-complete');
  }

  async function fetchPage(url) {
    if (cache.has(url)) return cache.get(url);
    var res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    var doc = new DOMParser().parseFromString(await res.text(), 'text/html');

    if (cache.size >= MAX_CACHE_SIZE) {
      var firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    cache.set(url, doc);
    return doc;
  }

  function showError(message) {
    var toast = document.createElement('div');
    toast.className = 'pjax-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  async function navigate(url, push) {
    if (push === undefined) push = true;
    var version = ++navVersion;

    progressStart();

    var incoming;
    try { incoming = await fetchPage(url); }
    catch (e) {
      progressDone();
      showError('页面加载失败，正在跳转...');
      location.href = url;
      return;
    }

    if (version !== navVersion) return;

    var current = document.querySelector('main');
    if (!current) return;

    current.style.transition = 'opacity 180ms ease, transform 180ms ease';
    current.style.opacity = '0';
    current.style.transform = 'translateY(6px)';
    await new Promise(function (r) { setTimeout(r, 180); });

    if (version !== navVersion) return;

    var nextNode = incoming.querySelector('main');
    if (!nextNode) { location.href = url; return; }
    var next = nextNode.cloneNode(true);

    // Swap page-specific CSS (Hugo fingerprints it as page-post.min.{hash}.css)
    var curStyle = document.head.querySelector('link[href*="page-"]');
    var nextStyle = incoming.querySelector('link[href*="page-"]');
    if (curStyle && nextStyle) curStyle.href = nextStyle.getAttribute('href');

    if (typeof window._lenisCleanup === 'function') {
      window._lenisCleanup();
      window._lenisCleanup = null;
    }
    current.replaceWith(next);
    next.setAttribute('tabindex', '-1');
    next.focus();
    document.title = incoming.title;
    document.body.className = incoming.body.className;

    // Post pages use a minimal spine sidebar; other pages use the full nav sidebar
    var currentSidebar = document.querySelector('aside.sidebar');
    var nextSidebar = incoming.querySelector('aside.sidebar');
    if (currentSidebar && nextSidebar) {
      currentSidebar.replaceWith(nextSidebar.cloneNode(true));
    }

    // Swap outline sidebar for post pages
    var currentOutline = document.querySelector('aside.outline-sidebar');
    var nextOutline = incoming.querySelector('aside.outline-sidebar');
    if (currentOutline && nextOutline) {
      currentOutline.replaceWith(nextOutline.cloneNode(true));
    } else if (currentOutline) {
      currentOutline.remove();
    } else if (nextOutline) {
      // Home → post: no outline sidebar in current DOM, insert the incoming one
      // right after the (already swapped) main so grid layout places it correctly
      var mainEl = document.querySelector('main');
      if (mainEl && mainEl.parentNode) {
        mainEl.parentNode.insertBefore(
          nextOutline.cloneNode(true),
          mainEl.nextSibling
        );
      }
    }

    if (typeof window._sidebarScrollCleanup === 'function') {
      window._sidebarScrollCleanup();
      window._sidebarScrollCleanup = null;
    }

    var targetPath = new URL(url, location.origin).pathname;
    document.querySelectorAll('.site-nav a').forEach(function (a) {
      var aPath = new URL(a.href, location.origin).pathname;
      var extraPrefix = a.getAttribute('data-match-prefix');
      // Normalize trailing slashes for exact match
      var exactMatch = aPath === targetPath
        || aPath === targetPath.replace(/\/$/, '')
        || aPath + '/' === targetPath;
      // data-match-prefix: archive page matches /tags/* paths
      var prefixMatch = extraPrefix && targetPath.indexOf(extraPrefix) === 0;
      // Root path must be exact — otherwise it matches every page
      var match = aPath === '/' ? exactMatch : (exactMatch || prefixMatch);
      a.classList.toggle('active', match);
      if (match) {
        a.setAttribute('aria-current', 'page');
      } else {
        a.removeAttribute('aria-current');
      }
    });

    if (push) {
      // Write the current page's own scroll position into ITS history record
      // (replaceState), so that coming back to it restores exactly where the
      // user left off. The new record starts at 0 (forward nav → top).
      var leaveY = window.scrollY || document.documentElement.scrollTop || 0;
      try {
        history.replaceState({ url: location.href, scrollY: leaveY }, '', location.href);
      } catch (_) { /* ignore same-document replaceState edge cases */ }
      // Remember the homepage scroll position when leaving it, so returning
      // via the brand link can restore it. body.page-home is the reliable
      // marker (URL may vary: shareId vs shareAlias).
      if (document.body.classList.contains('page-home')) {
        try { sessionStorage.setItem('wenxin:home-scroll', String(leaveY)); } catch (_) {}
      }
      // Navigating back to the homepage (e.g. via the brand link) restores the
      // homepage scroll position remembered in sessionStorage, instead of
      // always starting at the top.
      var restoreY = 0;
      var homePath = getHomePath();
      var targetPath = new URL(url, location.origin).pathname;
      if (homePath && targetPath === homePath) {
        try {
          restoreY = parseInt(sessionStorage.getItem('wenxin:home-scroll'), 10) || 0;
        } catch (_) { /* storage unavailable */ }
      }
      history.pushState({ url: url, scrollY: restoreY }, '', url);
    }

    // Double RAF: Safari needs two frames to separate "set initial value" from "trigger transition"
    next.style.transition = 'none';
    next.style.opacity = '0';
    next.style.transform = 'translateY(6px)';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        // Forward navigation starts at the top; back/forward restores the
        // scroll position saved in history.state (0 when unavailable).
        var restoreY = push ? 0 : pendingScrollRestore;
        pendingScrollRestore = 0;
        window.scrollTo(0, restoreY);
        next.style.transition = 'opacity 380ms ease, transform 380ms ease';
        next.style.opacity = '1';
        next.style.transform = 'translateY(0)';
        progressDone();
      });
    });

    // Notify analytics of SPA navigation (popstate only — see trackPageview)
    trackPageview(url, !push);

    // Delay Lenis + outline reinit until fade-in animation completes
    setTimeout(function () {
      if (typeof window._lenisReinit === 'function') {
        window._lenisReinit();
      }
      if (typeof window._outlineReinit === 'function') {
        window._outlineReinit();
      }
      window.dispatchEvent(new CustomEvent('pjax:done'));
    }, 420);
  }

  // Intercept all same-origin link clicks
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    if (a.target === '_blank') return;
    if (a.hasAttribute('download')) return;
    if (a.getAttribute('data-no-pjax') !== null) return;
    var href;
    try { href = new URL(a.href, location.origin); } catch (_) { return; }
    if (href.origin !== location.origin) return;
    // Anchor links scroll within the page — let the browser handle them
    if (href.pathname === location.pathname && href.hash) return;
    if (href.pathname === location.pathname) return;
    e.preventDefault();
    navigate(a.href);
  });

  window.addEventListener('popstate', function (e) {
    // Capture the saved scroll position for this history entry before navigating
    pendingScrollRestore = (e.state && typeof e.state.scrollY === 'number') ? e.state.scrollY : 0;
    navigate((e.state && e.state.url) || location.href, false);
  });
})();
