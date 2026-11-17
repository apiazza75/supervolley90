import { describe, expect, it } from 'vitest';
import { PixelBudgetCache } from '../src/render/pixel-budget-cache';

describe('sprite pixel memory budget', () => {
  it('retains a full two-team pose working set instead of evicting at 384 entries', () => {
    const cache = new PixelBudgetCache<number>(96 * 1024 * 1024);
    for (let i=0;i<600;i++) cache.set(String(i), i, 120, 200);
    for (let i=0;i<600;i++) expect(cache.get(String(i))).toBe(i);
    expect(cache.size).toBe(600); expect(cache.stats.evictions).toBe(0);
    expect(cache.stats.bytes).toBe(600 * 120 * 200 * 4);
  });

  it('evicts least-recently-used pixels, preserving recently drawn poses', () => {
    const cache = new PixelBudgetCache<string>(32);
    cache.set('a','A',2,2);cache.set('b','B',2,2);
    expect(cache.get('a')).toBe('A');
    cache.set('c','C',2,2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');expect(cache.get('c')).toBe('C');
    expect(cache.stats.bytes).toBe(32);expect(cache.stats.evictions).toBe(1);
  });

  it('accounts for replacement sizes and rejects oversized images without flushing peers', () => {
    const cache = new PixelBudgetCache<string>(32);
    cache.set('a','A',2,2);cache.set('b','B',2,2);
    cache.set('a','smaller',1,1);expect(cache.stats.bytes).toBe(20);
    cache.set('huge','huge',100,100);
    expect(cache.get('a')).toBe('smaller');expect(cache.get('b')).toBe('B');
    expect(cache.get('huge')).toBeUndefined();expect(cache.stats.bytes).toBe(20);
    cache.clear();expect(cache.size).toBe(0);expect(cache.stats.bytes).toBe(0);
  });

  it('never exceeds its bound with differently sized drawings and repeated keys', () => {
    const cache = new PixelBudgetCache<number>(10000);
    for(let i=0;i<2000;i++) {
      cache.set(String(i%71),i,1+i%47,1+i%79);
      expect(cache.stats.bytes).toBeGreaterThanOrEqual(0);
      expect(cache.stats.bytes).toBeLessThanOrEqual(cache.byteLimit);
    }
    expect(cache.stats.peakBytes).toBeLessThanOrEqual(cache.byteLimit);
  });

  it('does not change an evicted drawing still held by a caller', () => {
    const cache = new PixelBudgetCache<{ width:number; height:number }>(4);
    const canvas = { width:1,height:1 };
    cache.set('a',canvas,1,1);cache.set('b',{width:1,height:1},1,1);
    expect(canvas).toEqual({width:1,height:1});
  });

  it('rejects invalid sizes and supports a disabled cache', () => {
    expect(()=>new PixelBudgetCache(-1)).toThrow();
    const cache = new PixelBudgetCache<number>(0);
    expect(()=>cache.set('bad',0,NaN,2)).toThrow();
    cache.set('valid',1,1,1);expect(cache.size).toBe(0);
  });
});
