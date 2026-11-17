import {afterEach,describe,expect,it,vi} from 'vitest';
import {frameKitCanvas,frameKitTile,kitCanvas,SHEETS,type Sheet} from '../src/render/sprites';

afterEach(()=>vi.unstubAllGlobals());
function fixture(){
 const original=new Uint8ClampedArray([40,80,160,255]);
 const image={data:original.slice()};
 const sourceContext={getImageData:vi.fn(()=>image)};
 const source={width:64,height:64,getContext:vi.fn(()=>sourceContext)};
 const outputContext={drawImage:vi.fn(),getImageData:vi.fn(),putImageData:vi.fn()};
 const output={width:0,height:0,getContext:vi.fn(()=>outputContext)};
 vi.stubGlobal('document',{createElement:vi.fn(()=>output)});
 const sheet:Sheet={canvas:source as unknown as HTMLCanvasElement,frames:[{
  sx:16,sy:20,sw:16,sh:20,footX:8,footY:19,boxTop:1,boxBottom:19,
  inkBounds:{x:2,y:3,width:8,height:12},
 }],nativeBodyHeight:20,layout:SHEETS.idle,kitHue:220,variants:new Map()};
 return {sheet,original,image,sourceContext,outputContext,output};
}
describe('direct sprite-pixel readback',()=>{
 it.each(['tight','frame','sheet'] as const)('colours the %s region without an intermediate canvas copy',kind=>{
  const s=fixture(),palette={primary:'#d05030'};
  const result=kind==='tight'?frameKitTile(s.sheet,0,palette).canvas
   :kind==='frame'?frameKitCanvas(s.sheet,0,palette):kitCanvas(s.sheet,palette);
  expect(result).toBe(s.output);
  expect(s.sourceContext.getImageData).toHaveBeenCalledWith(...(kind==='tight'
   ?[18,23,8,12]:kind==='frame'?[16,20,16,20]:[0,0,64,64]));
  expect(s.outputContext.drawImage).not.toHaveBeenCalled();
  expect(s.outputContext.getImageData).not.toHaveBeenCalled();
  expect(s.outputContext.putImageData).toHaveBeenCalledWith(s.image,0,0);
  expect(s.original).toEqual(new Uint8ClampedArray([40,80,160,255]));
  expect(s.image.data[3]).toBe(255);
 });
 it('reuses the coloured pose on cache hits without reading or copying again',()=>{
  const s=fixture(),palette={primary:'#d05030'};
  const first=frameKitTile(s.sheet,0,palette),second=frameKitTile(s.sheet,0,palette);
  expect(second.canvas).toBe(first.canvas);
  expect(second).toMatchObject({x:2,y:3,width:8,height:12});
  expect(s.sourceContext.getImageData).toHaveBeenCalledTimes(1);
  expect(s.outputContext.putImageData).toHaveBeenCalledTimes(1);
 });
 it('reads packed crop weights without requesting either mask canvas',()=>{
  const s=fixture(),data=new Uint8Array(64*64);data[23*64+18]=1;
  s.sheet.materialMask={data,width:64,height:64};
  const getContext=vi.fn(()=>{throw Error('Unexpected mask readback');});
  s.sheet.maskCanvas=s.sheet.hairMaskCanvas={getContext} as unknown as HTMLCanvasElement;
  frameKitTile(s.sheet,0,{primary:'#d05030'});
  expect(getContext).not.toHaveBeenCalled();
  expect(s.image.data).not.toEqual(s.original);
  expect(s.image.data[3]).toBe(s.original[3]);
 });
});
