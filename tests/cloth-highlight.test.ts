import {describe,it,expect} from 'vitest';
import {isBlueClothHighlight} from '../src/render/cloth-highlight';

describe('source-blue cloth highlights',()=>{
 it.each([[202,226,250],[198,227,252],[203,227,249],[204,230,253],[200,224,251]])
 ('recognises the actual previously omitted walk detail %s,%s,%s',(r,g,b)=>{
  expect(isBlueClothHighlight(r,g,b)).toBe(true);
 });
 it.each([[255,255,255],[239,240,244],[230,228,219],[235,183,125],[145,84,48],[8,9,12],[10,20,31],[230,233,255],[20,29,60]])
 ('preserves neutral accents, skin, ink and weak colour differences %s,%s,%s',(r,g,b)=>{
  expect(isBlueClothHighlight(r,g,b)).toBe(false);
 });
});
