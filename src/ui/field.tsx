import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { T } from '../lib/i18n';
import { Head, Icon } from './layout';
import { WALK_JS } from './walk-js';

/**
 * Full-screen mobile shell for เดินจดมิเตอร์. Deliberately shares nothing with
 * the desktop Layout — no sidebar, no topbar, no rail. One column, thumb-zone
 * actions, and a single sticky footer.
 */
export interface FieldProps {
  t: T;
  title: string;
  locale: string;
  back?: string;
  action?: Child;
  foot?: Child;
  tabs?: boolean;
  help?: string;
}

export const FieldShell: FC<PropsWithChildren<FieldProps>> = ({
  t, title, locale, back, action, foot, tabs, help, children,
}) => (
  <html lang={locale}>
    <head>
      <Head title={`${title} · dorm.place`} />
    </head>
    <body>
      <div class="field-shell">
        <header class="field-top">
          <div class="bar">
            {back
              ? <a class="tap" href={back} aria-label={t('common.back')}>{Icon.chevron({ size: 22 })}</a>
              : <span class="tap" aria-hidden="true" />}
            <span class="ttl">{title}</span>
            {action ?? (help
              ? <a class="tap" href={help} aria-label={t('walk.howto')}>{Icon.help({ size: 20 })}</a>
              : <span class="tap" aria-hidden="true" />)}
          </div>
        </header>

        <main class="field-body">
          <div class="field-inner">{children}</div>
        </main>

        {foot ? <div class="field-foot"><div class="inner">{foot}</div></div> : null}

        {tabs ? (
          <nav class="field-tabs" aria-label={t('walk.tab_walk')}>
            <a href="/"><span aria-hidden="true">{Icon.dashboard({ size: 19 })}</span>{t('walk.tab_overview')}</a>
            <a href="/walk" aria-current="page"><span aria-hidden="true">{Icon.gauge({ size: 19 })}</span>{t('walk.tab_walk')}</a>
            <a href="/tickets"><span aria-hidden="true">{Icon.wrench({ size: 19 })}</span>{t('walk.tab_fix')}</a>
            <a href="/meters"><span aria-hidden="true">{Icon.menu({ size: 19 })}</span>{t('walk.tab_menu')}</a>
          </nav>
        ) : null}
      </div>
      <script dangerouslySetInnerHTML={{ __html: WALK_JS }} />
    </body>
  </html>
);

/** Back-arrow chevron points down by default; rotate it for the header. */
export const BackIcon: FC = () => (
  <span style="transform:rotate(90deg);display:grid" aria-hidden="true">{Icon.chevron({ size: 22 })}</span>
);

export { Icon };
