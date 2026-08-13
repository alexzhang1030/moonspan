/**
 * Host-side inbound buffer strategies (ADR 0004).
 *
 * - `transferable-arraybuffer`: take ownership of each WebSocket ArrayBuffer
 *   (general deployment path).
 * - `shared-arraybuffer-ring`: bounded SharedArrayBuffer ring for
 *   cross-origin-isolated fast path. Evidence-gated: browsers need COOP/COEP;
 *   Bun can construct SAB without isolation for reproducible measurement.
 */

export type BufferStrategyName =
  | "transferable-arraybuffer"
  | "shared-arraybuffer-ring";

export type BufferStrategyStats = {
  strategy: BufferStrategyName;
  framesWritten: number;
  bytesWritten: number;
  framesDrained: number;
  bytesDrained: number;
  /** Controllable host-side payload copies performed by this strategy. */
  hostCopies: number;
  dropCount: number;
  sabAvailable: boolean;
  isolationRequired: boolean;
  isolationPresent: boolean | null;
};

export type IngestFrame = {
  bytes: Uint8Array;
};

export interface BufferStrategy {
  readonly name: BufferStrategyName;
  write(frame: Uint8Array): boolean;
  drain(): Uint8Array[];
  stats(): BufferStrategyStats;
}

/** Transferable ArrayBuffer path: retain each frame as a standalone Uint8Array. */
export class TransferableArrayBufferStrategy implements BufferStrategy {
  readonly name = "transferable-arraybuffer" as const;
  #pending: Uint8Array[] = [];
  #framesWritten = 0;
  #bytesWritten = 0;
  #framesDrained = 0;
  #bytesDrained = 0;
  #hostCopies = 0;

  write(frame: Uint8Array): boolean {
    // Ownership take: copy into a fresh buffer so the WS/SAB producer can reuse.
    const owned = new Uint8Array(frame.byteLength);
    owned.set(frame);
    this.#hostCopies += 1;
    this.#pending.push(owned);
    this.#framesWritten += 1;
    this.#bytesWritten += owned.byteLength;
    return true;
  }

  drain(): Uint8Array[] {
    const out = this.#pending;
    this.#pending = [];
    for (const frame of out) {
      this.#framesDrained += 1;
      this.#bytesDrained += frame.byteLength;
    }
    return out;
  }

  stats(): BufferStrategyStats {
    return {
      strategy: this.name,
      framesWritten: this.#framesWritten,
      bytesWritten: this.#bytesWritten,
      framesDrained: this.#framesDrained,
      bytesDrained: this.#bytesDrained,
      hostCopies: this.#hostCopies,
      dropCount: 0,
      sabAvailable: typeof SharedArrayBuffer !== "undefined",
      isolationRequired: false,
      isolationPresent: null,
    };
  }
}

const RING_HEADER_BYTES = 16; // writeCursor:u32, readCursor:u32, dropCount:u32, reserved:u32

/**
 * Bounded SharedArrayBuffer ring.
 *
 * Layout: `[header 16 bytes][payload slots…]`. Each record is
 * `len:u32 + bytes[len]`, packed tightly. A full ring drops the new frame
 * (best-effort host queue) and increments `dropCount`.
 *
 * Production browsers need `crossOriginIsolated` (COOP/COEP). Measurement
 * environments that can construct SAB without isolation still exercise the
 * ring logic; the evidence record marks the gate.
 */
export class SharedArrayBufferRingStrategy implements BufferStrategy {
  readonly name = "shared-arraybuffer-ring" as const;
  #sab: SharedArrayBuffer;
  #view: Uint8Array;
  #capacity: number;
  #framesWritten = 0;
  #bytesWritten = 0;
  #framesDrained = 0;
  #bytesDrained = 0;
  #hostCopies = 0;
  #sabAvailable: boolean;
  #isolationPresent: boolean | null;

  constructor(capacityBytes = 4 * 1024 * 1024) {
    this.#sabAvailable = typeof SharedArrayBuffer !== "undefined";
    this.#isolationPresent =
      typeof globalThis.crossOriginIsolated === "boolean"
        ? globalThis.crossOriginIsolated
        : null;
    if (!this.#sabAvailable) {
      throw new Error(
        "SharedArrayBuffer unavailable (needs cross-origin isolation in browsers)",
      );
    }
    this.#capacity = Math.max(capacityBytes, 256 * 1024);
    this.#sab = new SharedArrayBuffer(RING_HEADER_BYTES + this.#capacity);
    this.#view = new Uint8Array(this.#sab);
    this.#setWrite(0);
    this.#setRead(0);
    this.#setDrops(0);
  }

  get sharedBuffer(): SharedArrayBuffer {
    return this.#sab;
  }

  write(frame: Uint8Array): boolean {
    const need = 4 + frame.byteLength;
    if (need > this.#capacity) {
      this.#setDrops(this.#drops() + 1);
      return false;
    }
    const write = this.#write();
    const read = this.#read();
    const used = write >= read ? write - read : this.#capacity - read + write;
    // Leave one byte free so write==read always means empty.
    const free = this.#capacity - used - 1;
    if (need > free) {
      this.#setDrops(this.#drops() + 1);
      return false;
    }
    // Controllable copy into the shared ring.
    this.#writeU32AtPayload(write, frame.byteLength);
    this.#copyIntoRing((write + 4) % this.#capacity, frame);
    this.#setWrite((write + need) % this.#capacity);
    this.#hostCopies += 1;
    this.#framesWritten += 1;
    this.#bytesWritten += frame.byteLength;
    return true;
  }

  drain(): Uint8Array[] {
    const out: Uint8Array[] = [];
    while (this.#read() !== this.#write()) {
      const read = this.#read();
      const len = this.#readU32AtPayload(read);
      const bytes = new Uint8Array(len);
      this.#copyFromRing((read + 4) % this.#capacity, bytes);
      // Drain copies out of the ring for poll ingest (still one engine retain).
      this.#hostCopies += 1;
      this.#setRead((read + 4 + len) % this.#capacity);
      out.push(bytes);
      this.#framesDrained += 1;
      this.#bytesDrained += len;
    }
    return out;
  }

  stats(): BufferStrategyStats {
    return {
      strategy: this.name,
      framesWritten: this.#framesWritten,
      bytesWritten: this.#bytesWritten,
      framesDrained: this.#framesDrained,
      bytesDrained: this.#bytesDrained,
      hostCopies: this.#hostCopies,
      dropCount: this.#drops(),
      sabAvailable: this.#sabAvailable,
      isolationRequired: true,
      isolationPresent: this.#isolationPresent,
    };
  }

  #write(): number {
    return this.#view[0]! | (this.#view[1]! << 8) | (this.#view[2]! << 16) | (this.#view[3]! << 24);
  }
  #read(): number {
    return this.#view[4]! | (this.#view[5]! << 8) | (this.#view[6]! << 16) | (this.#view[7]! << 24);
  }
  #drops(): number {
    return (
      this.#view[8]! |
      (this.#view[9]! << 8) |
      (this.#view[10]! << 16) |
      (this.#view[11]! << 24)
    ) >>> 0;
  }
  #setWrite(v: number): void {
    this.#view[0] = v & 0xff;
    this.#view[1] = (v >>> 8) & 0xff;
    this.#view[2] = (v >>> 16) & 0xff;
    this.#view[3] = (v >>> 24) & 0xff;
  }
  #setRead(v: number): void {
    this.#view[4] = v & 0xff;
    this.#view[5] = (v >>> 8) & 0xff;
    this.#view[6] = (v >>> 16) & 0xff;
    this.#view[7] = (v >>> 24) & 0xff;
  }
  #setDrops(v: number): void {
    this.#view[8] = v & 0xff;
    this.#view[9] = (v >>> 8) & 0xff;
    this.#view[10] = (v >>> 16) & 0xff;
    this.#view[11] = (v >>> 24) & 0xff;
  }

  #writeU32AtPayload(payloadOffset: number, value: number): void {
    const base = RING_HEADER_BYTES;
    for (let i = 0; i < 4; i++) {
      const idx = base + ((payloadOffset + i) % this.#capacity);
      this.#view[idx] = (value >>> (8 * i)) & 0xff;
    }
  }

  #readU32AtPayload(payloadOffset: number): number {
    const base = RING_HEADER_BYTES;
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const idx = base + ((payloadOffset + i) % this.#capacity);
      value |= (this.#view[idx]! << (8 * i));
    }
    return value >>> 0;
  }

  #copyIntoRing(payloadOffset: number, src: Uint8Array): void {
    const base = RING_HEADER_BYTES;
    for (let i = 0; i < src.length; i++) {
      this.#view[base + ((payloadOffset + i) % this.#capacity)] = src[i]!;
    }
  }

  #copyFromRing(payloadOffset: number, dst: Uint8Array): void {
    const base = RING_HEADER_BYTES;
    for (let i = 0; i < dst.length; i++) {
      dst[i] = this.#view[base + ((payloadOffset + i) % this.#capacity)]!;
    }
  }
}

export function createBufferStrategy(
  name: BufferStrategyName,
  options?: { ringCapacityBytes?: number },
): BufferStrategy {
  switch (name) {
    case "transferable-arraybuffer":
      return new TransferableArrayBufferStrategy();
    case "shared-arraybuffer-ring":
      return new SharedArrayBufferRingStrategy(options?.ringCapacityBytes);
  }
}

/** True when this environment can construct SharedArrayBuffer at all. */
export function sharedArrayBufferConstructible(): boolean {
  try {
    // eslint-disable-next-line no-new
    new SharedArrayBuffer(8);
    return true;
  } catch {
    return false;
  }
}
