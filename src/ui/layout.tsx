import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { T } from '../lib/i18n';
import type { User } from '../types';
import { Icon, type IconName } from './icons';
import { APP_JS, THEME_INIT } from './theme';

export const BRAND = 'dorm.place';
export const TAGLINE = 'Run your property. Automate your rent.';

export const Head: FC<{ title: string }> = ({ title }) => (
  <>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <meta name="description" content={TAGLINE} />
    <title>{title}</title>
    {/* Applied before first paint so the page never flashes the wrong theme. */}
    <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap"
    />
    <link rel="stylesheet" href="/app.css" />
  </>
);

/* ------------------------------------------------------------------ nav --- */

interface NavEntry { href: string; key: Parameters<T>[0]; icon: IconName; badge?: number }
interface NavGroup { label?: Parameters<T>[0]; items: NavEntry[] }

const NAV: NavGroup[] = [
  { items: [
    { href: '/', key: 'nav.dashboard', icon: 'dashboard' },
    { href: '/buildings', key: 'nav.buildings', icon: 'building' },
    { href: '/rooms', key: 'nav.rooms', icon: 'door' },
    { href: '/tenants', key: 'nav.tenants', icon: 'users' },
    { href: '/contracts', key: 'nav.contracts', icon: 'contract' },
  ] },
  { label: 'nav.group_money', items: [
    { href: '/walk', key: 'walk.title', icon: 'gauge' },
    { href: '/meters', key: 'walk.office', icon: 'contract' },
    { href: '/billing', key: 'nav.billing', icon: 'receipt' },
    { href: '/invoices', key: 'nav.invoices', icon: 'wallet' },
  ] },
  { label: 'nav.group_ops', items: [
    { href: '/tickets', key: 'nav.tickets', icon: 'wrench' },
    { href: '/reports', key: 'nav.reports', icon: 'chart' },
  ] },
];

function isCurrent(path: string, href: string): boolean {
  return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}

const initials = (name: string) => name.trim().slice(0, 2).toUpperCase();

const Sidebar: FC<{ t: T; path: string; user: User; context?: SideContext }> = ({ t, path, user, context }) => (
  <nav class="sidebar" aria-label={t('nav.dashboard')}>
    <a class="logo" href="/">
      <span>dorm</span><span class="dot">.</span><span>place</span>
    </a>

    {context ? (
      <a class="picker" href={context.href}>
        <span class="avatar-sq" aria-hidden="true">{initials(context.name)}</span>
        <span class="who">
          <b>{context.name}</b>
          <span>{context.sub}</span>
        </span>
        <span class="chev" aria-hidden="true">{Icon.chevron({ size: 15 })}</span>
      </a>
    ) : null}

    {NAV.map((group) => (
      <>
        {group.label ? <div class="nav-label">{t(group.label)}</div> : null}
        {group.items.map((n) => {
          const on = isCurrent(path, n.href);
          return (
            <a class="nav-item" href={n.href} aria-current={on ? 'page' : undefined}>
              <span class="ico" aria-hidden="true">{Icon[n.icon]({ size: 18 })}</span>
              <span>{t(n.key)}</span>
              {n.badge ? <span class="badge">{n.badge}</span> : null}
            </a>
          );
        })}
      </>
    ))}

    <span class="grow" />

    <div class="nav-label">{t('nav.account')}</div>
    <a class="nav-item" href="/buildings" aria-current={path === '/settings' ? 'page' : undefined}>
      <span class="ico" aria-hidden="true">{Icon.cog({ size: 18 })}</span>
      <span>{t('nav.settings')}</span>
    </a>
    <form method="post" action="/logout">
      <button class="nav-item" type="submit" style="width:100%;background:none;border:0;cursor:pointer;font:inherit">
        <span class="ico" aria-hidden="true">{Icon.logout({ size: 18 })}</span>
        <span>{t('nav.logout')}</span>
      </button>
    </form>
  </nav>
);

const Topbar: FC<{ t: T; user: User; locale: string }> = ({ t, user, locale }) => (
  <header class="topbar">
    <button class="icon-btn menu-btn" type="button" aria-label={t('nav.menu')} aria-expanded="false">
      {Icon.menu({ size: 20 })}
    </button>

    <form class="search" method="get" action="/search" role="search">
      <span class="ico" aria-hidden="true">{Icon.search({ size: 16 })}</span>
      <label class="sr-only" for="q">{t('search.placeholder')}</label>
      <input id="q" name="q" type="search" placeholder={t('search.placeholder')} autocomplete="off" />
    </form>

    <div class="topbar-actions">
      <a class="icon-btn" href={`?lang=${locale === 'th' ? 'en' : 'th'}`} title={locale === 'th' ? 'English' : 'ไทย'}
        aria-label={locale === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}>
        <span style="font-size:.6875rem;font-weight:700;letter-spacing:.03em">{locale === 'th' ? 'TH' : 'EN'}</span>
      </a>

      <button class="icon-btn theme-toggle" type="button" aria-label={t('theme.toggle')} title={t('theme.toggle')}>
        <span class="sun" aria-hidden="true">{Icon.sun({ size: 18 })}</span>
        <span class="moon" aria-hidden="true">{Icon.moon({ size: 18 })}</span>
      </button>

      <a class="icon-btn" href="/tickets" aria-label={t('nav.tickets')}>
        {Icon.bell({ size: 18 })}
        <span class="dot-badge" />
      </a>

      <span class="avatar" title={user.name}>{initials(user.name)}</span>
    </div>
  </header>
);

/* --------------------------------------------------------------- layout --- */

export interface SideContext { name: string; sub: string; href: string }

export interface LayoutProps {
  t: T;
  title: string;
  path: string;
  user: User;
  locale: string;
  flash?: { kind: 'ok' | 'err' | 'warn'; text: string } | null;
  /** Optional right-hand summary column. Only pass it where it earns its space. */
  rail?: Child;
  context?: SideContext;
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  t, title, path, user, locale, flash, rail, context, children,
}) => (
  <html lang={locale}>
    <head>
      <Head title={`${title} · ${BRAND}`} />
    </head>
    <body>
      <div class={`shell${rail ? ' has-rail' : ''}`}>
        <Sidebar t={t} path={path} user={user} context={context} />
        <div class="main">
          <Topbar t={t} user={user} locale={locale} />
          <div class="page">
            {flash ? (
              <div class={`flash ${flash.kind}`} role="status">
                <span aria-hidden="true">
                  {flash.kind === 'ok' ? Icon.check({ size: 16 })
                    : flash.kind === 'warn' ? Icon.alert({ size: 16 })
                    : Icon.alert({ size: 16 })}
                </span>
                <span>{flash.text}</span>
              </div>
            ) : null}
            {children}
          </div>
        </div>
        {rail ? <aside class="rail">{rail}</aside> : null}
      </div>
      <div class="scrim" aria-hidden="true" />
      <script dangerouslySetInnerHTML={{ __html: APP_JS }} />
    </body>
  </html>
);

/* ----------------------------------------------------------- primitives --- */

export const PageHead: FC<PropsWithChildren<{ title: string; sub?: string; greet?: boolean }>> = ({
  title, sub, greet, children,
}) => (
  <div class="page-head">
    <div>
      {greet ? <div class="greet">{title}</div> : <h1>{title}</h1>}
      {sub ? <div class="sub">{sub}</div> : null}
    </div>
    <div class="btn-row">{children}</div>
  </div>
);

export const Empty: FC<{ text: string; hint?: string; icon?: IconName; action?: Child }> = ({
  text, hint, icon = 'search', action,
}) => (
  <div class="empty">
    <div class="ico" aria-hidden="true">{Icon[icon]({ size: 20 })}</div>
    <b>{text}</b>
    {hint ? <p>{hint}</p> : null}
    {action}
  </div>
);

export const Tag: FC<{ kind: string; label: string; plain?: boolean }> = ({ kind, label, plain }) => (
  <span class={`tag ${kind}${plain ? ' plain' : ''}`}>{label}</span>
);

/** Big number card. `tone` colours the leading chip, never the number itself. */
export const Kpi: FC<{
  label: string; value: string; icon?: IconName; tone?: 'amber' | 'green' | 'red' | 'blue';
  meta?: Child; currency?: boolean;
}> = ({ label, value, icon = 'chart', tone, meta, currency }) => (
  <div class="kpi">
    <div class="top">
      <span class={`chip${tone ? ' ' + tone : ''}`} aria-hidden="true">{Icon[icon]({ size: 16 })}</span>
      <span class="k">{label}</span>
    </div>
    <div class="v">{currency ? <span class="cur">฿</span> : null}{value}</div>
    {meta ? <div class="m">{meta}</div> : null}
  </div>
);

export const Delta: FC<{ value: number; suffix?: string }> = ({ value, suffix = '%' }) => {
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return (
    <span class={`delta ${dir}`}>
      <span aria-hidden="true">{value > 0 ? Icon.arrowUp({ size: 12 }) : value < 0 ? Icon.arrowDown({ size: 12 }) : null}</span>
      {value > 0 ? '+' : ''}{value}{suffix}
    </span>
  );
};

export const RailStat: FC<{ label: string; value: string; bar?: { pct: number; tone?: 'green' | 'red' } }> = ({
  label, value, bar,
}) => (
  <div class="rail-stat">
    <div class="k">{label}</div>
    <div class="v">{value}</div>
    {bar ? (
      <div class="meter"><i class={bar.tone ?? ''} style={`width:${Math.max(0, Math.min(100, bar.pct))}%`} /></div>
    ) : null}
  </div>
);

export const QuickAction: FC<{ href: string; icon: IconName; label: string }> = ({ href, icon, label }) => (
  <a class="qa" href={href}>
    <span class="ico" aria-hidden="true">{Icon[icon]({ size: 18 })}</span>
    <span>{label}</span>
  </a>
);

export { Icon };
