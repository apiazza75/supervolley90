/** Actual illustrated order during arm withdrawal. Original key timings stay
 * at legacy phase 16.5 (17), 17.5 (18), 18.5 (19), 19.5 (20).
 * Four new drawings subdivide the two large overhead-to-forehead gaps. */
export const BLOCK_DESCENT_FRAMES = [17,32,18,33,34,35,19,20] as const;
export const BLOCK_AIR_FRAMES = [...Array.from({length:10},(_,i)=>i+7), ...BLOCK_DESCENT_FRAMES] as const;
export function blockDescentFrame(phase: number): number {
 if(phase<17)return 17;
 if(phase<17.5)return 32;
 if(phase<17.75)return 18;
 if(phase<18)return 33;
 if(phase<18.25)return 34;
 if(phase<18.5)return 35;
 if(phase<19.5)return 19;
 return 20;
}
