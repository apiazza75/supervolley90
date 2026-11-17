/** LRU bounded by retained RGBA pixels, not an arbitrary number of poses.
 * Browser/GPU overhead is additional; this bounds the backing pixel payload.
 * Eviction drops ownership without mutating a canvas a caller may still draw.
 */
export class PixelBudgetCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  readonly stats = { bytes: 0, peakBytes: 0, hits: 0, evictions: 0 };

  constructor(readonly byteLimit: number) {
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 0) throw new Error('Invalid pixel cache budget');
  }

  get size(): number { return this.entries.size; }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }

  set(key: string, value: T, width: number, height: number): void {
    const bytes = width * height * 4;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
      || !Number.isSafeInteger(bytes)) throw new Error('Invalid cached image dimensions');
    const previous = this.entries.get(key);
    if (previous) { this.stats.bytes -= previous.bytes; this.entries.delete(key); }
    // An oversized image may still be drawn by its caller, but cannot flush
    // the entire working set and then violate the memory bound itself.
    if (bytes > this.byteLimit) return;
    while (this.stats.bytes + bytes > this.byteLimit) {
      const oldest = this.entries.keys().next().value!;
      this.stats.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest); this.stats.evictions++;
    }
    this.entries.set(key, { value, bytes });
    this.stats.bytes += bytes;
    this.stats.peakBytes = Math.max(this.stats.peakBytes, this.stats.bytes);
  }

  clear(): void { this.entries.clear(); this.stats.bytes = 0; }
}
