import { describe, expect, it } from 'vitest';
import { inkBounds } from '../src/render/ink-bounds';

describe('lossless sprite paint bounds', () => {
  it('keeps faint edge pixels and a two-pixel transparent filtering gutter', () => {
    const pixels=new Uint8ClampedArray(20*20*4);
    pixels[(7*20+8)*4+3]=1;pixels[(10*20+12)*4+3]=255;
    expect(inkBounds(pixels,20,0,0,20,20)).toEqual({x:6,y:5,width:9,height:8});
  });
  it('ignores neighbouring atlas cells and reports original-cell offsets', () => {
    const pixels=new Uint8ClampedArray(40*20*4);
    pixels[(7*40+28)*4+3]=255;pixels[(0*40+0)*4+3]=255;
    expect(inkBounds(pixels,40,20,0,20,20)).toEqual({x:6,y:5,width:5,height:5});
  });
  it('does not crop opaque boundaries or change empty-frame geometry', () => {
    const pixels=new Uint8ClampedArray(20*20*4);
    expect(inkBounds(pixels,20,0,0,20,20)).toEqual({x:0,y:0,width:20,height:20});
    pixels[3]=255;pixels[(20*20-1)*4+3]=255;
    expect(inkBounds(pixels,20,0,0,20,20)).toEqual({x:0,y:0,width:20,height:20});
  });
});
