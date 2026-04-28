import type { ByteaDisplayFormat } from '../../common/types';
import { BYTEA_DISPLAY_DEFAULT } from '../../common/types';

/**
 * Detect numeric columns in the dataset
 */
export function getNumericColumns(columns: string[], rows: any[]): string[] {
  return columns.filter(col => {
    // Check first few non-null rows
    const sampleSize = Math.min(rows.length, 50);
    let isNumeric = true;
    let hasValue = false;

    for (let i = 0; i < sampleSize; i++) {
      const val = rows[i][col];
      if (val !== null && val !== undefined && val !== '') {
        hasValue = true;
        if (isNaN(Number(val))) {
          isNumeric = false;
          break;
        }
      }
    }

    return hasValue && isNumeric;
  });
}

/**
 * Check if a column name suggests it contains date/time data
 */
export function isDateColumn(col: string, columnTypes?: Record<string, string>): boolean {
  if (columnTypes && columnTypes[col]) {
    const type = columnTypes[col].toLowerCase();
    return type.includes('date') || type.includes('time') || type.includes('timestamp');
  }

  // Fallback to name heuristic
  const lower = col.toLowerCase();
  return lower.includes('date') ||
    lower.includes('time') ||
    lower.includes('created') ||
    lower.includes('updated') ||
    lower.includes('at') ||
    lower === 'day' ||
    lower === 'month' ||
    lower === 'year';
}

/**
 * Get timezone abbreviation from date
 */
export function getTimezoneAbbr(date: Date): string {
  try {
    const parts = date.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ');
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

/**
 * Format date value with custom format string
 */
export function formatDate(value: any, format: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);

  const pad = (n: number, len: number = 2) => String(n).padStart(len, '0');

  const formatMap: Record<string, string | number> = {
    'YYYY': date.getFullYear(),
    'MM': pad(date.getMonth() + 1),
    'DD': pad(date.getDate()),
    'HH': pad(date.getHours()),
    'mm': pad(date.getMinutes()),
    'ss': pad(date.getSeconds()),
    'SSS': pad(date.getMilliseconds(), 3),
    'TZ': getTimezoneAbbr(date)
  };

  return format.replace(/YYYY|MM|DD|HH|mm|ss|SSS|TZ/g, match => String(formatMap[match]));
}

/**
 * Format value for SQL statement usage
 */
export function formatValueForSQL(val: any, colType?: string): string {
  if (val === null) return 'NULL';

  // Handle specific types if known
  if (colType) {
    const type = colType.toLowerCase();
    if (type.includes('int') || type.includes('float') || type.includes('numeric') || type.includes('decimal')) {
      return String(val); // No quotes for numbers
    }
    if (type === 'boolean' || type === 'bool') {
      return String(val); // true/false
    }
  }

  // Default handling based on JS type
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);

  // String handling - escape single quotes
  return `'${String(val).replace(/'/g, "''")}'`;
}

export type ValueKind =
  | 'null'
  | 'boolean-true'
  | 'boolean-false'
  | 'timestamp'
  | 'date'
  | 'time'
  | 'number'
  | 'text'
  | 'json'
  | 'object'
  | 'bytea'
  | 'interval';

/** Compact single-line JSON for grid cells (json/jsonb, composites, structured UDTs). */
function compactJsonForDisplay(val: unknown): string {
  if (val === null || val === undefined) return String(val);
  if (typeof val === 'string') {
    const t = val.trim();
    if (
      (t.startsWith('{') && t.endsWith('}')) ||
      (t.startsWith('[') && t.endsWith(']'))
    ) {
      try {
        return JSON.stringify(JSON.parse(t));
      } catch {
        return val;
      }
    }
    return val;
  }
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

export interface FormatValueOptions {
  byteaDisplayFormat?: ByteaDisplayFormat;
  /** Locale-friendly / indented display for bool, temporal, xml, json, interval (grid preview toggle). */
  prettyPreview?: boolean;
}

/** Types where “pretty preview” improves on raw/pg-style cell text. */
export function columnTypeSupportsPrettyPreview(colType: string | undefined): boolean {
  if (!colType?.trim()) return false;
  let t = colType.toLowerCase().trim().replace(/^_/, '');
  const bracket = t.indexOf('[');
  if (bracket !== -1) t = t.slice(0, bracket);

  if (t === 'bool' || t === 'boolean') return true;
  if (t.includes('timestamp') || t === 'date') return true;
  if (t.includes('interval')) return true;
  if (t.includes('timetz') || (/\btime\b/.test(t) && !t.includes('timestamp'))) return true;
  if (t === 'xml') return true;
  if (t.includes('json')) return true;
  return false;
}

function formatTemporalPrettyLocale(val: unknown, lowerType: string): string {
  try {
    let d: Date | null = null;
    if (val instanceof Date) {
      d = val;
    } else if (typeof val === 'string') {
      const parsed = new Date(val);
      if (!Number.isNaN(parsed.getTime())) d = parsed;
    }
    if (!d || Number.isNaN(d.getTime())) {
      return formatTemporalRaw(val, lowerType);
    }

    if (lowerType.includes('timestamp')) {
      return d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZoneName: 'short',
      });
    }
    if (lowerType === 'date') {
      return d.toLocaleDateString(undefined, { dateStyle: 'full', timeZone: 'UTC' });
    }
    if (/\btime\b/.test(lowerType)) {
      return d.toLocaleTimeString(undefined, { timeStyle: 'medium' });
    }
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return typeof val === 'string' ? val : String(val);
  }
}

function prettyPrintXmlString(xml: string): string {
  const trimmed = xml.trim();
  try {
    const doc = new DOMParser().parseFromString(trimmed, 'text/xml');
    if (doc.querySelector('parsererror')) {
      return trimmed.replace(/>\s*</g, '>\n<');
    }
    const ser = new XMLSerializer();
    const out = ser.serializeToString(doc.documentElement);
    return out.replace(/></g, '>\n<');
  } catch {
    return trimmed.replace(/>\s*</g, '>\n<');
  }
}

function prettifyCellDisplay(
  val: any,
  colType: string,
  base: { text: string; isNull: boolean; type: string; kind: ValueKind },
): string {
  const lt = colType.toLowerCase();
  if (base.isNull) return base.text;

  if (base.kind === 'boolean-true' || base.kind === 'boolean-false') {
    const v =
      typeof val === 'boolean'
        ? val
        : String(val).toLowerCase() === 't' || String(val).toLowerCase() === 'true';
    return v ? 'Yes' : 'No';
  }

  if (lt.includes('interval')) {
    return base.text;
  }

  if (isPgTemporalType(lt)) {
    return formatTemporalPrettyLocale(val, lt);
  }

  if (lt === 'xml' && typeof val === 'string') {
    return prettyPrintXmlString(val);
  }

  if (lt.includes('json')) {
    try {
      const parsed = typeof val === 'string' ? JSON.parse(val) : val;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return base.text;
    }
  }

  return base.text;
}

/** Node/pg round-trip + JSON.parse yields `{ type: "Buffer", data: number[] }`. */
export function isSerializedBuffer(val: unknown): val is { type: 'Buffer'; data: number[] } {
  if (typeof val !== 'object' || val === null) return false;
  const o = val as { type?: unknown; data?: unknown };
  return (
    o.type === 'Buffer' &&
    Array.isArray(o.data) &&
    o.data.every((x) => typeof x === 'number' && x >= 0 && x <= 255)
  );
}

function uint8FromBufferLike(val: unknown): Uint8Array | null {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) {
    return new Uint8Array(val as Buffer);
  }
  if (isSerializedBuffer(val)) {
    return new Uint8Array(val.data);
  }
  return null;
}

export function formatByteaForDisplay(bytes: Uint8Array, mode: ByteaDisplayFormat): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  switch (mode) {
    case 'postgresql':
      return '\\x' + hex;
    case 'json':
      return JSON.stringify({ type: 'Buffer', data: Array.from(bytes) });
    case 'hex0x':
    default:
      return '0x' + hex;
  }
}

function shouldFormatAsBytea(val: unknown, colType?: string): boolean {
  const t = colType?.toLowerCase();
  if (t === 'bytea') return true;
  return isSerializedBuffer(val);
}

/** date / time / timestamp / timestamptz / interval — show driver text, not locale formatting. */
function isPgTemporalType(lowerType: string): boolean {
  if (lowerType.includes('json')) return false;
  if (lowerType.includes('interval')) return true;
  if (lowerType.includes('timestamp')) return true;
  if (lowerType === 'date') return true;
  if (lowerType.includes('timetz')) return true;
  return /\btime\b/.test(lowerType);
}

/**
 * Plain object shape after JSON round-trip (postgres-interval instance loses prototype methods).
 * Matches `postgres-interval` / pg driver field names.
 */
export function formatIntervalPlainObject(val: unknown): string | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;

  const keys = ['years', 'months', 'days', 'hours', 'minutes', 'seconds', 'milliseconds'];
  const value = val as Record<string, unknown>;
  if (!keys.some((k) => k in value)) return null;

  const toNum = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const parts: string[] = [];
  const units: Array<{ key: string; label: string }> = [
    { key: 'years', label: 'year' },
    { key: 'months', label: 'month' },
    { key: 'days', label: 'day' },
    { key: 'hours', label: 'hour' },
    { key: 'minutes', label: 'minute' },
    { key: 'seconds', label: 'second' },
    { key: 'milliseconds', label: 'millisecond' },
  ];

  for (const unit of units) {
    const n = toNum(value[unit.key]);
    if (n === 0) continue;
    const abs = Math.abs(n);
    parts.push(`${n} ${unit.label}${abs === 1 ? '' : 's'}`);
  }

  return parts.length > 0 ? parts.join(' ') : '0 seconds';
}

/** Raw display similar to pgAdmin data grid (verbatim strings from PG; ISO for JS Date). */
function formatTemporalRaw(val: unknown, lowerType: string): string {
  if (val === null || val === undefined) {
    return '[null]';
  }

  if (lowerType.includes('interval')) {
    if (typeof val === 'string') {
      return val;
    }
    if (typeof val === 'object' && val !== null) {
      const v = val as { toPostgres?: () => string; toISOString?: () => string };
      if (typeof v.toPostgres === 'function') {
        try {
          return v.toPostgres();
        } catch {
          /* fall through */
        }
      }
      if (typeof v.toISOString === 'function') {
        try {
          return v.toISOString();
        } catch {
          /* fall through */
        }
      }
      const plain = formatIntervalPlainObject(val);
      if (plain !== null) return plain;
    }
    return String(val);
  }

  if (typeof val === 'string') {
    return val;
  }

  if (val instanceof Date) {
    const iso = val.toISOString();
    if (lowerType.includes('timestamp')) {
      return iso.replace('T', ' ').replace(/\.\d{3}Z$/, '') + '+00';
    }
    if (/\btime\b/.test(lowerType)) {
      return iso.slice(11, 19);
    }
    if (lowerType === 'date') {
      return iso.slice(0, 10);
    }
    return iso.replace('T', ' ').replace(/\.\d{3}Z$/, '') + '+00';
  }

  return String(val);
}

/**
 * Format value with detailed type info (for Table Renderer)
 */
export function formatValue(
  val: any,
  colType?: string,
  options?: FormatValueOptions,
): { text: string; isNull: boolean; type: string; kind: ValueKind; datePart?: string; timePart?: string } {
  const base = computeFormatValue(val, colType, options);
  if (options?.prettyPreview && colType && columnTypeSupportsPrettyPreview(colType)) {
    return { ...base, text: prettifyCellDisplay(val, colType, base) };
  }
  return base;
}

function computeFormatValue(
  val: any,
  colType?: string,
  options?: FormatValueOptions,
): { text: string; isNull: boolean; type: string; kind: ValueKind; datePart?: string; timePart?: string } {
  if (val === null || val === undefined) {
    return { text: '[null]', isNull: true, type: 'null', kind: 'null' };
  }

  const byteaMode = options?.byteaDisplayFormat ?? BYTEA_DISPLAY_DEFAULT;
  const bytesEarly = uint8FromBufferLike(val);
  if (bytesEarly !== null && shouldFormatAsBytea(val, colType)) {
    return {
      text: formatByteaForDisplay(bytesEarly, byteaMode),
      isNull: false,
      type: 'bytea',
      kind: 'bytea',
    };
  }

  if (typeof val === 'boolean') {
    return { text: val ? 'TRUE' : 'FALSE', isNull: false, type: 'boolean', kind: val ? 'boolean-true' : 'boolean-false' };
  }

  if (typeof val === 'number') {
    return { text: String(val), isNull: false, type: 'number', kind: 'number' };
  }

  if (colType && isPgTemporalType(colType.toLowerCase())) {
    const lt = colType.toLowerCase();
    const text = formatTemporalRaw(val, lt);
    return { text, isNull: false, type: lt, kind: 'text' };
  }

  if (val instanceof Date) {
    const iso = val.toISOString();
    return {
      text: iso.replace('T', ' ').replace(/\.\d{3}Z$/, '') + '+00',
      isNull: false,
      type: 'timestamp',
      kind: 'text',
    };
  }

  if (typeof val === 'string' && colType) {
    const lowerType = colType.toLowerCase();

    if (lowerType === 'json' || lowerType === 'jsonb') {
      return { text: compactJsonForDisplay(val), isNull: false, type: 'json', kind: 'json' };
    }
  }

  if (colType) {
    const lowerType = colType.toLowerCase();
    if (lowerType === 'json' || lowerType === 'jsonb') {
      return { text: compactJsonForDisplay(val), isNull: false, type: 'json', kind: 'json' };
    }
  }

  if (typeof val === 'object') {
    const intervalPlain = formatIntervalPlainObject(val);
    if (intervalPlain !== null) {
      return {
        text: intervalPlain,
        isNull: false,
        type: 'interval',
        kind: 'interval',
      };
    }
    return {
      text: compactJsonForDisplay(val),
      isNull: false,
      type: 'object',
      kind: 'object',
    };
  }

  return { text: String(val), isNull: false, type: 'string', kind: 'text' };
}


/**
 * Helper helpers for color conversion
 */
export function rgbaToHex(rgba: string): string {
  const parts = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)/);
  if (parts) {
    const r = parseInt(parts[1]).toString(16).padStart(2, '0');
    const g = parseInt(parts[2]).toString(16).padStart(2, '0');
    const b = parseInt(parts[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return rgba; // Return as is if not matching format
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Create gradient for canvas
 */
export function createGradient(ctx: CanvasRenderingContext2D, colorIndex: number, customColor?: string, isVertical: boolean = true) {
  const colors = [
    ['rgba(54, 162, 235, 0.6)', 'rgba(54, 162, 235, 0.1)'], // Blue
    ['rgba(255, 99, 132, 0.6)', 'rgba(255, 99, 132, 0.1)'], // Red
    ['rgba(75, 192, 192, 0.6)', 'rgba(75, 192, 192, 0.1)'], // Teal
    ['rgba(255, 206, 86, 0.6)', 'rgba(255, 206, 86, 0.1)'], // Yellow
    ['rgba(153, 102, 255, 0.6)', 'rgba(153, 102, 255, 0.1)'], // Purple
    ['rgba(255, 159, 64, 0.6)', 'rgba(255, 159, 64, 0.1)']  // Orange
  ];

  const [startColor, endColor] = customColor
    ? [customColor, customColor.replace(/[\d.]+\)$/, '0.1)')]
    : colors[colorIndex % colors.length];

  const gradient = isVertical
    ? ctx.createLinearGradient(0, 0, 0, 400)
    : ctx.createLinearGradient(0, 0, 400, 0);

  gradient.addColorStop(0, startColor);
  gradient.addColorStop(1, endColor);

  return gradient;
}

export function darkenColor(rgba: string): string {
  return rgba.replace(/[\d.]+\)$/, '0.8)');
}
