import type { FC } from 'hono/jsx';
import { raw } from 'hono/html';

/**
 * Stroke icons on a 24-grid, sized by the `size` prop and inheriting colour.
 * Paths go in as raw children: hono rejects dangerouslySetInnerHTML on <svg>.
 */
const S: FC<{ d: string; size?: number; fill?: boolean }> = ({ d, size = 18, fill }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
    fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
  >
    {raw(d)}
  </svg>
);

const P = (d: string) => `<path d="${d}"/>`;

export const Icon = {
  dashboard: (p = {}) => <S {...p} d={P('M3 12h7V3H3zM14 8h7V3h-7zM14 21h7v-9h-7zM3 21h7v-6H3z')} />,
  building:  (p = {}) => <S {...p} d={P('M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 21V9h4a2 2 0 0 1 2 2v10M9 7h2M9 11h2M9 15h2')} />,
  door:      (p = {}) => <S {...p} d={P('M3 21h18M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M14 12h.01')} />,
  users:     (p = {}) => <S {...p} d={P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75')} />,
  contract:  (p = {}) => <S {...p} d={P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5')} />,
  gauge:     (p = {}) => <S {...p} d={P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 12l4-4M12 12v.01')} />,
  receipt:   (p = {}) => <S {...p} d={P('M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5zM8 8h8M8 12h8M8 16h4')} />,
  wallet:    (p = {}) => <S {...p} d={P('M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5M17 12h.01')} />,
  wrench:    (p = {}) => <S {...p} d={P('M14.7 6.3a4 4 0 0 0 5 5l-9.6 9.6a2.1 2.1 0 0 1-3-3z')} />,
  chart:     (p = {}) => <S {...p} d={P('M3 3v18h18M7 15l3-4 3 3 5-6')} />,
  cog:       (p = {}) => <S {...p} d={P('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z')} />,
  help:      (p = {}) => <S {...p} d={P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01')} />,
  search:    (p = {}) => <S {...p} d={P('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3')} />,
  bell:      (p = {}) => <S {...p} d={P('M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0')} />,
  sun:       (p = {}) => <S {...p} d={P('M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4')} />,
  moon:      (p = {}) => <S {...p} d={P('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8')} />,
  menu:      (p = {}) => <S {...p} d={P('M3 12h18M3 6h18M3 18h18')} />,
  close:     (p = {}) => <S {...p} d={P('M18 6 6 18M6 6l12 12')} />,
  chevron:   (p = {}) => <S {...p} d={P('m6 9 6 6 6-6')} />,
  plus:      (p = {}) => <S {...p} d={P('M12 5v14M5 12h14')} />,
  arrowUp:   (p = {}) => <S {...p} d={P('m18 15-6-6-6 6')} />,
  arrowDown: (p = {}) => <S {...p} d={P('m6 9 6 6 6-6')} />,
  arrowRight:(p = {}) => <S {...p} d={P('M5 12h14M12 5l7 7-7 7')} />,
  alert:     (p = {}) => <S {...p} d={P('M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0')} />,
  check:     (p = {}) => <S {...p} d={P('M20 6 9 17l-5-5')} />,
  clock:     (p = {}) => <S {...p} d={P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2')} />,
  droplet:   (p = {}) => <S {...p} d={P('M12 22a7 7 0 0 0 7-7c0-5-7-13-7-13S5 10 5 15a7 7 0 0 0 7 7')} />,
  bolt:      (p = {}) => <S {...p} d={P('M13 2 3 14h9l-1 8 10-12h-9z')} />,
  print:     (p = {}) => <S {...p} d={P('M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z')} />,
  download:  (p = {}) => <S {...p} d={P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3')} />,
  logout:    (p = {}) => <S {...p} d={P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9')} />,
  home:      (p = {}) => <S {...p} d={P('m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')} />,
};

export type IconName = keyof typeof Icon;
