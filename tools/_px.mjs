import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
const f = process.argv[2];
const png = PNG.sync.read(readFileSync(f));
const patch = (x0,y0,w,h,label)=>{let r=0,g=0,b=0,n=0;
 for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){const i=(y*png.width+x)*4;r+=png.data[i];g+=png.data[i+1];b+=png.data[i+2];n++;}
 console.log(label.padEnd(16), [r/n,g/n,b/n].map(v=>Math.round(v)).join(','), 'lum', Math.round(0.2126*r/n+0.7152*g/n+0.0722*b/n));};
patch(1040,700,60,80,'forearm');
patch(1030,540,50,50,'hand');
patch(400,600,120,80,'rock');
patch(700,700,120,80,'ground');
patch(1250,300,120,80,'far ground');
