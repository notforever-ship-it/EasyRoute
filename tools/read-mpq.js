// Reads one file out of the game's MPQ archives (Data\*.MPQ), newest patch first, the way the game does.
// Enough of the MPQ format for the 1.12 client's data tables: hash and block tables, sectors, zlib and bzip2-free
// files (the tables Easy Route needs are stored with zlib or not compressed at all).
// Usage as a tool: node tools/read-mpq.js <game Data folder> <file inside, e.g. DBFilesClient\WorldMapArea.dbc> <out>
// Used by build-guides.js through ReadGameFile().

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const crypt = new Uint32Array(0x500);
(function () {
  let seed = 0x00100001;
  for (let i = 0; i < 0x100; i++) {
    for (let j = 0, idx = i; j < 5; j++, idx += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t1 = (seed & 0xffff) << 0x10;
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t2 = seed & 0xffff;
      crypt[idx] = (t1 | t2) >>> 0;
    }
  }
})();

function hashString(str, type) {
  let s1 = 0x7fed7fed, s2 = 0xeeeeeeee;
  for (const c of str.toUpperCase()) {
    const ch = c.charCodeAt(0);
    s1 = (crypt[(type << 8) + ch] ^ ((s1 + s2) >>> 0)) >>> 0;
    s2 = (ch + s1 + s2 + ((s2 << 5) >>> 0) + 3) >>> 0;
  }
  return s1;
}

function decrypt(buf, key) {
  let s2 = 0xeeeeeeee;
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    s2 = (s2 + crypt[0x400 + (key & 0xff)]) >>> 0;
    const ch = (buf.readUInt32LE(i) ^ ((key + s2) >>> 0)) >>> 0;
    key = ((((~key) << 0x15) >>> 0) + 0x11111111 | (key >>> 0x0b)) >>> 0;
    s2 = (ch + s2 + ((s2 << 5) >>> 0) + 3) >>> 0;
    buf.writeUInt32LE(ch, i);
  }
  return buf;
}

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  fs.readSync(fd, b, 0, len, pos);
  return b;
}

function openArchive(file) {
  const fd = fs.openSync(file, "r");
  // The header sits at the start or on a 512-byte boundary further in.
  let base = -1;
  const size = fs.fstatSync(fd).size;
  for (let p = 0; p < Math.min(size, 1 << 20); p += 512) {
    if (readAt(fd, p, 4).toString("latin1") === "MPQ\x1a") { base = p; break; }
  }
  if (base < 0) { fs.closeSync(fd); return null; }
  const h = readAt(fd, base, 32);
  const sectorSize = 512 << h.readUInt16LE(14);
  const hashPos = base + h.readUInt32LE(16), blockPos = base + h.readUInt32LE(20);
  const hashCount = h.readUInt32LE(24), blockCount = h.readUInt32LE(28);
  const hashes = decrypt(readAt(fd, hashPos, hashCount * 16), hashString("(hash table)", 3));
  const blocks = decrypt(readAt(fd, blockPos, blockCount * 16), hashString("(block table)", 3));
  return { fd, base, sectorSize, hashes, blocks, hashCount };
}

function findBlock(a, name) {
  const i0 = hashString(name, 0) % a.hashCount, n1 = hashString(name, 1), n2 = hashString(name, 2);
  for (let k = 0; k < a.hashCount; k++) {
    const i = ((i0 + k) % a.hashCount) * 16;
    const block = a.hashes.readUInt32LE(i + 12);
    if (block === 0xffffffff) return null;
    if (a.hashes.readUInt32LE(i) === n1 && a.hashes.readUInt32LE(i + 4) === n2 && block !== 0xfffffffe) {
      const b = block * 16;
      return { offset: a.blocks.readUInt32LE(b), packed: a.blocks.readUInt32LE(b + 4),
        size: a.blocks.readUInt32LE(b + 8), flags: a.blocks.readUInt32LE(b + 12) };
    }
  }
  return null;
}

function decompress(data, outLen) {
  if (data.length >= outLen) return data.subarray(0, outLen);
  const mask = data[0];
  if (mask === 0x02) return zlib.inflateSync(data.subarray(1));
  throw new Error("compression " + mask.toString(16) + " is not supported by this reader");
}

function extract(a, name) {
  const blk = findBlock(a, name);
  if (!blk || !(blk.flags & 0x80000000) || (blk.flags & 0x04000000)) return null;
  if (blk.flags & 0x00010000) throw new Error(name + " is encrypted; this reader does not handle that");
  if (blk.flags & 0x00000100) throw new Error(name + " is imploded (PKWARE); this reader does not handle that");
  const pos = a.base + blk.offset;
  if (!(blk.flags & 0x00000200) || (blk.flags & 0x01000000)) {
    const raw = readAt(a.fd, pos, blk.packed);
    return (blk.flags & 0x00000200) ? decompress(raw, blk.size) : raw;
  }
  const sectors = Math.ceil(blk.size / a.sectorSize);
  const table = readAt(a.fd, pos, (sectors + 1) * 4);
  const parts = [];
  for (let s = 0; s < sectors; s++) {
    const start = table.readUInt32LE(s * 4), end = table.readUInt32LE(s * 4 + 4);
    const want = Math.min(a.sectorSize, blk.size - s * a.sectorSize);
    parts.push(decompress(readAt(a.fd, pos + start, end - start), want));
  }
  return Buffer.concat(parts);
}

// The file from the newest archive that has it: patch-9 ... patch-2, patch, then the base archives.
function ReadGameFile(dataDir, name) {
  const files = fs.readdirSync(dataDir).filter((f) => /\.mpq$/i.test(f));
  const rank = (f) => {
    const m = f.match(/^patch-(\d+)\.mpq$/i);
    if (m) return 1000 + +m[1];
    if (/^patch\.mpq$/i.test(f)) return 1000;
    return 0;
  };
  files.sort((x, y) => rank(y) - rank(x));
  for (const f of files) {
    const a = openArchive(path.join(dataDir, f));
    if (!a) continue;
    try {
      const data = extract(a, name);
      if (data) return { data, from: f };
    } finally {
      fs.closeSync(a.fd);
    }
  }
  return null;
}

// A DBC table: { records: [Buffer], strings: Buffer, string(offset) }.
function ReadDBC(buf) {
  if (buf.toString("latin1", 0, 4) !== "WDBC") throw new Error("not a DBC file");
  const count = buf.readUInt32LE(4), fields = buf.readUInt32LE(8), size = buf.readUInt32LE(12), strSize = buf.readUInt32LE(16);
  const records = [];
  for (let i = 0; i < count; i++) records.push(buf.subarray(20 + i * size, 20 + (i + 1) * size));
  const strings = buf.subarray(20 + count * size, 20 + count * size + strSize);
  return { fields, size, records, string: (o) => strings.toString("utf8", o, strings.indexOf(0, o)) };
}

module.exports = { ReadGameFile, ReadDBC };

if (require.main === module) {
  const [dir, name, out] = process.argv.slice(2);
  const r = ReadGameFile(dir, name);
  if (!r) { console.error("not found: " + name); process.exit(1); }
  if (out) fs.writeFileSync(out, r.data);
  console.log(name + " from " + r.from + ", " + r.data.length + " bytes");
}
