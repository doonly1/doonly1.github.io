// wenxin-outline-js.js - 文章大纲生成：提取 h2/h3、滚动监听、高亮当前节
/* Wenxin Outline — Table-of-contents generation, scroll-spy highlight,
 * smooth-scroll jump, mobile overlays, and back-to-top.
 *
 * DOM requirements (provided by the EJS template):
 *   - .outline-sidebar  — desktop right column (houses .outline-list)
 *   - .article-content  — the article body whose headings are scanned
 *   - .mobile-nav-btn / .mobile-outline-btn / .mobile-overlay-backdrop /
 *     .mobile-nav-overlay / .mobile-outline-overlay — mobile chrome
 *   - .back-to-top — optional; created by this script if missing
 *
 * PJAX: exposes window._outlineReinit() so pjax.js can rebuild after a
 *       page swap without a full reload.
 */
(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────────────── */

  function slugify(text) {
    return text
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function scrollToTarget(el) {
    if (!el) return;
    // 立即高亮目标项（不等滚动动画结束，避免 scroll-spy 因位置差误选相邻项）
    if (el.id) setActiveById(el.id);
    var rect = el.getBoundingClientRect();
    // 滚动到标题顶部 -80px，与 scroll-spy 的 rootMargin('-80px 0px -60% 0px') 对齐，
    // 使目标标题落在观察区内，滚动完成后 scroll-spy 能持续高亮它
    var top = rect.top + (window.pageYOffset || document.documentElement.scrollTop) - 80;
    if (typeof Lenis !== 'undefined' && window._lenisInstance) {
      window._lenisInstance.scrollTo(top, { offset: 0 });
    } else if (typeof window.Lenis !== 'undefined') {
      // Lenis exists as a constructor but instance not tracked — fall back
      try { window.Lenis.prototype.scrollTo(top, { offset: 0 }); } catch (_) {
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
    } else {
      window.scrollTo({ top: top, behavior: 'smooth' });
    }
  }

  /* ── heading ID generation ────────────────────────────────────────── */

  function ensureHeadingIds(article) {
    var headings = article.querySelectorAll('h1, h2, h3, h4, h5, h6');
    var usedIds = {};
    headings.forEach(function (h) {
      if (!h.id) {
        var base = slugify(h.textContent) || 'heading';
        var id = base;
        var n = 1;
        while (usedIds[id]) {
          id = base + '-' + (++n);
        }
        usedIds[id] = true;
        h.id = id;
      } else {
        usedIds[h.id] = true;
      }
    });
    return headings;
  }

  /* ── outline DOM ──────────────────────────────────────────────────── */

  function buildOutlineDOM(article) {
    var headings = ensureHeadingIds(article);
    // 目录只显示 h2-h4：跳过 h1（页面标题）与过深的 h5/h6
    // 注意：querySelectorAll 返回 NodeList，无 .filter()，须用 Array.prototype.filter.call
    headings = Array.prototype.filter.call(headings, function (h) {
      var lv = parseInt(h.tagName.charAt(1), 10);
      return lv >= 2 && lv <= 4;
    });
    var list = document.createElement('ul');
    list.className = 'outline-list';

    if (headings.length === 0) {
      var li = document.createElement('li');
      li.className = 'outline-item outline-empty';
      li.textContent = '本文无章节标题';
      list.appendChild(li);
      return list;
    }

    // Find minimum level for clean relative indentation
    var minLevel = 6;
    headings.forEach(function (h) {
      var lv = parseInt(h.tagName.charAt(1), 10);
      if (lv < minLevel) minLevel = lv;
    });

    headings.forEach(function (h) {
      var lv = parseInt(h.tagName.charAt(1), 10);
      var li = document.createElement('li');
      li.className = 'outline-item outline-h' + lv;

      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        scrollToTarget(document.getElementById(h.id));
        // Close mobile overlay if open
        if (window._closeAllMobileOverlays) {
          window._closeAllMobileOverlays();
        }
      });

      li.appendChild(a);
      list.appendChild(li);
    });

    return list;
  }

  /* ── scroll-spy (IntersectionObserver) ─────────────────────────────── */

  var observer = null;

  function clearActive() {
    document.querySelectorAll('.outline-item.active').forEach(function (el) {
      el.classList.remove('active');
    });
  }

  function setActiveById(id) {
    clearActive();
    if (!id) return;
    // Need to escape the id for CSS.escape (modern browsers)
    var escaped = CSS.escape(id);
    var item = document.querySelector(
      '.outline-item a[href="#' + escaped + '"]'
    );
    if (item) {
      item.parentElement.classList.add('active');
      // Keep active item visible inside scrollable sidebar
      if (typeof item.parentElement.scrollIntoView === 'function') {
        item.parentElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function initScrollSpy(article) {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    var headings = article.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) return;

    var visibleHeadings = [];

    observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var idx = visibleHeadings.indexOf(entry.target);
          if (entry.isIntersecting) {
            if (idx === -1) visibleHeadings.push(entry.target);
          } else {
            if (idx !== -1) visibleHeadings.splice(idx, 1);
          }
        });

        // Pick the one closest to the top of the viewport
        if (visibleHeadings.length) {
          var best = visibleHeadings[0];
          var bestTop = best.getBoundingClientRect().top;
          for (var i = 1; i < visibleHeadings.length; i++) {
            var t = visibleHeadings[i].getBoundingClientRect().top;
            if (t < bestTop) { best = visibleHeadings[i]; bestTop = t; }
          }
          setActiveById(best.id);
        }
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0
      }
    );

    headings.forEach(function (h) {
      observer.observe(h);
    });
  }

  /* ── generate / re-generate ───────────────────────────────────────── */

  function generateOutline() {
    var article = document.querySelector('.article-content');
    var container = document.querySelector('.outline-sidebar');
    if (!article || !container) return;

    // Remove old list
    var oldList = container.querySelector('.outline-list');
    if (oldList) oldList.remove();

    var list = buildOutlineDOM(article);
    container.appendChild(list);
    initScrollSpy(article);
  }

  /* ── back-to-top button ───────────────────────────────────────────── */

  var backToTopBtn = null;
  var scrollTick = false;

  function onBackToTopScroll() {
    if (!scrollTick) {
      requestAnimationFrame(function () {
        var y = window.pageYOffset || document.documentElement.scrollTop;
        if (backToTopBtn) {
          backToTopBtn.classList.toggle('is-visible', y > 500);
        }
        scrollTick = false;
      });
      scrollTick = true;
    }
  }

  function initBackToTop() {
    // Clean up old listener if re-initializing after PJAX
    if (window._backToTopCleanup) {
      window._backToTopCleanup();
      window._backToTopCleanup = null;
    }

    backToTopBtn = document.querySelector('.back-to-top');
    if (!backToTopBtn) {
      backToTopBtn = document.createElement('button');
      backToTopBtn.className = 'back-to-top';
      backToTopBtn.setAttribute('aria-label', '返回顶部');
      backToTopBtn.innerHTML = '&#8593;';
      backToTopBtn.addEventListener('click', function () {
        if (typeof Lenis !== 'undefined') {
          try { Lenis.prototype.scrollTo(0); } catch (_) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
      document.body.appendChild(backToTopBtn);
    }

    window.addEventListener('scroll', onBackToTopScroll, { passive: true });
    window._backToTopCleanup = function () {
      window.removeEventListener('scroll', onBackToTopScroll);
    };

    onBackToTopScroll(); // initial state
  }

  /* ── mobile overlay ───────────────────────────────────────────────── */

  var closeAllOverlaysRef = null;

  function initMobileOverlays() {
    var backdrop = document.querySelector('.mobile-overlay-backdrop');
    var navOverlay = document.querySelector('.mobile-nav-overlay');
    var outlineOverlay = document.querySelector('.mobile-outline-overlay');
    var navBtn = document.querySelector('.mobile-nav-btn');
    var outlineBtn = document.querySelector('.mobile-outline-btn');

    if (!navBtn || !outlineBtn || !backdrop) {
      closeAllOverlaysRef = function () {};
      return;
    }

    function closeAll() {
      backdrop.classList.remove('is-visible');
      if (navOverlay) {
        navOverlay.classList.remove('is-open');
      }
      if (outlineOverlay) {
        outlineOverlay.classList.remove('is-open');
      }
      // Clean up display:none after transition
      setTimeout(function () {
        if (!navOverlay.classList.contains('is-open')) {
          navOverlay.style.display = 'none';
        }
        if (!outlineOverlay.classList.contains('is-open')) {
          outlineOverlay.style.display = 'none';
        }
      }, 280);
    }

    closeAllOverlaysRef = closeAll;

    function openOverlay(overlayEl) {
      if (!overlayEl) return;
      closeAll();
      backdrop.classList.add('is-visible');
      overlayEl.style.display = 'block';
      // Double RAF to separate display:block (initial state) from
      // the CSS transition trigger
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          overlayEl.classList.add('is-open');
        });
      });
    }

    // Remove old listeners (PJAX reinit safety)
    var newNavBtn = navBtn.cloneNode(true);
    var newOutlineBtn = outlineBtn.cloneNode(true);
    navBtn.parentNode.replaceChild(newNavBtn, navBtn);
    outlineBtn.parentNode.replaceChild(newOutlineBtn, outlineBtn);

    newNavBtn.addEventListener('click', function () {
      openOverlay(navOverlay);
    });

    newOutlineBtn.addEventListener('click', function () {
      // Ensure outline content is populated in the overlay
      var article = document.querySelector('.article-content');
      if (article) {
        var oldList = outlineOverlay.querySelector('.outline-list');
        if (oldList) oldList.remove();
        outlineOverlay.appendChild(buildOutlineDOM(article));
      }
      openOverlay(outlineOverlay);
    });

    backdrop.addEventListener('click', closeAll);

    // Close buttons inside overlays
    document.querySelectorAll('.overlay-close').forEach(function (btn) {
      btn.addEventListener('click', closeAll);
    });
  }

  /* ── public API (for PJAX) ────────────────────────────────────────── */

  window._outlineReinit = function () {
    setTimeout(function () {
      generateOutline();
      initMobileOverlays();
    }, 120);
  };

  window._closeAllMobileOverlays = function () {
    if (closeAllOverlaysRef) closeAllOverlaysRef();
  };

  /* ── initialise ───────────────────────────────────────────────────── */

  function init() {
    generateOutline();
    initBackToTop();
    initMobileOverlays();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
