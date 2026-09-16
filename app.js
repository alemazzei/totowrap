import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, setDoc, getDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA2_gerZLEBYXbNipBQjbD1joqoO-gUm_0",
  authDomain: "totowrap-ecfea.firebaseapp.com",
  projectId: "totowrap-ecfea",
  storageBucket: "totowrap-ecfea.firebasestorage.app",
  messagingSenderId: "415033951245",
  appId: "1:415033951245:web:945a6d8dbb91051ba2c144"
};
const firebaseApp=initializeApp(firebaseConfig);
const db=getFirestore(firebaseApp);
const auth=getAuth(firebaseApp);
const STATE_REF=doc(db,"totowrap","state");
const DRAFT_REF=doc(db,"totowrap-private","draft");
const ADMIN_UID="4hgyioeFlcYixjF2DpRAxzVVowL2";

const original = {
  day: 1,
  estimatedTime: "",
  wrapTime: "",
  dayClosed: false,
  betsPublished: false,
  betClosingTime: "",
  players: [],
  history: []
};

const clone = v => JSON.parse(JSON.stringify(v));
let state = clone(original);
let isAdmin=false;
let route = (location.hash || "#today").slice(1);
let accuracyOrder = "best";
let accuracyPlayer = null;
let tablesTab = "standings";
let privateBets={};
let draftDay=null;

const app = document.querySelector("#app");
const qs = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const initials = n => n.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase();
const DAY_SEC=86400;
const toSec = t => { if(!t)return null; const [h=0,m=0,s=0]=t.split(":").map(Number); return h*3600+m*60+s; };
const clock = seconds => {const value=((Math.round(seconds)%DAY_SEC)+DAY_SEC)%DAY_SEC,h=Math.floor(value/3600),m=Math.floor(value%3600/60),s=value%60;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}${s?`:${String(s).padStart(2,"0")}`:""}`};
const diff = t => { const a=toSec(t),b=toSec(state.wrapTime); if(a===null||b===null)return null;const raw=Math.abs(a-b);return Math.round(Math.min(raw,DAY_SEC-raw)/6)/10; };
const chronologicalPlayers = players => [...players].sort((a,b)=>(toSec(a[3])??Infinity)-(toSec(b[3])??Infinity)||a[0].localeCompare(b[0],"it"));
function bettingBands(players=state.players){
  const unique=[...new Set(players.map(p=>p[3]).filter(Boolean))].sort((a,b)=>toSec(a)-toSec(b));
  const bands=new Map();
  if(!unique.length)return bands;
  if(unique.length===1){const c=toSec(unique[0]);bands.set(unique[0],{lower:c-1800,upper:c+1800,center:c});return bands}
  let largestGap=-1,start=0;
  unique.forEach((time,i)=>{const current=toSec(time),next=toSec(unique[(i+1)%unique.length])+(i===unique.length-1?DAY_SEC:0),gap=next-current;if(gap>largestGap){largestGap=gap;start=(i+1)%unique.length}});
  const ordered=[...unique.slice(start),...unique.slice(0,start)];
  const centers=ordered.map((time,i)=>{let value=toSec(time);if(i&&value<=toSec(ordered[0]))value+=DAY_SEC;return value});
  const boundaries=[];
  for(let i=0;i<centers.length-1;i++){const lowerBet=centers[i],higherBet=centers[i+1],midpoint=Math.floor((lowerBet+higherBet)/2);boundaries.push(Math.min(higherBet-1,Math.max(lowerBet+59,midpoint)))}
  ordered.forEach((time,i)=>bands.set(time,{lower:i===0?centers[i]-1800:boundaries[i-1]+1,upper:i===ordered.length-1?centers[i]+1800:boundaries[i],center:centers[i]}));
  return bands;
}
const bandFor = t => bettingBands().get(t);
const inBand = (bet,wrap=state.wrapTime) => {const band=bandFor(bet),raw=toSec(wrap);if(!band||raw===null)return false;let adjusted=raw;while(adjusted<band.center-DAY_SEC/2)adjusted+=DAY_SEC;while(adjusted>band.center+DAY_SEC/2)adjusted-=DAY_SEC;return adjusted>=band.lower&&adjusted<=band.upper};
const pointsFor = t => { if(!t||!state.wrapTime)return 0; if(t.slice(0,5)===state.wrapTime.slice(0,5))return 3; return inBand(t)?1:0; };
const bandLabel = t => {const band=bandFor(t);return band?`${clock(band.lower)}–${clock(band.upper)}`:"—"};
const award = points => points===3?'<span class="award" role="img" aria-label="Vittoria per minuto esatto">🏆</span>':points===1?'<span class="award" role="img" aria-label="Vittoria per fascia oraria">🥇</span>':"";
function expiredBet(t,now=new Date()){
  const band=bandFor(t);if(!band)return false;
  let seconds=now.getHours()*3600+now.getMinutes()*60+now.getSeconds();
  while(seconds<band.center-DAY_SEC/2)seconds+=DAY_SEC;
  while(seconds>band.center+DAY_SEC/2)seconds-=DAY_SEC;
  return seconds>band.upper;
}
const status = t => { if(!t)return ["Nessuna bet","none"];if(!state.wrapTime)return expiredBet(t)?["💀 FUORI","out"]:["IN GIOCO","pending"];const pts=pointsFor(t); if(pts===3)return ["ESATTO · 3 PT","win"]; if(pts===1)return ["FASCIA · 1 PT","close"]; return ["💀 FUORI","out"]; };
function updateLiveBets(){
  document.querySelectorAll(".bet-row[data-bet]").forEach(row=>{const s=status(row.dataset.bet);row.classList.toggle("eliminated",s[1]==="out");const pill=row.querySelector(".pill");pill.className=`pill ${s[1]}`;pill.textContent=s[0]});
}
const fmtAvg = m => `${Math.floor(m)}m${Math.round((m%1)*60).toString().padStart(2,"0")}s`;
const persist = async () => {
  if(!isAdmin)throw new Error("Accesso amministratore richiesto");
  // Firestore non consente array annidati. Salviamo quindi lo stato come JSON:
  // il formato interno dell'app resta invariato e partecipanti/storico funzionano.
  const publicState=clone(state);
  if(!publicState.betsPublished)publicState.players.forEach(p=>p[3]=null);
  await setDoc(STATE_REF,{payload:JSON.stringify(publicState),updatedAt:serverTimestamp()});
};

function liveClock(){
  const el=qs("#liveClock"),date=qs("#liveDate"); if(!el)return;
  const tick=()=>{const d=new Date();el.textContent=new Intl.DateTimeFormat("it-IT",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(d);date.textContent=new Intl.DateTimeFormat("it-IT",{weekday:"long",day:"numeric",month:"long"}).format(d);updateLiveBets()};
  tick(); clearInterval(liveClock.timer); liveClock.timer=setInterval(tick,1000);
}

function todayView(){
  if(!state.betsPublished)return `<section class="view"><div class="hero-grid"><article class="clock-card"><span class="eyebrow">L'orologio di oggi</span><strong class="clock" id="liveClock">--:--:--</strong><span class="date" id="liveDate"></span></article><article class="bet-closing"><span class="eyebrow">Bet closing at</span><strong>${esc(state.betClosingTime||"--:--")}</strong><p>Ready to shoot · Giorno ${state.day}</p></article></div><div class="card awaiting-bets"><h1>Le bet sono ancora riservate</h1><p>Compariranno qui quando l'amministratore cliccherà “Pubblica bet”.</p></div></section>`;
  const withBets=state.players.filter(p=>p[3]);
  return `<section class="view"><div class="hero-grid">
    <article class="clock-card"><span class="eyebrow">L'orologio di oggi</span><strong class="clock" id="liveClock">--:--:--</strong><span class="date" id="liveDate"></span></article>
    <div class="time-cards">
      <article class="time-card estimated-card"><span class="eyebrow">Fine stimata</span><strong>${esc(state.estimatedTime||"--:--")}</strong><p>La previsione di fine giornata</p></article>
      <article class="time-card actual-card"><span class="eyebrow">Wrap effettivo</span><strong>${esc(state.wrapTime||"--:--")}</strong><p>${state.wrapTime?"Orario ufficiale":"Ancora da confermare"}</p></article>
    </div>
  </div><div class="section-head"><div><span class="eyebrow">Giornata ${state.day}</span><h1>${state.dayClosed?"Risultati della giornata":"Le bet di oggi"}</h1></div><span class="count-label">${withBets.length} ${withBets.length===1?"bet inserita":"bet inserite"}</span></div>
  <div class="bet-list"><div class="bet-list-head"><span>Orario</span><span>Partecipante</span><span>Fascia di gioco</span><span>Stato</span></div>
  <ol class="bets">${state.players.length?chronologicalPlayers(state.players).map(p=>{const s=status(p[3]),pts=pointsFor(p[3]);return `<li class="bet-row${p[3]?"":" no-bet"}${pts?" winner":""}${s[1]==="out"?" eliminated":""}" data-bet="${esc(p[3]||"")}"><time class="bet-time">${esc(p[3]||"—")}</time><div class="bet-person"><div class="avatar" aria-hidden="true">${esc(initials(p[0]))}</div><h3>${esc(p[0])} ${award(pts)}</h3></div><div class="bet-range">${p[3]?`<span class="mobile-range-label">Fascia </span>${bandLabel(p[3])}`:"Bet non inserita"}</div><span class="pill ${s[1]}">${s[0]}</span></li>`}).join(""):`<li class="empty">Aggiungi i partecipanti dalle impostazioni.</li>`}</ol></div>
  <p class="bet-footnote">Dall'orario più presto al più tardi. <span>3 punti per il minuto esatto · 1 punto per la fascia.</span></p></section>`;
}

function betOffsetSeconds(bet,wrap){
  if(!bet||!wrap)return null;
  let delta=toSec(bet)-toSec(wrap);
  if(delta>DAY_SEC/2)delta-=DAY_SEC;
  if(delta<-DAY_SEC/2)delta+=DAY_SEC;
  return delta;
}
function wrongBandDistance(item,day){
  if(item.points!==0||!item.bet||!day[3])return null;
  let band=item.bandBounds;
  if(!band&&item.band){
    const [start,end]=item.band.split("–");
    const lower=toSec(start);let upper=toSec(end);
    if(lower!==null&&upper!==null){if(upper<lower)upper+=DAY_SEC;band={lower,upper,center:(lower+upper)/2}}
  }
  if(!band)band=bettingBands((day[6]||[]).filter(p=>p.bet).map(p=>[p.name,0,0,p.bet])).get(item.bet);
  if(!band)return null;
  let wrap=toSec(day[3]);
  while(wrap<band.center-DAY_SEC/2)wrap+=DAY_SEC;
  while(wrap>band.center+DAY_SEC/2)wrap-=DAY_SEC;
  return wrap<band.lower?band.lower-wrap:wrap>band.upper?wrap-band.upper:null;
}
function participantStats(player){
  const days=[...state.history].sort((a,b)=>b[0]-a[0]);
  const records=days.flatMap(day=>(Array.isArray(day[6])?day[6]:[]).filter(item=>item.name===player[0]).map(item=>({item,day})));
  const exact=records.filter(r=>r.item.points===3).length;
  const wrong=records.map(r=>wrongBandDistance(r.item,r.day)).filter(v=>v!==null);
  const forgotten=days.filter(day=>Array.isArray(day[7])&&day[7].includes(player[0])&&!(day[6]||[]).some(item=>item.name===player[0]&&item.bet)).length;
  const previous=days[0],last=previous&&(previous[6]||[]).find(item=>item.name===player[0]);
  const offset=last?betOffsetSeconds(last.bet,previous[3]):null;
  const lastLabel=offset===null?(previous?"Nessuna bet nella giornata precedente":"Nessuna giornata conclusa"):offset===0?"La bet precedente coincideva con il wrap":`La bet del giorno ${previous[0]} era ${Math.floor(Math.abs(offset)/60)} min, ${Math.abs(offset)%60} sec ${offset<0?"prima":"dopo"} il wrap effettivo`;
  const incomplete=days.some(day=>!Array.isArray(day[7]));
  return {exact,forgotten,closest:wrong.length?Math.min(...wrong):null,lastLabel,incomplete};
}
function participantDetails(player){
  const s=participantStats(player);
return `<div class="participant-detail"><p class="last-bet">${esc(s.lastLabel)}</p><div class="participant-metrics"><div><strong>${player[2]}</strong><span>Vittorie totali</span></div><div><strong>${s.exact}</strong><span>Vittorie esatte</span></div><div><strong>${s.forgotten}</strong><span>Bet dimenticate</span></div><div><strong>${s.closest===null?"—":`${s.closest}s`}</strong><span>Closest wrong bet</span></div></div><p class="field-note">Closest wrong bet: secondi dal wrap al confine più vicino della fascia, soltanto per le bet perdenti.${s.incomplete?" Le bet dimenticate sono conteggiate solo nelle giornate con elenco partecipanti registrato; le vecchie assenze non sono ricostruibili.":""}</p></div>`;
}
function tablesView(){
  return `<div class="tables-view"><div class="tables-tabs" role="group" aria-label="Sezioni di Tabelle"><button data-tables-tab="standings" class="${tablesTab==="standings"?"active":""}" aria-pressed="${tablesTab==="standings"}">Classifica</button><button data-tables-tab="accuracy" class="${tablesTab==="accuracy"?"active":""}" aria-pressed="${tablesTab==="accuracy"}">Precisione</button></div>${tablesTab==="accuracy"?accuracyView():standingsView()}</div>`;
}
function standingsView(){
  const sorted=[...state.players].sort((a,b)=>b[1]-a[1]||b[2]-a[2]); const max=Math.max(...sorted.map(p=>p[1]),1);
  if(!sorted.length)return `<section class="view"><div class="section-head"><div><span class="eyebrow">PUNTEGGI TOTALI</span><h1>Classifica generale</h1></div></div><div class="card empty">La classifica apparirà dopo aver aggiunto i partecipanti.</div></section>`;
  return `<section class="view"><div class="section-head"><div><span class="eyebrow">PUNTEGGI TOTALI</span><h1>Classifica generale</h1></div><p>${state.players.length} partecipanti</p></div>
  <div class="podium">${sorted.slice(0,3).map((p,i)=>`<article class="card podium-card"><div><span class="place">${i+1}° POSTO</span><h2>${esc(p[0])}</h2><span class="bet-meta">${p[2]} vittorie</span></div><div class="score">${p[1]} <small>pt</small></div></article>`).join("")}</div>
  <p class="helper">Clicca su un partecipante per aprire le sue statistiche.</p><div class="card rank-list">${sorted.map((p,i)=>`<details class="rank-entry"><summary class="rank-row"><span class="rank-no">${i+1}</span><span class="rank-person"><strong>${esc(p[0])}</strong><span class="bet-meta">${p[2]} ${p[2]===1?"vittoria":"vittorie"}</span></span><span class="rank-bar"><i style="width:${Math.max(3,p[1]/max*100)}%"></i></span><span class="rank-score">${p[1]} pt <span class="rank-chevron" aria-hidden="true">⌄</span></span></summary>${participantDetails(p)}</details>`).join("")}</div></section>`;
}

function accuracyView(){
  const sorted=[...state.players].sort((a,b)=>{if(!a[5]&&!b[5])return a[0].localeCompare(b[0]);if(!a[5])return 1;if(!b[5])return -1;return accuracyOrder==="best"?a[4]-b[4]:b[4]-a[4]});
  if(!state.players.some(p=>p[0]===accuracyPlayer))accuracyPlayer=sorted[0]?.[0]||"";
  if(!sorted.length)return `<section class="view"><div class="section-head"><div><span class="eyebrow">STATISTICHE</span><h1>Precisione media</h1></div></div><div class="card empty">Le statistiche appariranno dopo le prime giornate.</div></section>`;
  return `<section class="view"><div class="section-head"><div><span class="eyebrow">STATISTICHE</span><h1>Precisione media</h1></div><div class="segmented"><button class="${accuracyOrder==="best"?"active":""}" data-order="best">Più precisi</button><button class="${accuracyOrder==="worst"?"active":""}" data-order="worst">Meno precisi</button></div></div>
  ${accuracyChart()}<p class="helper">Seleziona un partecipante per vedere il suo percorso nel grafico.</p><div class="card accuracy-list">${sorted.map((p,i)=>{const winRate=p[5]?Math.round(p[2]/p[5]*100):0;return `<button class="accuracy-row${p[0]===accuracyPlayer?" selected":""}" data-accuracy-name="${esc(p[0])}" aria-pressed="${p[0]===accuracyPlayer}"><span class="rank-no">${i+1}</span><span class="bet-person"><span class="avatar">${esc(initials(p[0]))}</span><strong>${esc(p[0])}</strong></span><span class="accuracy-average"><strong>${p[5]?fmtAvg(p[4]):"—"}</strong><small>Errore medio</small></span><span class="accuracy-wins"><strong>${winRate}% vittorie</strong><small>${p[2]} su ${p[5]} bet</small></span><span aria-hidden="true">↗</span></button>`}).join("")}</div></section>`;
}

function accuracyChart(){
  const seriesByPlayer=new Map();
  [...state.history].sort((a,b)=>a[0]-b[0]).forEach(day=>{
    const details=Array.isArray(day[6])?day[6]:[];
    details.forEach(item=>{
      if(!item?.name||!Number.isFinite(item.errorMin))return;
      if(!seriesByPlayer.has(item.name))seriesByPlayer.set(item.name,[]);
      seriesByPlayer.get(item.name).push({day:day[0],error:item.errorMin,won:item.points>0});
    });
  });
  const points=seriesByPlayer.get(accuracyPlayer)||[];
  if(!points.length)return `<article class="card trend-card"><div class="trend-head"><div><span class="eyebrow">Il percorso di ${esc(accuracyPlayer)}</span><h2>Distanza dal wrap effettivo</h2></div></div><div class="trend-empty">Nessuna giornata conclusa con una bet di questo partecipante. Il grafico si aggiornerà alla chiusura della giornata.</div></article>`;
  const W=820,H=310,L=62,R=24,T=32,B=48,plotW=W-L-R,plotH=H-T-B;
  const maxError=Math.max(1,...points.map(p=>p.error));
  const scaleMax=Math.max(5,Math.ceil(maxError/5)*5);
  const firstDay=1,lastDay=Math.max(1,state.day-1,...state.history.map(h=>Number(h[0])));
  const x=(i)=>firstDay===lastDay?L+plotW/2:L+(points[i].day-firstDay)/(lastDay-firstDay)*plotW;
  const y=(value)=>T+plotH-(value/scaleMax)*plotH;
  const ticks=[0,.25,.5,.75,1].map(ratio=>{const value=scaleMax*ratio,py=y(value);return `<g><line x1="${L}" y1="${py}" x2="${W-R}" y2="${py}" class="chart-grid"/><text x="${L-10}" y="${py+4}" class="chart-label" text-anchor="end">${Math.round(value)}m</text></g>`}).join("");
  const path=points.map((p,i)=>`${i&&p.day===points[i-1].day+1?"L":"M"}${x(i).toFixed(1)} ${y(p.error).toFixed(1)}`).join(" ");
  const dayLabels=Array.from({length:lastDay},(_,i)=>i+1).map(day=>{const px=firstDay===lastDay?L+plotW/2:L+(day-firstDay)/(lastDay-firstDay)*plotW;return `<line x1="${px}" y1="${H-B}" x2="${px}" y2="${H-B+5}" class="chart-axis"/><text x="${px}" y="${H-20}" class="chart-label" text-anchor="middle">G${day}</text>`}).join("");
const markers=points.map((p,i)=>`<g><title>Giorno ${p.day}: ${fmtAvg(p.error)} dal wrap${p.won?" · vittoria":""}</title>${p.won?`<circle cx="${x(i)}" cy="${y(p.error)}" r="18" fill="white" stroke="#d64557"/><image href="gu3-logo.png" x="${x(i)-15}" y="${y(p.error)-15}" width="30" height="30" preserveAspectRatio="xMidYMid meet"/>`:`<circle cx="${x(i)}" cy="${y(p.error)}" r="5" class="chart-point"/>`}</g>`).join("");
return `<article class="card trend-card"><div class="trend-head"><div><span class="eyebrow">Il percorso di ${esc(accuracyPlayer)}</span><h2>Distanza dal wrap effettivo</h2></div></div><div class="chart-wrap"><svg class="trend-chart" style="min-width:${Math.max(620,lastDay*45)}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento della precisione di ${esc(accuracyPlayer)}"><line x1="${L}" y1="${T}" x2="${L}" y2="${H-B}" class="chart-axis"/><line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" class="chart-axis"/>${ticks}<path d="${path}" class="chart-line"/>${markers}${dayLabels}<text x="18" y="${T+plotH/2}" class="chart-title-y" text-anchor="middle" transform="rotate(-90 18 ${T+plotH/2})">Distanza dal wrap (minuti)</text><text x="${L+plotW/2}" y="${H-2}" class="chart-title-x" text-anchor="middle">Giornate</text></svg></div><div class="chart-legend"><span><i></i>${esc(accuracyPlayer)}</span><span><img src="gu3-logo.png" alt="" width="32" height="32">Minuto o fascia indovinati</span><small>Più vicino allo zero = più preciso. Giorni senza bet: vuoti e esclusi dalla media.</small></div></article>`;
}

function historyView(){
 return `<section class="view"><div class="section-head"><div><span class="eyebrow">Archivio TotoWrap</span><h1>Storico giornate</h1></div><p>Apri una giornata per vedere tutte le bet</p></div><div class="history-list">${state.history.map(h=>{
   const details=Array.isArray(h[6])?h[6]:[],winners=details.filter(item=>item.points>0);
   const winnerMarkup=winners.length?winners.map(item=>`<span class="historical-winner">${esc(item.name)} ${award(item.points)}<small>Bet ${esc(item.bet)} · +${item.points} pt</small></span>`).join(""):h[4]>0?String(h[1]).split(" · ").map(name=>`<span class="historical-winner">${esc(name)} ${award(h[4])}<small>Bet ${esc(h[2])}</small></span>`).join(""):"Nessun vincitore";
   const roster=Array.isArray(h[7])?h[7]:details.map(item=>item.name);
   const rows=[...details,...roster.filter(name=>!details.some(item=>item.name===name)).map(name=>({name,bet:null,points:0}))].sort((a,b)=>(toSec(a.bet)??Infinity)-(toSec(b.bet)??Infinity)||a.name.localeCompare(b.name,"it"));
   return `<article class="card history-row"><button class="history-summary" aria-expanded="false"><span class="history-day">TotoWrap<br>Giorno ${esc(h[0])}</span><span class="history-winner">${winnerMarkup}</span><span class="history-official"><small>Wrap effettivo</small><strong>${esc(h[3])}</strong></span><span>⌄</span></button><div class="history-detail"><div class="history-meta"><span>Fine stimata <strong>${esc(h[5]||"—")}</strong></span><span>Wrap effettivo <strong>${esc(h[3])}</strong></span></div><h3>Tutte le bet della giornata</h3><ol class="history-bets">${rows.length?rows.map(item=>`<li class="history-bet${item.points>0?" winner":""}"><time>${esc(item.bet||"—")}</time><span class="history-bet-person">${esc(item.name)} ${award(item.points)}</span><span class="history-band">${esc(item.band||"")}</span><span class="pill ${!item.bet?"none":item.points===3?"win":item.points===1?"close":"out"}">${!item.bet?"Bet dimenticata":item.points===3?"ESATTO · 3 PT":item.points===1?"FASCIA · 1 PT":"💀 FUORI"}</span></li>`).join(""):`<li class="empty">Le altre bet non sono disponibili per questa vecchia giornata.</li>`}</ol></div></article>`;
 }).join("")||`<div class="card empty">Non ci sono ancora giornate concluse.</div>`}</div></section>`;
}

function render(){
  if(route==="standings"||route==="accuracy"){tablesTab=route;route="tables"}
  const allowed=["today","tables","history"]; if(!allowed.includes(route))route="today";
  qs("#dayNumber").textContent=state.day;
  document.querySelectorAll("[data-route]").forEach(b=>b.classList.toggle("active",b.dataset.route===route));
  app.innerHTML=({today:todayView,tables:tablesView,history:historyView})[route]();
  if(route==="today")liveClock();
  window.scrollTo({top:0,behavior:"smooth"});
}

document.addEventListener("click",e=>{
  const tab=e.target.closest("[data-tables-tab]");if(tab){tablesTab=tab.dataset.tablesTab;route="tables";render()}
  const nav=e.target.closest("[data-route]"); if(nav){route=nav.dataset.route;location.hash=route;render()}
  const order=e.target.closest("[data-order]"); if(order){accuracyOrder=order.dataset.order;render()}
  const person=e.target.closest("[data-accuracy-name]");if(person){accuracyPlayer=person.dataset.accuracyName;render()}
  const row=e.target.closest(".history-summary"); if(row){const parent=row.closest(".history-row");parent.classList.toggle("open");row.setAttribute("aria-expanded",parent.classList.contains("open"))}
});
document.addEventListener("change",e=>{const select=e.target.closest("[data-accuracy-player]");if(select){accuracyPlayer=select.value;render()}});
window.addEventListener("hashchange",()=>{route=(location.hash||"#today").slice(1);render()});

const dialog=qs("#adminDialog"),betsForm=qs("#betsForm"),dayForm=qs("#dayForm"),playerInput=qs("#playerInput"),loginDialog=qs("#loginDialog"),loginForm=qs("#loginForm");
function setAdminTab(tab){
  document.querySelectorAll("[data-admin-tab]").forEach(button=>button.classList.toggle("active",button.dataset.adminTab===tab));
  document.querySelectorAll("[data-admin-page]").forEach(page=>page.classList.toggle("active",page.dataset.adminPage===tab));
}
function refreshPlayers(selected=0){
  qs("#saveBets").textContent=state.betsPublished?"Salva modifiche alle bet pubblicate":"Salva bet private";
  qs("#publishBets").hidden=state.betsPublished;
  playerInput.innerHTML=state.players.length?state.players.map((p,i)=>`<option value="${i}">${esc(p[0])}</option>`).join(""):`<option value="">Nessun partecipante</option>`;
  playerInput.value=state.players.length?String(Math.min(selected,state.players.length-1)):"";
  qs("#bulkBets").innerHTML=state.players.length?state.players.map((p,i)=>`<label class="bulk-bet-row"><span>${esc(p[0])}</span><input type="time" step="1" value="${(state.betsPublished?p[3]:draftDay===state.day?privateBets[p[0]]:null)||""}" data-bet-index="${i}" aria-label="Bet di ${esc(p[0])}"></label>`).join(""):`<div class="bulk-empty">Aggiungi prima i partecipanti.</div>`;
}
async function mutateAndSave(mutator,success){const before=clone(state);mutator();try{await persist();render();toast(success);return true}catch(error){state=before;render();console.error(error);toast("Salvataggio non riuscito: riprova");return false}}
async function openAdminSettings(){
  if(!isAdmin)return;
  qs("#estimatedTimeInput").value=state.estimatedTime;qs("#wrapTimeInput").value=state.wrapTime;qs("#betClosingTimeInput").value=state.betClosingTime;
  if(!state.betsPublished){
    try{const snapshot=await getDoc(DRAFT_REF),draft=snapshot.exists()?snapshot.data():null;privateBets=draft?.day===state.day?draft.bets||{}:{};draftDay=state.day}
    catch(error){console.error(error);return toast("Bet private non accessibili: aggiorna prima le regole Firebase")}
  }
  refreshPlayers();setAdminTab("bets");dialog.showModal();
}
function enteredBets(){return [...document.querySelectorAll("[data-bet-index]")].map(input=>({index:+input.dataset.betIndex,time:input.value||null}))}
async function savePrivateBets(){
  if(!isAdmin||state.dayClosed||state.betsPublished)return false;
  const day=state.day,bets=Object.fromEntries(enteredBets().map(item=>[state.players[item.index][0],item.time]));
  try{await setDoc(DRAFT_REF,{day,bets,updatedAt:serverTimestamp()});if(day!==state.day)return false;privateBets=bets;draftDay=day;return true}
  catch(error){console.error(error);toast("Salvataggio privato non riuscito: controlla le regole Firebase");return false}
}
qs("#publishBets").addEventListener("click",async()=>{
  if(!isAdmin||state.dayClosed||state.betsPublished)return;
  if(!state.betClosingTime)return toast("Imposta prima l'orario Bet closing at");
  if(!enteredBets().some(item=>item.time))return toast("Inserisci almeno una bet");
  if(!confirm("Pubblicare tutte le bet e rendere visibili gli orari a tutti?"))return;
  const button=qs("#publishBets");button.disabled=true;
  try{if(!await savePrivateBets())return;if(await mutateAndSave(()=>{state.players.forEach(p=>p[3]=privateBets[p[0]]||null);state.betsPublished=true},"Bet pubblicate per tutti"))dialog.close()}finally{button.disabled=false}
});
qs("#openAdmin").addEventListener("click",()=>{if(!isAdmin){loginDialog.showModal();return}openAdminSettings()});
qs("#closeAdmin").addEventListener("click",()=>dialog.close());
document.querySelectorAll("[data-admin-tab]").forEach(button=>button.addEventListener("click",()=>setAdminTab(button.dataset.adminTab)));
betsForm.addEventListener("submit",async e=>{e.preventDefault();if(state.dayClosed)return toast("Giornata chiusa: avvia prima il giorno successivo");if(!state.betsPublished){if(await savePrivateBets()){toast("Bet salvate in privato");dialog.close()}return}const bets=[...document.querySelectorAll("[data-bet-index]")].map(input=>({index:+input.dataset.betIndex,time:input.value||null}));if(await mutateAndSave(()=>bets.forEach(item=>{if(state.players[item.index])state.players[item.index][3]=item.time}),"Tutte le bet sono state salvate"))dialog.close()});
dayForm.addEventListener("submit",async e=>{e.preventDefault();if(state.dayClosed)return toast("Giornata chiusa: avvia prima il giorno successivo");const estimated=qs("#estimatedTimeInput").value,closing=qs("#betClosingTimeInput").value;if(await mutateAndSave(()=>{state.estimatedTime=estimated;state.betClosingTime=closing},"Orari della giornata salvati"))dialog.close()});
qs("#addPlayer").addEventListener("click",async()=>{if(state.dayClosed)return toast("Giornata chiusa: avvia prima il giorno successivo");const input=qs("#newPlayerInput"),name=input.value.trim();if(!name)return toast("Inserisci un nome");if(state.players.some(p=>p[0].toLowerCase()===name.toLowerCase()))return toast("Partecipante già presente");if(await mutateAndSave(()=>state.players.push([name,0,0,null,0,0]),`${name} aggiunto`)){input.value="";refreshPlayers(state.players.length-1)}});
qs("#removePlayer").addEventListener("click",async()=>{if(state.dayClosed)return toast("Giornata chiusa: avvia prima il giorno successivo");if(playerInput.value==="")return;const idx=+playerInput.value,name=state.players[idx][0];if(!confirm(`Rimuovere ${name}?`))return;if(await mutateAndSave(()=>state.players.splice(idx,1),`${name} rimosso`))refreshPlayers(Math.max(0,idx-1))});
async function closeDayAt(wrap,successMessage){
  if(!state.betsPublished)return toast("Pubblica le bet prima di chiudere la giornata");
  if(state.dayClosed)return toast("Giornata già chiusa: avvia il giorno successivo");
  const estimated=qs("#estimatedTimeInput").value;
  const bets=[...document.querySelectorAll("[data-bet-index]")].map(input=>({index:+input.dataset.betIndex,time:input.value||null}));
  if(!bets.some(item=>item.time))return toast("Inserisci almeno una bet");
  if(!wrap)return toast("Inserisci il wrap effettivo");
  const saved=await mutateAndSave(()=>{
    state.estimatedTime=estimated;
    state.wrapTime=wrap;
    bets.forEach(item=>{if(state.players[item.index])state.players[item.index][3]=item.time});
    const scorers=[],dayDetails=[];
    state.players.forEach(p=>{
      if(!p[3])return;
      const pts=pointsFor(p[3]),distance=diff(p[3]);
      dayDetails.push({name:p[0],bet:p[3],errorMin:distance,points:pts,band:bandLabel(p[3]),bandBounds:bandFor(p[3])});
      p[1]+=pts;
      if(pts>0){p[2]+=1;scorers.push([p[0],p[3],pts])}
      p[4]=((p[4]*p[5])+distance)/(p[5]+1);
      p[5]+=1;
    });
    const best=Math.max(0,...scorers.map(s=>s[2])),winners=scorers.filter(s=>s[2]===best);
    state.history.unshift([state.day,winners.length?winners.map(w=>w[0]).join(" · "):"Nessun vincitore",winners.length?winners.map(w=>w[1]).join(" · "):"—",wrap,best,estimated,dayDetails,state.players.map(p=>p[0])]);
    state.dayClosed=true;
  },successMessage);
  if(saved){dialog.close();route="today";location.hash=route;render()}
}
qs("#wrapNow").addEventListener("click",async()=>{
  const now=new Date();
  const exact=[now.getHours(),now.getMinutes(),now.getSeconds()].map(value=>String(value).padStart(2,"0")).join(":");
  qs("#wrapTimeInput").value=exact;
  await closeDayAt(exact,`Wrap ${exact}: punti assegnati`);
});
qs("#finalizeDay").addEventListener("click",()=>closeDayAt(qs("#wrapTimeInput").value,"Punti assegnati e giornata chiusa"));
qs("#advanceDay").addEventListener("click",async()=>{const nextDay=state.day+1;if(!confirm(state.dayClosed?`Avviare il giorno ${nextDay}? I risultati del giorno ${state.day} resteranno nello storico.`:`Passare al giorno ${nextDay} senza assegnare punti? Le bet e gli orari della giornata ${state.day} verranno cancellati.`))return;const saved=await mutateAndSave(()=>{state.day=nextDay;state.betsPublished=false;state.betClosingTime="";privateBets={};draftDay=null;state.dayClosed=false;state.estimatedTime="";state.wrapTime="";state.players.forEach(p=>p[3]=null)},`Giorno ${nextDay} avviato`);if(saved){dialog.close();route="today";location.hash=route;render()}});
qs("#resetDemo").addEventListener("click",async()=>{if(!confirm("Azzerare partecipanti, classifica, precisione e storico?"))return;try{await deleteDoc(DRAFT_REF)}catch(error){return toast("Reset non riuscito: controlla le regole Firebase")}privateBets={};draftDay=null;if(await mutateAndSave(()=>state=clone(original),"TotoWrap azzerato: si riparte dal giorno 1"))dialog.close()});
loginForm.addEventListener("submit",async e=>{e.preventDefault();const button=loginForm.querySelector("button[type=submit]");button.disabled=true;button.textContent="Accesso…";try{const credential=await signInWithEmailAndPassword(auth,qs("#loginEmail").value.trim(),qs("#loginPassword").value);if(credential.user.uid!==ADMIN_UID){await signOut(auth);throw new Error("Utente non autorizzato")}qs("#loginPassword").value="";loginDialog.close();await openAdminSettings();toast("Accesso amministratore effettuato")}catch(error){console.error(error);toast("Email o password non corretti")}finally{button.disabled=false;button.textContent="Accedi"}});
qs("#closeLogin").addEventListener("click",()=>loginDialog.close());
qs("#signOutBtn").addEventListener("click",async()=>{dialog.close();await signOut(auth);toast("Accesso amministratore terminato")});
function toast(text){const t=qs("#toast");t.textContent=text;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200)}

onAuthStateChanged(auth,user=>{isAdmin=user?.uid===ADMIN_UID;qs("#openAdmin").classList.toggle("admin-on",isAdmin);qs("#openAdmin").title=isAdmin?"Gestione amministratore":"Accesso amministratore";if(!isAdmin){privateBets={};draftDay=null}if(user&&!isAdmin)signOut(auth)});
onSnapshot(STATE_REF,snapshot=>{
  qs("#loadingScreen").hidden=true;
  if(!snapshot.exists())return;
  const stored=snapshot.data();
  let remote=stored;
  if(typeof stored.payload==="string"){
    try{remote=JSON.parse(stored.payload)}
    catch(error){console.error(error);toast("Dati del database non validi");return}
  }
  state={...clone(original),...remote,betsPublished:typeof remote.betsPublished==="boolean"?remote.betsPublished:(remote.players||[]).some(p=>p[3])||!!remote.dayClosed,players:Array.isArray(remote.players)?remote.players:[],history:Array.isArray(remote.history)?remote.history:[]};
  render();
},error=>{console.error(error);toast("Database temporaneamente non disponibile")});

if(document.modelContext?.registerTool){
  document.modelContext.registerTool({name:"open_totowrap_section",title:"Apri sezione TotoWrap",description:"Apre una sezione del sito tra today, standings, accuracy e history.",inputSchema:{type:"object",properties:{section:{type:"string",enum:["today","standings","accuracy","history"]}},required:["section"],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:({section})=>{route=section;location.hash=section;render();return{section}}});
}
render();
