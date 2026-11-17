import {describe,expect,it,vi} from 'vitest';
import {packBinaryMaterialMasks} from '../src/render/material-mask';
import {recolourMaterialPixels,type HslTarget} from '../src/render/material-pixels';
import {compactMaterialMasks,appendIllustratedExtension,type Sheet} from '../src/render/sprites';

describe('lossless binary material-mask packing',()=>{
 it('preserves all sixteen combinations, including material priority ties',()=>{
  const mask=new Uint8ClampedArray(64),hair=mask.slice();
  for(let i=0;i<16;i++){
   for(let c=0;c<3;c++)mask[i*4+c]=i&(1<<c)?255:0;
   hair[i*4]=i&8?255:0;
  }
  expect(packBinaryMaterialMasks(mask,hair)).toEqual(Uint8Array.from({length:16},(_,i)=>i));
 });
 it.each([1,23,24,128,254])('keeps legacy weighted masks intact at weight %s',weight=>{
  for(const channel of [0,1,2,3]){
   const mask=new Uint8ClampedArray(4),hair=mask.slice();
   if(channel===3)hair[0]=weight;else mask[channel]=weight;
   expect(packBinaryMaterialMasks(mask,hair)).toBeUndefined();
  }
 });
 it('rejects mismatched buffers instead of dropping pixels',()=>{
  expect(packBinaryMaterialMasks(new Uint8ClampedArray(4),new Uint8ClampedArray(8))).toBeUndefined();
  expect(packBinaryMaterialMasks(new Uint8ClampedArray(3),new Uint8ClampedArray(3))).toBeUndefined();
 });
 it('reads offset rows, transparent pixels and palette omissions exactly like RGBA masks',()=>{
  const width=9,height=7,packed=Uint8Array.from({length:width*height},(_,i)=>i%16);
  const pixels=Uint8ClampedArray.from({length:4*4*5},(_,i)=>(i*37)%256);
  const mask=new Uint8ClampedArray(pixels.length),hair=mask.slice();
  for(let y=0;y<5;y++)for(let x=0;x<4;x++){
   const bits=packed[(y+1)*width+x+2],o=(y*4+x)*4;
   for(let c=0;c<3;c++)mask[o+c]=bits&(1<<c)?255:0;
   hair[o]=bits&8?255:0;
  }
  const colours:readonly HslTarget[]=[[220,.65,.51],[50,.8,.7],[25,.6,.45],[345,.3,.1]];
  for(let selected=0;selected<16;selected++){
   const targets=colours.map((c,i)=>selected&(1<<i)?c:null);
   const expected=pixels.slice(),actual=pixels.slice();
   recolourMaterialPixels(expected,mask,hair,targets);
   recolourMaterialPixels(actual,packed,undefined,targets,{offset:11,width:4,stride:9});
   expect(actual).toEqual(expected);
  }
 });
});

function sheetFixture(soft=false){
 const m=new Uint8ClampedArray([255,0,0,255,0,0,255,255]);
 if(soft)m[0]=128;
 const h=new Uint8ClampedArray([0,0,0,255,255,0,0,255]);
 const canvas=(data:Uint8ClampedArray)=>({
  width:2,height:1,getContext:vi.fn(()=>({getImageData:vi.fn(()=>({data}))})),
 }) as unknown as HTMLCanvasElement;
 return {canvas:canvas(m),maskCanvas:canvas(m),hairMaskCanvas:canvas(h),frames:[],variants:new Map()} as unknown as Sheet;
}
describe('final-atlas compaction',()=>{
 it('releases ownership of both RGBA masks without modifying caller-owned canvases',()=>{
  const source=sheetFixture(),result=compactMaterialMasks(source);
  expect(result).not.toBe(source);
  expect(result.materialMask).toEqual({width:2,height:1,data:new Uint8Array([1,12])});
  expect(result.maskCanvas).toBeUndefined();expect(result.hairMaskCanvas).toBeUndefined();
  expect(source.maskCanvas?.width).toBe(2);expect(source.hairMaskCanvas?.height).toBe(1);
  expect(result.canvas).toBe(source.canvas);expect(result.frames).toBe(source.frames);
  expect(compactMaterialMasks(result)).toBe(result);
 });
 it('retains soft masks and incompatible atlas dimensions',()=>{
  const soft=sheetFixture(true);expect(compactMaterialMasks(soft)).toBe(soft);
  const wrong=sheetFixture();wrong.hairMaskCanvas!.width=3;
  expect(compactMaterialMasks(wrong)).toBe(wrong);
 });
 it('rejects extension joins after compaction rather than using stale mask coordinates',()=>{
  expect(()=>appendIllustratedExtension(compactMaterialMasks(sheetFixture()),sheetFixture()))
   .toThrow('before material-mask compaction');
 });
});
