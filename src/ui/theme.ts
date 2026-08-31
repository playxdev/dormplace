/**
 * Theme bootstrap. Injected inline into <head> so the correct palette is on
 * <html> before first paint — no flash of the wrong theme.
 *
 * Stored preference is one of "system" | "light" | "dark"; "system" tracks the
 * OS setting live.
 */
export const THEME_INIT = `
(function () {
  var KEY = 'dorm.theme';
  var root = document.documentElement;
  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var pref = 'system';
  try { pref = localStorage.getItem(KEY) || 'system'; } catch (e) {}
  root.dataset.theme = resolve(pref);
  root.dataset.themePref = pref;
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if ((root.dataset.themePref || 'system') === 'system') root.dataset.theme = resolve('system');
    });
  } catch (e) {}
})();
`.trim();

/**
 * Runtime behaviour: theme cycling with a circular reveal from the toggle, the
 * mobile nav drawer, and the row-label pass that lets dense tables collapse
 * into cards on small screens.
 */
export const APP_JS = `
(function () {
  var KEY = 'dorm.theme';
  var root = document.documentElement;
  var ORDER = ['light', 'dark', 'system'];

  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply(pref) {
    root.dataset.themePref = pref;
    root.dataset.theme = resolve(pref);
    try { localStorage.setItem(KEY, pref); } catch (e) {}
    var btn = document.querySelector('.theme-toggle');
    if (btn) btn.setAttribute('aria-label', 'ธีม: ' + pref + ' — กดเพื่อเปลี่ยน');
  }

  function reveal(pref, x, y) {
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !document.startViewTransition) { apply(pref); return; }
    var far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    var t = document.startViewTransition(function () { apply(pref); });
    t.ready.then(function () {
      root.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)',
                     'circle(' + far + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)',
          pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(function () {});
  }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('.theme-toggle');
    if (toggle) {
      var cur = root.dataset.themePref || 'system';
      var next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
      var r = toggle.getBoundingClientRect();
      reveal(next, r.left + r.width / 2, r.top + r.height / 2);
      return;
    }
    if (e.target.closest('.menu-btn')) { root.classList.toggle('nav-open'); return; }
    if (e.target.closest('.scrim') || e.target.closest('.sidebar a')) {
      root.classList.remove('nav-open');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('nav-open')) root.classList.remove('nav-open');
    // "/" focuses search, the way every product this wants to feel like does.
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      var s = document.querySelector('.search input');
      if (s) { e.preventDefault(); s.focus(); }
    }
  });

  // Mirror each table header into its cells so CSS can stack rows as cards.
  document.querySelectorAll('table.responsive').forEach(function (table) {
    var heads = [].map.call(table.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      [].forEach.call(tr.children, function (td, i) {
        if (heads[i]) td.setAttribute('data-label', heads[i]);
      });
    });
  });
})();
`.trim();
