import { crc32 } from 'node:zlib';

export const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');

export function demoPng(truth: unknown) {
  const contents = Buffer.from('tEXtappealhero:truth\0' + JSON.stringify(truth), 'latin1');
  const chunk = Buffer.alloc(contents.length + 8);
  chunk.writeUInt32BE(contents.length - 4);
  contents.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(contents), chunk.length - 4);
  return Buffer.concat([pixel.subarray(0, -12), chunk, pixel.subarray(-12)]);
}
