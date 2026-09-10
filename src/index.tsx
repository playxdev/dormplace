import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from './app';
import { Repos } from './repo';
import { IdentityRepo } from './repo/identity';
import { ForbiddenError, NotFoundError } from './lib/tenant-context';
import { SESSION_COOKIE } from './lib/auth';
import { translator, type Locale } from './lib/i18n';
import { THEME_INIT } from './ui/theme';

import authRoutes from './routes/auth';
import dashboard from './routes/dashboard';
import buildings from './routes/buildings';
import rooms from './routes/rooms';
import residents from './routes/residents';
import contracts from './routes/contracts';
import contractPrint from './routes/contract-print';
import meters from './routes/meters';
import billing from './routes/billing';
import invoices from './routes/invoices';
import invites from './routes/invites';
import lease from './routes/lease';
import tickets from './routes/tickets';
import announcements from './routes/announcements';
import reports from './routes/reports';
import search from './routes/search';
import walk from './routes/walk';

const app = new Hono<AppEnv>();

const LOCALE_COOKIE = 'dorm_lang';
const PUBLIC_PATHS = new Set(['/login', '/setup']);

/* Bind the repositories and resolve the request locale before anything else. */
app.use('*', async (c, next) => {
  c.set('identity', new IdentityRepo(c.env.DB));
  c.set('repos', new Repos(c.env.DB, c.env));

  const q = c.req.query('lang');
  let locale: Locale = 'th';
  if (q === 'th' || q === 'en') {
    locale = q;
    setCookie(c, LOCALE_COOKIE, locale, { path: '/', maxAge: 31536000, sameSite: 'Lax' });
  } else {
    const saved = getCookie(c, LOCALE_COOKIE);
    locale = saved === 'en' ? 'en' : ((c.env.DEFAULT_LOCALE as string) === 'en' ? 'en' : 'th');
  }
  c.set('locale', locale);
  c.set('t', translator(locale));
  await next();
});

/*
 * Session gate and tenant resolution (STANDARD §9.4).
 *
 * Two separate questions, in this order: who is this, and which business are
 * they acting for. The second is answered from membership rows only. Nothing a
 * client can set — a body field, a query parameter, a header — reaches the
 * TenantContext without having been matched against a membership this account
 * actually holds.
 *
 * A signed-in account with no usable membership is not an error to swallow: it
 * is someone whose access was removed while they had a tab open, and they get
 * told so rather than shown an empty dashboard.
 */
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // /lease/:code authorises itself with the invitation code it carries, which
  // is the only credential a resident has before they have an account.
  if (PUBLIC_PATHS.has(path) || path === '/app.css'
      || path.startsWith('/assets/') || path.startsWith('/lease/')) return next();

  const sid = getCookie(c, SESSION_COOKIE);
  const account = sid ? await c.get('identity').accountBySession(sid) : null;
  if (!account) {
    if (path === '/logout') return c.redirect('/login', 303);
    const provisioned = (await c.get('identity').accountCount()) > 0;
    return c.redirect(provisioned ? '/login' : '/setup', 302);
  }
  c.set('account', account);

  const identity = c.get('identity');
  const memberships = await identity.memberships(account.account_id, 'STAFF');
  c.set('memberships', memberships);

  // `?t=` selects among the memberships this account holds. It is a claim to be
  // checked, not an answer: resolve() ignores a tenant the account is not a
  // member of, and the request then has no context at all.
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
  const tctx = await identity.resolve(account.account_id, requestId, c.req.query('t'));
  if (!tctx) {
    return c.html(
      shellPage('ไม่มีสิทธิ์เข้าถึง', `<h1 style="margin:.5rem 0">บัญชีนี้ยังไม่ได้ผูกกับกิจการใด</h1>
        <p class="muted small">ติดต่อเจ้าของกิจการเพื่อขอคำเชิญ หรือออกจากระบบเพื่อเข้าด้วยบัญชีอื่น</p>
        <form method="post" action="/logout"><button class="btn block">ออกจากระบบ</button></form>`),
      403,
    );
  }
  c.set('tctx', tctx);
  await next();
});

app.route('/', authRoutes);
app.route('/', dashboard);
app.route('/', buildings);
app.route('/', rooms);
app.route('/', residents);
app.route('/', contractPrint); // before /contracts/:id so the print path wins
app.route('/', contracts);
app.route('/', meters);
app.route('/', billing);
app.route('/', invoices);
app.route('/', invites);
app.route('/', lease);
app.route('/', tickets);
app.route('/', announcements);
app.route('/', reports);
app.route('/', search);
app.route('/', walk);

function shellPage(title: string, body: string) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1">
   <title>${title} · dorm.place</title>
   <script>${THEME_INIT}<\/script>
   <link rel="stylesheet" href="/app.css"></head>
   <body><div class="auth-wrap"><div class="card auth-card" style="text-align:center">
     <div class="logo" style="justify-content:center">dorm<span class="dot">.</span>place</div>
     ${body}</div></div></body></html>`;
}

/* Static files, then the 404 page.
 *
 * Locally the assets binding serves public/ before the Worker ever runs, so
 * this path is dead. On Pages the opposite is true: `_worker.js` receives every
 * request, and an unhandled /app.css would render the 404 page as text/html
 * with the whole site unstyled. Asking ASSETS here makes both hosts behave the
 * same way. */
app.notFound(async (c) => {
  const asset = await c.env.ASSETS?.fetch(c.req.raw);
  if (asset && asset.status < 400) return asset;

  return c.html(
    shellPage('404', `<h1 style="font-size:2.5rem;margin:.5rem 0">404</h1>
      <p class="muted">ไม่พบหน้าที่ต้องการ</p>
      <a class="btn primary block" href="/">กลับหน้าแรก</a>`),
    404,
  );
});

app.onError((err, c) => {
  // A repo answers NotFound for a row in another tenant as well as for one that
  // does not exist, and this must render the same 404 for both — a distinct
  // page for "exists but not yours" would confirm the id.
  if (err instanceof NotFoundError) {
    return c.html(
      shellPage('404', `<h1 style="font-size:2.5rem;margin:.5rem 0">404</h1>
        <p class="muted">ไม่พบข้อมูลที่ต้องการ</p>
        <a class="btn primary block" href="/">กลับหน้าแรก</a>`),
      404,
    );
  }
  if (err instanceof ForbiddenError) {
    return c.html(
      shellPage('403', `<h1 style="margin:.5rem 0">สิทธิ์ไม่พอ</h1>
        <p class="muted small">บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้ ติดต่อเจ้าของกิจการหากต้องการสิทธิ์เพิ่ม</p>
        <a class="btn block" href="/">กลับหน้าแรก</a>`),
      403,
    );
  }
  console.error('unhandled', err);
  return c.html(
    shellPage('Error', `<h1 style="margin:.5rem 0">เกิดข้อผิดพลาด</h1>
      <p class="muted small">${String(err.message).replace(/[<>&]/g, '')}</p>
      <a class="btn block" href="/">กลับหน้าแรก</a>`),
    500,
  );
});

export default app;
