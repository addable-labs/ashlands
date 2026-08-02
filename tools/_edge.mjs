import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';
// Mean luma each side of a shadow terminator, in the SAME screen region of two
// captures of the same vantage. Lit side / shadow side / ratio in stops.
const [a,b,x,y,w,h] = process.argv.slice(2);
const box=[+x,+y,+w,+h];
for (const f of [a,b]) {
  const p=PNG.sync.read(readFileSync(f)); const d=p.data;
  const v=[];
  for(let j=box[1];j<box[1]+box[3];j++)for(let i=box[0];i<box[0]+box[2];i++){
    const k=(j*p.width+i)*4; v.push(0.2126*d[k]+0.7152*d[k+1]+0.0722*d[k+2]);
  }
  v.sort((m,n)=>m-n);
  const lo=v.slice(0,Math.floor(v.length*0.25)), hi=v.slice(Math.floor(v.length*0.75));
  const mean=(z)=>z.reduce((s,t)=>s+t,0)/z.length;
  const lin=(u)=>{const c=u/255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  const s=mean(lo), l=mean(hi);
  console.log(`${f.padEnd(34)} shadow ${s.toFixed(1).padStart(6)}  lit ${l.toFixed(1).padStart(6)}  step ${Math.log2(lin(l)/Math.max(lin(s),1e-5)).toFixed(2)} stops`);
}
