import { useState, useMemo, useCallback } from "react";

// ═══════════════════════════════════════════════════════════
// APEX v5 Trade Log Statistical Laboratory
// Greeks-based options analytics
// ═══════════════════════════════════════════════════════════

const C = {
  bg:"#06070a",bg1:"#0c0e14",bg2:"#12151e",bg3:"#181c28",
  bd:"#1e243a",t0:"#f2f4fa",t1:"#bcc4d8",t2:"#8490ae",t3:"#556080",
  g:"#00ffaa",r:"#ff3860",b:"#4d90ff",y:"#ffc038",p:"#b855ff",cy:"#00d8ff",gold:"#ffd700",
  strats:{vol:"#00ffaa",statarb:"#4d90ff",macro:"#ffc038",exec:"#b855ff"},
  regimes:{BULL:"#00ffaa",TRANS:"#ffc038",CRISIS:"#ff3860"},
};

// === BLACK-SCHOLES HELPERS ===
function normCDF(x){const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911;const s=x<0?-1:1;x=Math.abs(x)/Math.sqrt(2);const t=1/(1+p*x);return .5*(1+s*(1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x)));}
function normPDF(x){return Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);}
function bsD1(S,K,r,sig,T){return(Math.log(S/K)+(r+sig*sig/2)*T)/(sig*Math.sqrt(T||.001));}
function bsGamma(S,K,r,sig,T){if(T<=0)return 0;return normPDF(bsD1(S,K,r,sig,T))/(S*sig*Math.sqrt(T));}
function bsVega(S,K,r,sig,T){if(T<=0)return 0;return S*normPDF(bsD1(S,K,r,sig,T))*Math.sqrt(T)/100;}

// === GREEKS-BASED TRADE LOG GENERATOR ===
function generateLog(seed=42){
  let Sd=seed;
  const rng=()=>{Sd=(Sd*16807)%2147483647;return(Sd-1)/2147483646;};
  const rnorm=()=>{let u=0,v=0;while(!u)u=rng();while(!v)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};

  const regT=[[.988,.010,.002],[.035,.930,.035],[.008,.032,.960]];
  const regNames=["BULL","TRANS","CRISIS"];
  const mkt=[
    {spyMu:.00045,spyVol:.012,ivBase:.15,pairSig:1.0,trendStr:.6},
    {spyMu:.00005,spyVol:.018,ivBase:.22,pairSig:1.8,trendStr:.3},
    {spyMu:-.0008,spyVol:.028,ivBase:.35,pairSig:3.0,trendStr:1.5},
  ];
  const nC=[[1,.10,.05,.02],[.10,1,.08,.06],[.05,.08,1,.01],[.02,.06,.01,1]];
  const cC=[[1,.45,.30,.12],[.45,1,.40,.20],[.30,.40,1,.08],[.12,.20,.08,1]];

  function chol(m){const n=m.length,L=Array.from({length:n},()=>Array(n).fill(0));for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=0;for(let k=0;k<j;k++)s+=L[i][k]*L[j][k];L[i][j]=i===j?Math.sqrt(Math.max(m[i][i]-s,1e-12)):(m[i][j]-s)/L[j][j];}return L;}

  const DAYS=2660;
  const log=[];
  let regime=0,spy=230,equity=100000,peakEq=100000;
  const r_rf=.02;
  const prevSpreads=[0,0,0,0];
  const macroReturns=[];

  for(let t=0;t<DAYS;t++){
    const r=rng();
    regime=r<regT[regime][0]?0:r<regT[regime][0]+regT[regime][1]?1:2;
    const mp=mkt[regime];
    const L=chol(regime===2?cC:nC);
    const z=[rnorm(),rnorm(),rnorm(),rnorm()];
    const eps=L.map(row=>row.reduce((s,v,j)=>s+v*z[j],0));

    const spyRet=mp.spyMu+mp.spyVol*eps[0]*.5;
    spy*=(1+spyRet);
    const iv=mp.ivBase+.02*eps[0];
    const rv=mp.spyVol*Math.sqrt(252);

    const d=new Date(2016,0,4);d.setDate(d.getDate()+Math.floor(t*7/5));
    if(d.getDay()===0)d.setDate(d.getDate()+1);
    if(d.getDay()===6)d.setDate(d.getDate()+2);
    const dateStr=d.toISOString().slice(0,10);

    // === VOL: Short Iron Condor ===
    const T_ic=21/252;
    const shortCallK=spy*1.04,shortPutK=spy*.96;
    const theta_v=.0004*(iv/.18);
    const gamma_ic=bsGamma(spy,shortCallK,r_rf,iv,T_ic)+bsGamma(spy,shortPutK,r_rf,iv,T_ic);
    const gammaPnl_v=-.5*gamma_ic*spy*spy*spyRet*spyRet/spy*.3;
    const vegaChg=(rng()-.5)*.02;
    const vega_ic=bsVega(spy,shortCallK,r_rf,iv,T_ic)*2;
    const vegaPnl_v=-vegaChg*vega_ic*.5/spy;
    const vrpEdge=(iv-rv/100)*.0003;
    const volRet=theta_v+gammaPnl_v+vegaPnl_v+vrpEdge+eps[0]*.0004-.0006;

    // === STATARB: Pairs via Options ===
    const ouKappa=.15,ouSig=mp.pairSig*.001;
    const spreadInnov=-ouKappa*prevSpreads[1]+ouSig*eps[1];
    prevSpreads[1]=spreadInnov;
    const optLev=4.5;
    const thetaCost_sa=.0002*(iv/.18);
    const pairEdge=.00015*(2-regime);
    const saRet=spreadInnov*optLev+pairEdge-thetaCost_sa+eps[1]*.0005-.0008;

    // === MACRO: TSMOM + Tail Hedge ===
    macroReturns.push(eps[2]*.001);
    let trendSig=0;
    if(t>=60){const lb=macroReturns.slice(-60);trendSig=lb.reduce((a,b)=>a+b,0)/lb.length;}
    const tDir=trendSig>0?1:trendSig<-.0001?-1:0;
    const deltaPnl_m=tDir*.30*spyRet*mp.trendStr;
    const T_m=63/252;
    const gamma_m=bsGamma(spy,spy*(tDir>0?1.05:.95),r_rf,iv,T_m);
    const gammaBonus_m=.5*gamma_m*spy*spyRet*spyRet*5/spy;
    const thetaCost_m=.00015*(iv/.18);
    let tailPnl=regime===2&&spyRet<-.01?Math.abs(spyRet)*.5:-.00008;
    const macroRet=deltaPnl_m+gammaBonus_m-thetaCost_m+tailPnl+eps[2]*.0006-.0004;

    // === EXEC: MM + Gamma Scalp ===
    const bidAsk=regime===0?.03:regime===1?.05:.10;
    const spreadCap=bidAsk*50*.5/spy*.001;
    const gammaScalp=(rv-iv*100>0)?.00005:0;
    const flowAlpha=.00003*(1+.5*Math.abs(eps[3]));
    const invPnl=-.00002*Math.abs(eps[3]);
    const execRet=spreadCap+gammaScalp+flowAlpha+invPnl+eps[3]*.0002-.0003;

    const strats=[
      {id:"vol",name:"Options/Vol",ret:volRet,trade:regime===2?"Long put spreads (hedge)":"Short iron condor SPY",
        strikes:`P${shortPutK.toFixed(0)}/C${shortCallK.toFixed(0)}`,dte:21,
        theta:+(theta_v*1e4).toFixed(2),gamma:+(gammaPnl_v*1e4).toFixed(2),
        vega:+(vegaPnl_v*1e4).toFixed(2),vrp:+(vrpEdge*1e4).toFixed(2)},
      {id:"statarb",name:"StatArb",ret:saRet,trade:"Pairs: long calls under + puts over",
        strikes:"ATM±2σ",dte:30,spread:+(spreadInnov*100).toFixed(3),
        ouHL:+(Math.log(2)/ouKappa).toFixed(1),optLev:optLev,thetaCost:+(thetaCost_sa*1e4).toFixed(2)},
      {id:"macro",name:"Macro",ret:macroRet,trade:regime===2?"Long OTM puts + trend":tDir>0?"Long 30Δ calls (3mo)":"Long 30Δ puts (3mo)",
        strikes:tDir>0?`C${(spy*1.05).toFixed(0)}`:`P${(spy*.95).toFixed(0)}`,dte:63,
        delta:+(deltaPnl_m*1e4).toFixed(2),gammaB:+(gammaBonus_m*1e4).toFixed(2),
        tail:+(tailPnl*1e4).toFixed(2),trendSig:+(trendSig*1e4).toFixed(2)},
      {id:"exec",name:"Exec/MM",ret:execRet,trade:"MM: SPY weeklies + gamma scalp",
        strikes:"ATM wkly",dte:5,spreadCap:+(spreadCap*1e4).toFixed(2),
        gammaScalp:+(gammaScalp*1e4).toFixed(2),flow:+(flowAlpha*1e4).toFixed(2)},
    ];

    // Conviction
    strats.forEach((s,i)=>{
      const sigArr=[.00140,.00160,.00180,.00060];
      const fast=s.ret/sigArr[i];
      let conv=1;
      if(Math.abs(fast)>.8)conv=Math.min(1+(Math.abs(fast)-.8)*1.5,3);
      if(regime===0&&fast>.3)conv*=1.15;
      conv=Math.min(conv,3);

      const wts=[.35,.30,.20,.15];
      const lev=14+(regime===0?2:regime===2?-3:0);
      const size=wts[i]*.90*conv;
      const pnl=s.ret*lev*size;
      equity*=(1+pnl);
      if(equity>peakEq)peakEq=equity;
      const dd=(peakEq-equity)/peakEq;

      log.push({
        day:t,date:dateStr,year:d.getFullYear(),month:d.getMonth(),weekday:d.getDay(),
        regime:regNames[regime],regimeIdx:regime,
        strategy:s.name,stratId:s.id,
        trade:s.trade,strikes:s.strikes,dte:s.dte,
        spyPrice:+spy.toFixed(2),iv:+(iv*100).toFixed(1),rv:+rv.toFixed(1),
        leverage:+lev.toFixed(1),conviction:+conv.toFixed(2),
        signalStrength:+Math.abs(fast).toFixed(3),
        direction:s.ret>0?"LONG":"SHORT",
        size:+(size*100).toFixed(2),rawReturn:+s.ret.toFixed(6),
        pnl:+(pnl*100).toFixed(4),
        equity:+equity.toFixed(0),drawdown:+(dd*100).toFixed(2),
        isHighConv:conv>1.3,isDDBuy:dd>.06&&dd<.30,
        // Greeks decomposition (strategy-specific)
        ...(s.id==="vol"?{theta:s.theta,gamma:s.gamma,vega:s.vega,vrp:s.vrp}:{}),
        ...(s.id==="statarb"?{spread:s.spread,ouHL:s.ouHL,optLev:s.optLev,thetaCost:s.thetaCost}:{}),
        ...(s.id==="macro"?{deltaPnl:s.delta,gammaBonus:s.gammaB,tailPnl:s.tail,trendSig:s.trendSig}:{}),
        ...(s.id==="exec"?{spreadCapture:s.spreadCap,gammaScalpPnl:s.gammaScalp,flowAlpha:s.flow}:{}),
      });
    });
  }
  return log;
}

// Stats utilities
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const std=a=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1||1));};
const median=a=>{const s=[...a].sort((a,b)=>a-b);return s.length%2?s[s.length>>1]:(s[(s.length>>1)-1]+s[s.length>>1])/2;};
const sharpe=a=>{const m=mean(a),s=std(a);return s>0?(m*252)/(s*Math.sqrt(252)):0;};
const sortino=a=>{const m=mean(a),ds=a.filter(x=>x<0),d=Math.sqrt(ds.reduce((s,x)=>s+x*x,0)/(ds.length||1));return d>0?(m*252)/(d*Math.sqrt(252)):0;};
function streaks(a){let mw=0,ml=0,c=0;a.forEach(v=>{if(v>0)c=c>0?c+1:1;else c=c<0?c-1:-1;if(c>mw)mw=c;if(c<ml)ml=c;});return{maxWin:mw,maxLoss:Math.abs(ml)};}
function autocorr(a,lag=1){const m=mean(a);let num=0,den=0;for(let i=lag;i<a.length;i++){num+=(a[i]-m)*(a[i-lag]-m);den+=(a[i]-m)**2;}return den>0?num/den:0;}

function MiniBar({value,max,color,width=80}){
  return(<div style={{width,height:12,background:C.bg3,borderRadius:3,overflow:"hidden"}}>
    <div style={{width:`${max>0?Math.min(Math.abs(value)/max,1)*100:0}%`,height:"100%",background:color,opacity:.6,borderRadius:3}}/></div>);
}
function Stat({label,value,sub,color=C.t0}){
  return(<div style={{background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
    <div style={{fontSize:8,color:C.t3,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{label}</div>
    <div style={{fontSize:20,fontWeight:700,fontFamily:"monospace",color}}>{value}</div>
    {sub&&<div style={{fontSize:9,color:C.t2,fontFamily:"monospace",marginTop:2}}>{sub}</div>}
  </div>);
}
function Sec({title,badge,bc}){
  return(<div style={{display:"flex",alignItems:"center",gap:10,margin:"20px 0 10px"}}>
    <span style={{fontSize:9,fontWeight:600,letterSpacing:2,textTransform:"uppercase",color:C.t3}}>{title}</span>
    {badge&&<span style={{fontSize:7,padding:"2px 5px",borderRadius:3,background:`${bc}18`,color:bc,fontFamily:"monospace",fontWeight:600}}>{badge}</span>}
    <div style={{flex:1,height:1,background:C.bd}}/>
  </div>);
}

const fmt=(v,d=2)=>typeof v==="number"?v.toFixed(d):v;
const fmtP=v=>(v*100).toFixed(1)+"%";
const pc=v=>v>=0?C.g:C.r;

export default function TradeLab(){
  const[seed,setSeed]=useState(42);
  const[filter,setFilter]=useState("all");
  const[convF,setConvF]=useState("all");

  const log=useMemo(()=>generateLog(seed),[seed]);

  const dailyPnl=useMemo(()=>{
    const bd={};log.forEach(t=>{if(!bd[t.day])bd[t.day]={day:t.day,pnl:0};bd[t.day].pnl+=t.pnl;});
    return Object.values(bd);
  },[log]);
  const dailyR=useMemo(()=>dailyPnl.map(d=>d.pnl/100),[dailyPnl]);

  const filtered=useMemo(()=>{
    let f=log;
    if(filter!=="all")f=f.filter(t=>filter==="crisis"?t.regimeIdx===2:t.stratId===filter);
    if(convF==="high")f=f.filter(t=>t.isHighConv);
    if(convF==="low")f=f.filter(t=>!t.isHighConv);
    if(convF==="ddbuy")f=f.filter(t=>t.isDDBuy);
    return f;
  },[log,filter,convF]);

  const stats=useMemo(()=>{
    const pnls=filtered.map(t=>t.pnl);
    const wins=pnls.filter(p=>p>0),losses=pnls.filter(p=>p<=0);
    const hc=filtered.filter(t=>t.isHighConv),lc=filtered.filter(t=>!t.isHighConv);

    // By strategy
    const byStrat={};
    filtered.forEach(t=>{
      if(!byStrat[t.stratId])byStrat[t.stratId]={name:t.strategy,pnls:[],convs:[]};
      byStrat[t.stratId].pnls.push(t.pnl);byStrat[t.stratId].convs.push(t.conviction);
    });

    // By regime
    const byRegime={};
    filtered.forEach(t=>{if(!byRegime[t.regime])byRegime[t.regime]={pnls:[],count:0};byRegime[t.regime].pnls.push(t.pnl);byRegime[t.regime].count++;});

    // Conviction buckets
    const convBuckets=[{l:"1.0 (base)",mn:0,mx:1.05},{l:"1.0–1.5",mn:1.05,mx:1.5},{l:"1.5–2.0",mn:1.5,mx:2},{l:"2.0–2.5",mn:2,mx:2.5},{l:"2.5–3.0",mn:2.5,mx:3.1}];
    const byConv=convBuckets.map(b=>{const tr=filtered.filter(t=>t.conviction>=b.mn&&t.conviction<b.mx);return{...b,n:tr.length,pnls:tr.map(t=>t.pnl),wr:tr.length?tr.filter(t=>t.pnl>0).length/tr.length:0};});

    // Greeks decomposition (vol strategy only)
    const volTrades=filtered.filter(t=>t.stratId==="vol");
    const greeksDecomp=volTrades.length?{
      avgTheta:mean(volTrades.map(t=>t.theta||0)),
      avgGamma:mean(volTrades.map(t=>t.gamma||0)),
      avgVega:mean(volTrades.map(t=>t.vega||0)),
      avgVrp:mean(volTrades.map(t=>t.vrp||0)),
      totalTheta:volTrades.reduce((s,t)=>s+(t.theta||0),0),
      totalGamma:volTrades.reduce((s,t)=>s+(t.gamma||0),0),
      totalVega:volTrades.reduce((s,t)=>s+(t.vega||0),0),
      totalVrp:volTrades.reduce((s,t)=>s+(t.vrp||0),0),
    }:null;

    // Macro tail hedge analysis
    const macroTrades=filtered.filter(t=>t.stratId==="macro");
    const tailTrades=macroTrades.filter(t=>(t.tailPnl||0)>1);
    const tailAnalysis=macroTrades.length?{
      totalTailPnl:macroTrades.reduce((s,t)=>s+(t.tailPnl||0),0),
      tailDays:tailTrades.length,
      avgTailPayoff:tailTrades.length?mean(tailTrades.map(t=>t.tailPnl)):0,
      dailyCost:mean(macroTrades.filter(t=>(t.tailPnl||0)<0).map(t=>t.tailPnl||0)),
    }:null;

    // Exec spread analysis
    const execTrades=filtered.filter(t=>t.stratId==="exec");
    const execAnalysis=execTrades.length?{
      avgSpreadCap:mean(execTrades.map(t=>t.spreadCapture||0)),
      avgGammaScalp:mean(execTrades.map(t=>t.gammaScalpPnl||0)),
      avgFlow:mean(execTrades.map(t=>t.flowAlpha||0)),
    }:null;

    // Monthly
    const byMonth=Array.from({length:12},(_,m)=>{const tr=filtered.filter(t=>t.month===m);return{month:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m],pnls:tr.map(t=>t.pnl)};});

    // Weekday
    const byWeekday=Array.from({length:5},(_,d)=>{const tr=filtered.filter(t=>t.weekday===d+1);return{day:["Mon","Tue","Wed","Thu","Fri"][d],pnls:tr.map(t=>t.pnl)};});

    // Edge decay
    const half=Math.floor(filtered.length/2);
    const fH=filtered.slice(0,half).map(t=>t.pnl/100);
    const sH=filtered.slice(half).map(t=>t.pnl/100);

    // IV regime analysis
    const ivBuckets=[{l:"IV<15%",mn:0,mx:15},{l:"15-20%",mn:15,mx:20},{l:"20-30%",mn:20,mx:30},{l:"30%+",mn:30,mx:100}];
    const byIV=ivBuckets.map(b=>{const tr=filtered.filter(t=>t.iv>=b.mn&&t.iv<b.mx);return{...b,n:tr.length,pnls:tr.map(t=>t.pnl),wr:tr.length?tr.filter(t=>t.pnl>0).length/tr.length:0};});

    return{
      total:filtered.length,wins:wins.length,losses:losses.length,
      winRate:pnls.length?wins.length/pnls.length:0,
      avgPnl:mean(pnls),medPnl:median(pnls),
      avgWin:mean(wins),avgLoss:mean(losses),
      profitFactor:losses.length?-mean(wins)*wins.length/(mean(losses)*losses.length):Infinity,
      streaks:streaks(pnls),
      sharpe:sharpe(dailyR),sortino:sortino(dailyR),
      autocorr1:autocorr(dailyR,1),autocorr5:autocorr(dailyR,5),
      skew:pnls.length>2?(pnls.reduce((s,x)=>s+((x-mean(pnls))/std(pnls))**3,0)/pnls.length):0,
      kurtosis:pnls.length>3?(pnls.reduce((s,x)=>s+((x-mean(pnls))/std(pnls))**4,0)/pnls.length)-3:0,
      hcWR:hc.length?hc.filter(t=>t.pnl>0).length/hc.length:0,
      hcAvg:mean(hc.map(t=>t.pnl)),lcAvg:mean(lc.map(t=>t.pnl)),
      byStrat,byRegime,byConv,byMonth,byWeekday,byIV,
      greeksDecomp,tailAnalysis,execAnalysis,
      edgeDecay:{first:sharpe(fH),second:sharpe(sH)},
    };
  },[filtered,dailyR]);

  const exportCSV=useCallback(()=>{
    const h=["date","day","regime","strategy","trade","strikes","dte","spyPrice","iv","rv","leverage","conviction","signalStrength","direction","size","rawReturn","pnl","equity","drawdown","isHighConv","isDDBuy","theta","gamma","vega","vrp","spread","ouHL","optLev","thetaCost","deltaPnl","gammaBonus","tailPnl","trendSig","spreadCapture","gammaScalpPnl","flowAlpha"];
    const rows=log.map(t=>h.map(k=>t[k]!=null?t[k]:""));
    const csv=[h.join(","),...rows.map(r=>r.join(","))].join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`apex_v5_tradelog_seed${seed}.csv`;a.click();URL.revokeObjectURL(url);
  },[log,seed]);

  const th={textAlign:"left",padding:"4px 7px",fontSize:7,textTransform:"uppercase",letterSpacing:1,color:C.t3,borderBottom:`1px solid ${C.bd}`,fontWeight:600};
  const td={padding:"5px 7px",borderBottom:`1px solid ${C.bd}30`,fontFamily:"monospace",fontSize:9};

  return(
    <div style={{background:C.bg,color:C.t0,fontFamily:"'Outfit',system-ui,sans-serif",minHeight:"100vh",padding:"0 0 40px"}}>
      {/* Header */}
      <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.bd}`,background:"rgba(6,7,10,.96)",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(16px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:30,height:30,borderRadius:7,background:`linear-gradient(135deg,${C.g},${C.gold})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:13,color:"#000",fontFamily:"monospace"}}>A</div>
          <div>
            <div style={{fontSize:15,fontWeight:800,letterSpacing:4,background:`linear-gradient(135deg,${C.g},${C.gold})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>APEX v5</div>
            <div style={{fontSize:8,color:C.t3,letterSpacing:2}}>GREEKS-BASED TRADE LOG LAB</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setSeed(Math.floor(Math.random()*2147483646)+1)} style={{padding:"5px 12px",borderRadius:5,fontSize:10,cursor:"pointer",border:`1px solid ${C.bd}`,background:C.bg2,color:C.t2,fontFamily:"inherit"}}>↻ New Seed</button>
          <button onClick={exportCSV} style={{padding:"5px 12px",borderRadius:5,fontSize:10,cursor:"pointer",border:`1px solid ${C.g}`,background:C.g,color:"#000",fontWeight:700,fontFamily:"inherit"}}>⬇ Export CSV ({log.length.toLocaleString()} rows × 35 cols)</button>
        </div>
      </div>

      <div style={{padding:"14px 18px"}}>
        {/* Filters */}
        <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap"}}>
          {[{k:"all",l:"All"},{k:"vol",l:"Vol/Options"},{k:"statarb",l:"StatArb"},{k:"macro",l:"Macro"},{k:"exec",l:"Exec/MM"},{k:"crisis",l:"Crisis"}].map(f=>(
            <button key={f.k} onClick={()=>setFilter(f.k)} style={{padding:"4px 10px",borderRadius:5,fontSize:9,cursor:"pointer",border:`1px solid ${filter===f.k?C.g:C.bd}`,background:filter===f.k?C.g+"15":C.bg2,color:filter===f.k?C.g:C.t2,fontFamily:"inherit"}}>{f.l}</button>
          ))}
          <div style={{width:1,background:C.bd,margin:"0 3px"}}/>
          {[{k:"all",l:"All Conv"},{k:"high",l:"High Conv"},{k:"low",l:"Base"},{k:"ddbuy",l:"DD Buy"}].map(f=>(
            <button key={f.k} onClick={()=>setConvF(f.k)} style={{padding:"4px 10px",borderRadius:5,fontSize:9,cursor:"pointer",border:`1px solid ${convF===f.k?C.cy:C.bd}`,background:convF===f.k?C.cy+"15":C.bg2,color:convF===f.k?C.cy:C.t2,fontFamily:"inherit"}}>{f.l}</button>
          ))}
        </div>

        {/* KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:14}}>
          <Stat label="Trades" value={stats.total.toLocaleString()} sub={`${stats.wins.toLocaleString()}W / ${stats.losses.toLocaleString()}L`}/>
          <Stat label="Win Rate" value={fmtP(stats.winRate)} color={stats.winRate>.52?C.g:C.r} sub={`HiConv: ${fmtP(stats.hcWR)}`}/>
          <Stat label="Sharpe" value={fmt(stats.sharpe)} color={stats.sharpe>3?C.g:C.y} sub={`Sortino: ${fmt(stats.sortino)}`}/>
          <Stat label="Profit Factor" value={fmt(stats.profitFactor)} color={stats.profitFactor>2?C.g:C.y}/>
          <Stat label="Avg P&L (bps)" value={fmt(stats.avgPnl,3)} color={pc(stats.avgPnl)} sub={`Med: ${fmt(stats.medPnl,3)}`}/>
          <Stat label="Streaks" value={`${stats.streaks.maxWin}W/${stats.streaks.maxLoss}L`}/>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
          <Stat label="Skewness" value={fmt(stats.skew)} color={stats.skew>0?C.g:C.r} sub="<0 = left tail"/>
          <Stat label="Kurtosis" value={fmt(stats.kurtosis)} color={stats.kurtosis>3?C.r:C.g} sub=">3 = fat tails"/>
          <Stat label="AC(1d)" value={fmt(stats.autocorr1,3)} color={Math.abs(stats.autocorr1)<.05?C.g:C.y}/>
          <Stat label="AC(5d)" value={fmt(stats.autocorr5,3)} color={Math.abs(stats.autocorr5)<.05?C.g:C.y}/>
          <Stat label="Edge Decay" value={`${fmt(stats.edgeDecay.first)}→${fmt(stats.edgeDecay.second)}`} color={stats.edgeDecay.second>=stats.edgeDecay.first*.8?C.g:C.r} sub="Sharpe 1st→2nd half"/>
        </div>

        {/* === GREEKS DECOMPOSITION (Vol strategy) === */}
        {stats.greeksDecomp&&(filter==="all"||filter==="vol")&&<>
          <Sec title="Options Greeks P&L Decomposition (Vol Strategy)" badge="GREEKS" bc={C.g}/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
            <Stat label="Avg Theta (bps/day)" value={fmt(stats.greeksDecomp.avgTheta,2)} color={C.g} sub={`Total: ${fmt(stats.greeksDecomp.totalTheta,0)}`}/>
            <Stat label="Avg Gamma Cost (bps)" value={fmt(stats.greeksDecomp.avgGamma,2)} color={C.r} sub={`Total: ${fmt(stats.greeksDecomp.totalGamma,0)}`}/>
            <Stat label="Avg Vega P&L (bps)" value={fmt(stats.greeksDecomp.avgVega,2)} color={pc(stats.greeksDecomp.avgVega)} sub={`Total: ${fmt(stats.greeksDecomp.totalVega,0)}`}/>
            <Stat label="Avg VRP Edge (bps)" value={fmt(stats.greeksDecomp.avgVrp,2)} color={C.gold} sub={`Total: ${fmt(stats.greeksDecomp.totalVrp,0)}`}/>
          </div>
          <div style={{background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:8,padding:12,marginBottom:14,fontSize:9,color:C.t2}}>
            <span style={{color:C.gold,fontWeight:600}}>P&L Attribution:</span> Daily Vol P&L = Θ(theta collected) + Γ(gamma cost from moves) + V(vega from IV changes) + VRP(systematic edge). {stats.greeksDecomp.totalTheta>0?"Theta is the primary profit driver — ":""}
            {Math.abs(stats.greeksDecomp.totalGamma)>stats.greeksDecomp.totalTheta?"⚠ Gamma costs exceed theta — short vol is net losing":"Theta > Gamma cost — short vol edge is intact ✓"}
          </div>
        </>}

        {/* === TAIL HEDGE ANALYSIS (Macro) === */}
        {stats.tailAnalysis&&(filter==="all"||filter==="macro")&&<>
          <Sec title="Tail Hedge Analysis (Macro Strategy)" badge="CONVEXITY" bc={C.y}/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
            <Stat label="Tail Payoff Days" value={stats.tailAnalysis.tailDays} color={C.y} sub={`of ${filtered.filter(t=>t.stratId==="macro").length} total`}/>
            <Stat label="Avg Tail Payoff (bps)" value={fmt(stats.tailAnalysis.avgTailPayoff,1)} color={C.g}/>
            <Stat label="Daily Carry Cost (bps)" value={fmt(stats.tailAnalysis.dailyCost,2)} color={C.r}/>
            <Stat label="Total Tail P&L (bps)" value={fmt(stats.tailAnalysis.totalTailPnl,0)} color={pc(stats.tailAnalysis.totalTailPnl)} sub={stats.tailAnalysis.totalTailPnl>0?"Tail hedge profitable ✓":"Net cost of insurance"}/>
          </div>
        </>}

        {/* === EXEC ALPHA DECOMPOSITION === */}
        {stats.execAnalysis&&(filter==="all"||filter==="exec")&&<>
          <Sec title="Execution Alpha Sources (MM Strategy)" badge="MICROSTRUCTURE" bc={C.p}/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
            <Stat label="Avg Spread Capture (bps)" value={fmt(stats.execAnalysis.avgSpreadCap,2)} color={C.g}/>
            <Stat label="Avg Gamma Scalp (bps)" value={fmt(stats.execAnalysis.avgGammaScalp,3)} color={pc(stats.execAnalysis.avgGammaScalp)}/>
            <Stat label="Avg Flow Alpha (bps)" value={fmt(stats.execAnalysis.avgFlow,2)} color={C.g}/>
          </div>
        </>}

        {/* === IV REGIME ANALYSIS === */}
        <Sec title="Performance by IV Regime" badge="VOL SURFACE" bc={C.cy}/>
        <div style={{background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:8,padding:12,marginBottom:14}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr>{["IV Regime","Trades","Win Rate","Avg P&L","Sharpe"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{stats.byIV.map((b,i)=><tr key={i}>
              <td style={{...td,fontFamily:"inherit",fontWeight:600}}>{b.l}</td>
              <td style={td}>{b.n.toLocaleString()}</td>
              <td style={{...td,color:b.wr>.52?C.g:C.r}}>{fmtP(b.wr)}</td>
              <td style={{...td,color:pc(mean(b.pnls))}}>{b.pnls.length?fmt(mean(b.pnls),3):"—"}</td>
              <td style={td}>{b.pnls.length>10?fmt(sharpe(b.pnls.map(p=>p/100))):"—"}</td>
            </tr>)}</tbody>
          </table>
        </div>

        {/* By Strategy */}
        <Sec title="By Strategy" badge="DECOMP" bc={C.b}/>
        <div style={{background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:8,padding:12,marginBottom:14}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr>{["Strategy","Trades","Win Rate","Avg P&L","Total P&L","Sharpe","Avg Conv"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{Object.entries(stats.byStrat).map(([id,s])=><tr key={id}>
              <td style={{...td,color:C.strats[id],fontWeight:600,fontFamily:"inherit"}}>{s.name}</td>
              <td style={td}>{s.pnls.length.toLocaleString()}</td>
              <td style={{...td,color:s.pnls.filter(p=>p>0).length/s.pnls.length>.52?C.g:C.r}}>{fmtP(s.pnls.filter(p=>p>0).length/s.pnls.length)}</td>
              <td style={{...td,color:pc(mean(s.pnls))}}>{fmt(mean(s.pnls),3)}</td>
              <td style={{...td,color:pc(s.pnls.reduce((a,b)=>a+b,0))}}>{fmt(s.pnls.reduce((a,b)=>a+b,0),1)}</td>
              <td style={td}>{fmt(sharpe(s.pnls.map(p=>p/100)))}</td>
              <td style={td}>{fmt(mean(s.convs))}</td>
            </tr>)}</tbody>
          </table>
        </div>

        {/* Conviction */}
        <Sec title="Conviction Analysis" badge="DOES SIZING UP WORK?" bc={C.gold}/>
        <div style={{background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:8,padding:12,marginBottom:14}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr>{["Conv Bucket","Trades","%","Win Rate","Avg P&L","Total P&L",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{stats.byConv.map((b,i)=><tr key={i}>
              <td style={{...td,fontFamily:"inherit",fontWeight:600}}>{b.l}</td>
              <td style={td}>{b.n.toLocaleString()}</td>
              <td style={td}>{stats.total?fmtP(b.n/stats.total):"—"}</td>
              <td style={{...td,color:b.wr>.52?C.g:C.r}}>{fmtP(b.wr)}</td>
              <td style={{...td,color:pc(mean(b.pnls))}}>{b.pnls.length?fmt(mean(b.pnls),3):"—"}</td>
              <td style={{...td,color:pc(b.pnls.reduce((a,x)=>a+x,0))}}>{fmt(b.pnls.reduce((a,x)=>a+x,0),1)}</td>
              <td style={td}><MiniBar value={mean(b.pnls)} max={.02} color={pc(mean(b.pnls))}/></td>
            </tr>)}</tbody>
          </table>
          <div style={{marginTop:8,fontSize:9,color:C.t3}}>
            {stats.hcAvg>stats.lcAvg
              ?<span style={{color:C.g}}>✓ High conviction outperforms base by {fmt((stats.hcAvg-stats.lcAvg)*100,1)}% — conviction scaling adds alpha</span>
              :<span style={{color:C.r}}>⚠ High conviction underperforms — review signal quality</span>}
          </div>
        </div>

        {/* Regime */}
        <Sec title="By Regime" badge="REGIME" bc={C.y}/>
        <div style={{background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:8,padding:12,marginBottom:14}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr>{["Regime","Trades","Win Rate","Avg P&L","Total P&L","Sharpe"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{Object.entries(stats.byRegime).map(([name,r])=><tr key={name}>
              <td style={{...td,color:C.regimes[name],fontWeight:600,fontFamily:"inherit"}}>{name}</td>
              <td style={td}>{r.count.toLocaleString()}</td>
              <td style={{...td,color:r.pnls.filter(p=>p>0).length/r.pnls.length>.52?C.g:C.r}}>{fmtP(r.pnls.filter(p=>p>0).length/r.pnls.length)}</td>
              <td style={{...td,color:pc(mean(r.pnls))}}>{fmt(mean(r.pnls),3)}</td>
              <td style={{...td,color:pc(r.pnls.reduce((a,b)=>a+b,0))}}>{fmt(r.pnls.reduce((a,b)=>a+b,0),1)}</td>
              <td style={td}>{fmt(sharpe(r.pnls.map(p=>p/100)))}</td>
            </tr>)}</tbody>
          </table>
        </div>

        {/* Monthly */}
        <Sec title="Monthly Seasonality" bc={C.p}/>
        <div style={{background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:8,padding:12,marginBottom:14,overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
            <thead><tr><th style={th}>Metric</th>{stats.byMonth.map(m=><th key={m.month} style={{...th,textAlign:"center"}}>{m.month}</th>)}</tr></thead>
            <tbody>
              <tr><td style={{...td,fontFamily:"inherit"}}>Avg P&L</td>
                {stats.byMonth.map((m,i)=>{const v=mean(m.pnls);const mx=Math.max(...stats.byMonth.map(m=>Math.abs(mean(m.pnls))));const int=mx>0?Math.min(Math.abs(v)/mx,1)*.5:0;return<td key={i} style={{textAlign:"center",background:v>=0?`rgba(0,255,170,${int})`:`rgba(255,56,96,${int})`,color:v>=0?C.g:C.r,padding:"3px",borderRadius:2,fontSize:9}}>{fmt(v,3)}</td>;})}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Hi-Conv Deep Dive */}
        <Sec title="High Conviction Deep Dive" badge={`${filtered.filter(t=>t.isHighConv).length} TRADES`} bc={C.gold}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
          <Stat label="Hi-Conv Win Rate" value={fmtP(stats.hcWR)} color={stats.hcWR>.55?C.g:C.r} sub={`Base: ${fmtP(filtered.filter(t=>!t.isHighConv).length?filtered.filter(t=>!t.isHighConv&&t.pnl>0).length/filtered.filter(t=>!t.isHighConv).length:0)}`}/>
          <Stat label="Hi-Conv Avg P&L" value={fmt(stats.hcAvg,3)} color={pc(stats.hcAvg)} sub={`Base: ${fmt(stats.lcAvg,3)}`}/>
          <Stat label="Hi-Conv % of Profit" value={(()=>{const h=filtered.filter(t=>t.isHighConv).reduce((a,t)=>a+t.pnl,0);const tot=filtered.reduce((a,t)=>a+t.pnl,0);return tot>0?fmtP(h/tot):"—";})()} color={C.gold}/>
        </div>

        {/* Export info */}
        <div style={{background:C.bg2,border:`1px solid ${C.bd}`,borderRadius:8,padding:12,fontSize:9,color:C.t3}}>
          <span style={{color:C.gold,fontWeight:600}}>⬇ CSV Export</span> includes {log.length.toLocaleString()} rows × 35 columns with full Greeks decomposition: theta, gamma, vega, VRP (vol strategy), spread/OU half-life (statarb), delta/gamma bonus/tail P&L/trend signal (macro), spread capture/gamma scalp/flow alpha (exec). Seed: <span style={{fontFamily:"monospace"}}>{seed}</span>
        </div>
      </div>
    </div>
  );
}
