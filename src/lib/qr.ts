import encodeQR from '@paulmillr/qr';

/** Renders a payload as an inline SVG string, sized to `size` CSS pixels. */
export function qrSvg(payload: string, size = 220): string {
  const svg = encodeQR(payload, 'svg', { ecc: 'medium', border: 2 });
  return svg
    .replace('<svg ', `<svg width="${size}" height="${size}" shape-rendering="crispEdges" `)
    .replace(/<rect([^>]*?)fill="white"/g, '<rect$1fill="#ffffff"');
}
