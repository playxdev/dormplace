import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { route, type Ctx } from '../app';
import { BRAND, Head, Icon, TAGLINE } from '../ui/layout';
import { SESSION_COOKIE, SESSION_DAYS, hashPassword, newSessionId, sessionExpiry, verifyPassword } from '../lib/auth';
import { id, str } from '../lib/util';
import type { T } from '../lib/i18n';

const app = route();

function AuthPage(props: { t: T; mode: 'login' | 'setup'; error?: string }) {
  const { t, mode, error } = props;
  const setup = mode === 'setup';
  return (
    <html lang="th">
      <head>
        <Head title={`${setup ? t('auth.signup') : t('auth.login')} · ${BRAND}`} />
      </head>
      <body>
        <div class="auth-wrap">
          <div class="card auth-card">
            <div class="logo"><span>dorm</span><span class="dot">.</span><span>place</span></div>
            <p class="muted small" style="margin-bottom:1.25rem">
              {setup ? t('auth.first_run') : t('common.tagline')}
            </p>
            {error ? (
              <div class="flash err" role="alert">
                <span aria-hidden="true">{Icon.alert({ size: 16 })}</span><span>{error}</span>
              </div>
            ) : null}
            <form method="post" action={setup ? '/setup' : '/login'}>
              {setup ? (
                <div class="field">
                  <label for="name">{t('auth.name')}</label>
                  <input id="name" name="name" required autocomplete="name" autofocus />
                </div>
              ) : null}
              <div class="field">
                <label for="email">{t('auth.email')}</label>
                <input id="email" name="email" type="email" required autocomplete="username"
                  autofocus={!setup} placeholder="you@example.com" />
              </div>
              <div class="field">
                <label for="password">{t('auth.password')}</label>
                <input id="password" name="password" type="password" required minlength={8}
                  autocomplete={setup ? 'new-password' : 'current-password'} />
                {setup ? <div class="hint">อย่างน้อย 8 ตัวอักษร</div> : null}
              </div>
              <button class="btn primary block lg" type="submit" style="margin-top:.25rem">
                {setup ? t('auth.signup') : t('auth.login')}
              </button>
            </form>
          </div>
          <p class="tiny dim" style="margin-top:1rem;text-align:center">{TAGLINE}</p>
        </div>
      </body>
    </html>
  );
}

async function startSession(c: Ctx, userId: string) {
  const sid = newSessionId();
  await c.get('db').run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', sid, userId, sessionExpiry());
  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
    secure: new URL(c.req.url).protocol === 'https:',
  });
}

app.get('/login', async (c) => {
  const t = c.get('t');
  if ((await c.get('db').userCount()) === 0) return c.redirect('/setup', 302);
  return c.html(<AuthPage t={t} mode="login" error={c.req.query('e') ? t('auth.invalid') : undefined} />);
});

app.post('/login', async (c) => {
  const form = await c.req.formData();
  const email = str(form.get('email')).toLowerCase();
  const password = str(form.get('password'));
  const user = await c.get('db').userByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.redirect('/login?e=1', 303);
  }
  await startSession(c, user.id);
  return c.redirect('/', 303);
});

app.get('/setup', async (c) => {
  const t = c.get('t');
  if ((await c.get('db').userCount()) > 0) return c.redirect('/login', 302);
  return c.html(<AuthPage t={t} mode="setup" error={c.req.query('e') ? t('auth.exists') : undefined} />);
});

app.post('/setup', async (c) => {
  const db = c.get('db');
  if ((await db.userCount()) > 0) return c.redirect('/login', 303);
  const form = await c.req.formData();
  const email = str(form.get('email')).toLowerCase();
  const name = str(form.get('name'));
  const password = str(form.get('password'));
  if (!email || !name || password.length < 8) return c.redirect('/setup?e=1', 303);
  const uid = id('u_');
  await db.run(
    "INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'owner')",
    uid, email, await hashPassword(password), name,
  );
  await startSession(c, uid);
  return c.redirect('/buildings/new', 303);
});

app.post('/logout', async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await c.get('db').run('DELETE FROM sessions WHERE id = ?', sid);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.redirect('/login', 303);
});

export default app;
