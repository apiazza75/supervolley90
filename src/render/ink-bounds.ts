export interface InkBounds { x: number; y: number; width: number; height: number }

/** Keep every non-zero alpha pixel plus a filtering gutter. No resampling. */
export function inkBounds(rgba: Uint8ClampedArray, imageWidth: number,
  sx: number, sy: number, width: number, height: number): InkBounds {
  let left=width, top=height, right=-1, bottom=-1;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    if(rgba[((sy+y)*imageWidth+sx+x)*4+3]===0) continue;
    left=Math.min(left,x);right=Math.max(right,x);
    top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<0) return {x:0,y:0,width,height};
  left=Math.max(0,left-2);top=Math.max(0,top-2);
  right=Math.min(width-1,right+2);bottom=Math.min(height-1,bottom+2);
  return {x:left,y:top,width:right-left+1,height:bottom-top+1};
}
