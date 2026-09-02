import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from './app';
import { Db } from './lib/db';
import { SESSION_COOKIE } from './lib/auth';
import { translator, type Locale } from './lib/i18n';
import { THEME_INIT } from './ui/theme';

import authRoutes from './routes/auth';
import dashboard from './routes/dashboard';
import buildings from './routes/buildings';
import rooms from './routes/rooms';
import tenants from './routes/tenants';
import contracts from './routes/contracts';
import contractPrint from './routes/contract-print';
import meters from './routes/meters';
import billing from './routes/billing';
import invoices from './routes/invoices';
import invites from './routes/invites';
import tickets from './routes/tickets';
import reports from './routes/reports';
import search from './routes/search';
import walk from './routes/walk';

const app = new Hono<AppEnv>();

const LOCALE_COOKIE = 'dorm_lang';
const PUBLIC_PATHS = new Set(['/login', '/setup']);

/* Bind the database and resolve the request locale before anything else. */
app.use('*', async (c, next) => {
  c.set('db', new Db(c.env.DB));

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

/* Session gate. Everything except /login and /setup requires a signed-in user. */
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PATHS.has(path) || path === '/app.css' || path.startsWith('/assets/')) return next();

  const sid = getCookie(c, SESSION_COOKIE);
  const user = sid ? await c.get('db').userBySession(sid) : null;
  if (!user) {
    if (path === '/logout') return c.redirect('/login', 303);
    const hasUsers = (await c.get('db').userCount()) > 0;
    return c.redirect(hasUsers ? '/login' : '/setup', 302);
  }
  c.set('user', user);
  await next();
});

app.route('/', authRoutes);
app.route('/', dashboard);
app.route('/', buildings);
app.route('/', rooms);
app.route('/', tenants);
app.route('/', contractPrint); // before /contracts/:id so the print path wins
app.route('/', contracts);
app.route('/', meters);
app.route('/', billing);
app.route('/', invoices);
app.route('/', invites);
app.route('/', tickets);
app.route('/', reports);
app.route('/', search);
app.route('/', walk);

const shellPage = (title: string, body: string) =>
  `<!doctype html><html lang="th"><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1">
   <title>${title} · dorm.place</title>
   <script>${THEME_INIT}<\/script>
   <link rel="stylesheet" href="/app.css"></head>
   <body><div class="auth-wrap"><div class="card auth-card" style="text-align:center">
     <div class="logo" style="justify-content:center">dorm<span class="dot">.</span>place</div>
     ${body}</div></div></body></html>`;

app.notFound((c) =>
  c.html(
    shellPage('404', `<h1 style="font-size:2.5rem;margin:.5rem 0">404</h1>
      <p class="muted">ไม่พบหน้าที่ต้องการ</p>
      <a class="btn primary block" href="/">กลับหน้าแรก</a>`),
    404,
  ),
);

app.onError((err, c) => {
  console.error('unhandled', err);
  return c.html(
    shellPage('Error', `<h1 style="margin:.5rem 0">เกิดข้อผิดพลาด</h1>
      <p class="muted small">${String(err.message).replace(/[<>&]/g, '')}</p>
      <a class="btn block" href="/">กลับหน้าแรก</a>`),
    500,
  );
});

export default app;
