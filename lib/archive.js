'use strict';

// shucky archive extractor — unpack a .tar.gz or .zip into a directory, safely.
// Pure Node (zlib only). This is the highest-risk parser in shucky, so it is defensive by default:
//   - zip-slip: every entry path is resolved and must stay inside the destination
//   - symlink/hardlink/device entries are DROPPED (never written) — same reason place.js drops them
//   - caps: entry count, per-entry size, total uncompressed size, and zlib maxOutputLength (zip-bomb)
//   - unrecognised entry types and unsupported compression methods are skipped, not trusted

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_LIMITS = {
  maxEntries: 5000,
  maxEntrySize: 64 * 1024 * 1024,
  maxTotalSize: 256 * 1024 * 1024
};

// Resolve an archive entry name under destDir; return null if it escapes (zip-slip) or is absolute.
function safeJoin(destDir, name) {
  if (!name) return null;
  let n = String(name).replace(/\\/g, '/');
  if (n.indexOf('\0') !== -1) return null;
  if (n[0] === '/' || /^[a-zA-Z]:/.test(n)) return null; // absolute (unix / windows)
  const full = path.resolve(destDir, n);
  const rel = path.relative(destDir, full);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

// ---- tar ------------------------------------------------------------------

function readField(block, start, len) {
  const s = block.slice(start, start + len);
  const nul = s.indexOf(0);
  return s.slice(0, nul === -1 ? len : nul).toString('utf8');
}

function extractTar(buf, destDir, limits) {
  limits = Object.assign({}, DEFAULT_LIMITS, limits);
  let offset = 0, entries = 0, total = 0, written = 0;
  let paxPath = null;
  while (offset + 512 <= buf.length) {
    const header = buf.slice(offset, offset + 512);
    offset += 512;
    let allZero = true;
    for (let i = 0; i < 512; i++) { if (header[i] !== 0) { allZero = false; break; } }
    if (allZero) break; // end-of-archive marker

    const ustarName = readField(header, 0, 100);
    const prefix = readField(header, 345, 155);
    const sizeOct = readField(header, 124, 12).replace(/[^0-7]/g, '');
    const size = sizeOct ? parseInt(sizeOct, 8) : 0;
    const typeflag = String.fromCharCode(header[156]) || '0';

    if (size > limits.maxEntrySize) throw new Error('tar entry too large');
    total += size;
    if (total > limits.maxTotalSize) throw new Error('tar exceeds total size cap');
    const data = buf.slice(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    // pax / GNU extended headers: pull a long path for the NEXT entry, then move on.
    if (typeflag === 'x' || typeflag === 'g') {
      const m = data.toString('utf8').match(/\d+ path=([^\n]*)\n/);
      if (m) paxPath = m[1];
      continue;
    }

    let name = paxPath || (prefix ? prefix + '/' + ustarName : ustarName);
    paxPath = null;
    if (!name) continue;
    if (++entries > limits.maxEntries) throw new Error('tar has too many entries');

    if (typeflag === '5') { // directory
      const d = safeJoin(destDir, name);
      if (d) fs.mkdirSync(d, { recursive: true });
      continue;
    }
    // '0' / '\0' = regular file. Everything else (2=symlink, 1=hardlink, 3/4=device, fifo, …) is dropped.
    if (typeflag !== '0' && typeflag !== '\0') continue;

    const dest = safeJoin(destDir, name);
    if (!dest) continue; // tar-slip → skip
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    written++;
  }
  return written;
}

function extractTarGz(buf, destDir, limits) {
  limits = Object.assign({}, DEFAULT_LIMITS, limits);
  let tar;
  try { tar = zlib.gunzipSync(buf, { maxOutputLength: limits.maxTotalSize }); }
  catch (e) { throw new Error('gunzip failed (corrupt or too large): ' + e.message); }
  return extractTar(tar, destDir, limits);
}

// ---- zip ------------------------------------------------------------------

function extractZip(buf, destDir, limits) {
  limits = Object.assign({}, DEFAULT_LIMITS, limits);
  // Find End Of Central Directory record (sig 0x06054b50), scanning back from the end.
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a valid zip (no end-of-central-directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  let entries = 0, total = 0, written = 0;

  for (let n = 0; n < count; n++) {
    if (cd + 46 > buf.length || buf.readUInt32LE(cd) !== 0x02014b50) break; // central-dir header
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const uncompSize = buf.readUInt32LE(cd + 24);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const extAttrs = buf.readUInt32LE(cd + 38);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.slice(cd + 46, cd + 46 + nameLen).toString('utf8');
    cd += 46 + nameLen + extraLen + commentLen;

    if (++entries > limits.maxEntries) throw new Error('zip has too many entries');
    if (uncompSize > limits.maxEntrySize) throw new Error('zip entry too large');
    total += uncompSize;
    if (total > limits.maxTotalSize) throw new Error('zip exceeds total size cap');

    if (name.endsWith('/')) { const d = safeJoin(destDir, name); if (d) fs.mkdirSync(d, { recursive: true }); continue; }
    // Drop symlinks (unix mode S_IFLNK 0xA000 in the high 16 bits of external attrs).
    if (((extAttrs >>> 16) & 0xF000) === 0xA000) continue;

    const dest = safeJoin(destDir, name);
    if (!dest) continue; // zip-slip → skip

    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);

    let data;
    if (method === 0) data = comp;                                  // stored
    else if (method === 8) {
      try { data = zlib.inflateRawSync(comp, { maxOutputLength: limits.maxEntrySize }); }
      catch (e) { continue; }                                       // corrupt entry → skip
    } else continue;                                                // unsupported method → skip

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    written++;
  }
  return written;
}

// ---- dispatch -------------------------------------------------------------

function extractArchive(buf, destDir, opts) {
  opts = opts || {};
  if (!buf || buf.length < 4) throw new Error('empty or truncated archive');
  fs.mkdirSync(destDir, { recursive: true });
  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // 'PK'
  if (isZip || opts.format === 'zip') return { format: 'zip', written: extractZip(buf, destDir, opts.limits) };
  if (isGzip || opts.format === 'tar.gz' || opts.format === 'tgz') return { format: 'tar.gz', written: extractTarGz(buf, destDir, opts.limits) };
  throw new Error('unrecognized archive format (expected .tar.gz or .zip)');
}

module.exports = { extractArchive, extractTarGz, extractZip, extractTar, safeJoin, DEFAULT_LIMITS };
