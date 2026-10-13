#!/usr/bin/env node
// embed-glb.mjs — nhúng texture ngoài (vd Textures/colormap.png) vào trong file .glb
// để mỗi model tự chứa, nạp được ở bất cứ đâu và đóng gói 1 file được.
// Dùng: node html/tools/embed-glb.mjs vào.glb ra.glb
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';

export function embedGlb(inFile, outFile) {
  const b = readFileSync(inFile);
  if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error('Không phải .glb: ' + inFile);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString());
  let off = 20 + jsonLen;
  let bin = Buffer.alloc(0);
  if (off < b.length) {
    const binLen = b.readUInt32LE(off);
    bin = b.subarray(off + 8, off + 8 + binLen);
  }
  const parts = [bin];
  let size = bin.length;
  const pad4 = () => { const p = (4 - (size % 4)) % 4; if (p) { parts.push(Buffer.alloc(p)); size += p; } };
  json.bufferViews ||= [];
  for (const img of json.images || []) {
    if (!img.uri || img.uri.startsWith('data:')) continue;
    const data = readFileSync(join(dirname(inFile), decodeURIComponent(img.uri)));
    pad4();
    json.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: data.length });
    img.bufferView = json.bufferViews.length - 1;
    img.mimeType = extname(img.uri).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    delete img.uri;
    parts.push(data);
    size += data.length;
  }
  pad4();
  const newBin = Buffer.concat(parts);
  json.buffers ||= [{}];
  json.buffers[0].byteLength = newBin.length;
  let jsonBuf = Buffer.from(JSON.stringify(json));
  const jp = (4 - (jsonBuf.length % 4)) % 4;
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jp, 0x20)]);
  const total = 12 + 8 + jsonBuf.length + 8 + newBin.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.write('JSON', 4, 'ascii');
  const bh = Buffer.alloc(8); bh.writeUInt32LE(newBin.length, 0); bh.write('BIN\0', 4, 'ascii');
  writeFileSync(outFile, Buffer.concat([header, jh, jsonBuf, bh, newBin]));
}

if (process.argv[1] && process.argv[1].endsWith('embed-glb.mjs') && process.argv[2]) {
  embedGlb(process.argv[2], process.argv[3] || process.argv[2]);
  console.log('Đã nhúng:', process.argv[3] || process.argv[2]);
}
