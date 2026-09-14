const original = {
  day: 1,
  wrapTime: "",
  players: [],
  history: []
};

const clone = v => JSON.parse(JSON.stringify(v));
const STORAGE_KEY="totowrap-state-v2";
let state = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || clone(original); } catch { return clone(original); } })();
let route = (location.hash || "#today").slice(1);
let accuracyOrder = "best";

const app = document.querySelector("#app");
const qs = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const initials = n => n.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase();
const DAY_SEC=86400;
const toSec = t => { if(!t)return null; const [h=0,m=0,s=0]=t.split(":").map(Number); return h*3600+m*60+s; };
const clock = seconds => {const value=((Math.round(seconds)%DAY_SEC)+DAY_SEC)%DAY_SEC,h=Math.floor(value/3600),m=Math.floor(value%3600/60),s=value%60;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}${s?`:${String(s).padStart(2,"0")}`:""}`};
const diff = t => { const a=toSec(t),b=toSec(state.wrapTime); if(a===null||b===null)return null;const raw=Math.abs(a-b);return Math.round(Math.min(raw,DAY_SEC-raw)/6)/10; };
function bettingBands(){
  const unique=[...new Set(state.players.map(p=>p[3]).filter(Boolean))].sort((a,b)=>toSec(a)-toSec(b));
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
const status = t => { const pts=pointsFor(t); if(!t)return ["Nessuna bet","none"]; if(pts===3)return ["ESATTO · 3 PT","win"]; if(pts===1)return ["FASCIA · 1 PT","close"]; return ["FUORI","out"]; };
const fmtAvg = m => `${Math.floor(m)}m${Math.round((m%1)*60).toString().padStart(2,"0")}s`;
const persist = () => localStorage.setItem(STORAGE_KEY,JSON.stringify(state));

function liveClock(){
  const el=qs("#liveClock"),date=qs("#liveDate"); if(!el)return;
  const tick=()=>{const d=new Date();el.textContent=new Intl.DateTimeFormat("it-IT",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(d);date.textContent=new Intl.DateTimeFormat("it-IT",{weekday:"long",day:"numeric",month:"long"}).format(d)};
  tick(); clearInterval(liveClock.timer); liveClock.timer=setInterval(tick,1000);
}

function todayView(){
  const withBets=state.players.filter(p=>p[3]);
  return `<section class="view"><div class="hero-grid">
    <article class="card clock-card"><span class="eyebrow">ORA UFFICIALE LIVE</span><strong class="clock" id="liveClock">--:--:--</strong><span class="date" id="liveDate"></span></article>
    <article class="card target-card"><div><span class="eyebrow">FINE EFFETTIVA</span><h2>Wrap del giorno</h2><p>${withBets.length} bet inserite</p><div class="rules"><div class="rule"><strong>3 punti</strong><span>minuto esatto</span></div><div class="rule"><strong>1 punto</strong><span>fascia automatica</span></div></div></div><div class="target-ring"><strong>${esc(state.wrapTime||"--:--:--")}</strong></div></article>
  </div><div class="section-head"><div><span class="eyebrow">GIORNATA ${state.day}</span><h1>Le bet di oggi</h1></div><p>Ordinate dalla più vicina al wrap</p></div>
  <div class="bets">${state.players.length?[...state.players].sort((a,b)=>(diff(a[3])??9999)-(diff(b[3])??9999)).map(p=>{const s=status(p[3]);return `<article class="card bet-card"><div class="avatar">${initials(p[0])}</div><div><h3>${esc(p[0])}</h3><div class="bet-meta">${p[3]?`Fascia ${bandLabel(p[3])}`:"Non ha giocato"}</div></div><div><div class="bet-time">${p[3]||"—"}</div><span class="pill ${s[1]}">${s[0]}</span></div></article>`}).join(""):`<div class="card empty">Aggiungi i partecipanti dal pulsante Gestione.</div>`}</div></section>`;
}

function standingsView(){
  const sorted=[...state.players].sort((a,b)=>b[1]-a[1]||b[2]-a[2]); const max=Math.max(...sorted.map(p=>p[1]),1);
  if(!sorted.length)return `<section class="view"><div class="section-head"><div><span class="eyebrow">PUNTEGGI TOTALI</span><h1>Classifica generale</h1></div></div><div class="card empty">La classifica apparirà dopo aver aggiunto i partecipanti.</div></section>`;
  return `<section class="view"><div class="section-head"><div><span class="eyebrow">PUNTEGGI TOTALI</span><h1>Classifica generale</h1></div><p>${state.players.length} partecipanti</p></div>
  <div class="podium">${sorted.slice(0,3).map((p,i)=>`<article class="card podium-card"><div><span class="place">${i+1}° POSTO</span><h2>${esc(p[0])}</h2><span class="bet-meta">${p[2]} vittorie</span></div><div class="score">${p[1]} <small>pt</small></div></article>`).join("")}</div>
  <div class="card rank-list">${sorted.map((p,i)=>`<div class="rank-row"><div class="rank-no">${i+1}</div><div><h3>${esc(p[0])}</h3><div class="bet-meta">${p[2]} ${p[2]===1?"vittoria":"vittorie"}</div></div><div class="rank-bar"><i style="width:${Math.max(3,p[1]/max*100)}%"></i></div><div class="rank-score">${p[1]} pt</div></div>`).join("")}</div></section>`;
}

function accuracyView(){
  const sorted=[...state.players].sort((a,b)=>{if(!a[5]&&!b[5])return a[0].localeCompare(b[0]);if(!a[5])return 1;if(!b[5])return -1;return accuracyOrder==="best"?a[4]-b[4]:b[4]-a[4]}); const max=Math.max(1,...sorted.map(p=>p[4]));
  if(!sorted.length)return `<section class="view"><div class="section-head"><div><span class="eyebrow">STATISTICHE</span><h1>Precisione media</h1></div></div><div class="card empty">Le statistiche appariranno dopo le prime giornate.</div></section>`;
  return `<section class="view"><div class="section-head"><div><span class="eyebrow">STATISTICHE</span><h1>Precisione media</h1></div><div class="segmented"><button class="${accuracyOrder==="best"?"active":""}" data-order="best">Più precisi</button><button class="${accuracyOrder==="worst"?"active":""}" data-order="worst">Meno precisi</button></div></div>
  <div class="accuracy-grid">${sorted.map((p,i)=>`<article class="card accuracy-card"><div class="accuracy-top"><div><span class="place">#${i+1}</span><h3>${esc(p[0])}</h3></div><div class="accuracy-value">${p[5]?fmtAvg(p[4]):"—"}</div></div><div class="accuracy-track"><i style="width:${p[5]?Math.max(5,100-(p[4]/max*82)):0}%"></i></div><div class="accuracy-stats"><span>Errore medio dal wrap</span><span>${p[5]} bet</span></div></article>`).join("")}</div></section>`;
}

function historyView(){
 return `<section class="view"><div class="section-head"><div><span class="eyebrow">ARCHIVIO</span><h1>Storico giornate</h1></div><p>Apri una giornata per i dettagli</p></div><div class="history-list">${state.history.map(h=>`<article class="card history-row"><button class="history-summary" aria-expanded="false"><span class="history-day">Giorno ${h[0]}</span><span class="history-winner"><strong>${esc(h[1])}</strong><small>Bet vincente ${h[2]}</small></span><span class="history-score">+${h[4]} pt</span><span>⌄</span></button><div class="history-detail"><div class="mini"><span>Vincitore</span><strong>${esc(h[1])}</strong></div><div class="mini"><span>Bet</span><strong>${h[2]}</strong></div><div class="mini"><span>Wrap ufficiale</span><strong>${h[3]}</strong></div></div></article>`).join("")}</div></section>`;
}

function render(){
  const allowed=["today","standings","accuracy","history"]; if(!allowed.includes(route))route="today";
  qs("#dayNumber").textContent=state.day;
  document.querySelectorAll("[data-route]").forEach(b=>b.classList.toggle("active",b.dataset.route===route));
  app.innerHTML=({today:todayView,standings:standingsView,accuracy:accuracyView,history:historyView})[route]();
  if(route==="today")liveClock();
  window.scrollTo({top:0,behavior:"smooth"});
}

document.addEventListener("click",e=>{
  const nav=e.target.closest("[data-route]"); if(nav){route=nav.dataset.route;location.hash=route;render()}
  const order=e.target.closest("[data-order]"); if(order){accuracyOrder=order.dataset.order;render()}
  const row=e.target.closest(".history-summary"); if(row){const parent=row.closest(".history-row");parent.classList.toggle("open");row.setAttribute("aria-expanded",parent.classList.contains("open"))}
});
window.addEventListener("hashchange",()=>{route=(location.hash||"#today").slice(1);render()});

const dialog=qs("#adminDialog"),form=qs("#adminForm"),playerInput=qs("#playerInput");
function refreshPlayers(selected=0){playerInput.innerHTML=state.players.length?state.players.map((p,i)=>`<option value="${i}">${esc(p[0])}</option>`).join(""):`<option value="">Nessun partecipante</option>`;playerInput.value=state.players.length?String(Math.min(selected,state.players.length-1)):"";qs("#betTimeInput").disabled=!state.players.length;qs("#betTimeInput").value=state.players.length?(state.players[+playerInput.value][3]||"20:00"):""}
qs("#openAdmin").addEventListener("click",()=>{qs("#wrapTimeInput").value=state.wrapTime;refreshPlayers();dialog.showModal()});
playerInput.addEventListener("change",()=>{if(playerInput.value!=="")qs("#betTimeInput").value=state.players[+playerInput.value][3]||"20:00"});
form.addEventListener("submit",e=>{if(e.submitter?.value==="cancel")return;e.preventDefault();state.wrapTime=qs("#wrapTimeInput").value;if(playerInput.value!=="")state.players[+playerInput.value][3]=qs("#betTimeInput").value;persist();dialog.close();render();toast("Giornata aggiornata")});
qs("#addPlayer").addEventListener("click",()=>{const input=qs("#newPlayerInput"),name=input.value.trim();if(!name)return toast("Inserisci un nome");if(state.players.some(p=>p[0].toLowerCase()===name.toLowerCase()))return toast("Partecipante già presente");state.players.push([name,0,0,null,0,0]);input.value="";persist();refreshPlayers(state.players.length-1);render();toast(`${name} aggiunto`)});
qs("#removePlayer").addEventListener("click",()=>{if(playerInput.value==="")return;const idx=+playerInput.value,name=state.players[idx][0];if(!confirm(`Rimuovere ${name}?`))return;state.players.splice(idx,1);persist();refreshPlayers(Math.max(0,idx-1));render();toast(`${name} rimosso`)});
qs("#finalizeDay").addEventListener("click",()=>{if(!state.players.some(p=>p[3]))return toast("Inserisci almeno una bet");const wrap=qs("#wrapTimeInput").value;if(!wrap)return toast("Inserisci l'orario di wrap");state.wrapTime=wrap;const scorers=[];state.players.forEach(p=>{if(!p[3])return;const pts=pointsFor(p[3]);const distance=diff(p[3]);p[1]+=pts;if(pts>0){p[2]+=1;scorers.push([p[0],p[3],pts])}p[4]=((p[4]*p[5])+distance)/(p[5]+1);p[5]+=1});const best=Math.max(0,...scorers.map(s=>s[2]));const winners=scorers.filter(s=>s[2]===best);state.history.unshift([state.day,winners.length?winners.map(w=>w[0]).join(" · "):"Nessun vincitore",winners.length?winners.map(w=>w[1]).join(" · "):"—",wrap,best]);state.day+=1;state.players.forEach(p=>p[3]=null);persist();dialog.close();route="standings";location.hash=route;render();toast("Punti assegnati e giornata chiusa")});
qs("#resetDemo").addEventListener("click",()=>{if(!confirm("Azzerare partecipanti, classifica, precisione e storico?"))return;state=clone(original);persist();dialog.close();render();toast("TotoWrap azzerato: si riparte dal giorno 1")});
function toast(text){const t=qs("#toast");t.textContent=text;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200)}

if(document.modelContext?.registerTool){
  document.modelContext.registerTool({name:"open_totowrap_section",title:"Apri sezione TotoWrap",description:"Apre una sezione del sito tra today, standings, accuracy e history.",inputSchema:{type:"object",properties:{section:{type:"string",enum:["today","standings","accuracy","history"]}},required:["section"],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:({section})=>{route=section;location.hash=section;render();return{section}}});
}
render();
