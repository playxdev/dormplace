/**
 * PromptPay (Thai QR Payment) payload builder — EMVCo QR Code Specification for
 * Payment Systems, Merchant-Presented Mode, as profiled by the Thai Bankers'
 * Association.
 */

const AID_PROMPTPAY = 'A000000677010111';

function tlv(tag: string, value: string): string {
  return tag + String(value.length).padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — the checksum tag 63 requires. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export type PromptPayTarget =
  | { kind: 'mobile'; value: string }
  | { kind: 'nid'; value: string }
  | { kind: 'ewallet'; value: string };

/**
 * Detects what kind of PromptPay id was entered and normalises it.
 * 10-digit local mobile -> 0066 + last 9 digits (13 chars, per spec)
 * 13 digits -> national id / tax id
 * 15 digits -> e-wallet id
 */
export function normalizeTarget(raw: string): PromptPayTarget | null {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 15) return { kind: 'ewallet', value: d };
  if (d.length === 13) return { kind: 'nid', value: d };
  if (d.length === 10 && d.startsWith('0')) return { kind: 'mobile', value: '0066' + d.slice(1) };
  if (d.length === 11 && d.startsWith('66')) return { kind: 'mobile', value: '00' + d };
  if (d.length === 12 && d.startsWith('660')) return { kind: 'mobile', value: '0066' + d.slice(3) };
  if (d.length === 9) return { kind: 'mobile', value: '0066' + d };
  return null;
}

/**
 * Builds the raw payload string encoded into the QR image.
 * Omit `amountBaht` (or pass 0) for a static "any amount" QR.
 */
export function promptPayPayload(rawTarget: string, amountBaht?: number): string | null {
  const target = normalizeTarget(rawTarget);
  if (!target) return null;

  const subTag = target.kind === 'mobile' ? '01' : target.kind === 'nid' ? '02' : '03';
  const merchant = tlv('00', AID_PROMPTPAY) + tlv(subTag, target.value);
  const dynamic = typeof amountBaht === 'number' && amountBaht > 0;

  // Field order follows the de-facto Thai deployment (country before currency),
  // matching what bank apps in the wild accept.
  let payload =
    tlv('00', '01') +
    tlv('01', dynamic ? '12' : '11') +
    tlv('29', merchant) +
    tlv('58', 'TH') +
    tlv('53', '764') +
    (dynamic ? tlv('54', amountBaht.toFixed(2)) : '');

  payload += '6304';
  return payload + crc16(payload);
}

/** Convenience wrapper taking satang, matching how amounts are stored. */
export function promptPayPayloadSatang(rawTarget: string, satang: number): string | null {
  return promptPayPayload(rawTarget, satang > 0 ? satang / 100 : undefined);
}
