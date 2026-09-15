import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
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
const ADMIN_UID="4hgyioeFlcYixjF2DpRAxzVVowL2";

const original = {
  day: 1,
  estimatedTime: "",
  wrapTime: "",
  players: [],
  history: []
};

const clone = v => JSON.parse(JSON.stringify(v));
let state = clone(original);
let isAdmin=false;
let route = (location.hash || "#today").slice(1);
let accuracyOrder = "best";
let accuracyPlayer = null;

const app = document.querySelector("#app");
const qs = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const initials = n => n.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase();
const DAY_SEC=86400;
const toSec = t => { if(!t)return null; const [h=0,m=0,s=0]=t.split(":").map(Number); return h*3600+m*60+s; };
const clock = seconds => {const value=((Math.round(seconds)%DAY_SEC)+DAY_SEC)%DAY_SEC,h=Math.floor(value/3600),m=Math.floor(value%3600/60),s=value%60;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}${s?`:${String(s).padStart(2,"0")}`:""}`};
const diff = t => { const a=toSec(t),b=toSec(state.wrapTime); if(a===null||b===null)return null;const raw=Math.abs(a-b);return Math.round(Math.min(raw,DAY_SEC-raw)/6)/10; };
const distanceFrom = (t,reference) => {const a=toSec(t),b=toSec(reference);if(a===null||b===null)return null;const raw=Math.abs(a-b);return Math.min(raw,DAY_SEC-raw)};
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
const status = t => { if(!t)return ["Nessuna bet","none"];if(!state.wrapTime)return ["IN GIOCO","pending"];const pts=pointsFor(t); if(pts===3)return ["ESATTO · 3 PT","win"]; if(pts===1)return ["FASCIA · 1 PT","close"]; return ["FUORI","out"]; };
const fmtAvg = m => `${Math.floor(m)}m${Math.round((m%1)*60).toString().padStart(2,"0")}s`;
const persist = async () => {
  if(!isAdmin)throw new Error("Accesso amministratore richiesto");
  // Firestore non consente array annidati. Salviamo quindi lo stato come JSON:
  // il formato interno dell'app resta invariato e partecipanti/storico funzionano.
  await setDoc(STATE_REF,{payload:JSON.stringify(clone(state)),updatedAt:serverTimestamp()});
};

function liveClock(){
  const el=qs("#liveClock"),date=qs("#liveDate"); if(!el)return;
  const tick=()=>{const d=new Date();el.textContent=new Intl.DateTimeFormat("it-IT",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(d);date.textContent=new Intl.DateTimeFormat("it-IT",{weekday:"long",day:"numeric",month:"long"}).format(d)};
  tick(); clearInterval(liveClock.timer); liveClock.timer=setInterval(tick,1000);
}

function todayView(){
  const withBets=state.players.filter(p=>p[3]);
  const referenceTime=state.wrapTime||state.estimatedTime;
  const referenceLabel=state.wrapTime?"wrap effettivo":state.estimatedTime?"fine stimata":"orario";
  return `<section class="view"><div class="hero-grid">
    <article class="card clock-card"><span class="eyebrow">ORA UFFICIALE LIVE</span><strong class="clock" id="liveClock">--:--:--</strong><span class="date" id="liveDate"></span></article>
    <div class="time-cards">
      <article class="card time-card estimated-card"><span class="eyebrow">FINE STIMATA</span><strong>${esc(state.estimatedTime||"--:--")}</strong><p>Orario indicativo per scegliere la bet</p></article>
      <article class="card time-card actual-card"><span class="eyebrow">WRAP EFFETTIVO</span><strong>${esc(state.wrapTime||"--:--")}</strong><p>${state.wrapTime?"Orario ufficiale":"Da confermare a fine giornata"}</p></article>
      <div class="rules"><div class="rule"><strong>3 punti</strong><span>minuto esatto</span></div><div class="rule"><strong>1 punto</strong><span>fascia automatica</span></div><div class="rule"><strong>${withBets.length}</strong><span>bet inserite</span></div></div>
    </div>
  </div><div class="section-head"><div><span class="eyebrow">GIORNATA ${state.day}</span><h1>Le bet di oggi</h1></div><p>Ordinate dalla più vicina alla ${referenceLabel}</p></div>
  <div class="bets">${state.players.length?[...state.players].sort((a,b)=>(distanceFrom(a[3],referenceTime)??999999)-(distanceFrom(b[3],referenceTime)??999999)).map(p=>{const s=status(p[3]);return `<article class="card bet-card"><div class="avatar">${initials(p[0])}</div><div><h3>${esc(p[0])}</h3><div class="bet-meta">${p[3]?`Fascia ${bandLabel(p[3])}`:"Non ha giocato"}</div></div><div><div class="bet-time">${p[3]||"—"}</div><span class="pill ${s[1]}">${s[0]}</span></div></article>`}).join(""):`<div class="card empty">Aggiungi i partecipanti dal pulsante Gestione.</div>`}</div></section>`;
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
  <div class="accuracy-grid">${sorted.map((p,i)=>{const winRate=p[5]?Math.round(p[2]/p[5]*100):0;return `<article class="card accuracy-card"><div class="accuracy-top"><div><span class="place">#${i+1}</span><h3>${esc(p[0])}</h3></div><div class="accuracy-result"><div class="accuracy-value">${p[5]?fmtAvg(p[4]):"—"}</div><span class="win-rate">${winRate}% vittorie</span></div></div><div class="accuracy-track"><i style="width:${p[5]?Math.max(5,100-(p[4]/max*82)):0}%"></i></div><div class="accuracy-stats"><span>Errore medio dal wrap</span><span>${p[2]} ${p[2]===1?"vittoria":"vittorie"} su ${p[5]} bet</span></div></article>`}).join("")}</div>${accuracyChart()}</section>`;
}

function accuracyChart(){
  const seriesByPlayer=new Map();
  [...state.history].reverse().forEach(day=>{
    const details=Array.isArray(day[6])?day[6]:[];
    details.forEach(item=>{
      if(!item?.name||!Number.isFinite(item.errorMin))return;
      if(!seriesByPlayer.has(item.name))seriesByPlayer.set(item.name,[]);
      seriesByPlayer.get(item.name).push({day:day[0],error:item.errorMin,won:item.points>0});
    });
  });
  const names=state.players.map(p=>p[0]).filter(name=>seriesByPlayer.has(name));
  if(!names.length)return `<article class="card trend-card"><div class="trend-head"><div><span class="eyebrow">ANDAMENTO NEL TEMPO</span><h2>Errore dal wrap per giornata</h2></div></div><div class="trend-empty">Il grafico si aggiornerà automaticamente dopo la prima giornata chiusa.</div></article>`;
  if(!names.includes(accuracyPlayer))accuracyPlayer=names[0];
  const points=seriesByPlayer.get(accuracyPlayer)||[];
  const W=820,H=310,L=62,R=24,T=32,B=48,plotW=W-L-R,plotH=H-T-B;
  const maxError=Math.max(1,...points.map(p=>p.error));
  const scaleMax=Math.max(5,Math.ceil(maxError/5)*5);
  const x=(i)=>points.length===1?L+plotW/2:L+(i/(points.length-1))*plotW;
  const y=(value)=>T+plotH-(value/scaleMax)*plotH;
  const ticks=[0,.25,.5,.75,1].map(ratio=>{const value=scaleMax*ratio,py=y(value);return `<g><line x1="${L}" y1="${py}" x2="${W-R}" y2="${py}" class="chart-grid"/><text x="${L-10}" y="${py+4}" class="chart-label" text-anchor="end">${Math.round(value)}m</text></g>`}).join("");
  const path=points.map((p,i)=>`${i?"L":"M"}${x(i).toFixed(1)} ${y(p.error).toFixed(1)}`).join(" ");
  const markers=points.map((p,i)=>`<g><circle cx="${x(i)}" cy="${y(p.error)}" r="${p.won?7:5}" class="chart-point${p.won?" won":""}"><title>Giorno ${p.day}: ${fmtAvg(p.error)} dal wrap${p.won?" · vittoria":""}</title></circle><text x="${x(i)}" y="${H-20}" class="chart-label" text-anchor="middle">G${p.day}</text></g>`).join("");
  return `<article class="card trend-card"><div class="trend-head"><div><span class="eyebrow">ANDAMENTO NEL TEMPO</span><h2>Errore dal wrap per giornata</h2></div><label>Partecipante<select data-accuracy-player>${names.map(name=>`<option value="${esc(name)}" ${name===accuracyPlayer?"selected":""}>${esc(name)}</option>`).join("")}</select></label></div><div class="chart-wrap"><svg class="trend-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento della precisione di ${esc(accuracyPlayer)}"><line x1="${L}" y1="${T}" x2="${L}" y2="${H-B}" class="chart-axis"/><line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" class="chart-axis"/>${ticks}<path d="${path}" class="chart-line"/>${markers}<text x="18" y="${T+plotH/2}" class="chart-title-y" text-anchor="middle" transform="rotate(-90 18 ${T+plotH/2})">Errore dal wrap</text><text x="${L+plotW/2}" y="${H-2}" class="chart-title-x" text-anchor="middle">Giornate</text></svg></div><div class="chart-legend"><span><i></i>${esc(accuracyPlayer)}</span><span><i class="won"></i>Giornata vinta</span><small>Più il punto è vicino allo zero, più precisa è stata la bet.</small></div></article>`;
}

function historyView(){
 return `<section class="view"><div class="section-head"><div><span class="eyebrow">ARCHIVIO</span><h1>Storico giornate</h1></div><p>Apri una giornata per i dettagli</p></div><div class="history-list">${state.history.map(h=>`<article class="card history-row"><button class="history-summary" aria-expanded="false"><span class="history-day">Giorno ${h[0]}</span><span class="history-winner"><strong>${esc(h[1])}</strong><small>Bet vincente ${h[2]}</small></span><span class="history-score">+${h[4]} pt</span><span>⌄</span></button><div class="history-detail"><div class="mini"><span>Vincitore</span><strong>${esc(h[1])}</strong></div><div class="mini"><span>Bet</span><strong>${h[2]}</strong></div><div class="mini"><span>Fine stimata</span><strong>${h[5]||"—"}</strong></div><div class="mini"><span>Wrap ufficiale</span><strong>${h[3]}</strong></div></div></article>`).join("")}</div></section>`;
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
document.addEventListener("change",e=>{const select=e.target.closest("[data-accuracy-player]");if(select){accuracyPlayer=select.value;render()}});
window.addEventListener("hashchange",()=>{route=(location.hash||"#today").slice(1);render()});

const dialog=qs("#adminDialog"),form=qs("#adminForm"),playerInput=qs("#playerInput"),loginDialog=qs("#loginDialog"),loginForm=qs("#loginForm");
function refreshPlayers(selected=0){
  playerInput.innerHTML=state.players.length?state.players.map((p,i)=>`<option value="${i}">${esc(p[0])}</option>`).join(""):`<option value="">Nessun partecipante</option>`;
  playerInput.value=state.players.length?String(Math.min(selected,state.players.length-1)):"";
  qs("#bulkBets").innerHTML=state.players.length?state.players.map((p,i)=>`<label class="bulk-bet-row"><span>${esc(p[0])}</span><input type="time" step="1" value="${p[3]||""}" data-bet-index="${i}" aria-label="Bet di ${esc(p[0])}"></label>`).join(""):`<div class="bulk-empty">Aggiungi prima i partecipanti.</div>`;
}
async function mutateAndSave(mutator,success){const before=clone(state);mutator();try{await persist();render();toast(success);return true}catch(error){state=before;render();console.error(error);toast("Salvataggio non riuscito: riprova");return false}}
qs("#openAdmin").addEventListener("click",()=>{if(!isAdmin){loginDialog.showModal();return}qs("#estimatedTimeInput").value=state.estimatedTime;qs("#wrapTimeInput").value=state.wrapTime;refreshPlayers();dialog.showModal()});
form.addEventListener("submit",async e=>{if(e.submitter?.value==="cancel")return;e.preventDefault();const estimated=qs("#estimatedTimeInput").value,wrap=qs("#wrapTimeInput").value,bets=[...document.querySelectorAll("[data-bet-index]")].map(input=>({index:+input.dataset.betIndex,time:input.value||null}));if(await mutateAndSave(()=>{state.estimatedTime=estimated;state.wrapTime=wrap;bets.forEach(item=>{if(state.players[item.index])state.players[item.index][3]=item.time})},"Stima e bet aggiornate"))dialog.close()});
qs("#addPlayer").addEventListener("click",async()=>{const input=qs("#newPlayerInput"),name=input.value.trim();if(!name)return toast("Inserisci un nome");if(state.players.some(p=>p[0].toLowerCase()===name.toLowerCase()))return toast("Partecipante già presente");if(await mutateAndSave(()=>state.players.push([name,0,0,null,0,0]),`${name} aggiunto`)){input.value="";refreshPlayers(state.players.length-1)}});
qs("#removePlayer").addEventListener("click",async()=>{if(playerInput.value==="")return;const idx=+playerInput.value,name=state.players[idx][0];if(!confirm(`Rimuovere ${name}?`))return;if(await mutateAndSave(()=>state.players.splice(idx,1),`${name} rimosso`))refreshPlayers(Math.max(0,idx-1))});
qs("#finalizeDay").addEventListener("click",async()=>{
  const estimated=qs("#estimatedTimeInput").value,wrap=qs("#wrapTimeInput").value;
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
      dayDetails.push({name:p[0],bet:p[3],errorMin:distance,points:pts});
      p[1]+=pts;
      if(pts>0){p[2]+=1;scorers.push([p[0],p[3],pts])}
      p[4]=((p[4]*p[5])+distance)/(p[5]+1);
      p[5]+=1;
    });
    const best=Math.max(0,...scorers.map(s=>s[2])),winners=scorers.filter(s=>s[2]===best);
    state.history.unshift([state.day,winners.length?winners.map(w=>w[0]).join(" · "):"Nessun vincitore",winners.length?winners.map(w=>w[1]).join(" · "):"—",wrap,best,estimated,dayDetails]);
    state.day+=1;
    state.estimatedTime="";
    state.wrapTime="";
    state.players.forEach(p=>p[3]=null);
  },"Punti assegnati e giornata chiusa");
  if(saved){dialog.close();route="standings";location.hash=route;render()}
});
qs("#advanceDay").addEventListener("click",async()=>{const nextDay=state.day+1;if(!confirm(`Passare al giorno ${nextDay} senza assegnare punti? Le bet e gli orari della giornata ${state.day} verranno cancellati.`))return;const saved=await mutateAndSave(()=>{state.day=nextDay;state.estimatedTime="";state.wrapTime="";state.players.forEach(p=>p[3]=null)},`Giorno ${nextDay} avviato`);if(saved){dialog.close();route="today";location.hash=route;render()}});
qs("#resetDemo").addEventListener("click",async()=>{if(!confirm("Azzerare partecipanti, classifica, precisione e storico?"))return;if(await mutateAndSave(()=>state=clone(original),"TotoWrap azzerato: si riparte dal giorno 1"))dialog.close()});
loginForm.addEventListener("submit",async e=>{e.preventDefault();const button=loginForm.querySelector("button[type=submit]");button.disabled=true;button.textContent="Accesso…";try{const credential=await signInWithEmailAndPassword(auth,qs("#loginEmail").value.trim(),qs("#loginPassword").value);if(credential.user.uid!==ADMIN_UID){await signOut(auth);throw new Error("Utente non autorizzato")}qs("#loginPassword").value="";loginDialog.close();qs("#estimatedTimeInput").value=state.estimatedTime;qs("#wrapTimeInput").value=state.wrapTime;refreshPlayers();dialog.showModal();toast("Accesso amministratore effettuato")}catch(error){console.error(error);toast("Email o password non corretti")}finally{button.disabled=false;button.textContent="Accedi"}});
qs("#closeLogin").addEventListener("click",()=>loginDialog.close());
qs("#signOutBtn").addEventListener("click",async()=>{dialog.close();await signOut(auth);toast("Accesso amministratore terminato")});
function toast(text){const t=qs("#toast");t.textContent=text;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200)}

onAuthStateChanged(auth,user=>{isAdmin=user?.uid===ADMIN_UID;qs("#openAdmin").classList.toggle("admin-on",isAdmin);qs("#openAdmin").title=isAdmin?"Gestione amministratore":"Accesso amministratore";if(user&&!isAdmin)signOut(auth)});
onSnapshot(STATE_REF,snapshot=>{
  if(!snapshot.exists())return;
  const stored=snapshot.data();
  let remote=stored;
  if(typeof stored.payload==="string"){
    try{remote=JSON.parse(stored.payload)}
    catch(error){console.error(error);toast("Dati del database non validi");return}
  }
  state={...clone(original),...remote,players:Array.isArray(remote.players)?remote.players:[],history:Array.isArray(remote.history)?remote.history:[]};
  render();
},error=>{console.error(error);toast("Database temporaneamente non disponibile")});

if(document.modelContext?.registerTool){
  document.modelContext.registerTool({name:"open_totowrap_section",title:"Apri sezione TotoWrap",description:"Apre una sezione del sito tra today, standings, accuracy e history.",inputSchema:{type:"object",properties:{section:{type:"string",enum:["today","standings","accuracy","history"]}},required:["section"],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:({section})=>{route=section;location.hash=section;render();return{section}}});
}
render();
