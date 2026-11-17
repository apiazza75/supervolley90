"""Pack individually illustrated alternating approach steps; no synthesized pixels."""
import argparse
from pathlib import Path
from PIL import Image
from import_set_gather import import_gather
from import_single_pose_redraws import register_single
from import_gait_keyframes import extract_grid_figures
from import_generated_sprites import chroma_key

def keys(source_dir, base):
    first = import_gather(Image.open(source_dir / 'approach-step-keys-v2.png'), 1,
        [[0,0,384,512],[350,0,734,512],[744,0,1128,512],[1152,0,1536,512]])
    result = [first.crop((i*512,0,(i+1)*512,512)) for i in range(4)]
    for name in ['approach-penultimate-v1.png','approach-closing-v1.png']:
        result.append(register_single(Image.open(source_dir/name).crop((260,30,1220,970)), .48))
    original = Image.open(base).convert('RGBA')
    result.extend(original.crop((f%6*512,f//6*512,f%6*512+512,f//6*512+512)) for f in [14,15])
    return result

def between(path, scale, cols, rows):
    figures=extract_grid_figures(chroma_key(Image.open(path),cols=cols,rows=rows),cols,rows)
    result=[]
    for figure in figures:
        padded=Image.new('RGBA',(figure.width+16,figure.height+16))
        padded.paste(figure,(8,8))
        result.append(register_single(padded,scale))
    return result

def pack(cells,cols):
    if not cells or len(cells)%cols: raise ValueError('Incomplete drawing grid')
    out=Image.new('RGBA',(cols*512,len(cells)//cols*512))
    for i,cell in enumerate(cells):
        if cell.size!=(512,512) or cell.mode!='RGBA': raise ValueError('Invalid registered drawing')
        out.paste(cell,(i%cols*512,i//cols*512))
    return out

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-dir',type=Path,required=True);p.add_argument('--base',type=Path,required=True)
    p.add_argument('--out-dir',type=Path,required=True)
    p.add_argument('--pairs',action='store_true')
    args=p.parse_args();args.out_dir.mkdir(parents=True,exist_ok=True)
    main=keys(args.source_dir,args.base)
    pack(main,4).save(args.out_dir/'approach-keys.png',optimize=True)
    if args.pairs:
        scales=[.8,.8,.88,.78,.70,.69,.69]
        groups=[between(args.source_dir/f'approach-step-pair-{i}-v1.png',scale,2 if i<4 else 4,2 if i<4 else 1)
                for i,scale in enumerate(scales)]
        cells=[]
        for key,group in zip(main,groups): cells.extend([key,*group])
        cells.append(main[-1])
        for i in range(9):pack(cells[i*4:i*4+4],4).save(args.out_dir/f'approach-steps-{i+1}.png',optimize=True)
        pack(cells,6).save(args.out_dir/'approach-steps-review.png',optimize=True)
