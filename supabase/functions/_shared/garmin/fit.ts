/**
 * Minimal FIT reader for activity files: the per-second `record` messages
 * (timestamp, heart rate, power, speed, distance) and nothing else. Garmin's
 * Personal API serves the original file inside a ZIP
 * (`/download-service/files/activity/{id}`, the same endpoint camino-703 uses);
 * `fitFromDownload` accepts that ZIP or a bare .fit.
 *
 * Written by hand (no npm dependency in `_shared`, which also runs under
 * `node --test`): file header, definition and data messages, compressed
 * timestamp headers and developer fields (skipped). Invalid values (0xFF…)
 * are dropped. Pure apart from the async inflate (DecompressionStream, in Deno
 * and Node).
 */

export interface ActivitySample {
  /** Seconds since the FIT epoch (1989-12-31T00:00:00Z); only differences matter. */
  t: number;
  hr?: number;
  powerW?: number;
  speedMps?: number;
  distanceM?: number;
}

export class FitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FitError';
  }
}

const RECORD = 20;
const TIMESTAMP = 253;
const F_DISTANCE = 5;
const F_SPEED = 6;
const F_POWER = 7;
const F_HR = 3;
const F_ENHANCED_SPEED = 73;

interface FieldDef {
  num: number;
  size: number;
  baseType: number;
}

interface MessageDef {
  global: number;
  littleEndian: boolean;
  fields: FieldDef[];
  /** Bytes of developer fields after the regular ones (skipped). */
  devBytes: number;
}

function isFit(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54; // ".FIT"
}

/** Unsigned integer of 1, 2 or 4 bytes; null when it is the FIT "invalid" value. */
function readUint(view: DataView, offset: number, size: number, le: boolean): number | null {
  if (size === 1) {
    const v = view.getUint8(offset);
    return v === 0xff ? null : v;
  }
  if (size === 2) {
    const v = view.getUint16(offset, le);
    return v === 0xffff ? null : v;
  }
  if (size === 4) {
    const v = view.getUint32(offset, le);
    return v === 0xffffffff ? null : v;
  }
  return null;
}

/** Decodes the record samples of a FIT activity file. Throws FitError when it is not one. */
export function decodeFitRecords(bytes: Uint8Array): ActivitySample[] {
  if (!isFit(bytes)) throw new FitError('No es un fichero FIT.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0];
  const dataSize = view.getUint32(4, true);
  const end = Math.min(bytes.length, headerSize + dataSize);
  const defs = new Map<number, MessageDef>();
  const out: ActivitySample[] = [];
  let lastTimestamp = 0;
  let pos = headerSize;

  while (pos < end) {
    const header = bytes[pos];
    pos += 1;
    if ((header & 0x80) === 0 && (header & 0x40) !== 0) {
      // Definition message.
      if (pos + 5 > end) break;
      const local = header & 0x0f;
      const littleEndian = bytes[pos + 1] === 0;
      const global = view.getUint16(pos + 2, littleEndian);
      const count = bytes[pos + 4];
      pos += 5;
      const fields: FieldDef[] = [];
      for (let i = 0; i < count; i += 1) {
        fields.push({ num: bytes[pos], size: bytes[pos + 1], baseType: bytes[pos + 2] });
        pos += 3;
      }
      let devBytes = 0;
      if ((header & 0x20) !== 0) {
        const devCount = bytes[pos];
        pos += 1;
        for (let i = 0; i < devCount; i += 1) {
          devBytes += bytes[pos + 1];
          pos += 3;
        }
      }
      defs.set(local, { global, littleEndian, fields, devBytes });
      continue;
    }

    const compressed = (header & 0x80) !== 0;
    const local = compressed ? (header >> 5) & 0x03 : header & 0x0f;
    const def = defs.get(local);
    if (!def) throw new FitError('Mensaje FIT sin definición.');
    let timestamp: number | null = null;
    if (compressed) {
      const offset = header & 0x1f;
      timestamp = (lastTimestamp & ~0x1f) + offset;
      if (offset < (lastTimestamp & 0x1f)) timestamp += 0x20;
    }
    const sample: Partial<ActivitySample> = {};
    let speed: number | null = null;
    let enhancedSpeed: number | null = null;
    for (const f of def.fields) {
      if (pos + f.size > end) throw new FitError('Fichero FIT truncado.');
      if (f.num === TIMESTAMP && f.size === 4) {
        timestamp = readUint(view, pos, 4, def.littleEndian);
      } else if (def.global === RECORD) {
        if (f.num === F_HR) {
          const v = readUint(view, pos, f.size, def.littleEndian);
          if (v !== null && v > 0) sample.hr = v;
        } else if (f.num === F_POWER) {
          const v = readUint(view, pos, f.size, def.littleEndian);
          if (v !== null) sample.powerW = v;
        } else if (f.num === F_SPEED) {
          const v = readUint(view, pos, f.size, def.littleEndian);
          if (v !== null) speed = v / 1000;
        } else if (f.num === F_ENHANCED_SPEED) {
          const v = readUint(view, pos, f.size, def.littleEndian);
          if (v !== null) enhancedSpeed = v / 1000;
        } else if (f.num === F_DISTANCE) {
          const v = readUint(view, pos, f.size, def.littleEndian);
          if (v !== null) sample.distanceM = v / 100;
        }
      }
      pos += f.size;
    }
    pos += def.devBytes;
    if (timestamp !== null) lastTimestamp = timestamp;
    if (def.global === RECORD && timestamp !== null) {
      const s = enhancedSpeed ?? speed;
      out.push({ t: timestamp, ...sample, ...(s !== null ? { speedMps: s } : {}) });
    }
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The first .fit entry of a ZIP (central directory, so data descriptors are fine). */
async function fitFromZip(bytes: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FitError('La descarga de Garmin no es un ZIP válido.');
  const entries = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < entries; i += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith('.fit')) continue;
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(start, start + compressedSize);
    if (method === 0) return data;
    if (method === 8) return inflateRaw(data);
    throw new FitError('Compresión del ZIP no soportada.');
  }
  throw new FitError('El ZIP de Garmin no trae ningún .fit.');
}

/** Record samples from Garmin's download (ZIP with the .fit, or the .fit itself). */
export async function fitFromDownload(bytes: Uint8Array): Promise<ActivitySample[]> {
  if (isFit(bytes)) return decodeFitRecords(bytes);
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return decodeFitRecords(await fitFromZip(bytes));
  throw new FitError('Garmin no devolvió un fichero de actividad.');
}
