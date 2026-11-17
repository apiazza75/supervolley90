import { describe, expect, it } from 'vitest';
import { recolourMaterialPixels, type HslTarget } from '../src/render/material-pixels';

/** Frozen pre-optimization scalar/array formula: independent equivalence oracle. */
function reference(d: Uint8ClampedArray, md: Uint8ClampedArray, hd: Uint8ClampedArray | undefined, targets: readonly HslTarget[]) {
  const rgbToHsl = (r: number, g: number, b: number) => {
    const R=r/255,G=g/255,B=b/255,max=Math.max(R,G,B),min=Math.min(R,G,B),l=(max+min)/2,delta=max-min;
    return [0,delta<1e-6?0:l>.5?delta/(2-max-min):delta/(max+min),l];
  };
  const hslToRgb = (h:number,s:number,l:number) => {
    if(s<1e-6){const v=Math.round(l*255);return [v,v,v];}
    const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
    const f=(t:number)=>{let u=t;if(u<0)u+=1;if(u>1)u-=1;if(u<1/6)return p+(q-p)*6*u;if(u<1/2)return q;if(u<2/3)return p+(q-p)*(2/3-u)*6;return p;};
    const hh=h/360;return [Math.round(f(hh+1/3)*255),Math.round(f(hh)*255),Math.round(f(hh-1/3)*255)];
  };
  for(let i=0;i<d.length/4;i++){
    if(d[i*4+3]<24)continue;
    const weights=[md[i*4],md[i*4+1],md[i*4+2],hd?.[i*4]??0];let channel=-1,weight=0;
    for(let c=0;c<4;c++)if(targets[c]&&weights[c]>weight){channel=c;weight=weights[c];}
    if(channel<0||weight<24)continue;
    const target=targets[channel]!;
    const [,sourceS,sourceL]=rgbToHsl(d[i*4],d[i*4+1],d[i*4+2]);
    const l=Math.max(.025,Math.min(.975,target[2]+(sourceL-[.31,.7,.55,.16][channel])*[.9,.62,.7,.5][channel]));
    const s=Math.max(target[1]*.82,sourceS*.42),[r,g,b]=hslToRgb(target[0],Math.min(1,s),l),mix=weight/255;
    d[i*4]=Math.round(d[i*4]*(1-mix)+r*mix);d[i*4+1]=Math.round(d[i*4+1]*(1-mix)+g*mix);d[i*4+2]=Math.round(d[i*4+2]*(1-mix)+b*mix);
  }
}

describe('allocation-free material recolouring', () => {
  it.each([false,true])('matches every byte of the prior formula with hair mask=%s', withHair => {
    let state=12345;const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state>>>24;};
    const source=Uint8ClampedArray.from({length:40000},next),mask=Uint8ClampedArray.from(source,next),hair=withHair?Uint8ClampedArray.from(source,next):undefined;
    for(const targets of [
      [[220,.65,.51],[50,.8,.7],[25,.6,.45],[345,.3,.1]],
      [[0,0,.5],null,null,null],
      [null,[360,.9,.1],null,[120,.9,.8]],
      [null,null,null,null],
    ] as readonly (readonly HslTarget[])[]){
      const expected=source.slice(),actual=source.slice();reference(expected,mask,hair,targets);recolourMaterialPixels(actual,mask,hair,targets);
      expect(actual).toEqual(expected);
      for(let i=3;i<actual.length;i+=4)expect(actual[i]).toBe(source[i]);
    }
  });
  it('preserves mask ties, alpha/weight thresholds, grey and black/white pixels', () => {
    const rows=[];
    for(const v of [0,1,127,128,254,255])for(const alpha of [0,23,24,255])for(const weight of [0,23,24,255])rows.push(v,v,v,alpha,weight);
    const source=new Uint8ClampedArray(rows.length/5*4),mask=source.slice(),hair=source.slice();
    for(let i=0;i<rows.length/5;i++){source.set(rows.slice(i*5,i*5+4),i*4);mask.fill(rows[i*5+4],i*4,i*4+4);hair.fill(rows[i*5+4],i*4,i*4+4);}
    for(const targets of [[[0,0,0],[120,1,.5],[240,1,1],[60,1,.5]],[null,[120,1,.5],[240,1,1],[60,1,.5]]] as readonly (readonly HslTarget[])[]){
      const expected=source.slice(),actual=source.slice();reference(expected,mask,hair,targets);recolourMaterialPixels(actual,mask,hair,targets);expect(actual).toEqual(expected);
    }
  });
});
