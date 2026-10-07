import { record, text } from '../lib/json-value.js';
import type { Asset } from './types.js';

const RAW_MARKET_CODE_LABEL_RE = /^[A-Z0-9_*./-]{1,16} [A-Z*]{2,4}$/;
const RAW_ASSET_CODE_LABEL_RE = /^[A-Z][A-Z0-9_.-]{1,14}$/;
// Only tested on strings RAW_ASSET_CODE_LABEL_RE accepted, so it needs no tail after the digit.
const NON_ASSET_ID_PREFIX_RE = /^(?:CH|DV|MD|MW|WC)[A-Z0-9_.-]*\d/;
const BBID_SUFFIX_TO_EXCHANGE: Readonly<Record<string, string>> = {
  UW: 'NASD',
  UQ: 'NASD',
  UR: 'NASD',
  UN: 'NYSE',
  US: 'NYSE',
  UF: 'ARCA',
  UP: 'ARCA',
  LN: 'LSE',
  LI: 'LSE',
  FP: 'EPA',
  GR: 'XETR',
  GY: 'XETR',
  HK: 'HKEX',
  JP: 'TSE',
  JT: 'TSE',
  AU: 'ASX',
  CN: 'TSX',
  SS: 'SSE',
  SZ: 'SZSE',
  SW: 'SWX',
  IM: 'BIT',
  SM: 'BME',
  NA: 'ENXT',
};

function isRawAssetLabel(value: string): boolean {
  return RAW_MARKET_CODE_LABEL_RE.test(value)
    || (RAW_ASSET_CODE_LABEL_RE.test(value) && !NON_ASSET_ID_PREFIX_RE.test(value));
}

function assetLabel(attributes: Record<string, unknown>): string {
  const name = text(attributes.name);
  const compact = text(attributes.short_name)
    ?? text(attributes.bbid)
    ?? text(record(attributes.xref)?.bbid);
  if (name && (!compact || isRawAssetLabel(compact))) return name;
  return compact ?? name ?? text(attributes.id) ?? '';
}

function assetAliases(attributes: Record<string, unknown>): string[] {
  return [...new Set([
    text(attributes.short_name),
    text(attributes.bbid),
    text(record(attributes.xref)?.bbid),
    text(attributes.ticker),
  ].filter((value): value is string => value !== undefined && isRawAssetLabel(value)))];
}

function exchangeFromBbid(bbid: string | undefined): string | undefined {
  // Stryker disable next-line Regex: bbid is trimmed, so /\s/ and /\s+/ leave the same last token
  const suffix = bbid?.split(/\s+/).at(-1)?.toUpperCase();
  return suffix ? BBID_SUFFIX_TO_EXCHANGE[suffix] : undefined;
}

/** The Asset that Marquee asset `attributes` describe under `entityId`; undefined without an id or label. */
export function assetFromAttributes(
  attributes: Record<string, unknown>,
  entityId: string | undefined,
): Asset | undefined {
  if (!entityId) return undefined;
  const label = assetLabel(attributes);
  if (!label) return undefined;
  const bbid = text(attributes.bbid);
  const assetClass = text(attributes.assetClass);
  const assetType = text(attributes.type);
  const ticker = text(attributes.ticker);
  const exchange = text(attributes.exchange) ?? exchangeFromBbid(bbid);
  const currency = text(attributes.currency);
  return {
    kind: 'asset',
    entityId,
    label,
    aliases: assetAliases(attributes),
    ...(assetClass ? { assetClass } : {}),
    ...(assetType ? { assetType } : {}),
    ...(ticker ? { ticker } : {}),
    ...(bbid ? { bbid } : {}),
    ...(exchange ? { exchange } : {}),
    ...(currency ? { currency } : {}),
  };
}
