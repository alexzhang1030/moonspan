/**
 * Minimal little-endian CDR1 payloads for the ingest baseline.
 *
 * Layout matches `rclweb::cdr` (`CdrWriter::new_default(Little)`): 4-byte
 * encapsulation `00 01 00 00`, then aligned fields. Used so the wasm engine
 * actually emits Sample events instead of decode faults.
 */

const te = new TextEncoder();

class CdrLeWriter {
  private buf: Uint8Array;
  private o = 0;

  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(64, capacity));
    this.buf[1] = 1; // CDR_LE representation
    this.o = 4;
  }

  private ensure(n: number): void {
    if (this.o + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.o + n));
    next.set(this.buf.subarray(0, this.o));
    this.buf = next;
  }

  private align4(): void {
    const pad = (4 - (this.o % 4)) % 4;
    if (!pad) return;
    this.ensure(pad);
    this.o += pad;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.o++] = v & 0xff;
  }

  u32(v: number): void {
    this.align4();
    this.ensure(4);
    this.buf[this.o++] = v & 0xff;
    this.buf[this.o++] = (v >>> 8) & 0xff;
    this.buf[this.o++] = (v >>> 16) & 0xff;
    this.buf[this.o++] = (v >>> 24) & 0xff;
  }

  i32(v: number): void {
    this.u32(v | 0);
  }

  bool(v: boolean): void {
    this.u8(v ? 1 : 0);
  }

  str(s: string): void {
    const bytes = te.encode(s);
    this.u32(bytes.length + 1);
    this.ensure(bytes.length + 1);
    this.buf.set(bytes, this.o);
    this.o += bytes.length;
    this.buf[this.o++] = 0;
  }

  byteSeq(data: Uint8Array): void {
    this.u32(data.length);
    this.ensure(data.length);
    this.buf.set(data, this.o);
    this.o += data.length;
  }

  finish(): Uint8Array {
    return this.buf.subarray(0, this.o);
  }
}

const td = new TextDecoder();

class CdrLeReader {
  constructor(
    private readonly buf: Uint8Array,
    private o = 4,
  ) {
    if (buf.length < 4 || buf[1] !== 1) {
      throw new Error("expected little-endian CDR encapsulation");
    }
  }

  private align4(): void {
    this.o += (4 - (this.o % 4)) % 4;
  }

  u8(): number {
    return this.buf[this.o++]!;
  }

  u32(): number {
    this.align4();
    const v =
      this.buf[this.o]! |
      (this.buf[this.o + 1]! << 8) |
      (this.buf[this.o + 2]! << 16) |
      (this.buf[this.o + 3]! << 24);
    this.o += 4;
    return v >>> 0;
  }

  i32(): number {
    return this.u32() | 0;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  str(): string {
    const n = this.u32();
    if (n === 0) return "";
    const bytes = this.buf.subarray(this.o, this.o + n - 1);
    this.o += n;
    return td.decode(bytes);
  }

  byteSeq(): Uint8Array {
    const n = this.u32();
    const view = this.buf.subarray(this.o, this.o + n);
    this.o += n;
    return view;
  }
}

export function decodeStdMsgsStringCdr(cdr: Uint8Array): string {
  return new CdrLeReader(cdr).str();
}

export type DecodedPointCloud2 = {
  width: number;
  height: number;
  data: Uint8Array;
  fields: Array<{ name: string; offset: number; datatype: number; count: number }>;
};

/** JS CDR decode matching `@foxglove/cdr` aligned `uint8Array` (data is a view). */
export function decodePointCloud2Cdr(cdr: Uint8Array): DecodedPointCloud2 {
  const r = new CdrLeReader(cdr);
  r.i32();
  r.u32();
  r.str();
  const height = r.u32();
  const width = r.u32();
  const fieldCount = r.u32();
  const fields: DecodedPointCloud2["fields"] = [];
  for (let i = 0; i < fieldCount; i++) {
    fields.push({
      name: r.str(),
      offset: r.u32(),
      datatype: r.u8(),
      count: r.u32(),
    });
  }
  r.bool();
  r.u32();
  r.u32();
  const data = r.byteSeq();
  r.bool();
  return { width, height, data, fields };
}

/** `std_msgs/msg/String` CDR for an exact UTF-8 body (plus NUL). */
export function encodeStdMsgsStringCdr(text: string): Uint8Array {
  const w = new CdrLeWriter(16 + text.length);
  w.str(text);
  return w.finish();
}

/**
 * `std_msgs/msg/String` CDR whose total stream length is `targetBytes`
 * (encapsulation + length + body + NUL). Body is ASCII `x`.
 */
export function stdMsgsStringCdrOfSize(targetBytes: number): Uint8Array {
  const overhead = 9; // 4 enc + 4 strlen + 1 NUL
  const n = Math.max(0, targetBytes - overhead);
  return encodeStdMsgsStringCdr("x".repeat(n));
}

/**
 * Synthetic XYZ float32 PointCloud2 (same metadata as
 * `rclweb::cdr::build_synthetic_xyz_cdr`). `fillPoints` writes i*0.01/0.02/0.03;
 * leave it false for the 1 MiB ingest loop (zeros are valid CDR).
 */
export function encodeXyzPointCloud2Cdr(
  pointCount: number,
  fillPoints = true,
): Uint8Array {
  const pointStep = 12;
  const data = new Uint8Array(pointCount * pointStep);
  if (fillPoints) {
    const view = new DataView(data.buffer);
    const sx = Math.fround(0.01);
    const sy = Math.fround(0.02);
    const sz = Math.fround(0.03);
    for (let i = 0; i < pointCount; i++) {
      const fi = Math.fround(i);
      const base = i * 12;
      view.setFloat32(base, Math.fround(fi * sx), true);
      view.setFloat32(base + 4, Math.fround(fi * sy), true);
      view.setFloat32(base + 8, Math.fround(fi * sz), true);
    }
  }
  const w = new CdrLeWriter(256 + data.length);
  w.i32(1);
  w.u32(2);
  w.str("map");
  w.u32(1);
  w.u32(pointCount >>> 0);
  w.u32(3);
  w.str("x");
  w.u32(0);
  w.u8(7);
  w.u32(1);
  w.str("y");
  w.u32(4);
  w.u8(7);
  w.u32(1);
  w.str("z");
  w.u32(8);
  w.u8(7);
  w.u32(1);
  w.bool(false);
  w.u32(pointStep);
  w.u32(pointCount * pointStep);
  w.byteSeq(data);
  w.bool(true);
  return w.finish();
}
