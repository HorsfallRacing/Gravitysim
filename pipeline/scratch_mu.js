const fs=require('fs');
const COURSE=JSON.parse(fs.readFileSync(__dirname+'/course.harewood.json','utf8'));
const G=9.81,RHO=1.225,STALL_KMH=0.036,V_START=0;
const N=()=>COURSE.length_m;
const GRAD_H=7;
const gradAt=d=>{const i=Math.max(GRAD_H,Math.min(N()-GRAD_H,Math.round(d)));const e=COURSE.stations.ele;return (e[i-GRAD_H]-e[i+GRAD_H])/(2*GRAD_H);};
const HEADINGS=(()=>{const{lat,lon}=COURSE.stations,h=new Float32Array(lat.length);
 for(let i=0;i<lat.length;i++){const a=Math.max(0,i-3),b=Math.min(lat.length-1,i+3);
 const p1=lat[a]*Math.PI/180,p2=lat[b]*Math.PI/180,dl=(lon[b]-lon[a])*Math.PI/180;
 const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
 h[i]=(Math.atan2(y,x)*180/Math.PI+360)%360;}return h;})();
const headingAt=d=>HEADINGS[Math.max(0,Math.min(N(),Math.round(d)))];
const R_MAX=3000;
const radiusAt=d=>{const k=Math.abs(COURSE.stations.kappa[Math.max(0,Math.min(N(),Math.round(d)))]);return k<1/R_MAX?R_MAX:1/k;};
function accelAt(d,v_kmh,p,brakeOn){const v=v_kmh/3.6;const Fg=p.mass*G*gradAt(d);
 const windTo=(p.windDir+180)%360;const tail=(p.windSpeed/3.6)*Math.cos((windTo-headingAt(d))*Math.PI/180);
 const vRel=v-tail;const Fd=0.5*RHO*p.cda*vRel*Math.abs(vRel);const Frr=p.crr*p.mass*G;
 const Fb=brakeOn?(p.brakeConfidence/100)*Math.max(0,p.mu)*G*p.mass:0;
 return (Fg-Fd-Frr-Fb)/p.mass;}
function cornerLimit(d,p){const r=radiusAt(d);const use=p.gripUsage/100;
 const vSlide=Math.sqrt(Math.max(0,p.mu)*use*G*r);
 const aRoll=(p.trackF/2000)/(p.cgHeight/1000)*G;const vRoll=Math.sqrt(Math.max(0,aRoll)*r);
 return Math.min(vSlide,vRoll)*3.6;}
function forwardEnvelope(p){const dt=0.1,dMax=N(),tMax=400;let v=V_START,d=0,t=0,stalledAt=null;
 const ds=[d],vs=[v];
 while(d<dMax&&t<tMax){const a=accelAt(d,v,p,false);let vn=Math.max(0,v+a*dt*3.6);
  const dn=d+((v+vn)/2/3.6)*dt;vn=Math.min(vn,cornerLimit(dn,p));d=dn;v=vn;t+=dt;ds.push(d);vs.push(v);
  if(v<=STALL_KMH){stalledAt=d;break;}}
 return{ds,vs,stalledAt};}
function backwardEnvelope(p){const dt=0.1,dMax=N(),tMax=400;let v=250,d=dMax,t=0;const ds=[d],vs=[v];
 while(d>0&&t<tMax){const a=accelAt(d,v,p,true);let vp=Math.max(0,v-a*dt*3.6);
  const dp=d-((v+vp)/2/3.6)*dt;vp=Math.min(vp,cornerLimit(dp,p),250);d=dp;v=vp;t+=dt;ds.push(d);vs.push(v);}
 ds.reverse();vs.reverse();return{ds,vs};}
function sampleTrace(tr,d){const{ds,vs}=tr;if(d<=ds[0])return vs[0];if(d>=ds[ds.length-1])return vs[vs.length-1];
 let lo=0,hi=ds.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(ds[m]<=d)lo=m;else hi=m;}
 const s=ds[hi]-ds[lo]||1;return vs[lo]+(d-ds[lo])/s*(vs[hi]-vs[lo]);}
function simulate(p){const fin=COURSE.finish_m;const fwd=forwardEnvelope(p),bwd=backwardEnvelope(p);
 const v=[];for(let d=0;d<=N();d++)v.push(Math.min(sampleTrace(fwd,d),sampleTrace(bwd,d)));
 let stall=null;for(let d=1;d<=fin;d++)if(v[d]<=STALL_KMH){stall=d;break;}
 const cum=[0];for(let d=1;d<=N();d++){const va=((v[d-1]+v[d])/2)/3.6;cum.push(cum[d-1]+(va>0.01?1/va:0));}
 return{v,cum,time:stall===null?cum[fin]:null,stall};}
const BASE={mass:125.3,cda:0.1125,crr:0.0048,mu:0.4989,wheelbase:1345,trackF:1060,cgHeight:300,
 gripUsage:100,brakeConfidence:90,windSpeed:0,windDir:225};
const run=mu=>simulate({...BASE,mu});

console.log('=== PORT CHECK ===');
const b=run(0.4989);
console.log('mu=0.4989 -> t =',b.time===null?('STALL @'+b.stall):b.time.toFixed(2),'s');

console.log('\n=== CORNERS (current asset) ===');
const apex={ 'Quarry':18.96,'Farmhouse':47.48,'Croisdale':47.48,'Orchard':37.03,'Willow':53.94,'Country':38.05,'Chippy':29.94 };
const mus=[];
for(const c of COURSE.corners){
  // min radius in corner window, and radius at stored apex
  let rmin=1e9,dmin=null;
  for(let d=c.d0_m;d<=c.d1_m;d++){const r=radiusAt(d);if(r<rmin){rmin=r;dmin=d;}}
  const dap=(c.apex_m!==undefined?c.apex_m:dmin);
  const rap=radiusAt(dap);
  let key=Object.keys(apex).find(k=>c.name.toLowerCase().includes(k.toLowerCase()));
  const va=key?apex[key]:null;
  const muApex=va?Math.pow(va/3.6,2)/(G*rap):null;
  const muMin=va?Math.pow(va/3.6,2)/(G*rmin):null;
  mus.push({name:c.name,d0:c.d0_m,d1:c.d1_m,apex_m:dap,r_apex:rap,r_min:rmin,d_rmin:dmin,v:va,muApex,muMin});
  console.log(c.name.padEnd(22),'d0..d1',String(c.d0_m).padStart(4),String(c.d1_m).padStart(4),
    'apex_m',String(dap).padStart(4),'R_apex',rap.toFixed(1).padStart(7),'R_min',rmin.toFixed(1).padStart(7),
    'v',va===null?'  -  ':va.toFixed(2).padStart(6),
    'mu@apexR',muApex===null?'  -  ':muApex.toFixed(3),'mu@Rmin',muMin===null?'  -  ':muMin.toFixed(3));
}
const vals=mus.filter(m=>m.muApex!==null).map(m=>m.muApex);
const valsMin=mus.filter(m=>m.muMin!==null).map(m=>m.muMin);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const sd=a=>Math.sqrt(mean(a.map(x=>(x-mean(a))**2)));
console.log('\nmu@apexR: n='+vals.length,'min',Math.min(...vals).toFixed(3),'max',Math.max(...vals).toFixed(3),'mean',mean(vals).toFixed(4),'sd',sd(vals).toFixed(4));
console.log('mu@Rmin : n='+valsMin.length,'min',Math.min(...valsMin).toFixed(3),'max',Math.max(...valsMin).toFixed(3),'mean',mean(valsMin).toFixed(4),'sd',sd(valsMin).toFixed(4));

console.log('\n=== TIME vs MU SWEEP ===');
for(const mu of [0.40,0.4989,0.55,0.60,0.65,0.70,0.75,0.80,0.85,0.90,1.00,1.10,1.20]){
  const r=run(mu);console.log('mu',mu.toFixed(4),'-> t',r.time===null?'STALL':r.time.toFixed(2));
}
// bisect for targets
function solve(target){let lo=0.3,hi=3.0;for(let i=0;i<60;i++){const m=(lo+hi)/2;const t=run(m).time;
  if(t===null||t>target)lo=m;else hi=m;}return (lo+hi)/2;}
console.log('\nmu for 87.43 s (slowest run):',solve(87.43).toFixed(4));
console.log('mu for 85.25 s (mean run)   :',solve(85.25).toFixed(4));
console.log('mu for 82.50 s (fastest run):',solve(82.50).toFixed(4));
// how much time is even sensitive to mu?
const inf=run(5.0);console.log('mu=5.0 (grip effectively unlimited) -> t',inf.time===null?'STALL':inf.time.toFixed(2));

console.log('\n=== EXCLUDING QUARRY (acceleration-limited, not grip-limited) ===');
const ex=mus.filter(m=>m.muApex!==null&&!m.name.includes('Quarry')).map(m=>m.muApex);
console.log('n='+ex.length,'min',Math.min(...ex).toFixed(3),'max',Math.max(...ex).toFixed(3),'mean',mean(ex).toFixed(4),'sd',sd(ex).toFixed(4));
console.log('\n=== SIM APEX SPEEDS vs RECORDED, at candidate mu ===');
for(const mu of [0.4989,0.6227,0.6374]){
  const r=run(mu);let s='mu='+mu.toFixed(4)+' t='+r.time.toFixed(2)+'  ';
  for(const m of mus) s+=m.name.split('/')[0].slice(0,8)+':'+r.v[m.apex_m].toFixed(1)+'/'+(m.v?m.v.toFixed(1):'-')+'  ';
  console.log(s);
}
