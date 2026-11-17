import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendIllustratedExtension, SHEETS, type Sheet } from '../src/render/sprites';

afterEach(()=>vi.unstubAllGlobals());

function sheet(count: number, height: number): Sheet {
 const canvas=()=>({width:count===24?1536:1024,height}) as HTMLCanvasElement;
 return { canvas:canvas(),maskCanvas:canvas(),hairMaskCanvas:canvas(),
  layout:SHEETS.approach,kitHue:220,nativeBodyHeight:219,variants:new Map(),
  frames:Array.from({length:count},(_,i)=>({sx:(i%6)*256,sy:Math.floor(i/6)*256,
   sw:256,sh:256,footX:128,footY:235,boxTop:10,boxBottom:235})),
 };
}

describe('read-friendly extended manga atlases',()=>{
 it('retains CPU-read backing for drawings and both material masks across repeated joins',()=>{
  const created:any[]=[];
  vi.stubGlobal('document',{createElement:vi.fn(()=>{
   const ctx={drawImage:vi.fn()},canvas={width:0,height:0,getContext:vi.fn(()=>ctx),ctx};
   created.push(canvas);return canvas;
  })});
  const main=sheet(24,1024),first=sheet(4,256),second=sheet(4,256);
  const before=JSON.stringify(main.frames);
  const joined=appendIllustratedExtension(main,first),result=appendIllustratedExtension(joined,second);
  expect(created).toHaveLength(6);
  for(const canvas of created){
   expect(canvas.getContext).toHaveBeenCalledTimes(1);
   expect(canvas.getContext).toHaveBeenCalledWith('2d',{willReadFrequently:true});
  }
  expect(result.frames).toHaveLength(32);
  expect(result.nativeBodyHeight).toBe(main.nativeBodyHeight);
  expect(result.canvas.width).toBe(1536);expect(result.canvas.height).toBe(1536);
  expect(result.frames.slice(0,24)).toEqual(main.frames);
  expect(result.frames[24].sy).toBe(1024);expect(result.frames[28].sy).toBe(1280);
  expect(created[0].ctx.drawImage.mock.calls).toEqual([[main.canvas,0,0],[first.canvas,0,1024]]);
  expect(created[1].ctx.drawImage.mock.calls).toEqual([[main.maskCanvas,0,0],[first.maskCanvas,0,1024]]);
  expect(created[2].ctx.drawImage.mock.calls).toEqual([[main.hairMaskCanvas,0,0],[first.hairMaskCanvas,0,1024]]);
  expect(JSON.stringify(main.frames)).toBe(before);
 });
 it('keeps the two-drawing running extension supported without altering indices',()=>{
  vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}})})});
  const main=sheet(24,1024),result=appendIllustratedExtension(main,sheet(2,256));
  expect(result.frames).toHaveLength(26);expect(result.frames.slice(0,24)).toEqual(main.frames);
 });
 it('rejects incompatible art before creating a joined surface',()=>{
  const createElement=vi.fn();vi.stubGlobal('document',{createElement});
  const main=sheet(24,1024),wrong=sheet(4,256);wrong.nativeBodyHeight=220;
  expect(()=>appendIllustratedExtension(main,wrong)).toThrow('Invalid illustrated extension registration');
  expect(createElement).not.toHaveBeenCalled();
 });
});
