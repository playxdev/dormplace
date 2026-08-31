/**
 * Field-mode runtime. Three jobs:
 *   1. live usage + validation as the walker types
 *   2. never lose a reading — every keystroke drafts to localStorage
 *   3. tolerate no signal — submit via fetch, queue locally on failure and
 *      flush when the connection comes back
 */
export const WALK_JS = `
(function () {
  var form = document.getElementById('walk-form');
  var THEME_ORDER = ['light', 'dark', 'system'];

  /* ---------- theme toggle also lives out here in field mode ---------- */
  document.addEventListener('click', function (e) {
    var tg = e.target.closest('.theme-toggle');
    if (!tg) return;
    var root = document.documentElement;
    var cur = root.dataset.themePref || 'system';
    var next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function apply() {
      root.dataset.themePref = next;
      root.dataset.theme = (next === 'system')
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : next;
      try { localStorage.setItem('dorm.theme', next); } catch (x) {}
    }
    if (reduce || !document.startViewTransition) { apply(); return; }
    var r = tg.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    var far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    var vt = document.startViewTransition(apply);
    vt.ready.then(function () {
      root.animate({ clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)',
                                'circle(' + far + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)',
          pseudoElement: '::view-transition-new(root)' });
    }).catch(function () {});
  });

  var QKEY = 'dorm.walk.queue';
  function queue() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } }
  function setQueue(q) { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) {} }

  function paintSync() {
    var pill = document.querySelector('.sync');
    if (!pill) return;
    var n = queue().length;
    if (!navigator.onLine) { pill.dataset.state = 'offline'; pill.querySelector('span').textContent = pill.dataset.offline.replace('{n}', n); }
    else if (n > 0)        { pill.dataset.state = 'local';   pill.querySelector('span').textContent = pill.dataset.local; }
    else                   { pill.dataset.state = 'ok';      pill.querySelector('span').textContent = pill.dataset.ok; }
  }

  /** Replay anything captured while offline, oldest first. */
  function flush() {
    var q = queue();
    if (!q.length || !navigator.onLine) { paintSync(); return; }
    var item = q[0];
    fetch(item.url, { method: 'POST', body: new URLSearchParams(item.body), headers: { 'x-walk-sync': '1' } })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        setQueue(queue().slice(1));
        flush();
      })
      .catch(function () { paintSync(); });
  }
  addEventListener('online', flush);
  flush();

  if (!form) { paintSync(); return; }

  /* ---------- live usage + validation ---------- */
  var dkey = 'dorm.walk.draft.' + form.dataset.room + '.' + form.dataset.period;

  function fmt(n) { return n.toLocaleString('en-US'); }

  function refresh(kind) {
    var input = form.querySelector('[name="' + kind + '"]');
    if (!input) return;
    var box = input.closest('.meter-card');
    var prev = parseFloat(input.dataset.prev || '0');
    var avg = parseFloat(input.dataset.avg || '0');
    var chip = box.querySelector('.musage .chip');
    var warn = box.querySelector('.mwarn');
    var raw = input.value.trim();

    if (raw === '') {
      chip.textContent = '- ' + input.dataset.unit;
      chip.className = 'chip none';
      if (warn) warn.hidden = true;
      return;
    }
    var val = parseFloat(raw);
    var used = val - prev;
    chip.textContent = fmt(used) + ' ' + input.dataset.unit;
    chip.className = 'chip' + (used < 0 ? ' bad' : '');

    var msg = '', bad = false;
    if (val < prev) {
      msg = warn.dataset.lower + ' — ' + warn.dataset.lowerHint
        .replace('{prev}', fmt(prev)).replace('{now}', fmt(val));
      bad = true;
    } else if (avg > 0 && used > avg * 1.5) {
      var pct = Math.round(((used - avg) / avg) * 100);
      msg = warn.dataset.spike + ' — ' + warn.dataset.spikeHint.replace('{pct}', pct);
      chip.className = 'chip warn';
    }
    if (warn) {
      warn.hidden = !msg;
      warn.classList.toggle('bad', bad);
      var txt = warn.querySelector('.mwarn-text');
      if (txt) txt.textContent = msg;
    }
  }

  function saveDraft() {
    var d = {};
    ['water', 'electric', 'note'].forEach(function (k) {
      var el = form.querySelector('[name="' + k + '"]');
      if (el) d[k] = el.value;
    });
    try { localStorage.setItem(dkey, JSON.stringify(d)); } catch (e) {}
  }

  // Restore anything typed before the phone slept or the tab died.
  try {
    var saved = JSON.parse(localStorage.getItem(dkey) || 'null');
    if (saved) {
      Object.keys(saved).forEach(function (k) {
        var el = form.querySelector('[name="' + k + '"]');
        if (el && !el.value && saved[k]) el.value = saved[k];
      });
    }
  } catch (e) {}

  ['water', 'electric'].forEach(function (k) {
    var el = form.querySelector('[name="' + k + '"]');
    if (!el) return;
    el.addEventListener('input', function () { refresh(k); saveDraft(); });
    refresh(k);
  });
  var noteEl = form.querySelector('[name="note"]');
  if (noteEl) noteEl.addEventListener('input', saveDraft);

  // Show the chosen photo's name so it is obvious one is attached.
  var photo = form.querySelector('input[type=file]');
  if (photo) {
    photo.addEventListener('change', function () {
      var lbl = form.querySelector('.photo-name');
      if (lbl) { lbl.textContent = photo.files[0] ? (lbl.dataset.attached + ' · ' + photo.files[0].name) : ''; }
    });
  }

  /* ---------- submit: optimistic, offline-safe ---------- */
  form.addEventListener('submit', function (e) {
    // A photo needs a real multipart post; let the browser handle that one.
    if (photo && photo.files && photo.files.length) return;

    var required = form.dataset.requireValues === '1';
    if (required) {
      for (var i = 0; i < ['water', 'electric'].length; i++) {
        var k = ['water', 'electric'][i];
        var el = form.querySelector('[name="' + k + '"]');
        if (el && el.value.trim() === '') {
          e.preventDefault();
          el.focus();
          var m = form.querySelector('.form-error');
          if (m) { m.hidden = false; m.textContent = el.dataset.needMsg; }
          return;
        }
      }
    }

    e.preventDefault();
    var body = {};
    new FormData(form).forEach(function (v, k) { if (typeof v === 'string') body[k] = v; });

    try { localStorage.removeItem(dkey); } catch (x) {}

    var q = queue();
    q.push({ url: form.action, body: body });
    setQueue(q);
    paintSync();

    // Move on immediately — the walker should never wait on the network.
    var next = form.dataset.next;
    if (navigator.onLine) {
      flush();
      setTimeout(function () { location.href = next; }, 120);
    } else {
      location.href = next;
    }
  });

  paintSync();
})();
`.trim();
