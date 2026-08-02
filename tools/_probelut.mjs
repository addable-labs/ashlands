import { execSync } from 'node:child_process';
execSync('npx tsc src/render/grade.ts --outDir node_modules/.cache/gradelab --module esnext --target es2022 --moduleResolution bundler --skipLibCheck --removeComments --ignoreConfig', {stdio:'inherit'});
const { buildGradeLUT } = await import(new URL('../node_modules/.cache/gradelab/grade.js', import.meta.url).href);
const N=64, tex=buildGradeLUT(), h=tex.image.data;
const fh=(u)=>{const s=(u&0x8000)?-1:1,e=(u>>10)&0x1f,m=u&0x3ff;if(e===0)return s*m*5.960464477539063e-8;return s*Math.pow(2,e-15)*(1+m/1024);};
const at=(r,g,b)=>(g*(N*N)+b*N+r)*4;
function look(r,g,b){ // nearest node
  const i=at(Math.round(r*63),Math.round(g*63),Math.round(b*63));
  return [fh(h[i]),fh(h[i+1]),fh(h[i+2])];
}
const hsv=(c)=>{const mx=Math.max(...c),mn=Math.min(...c);const ch=mx>1e-6?(mx-mn)/mx:0;let hh=0;const d=mx-mn;
 if(d>1e-7){ if(mx===c[0])hh=((c[1]-c[2])/d)%6; else if(mx===c[1])hh=(c[2]-c[0])/d+2; else hh=(c[0]-c[1])/d+4; hh*=60; if(hh<0)hh+=360;}
 return {chroma:ch,hue:hh};}
const cases=[
 ['deep shadow ash  ', 0.141,0.116,0.092],
 ['shadow ash       ', 0.22,0.185,0.15],
 ['mid ash          ', 0.45,0.40,0.34],
 ['lit ash          ', 0.70,0.64,0.55],
 ['sulphur sky      ', 0.79,0.60,0.36],
 ['ember #ff7a2a    ', 1.00,0.48,0.16],
 ['biolum #3fd6c0   ', 0.25,0.84,0.75],
 ['violet #8f6bff   ', 0.56,0.42,1.00],
 ['verdigris #5f7a63', 0.37,0.48,0.39],
 ['neutral dark     ', 0.12,0.12,0.12],
];
console.log('name                  in(8bit)        out(8bit)     inChroma inHue   outChroma outHue');
for(const [n,r,g,b] of cases){
  const o=look(r,g,b); const a=hsv([r,g,b]), c=hsv(o);
  const q=(v)=>Math.round(v*255).toString().padStart(3);
  console.log(`${n} ${q(r)},${q(g)},${q(b)}  ->  ${q(o[0])},${q(o[1])},${q(o[2])}    ${a.chroma.toFixed(3)}  ${a.hue.toFixed(0).padStart(3)}      ${c.chroma.toFixed(3)}   ${c.hue.toFixed(0).padStart(3)}`);
}
