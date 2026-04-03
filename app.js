'use strict';
// ════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════
const SUPER_ADMIN = 'c.nocher@coradam.com';
const ALLOWED_DOMAIN = 'coradam.com';
const COUNTRIES = ['Italy','Thailand','France','Portugal','Spain','India'];
const FLAGS = {Italy:'🇮🇹',Thailand:'🇹🇭',France:'🇫🇷',Portugal:'🇵🇹',Spain:'🇪🇸',India:'🇮🇳'};

// ════════════════════════════════════
// UTILS
// ════════════════════════════════════
const U = {
  uuid(){ return crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)}); },
  today(){ return new Date().toISOString().slice(0,10); },
  monthKey(d){ return `${d.getFullYear()}-${S2(d.getMonth()+1)}`; },
  monthLabel(d){ return d.toLocaleString('en-GB',{month:'long',year:'numeric'}); },
  daysInMonth(y,m){ return new Date(y,m+1,0).getDate(); },
  prevDays(y,m){ return new Date(y,m,0).getDate(); },
  wd(y,m,d){ const w=new Date(y,m,d).getDay(); return w===0?6:w-1; },
  isWeekend(y,m,d){ const w=new Date(y,m,d).getDay(); return w===0||w===6; },
  slotCls(s){ return s==='Full Day'?'full':s==='Half Day AM'?'am':'pm'; },
  chipCls(s){ return 'c-'+U.slotCls(s); },
  badgeCls(s){ return 'b-'+U.slotCls(s); },
  dotCls(s){ return 'd-'+U.slotCls(s); },
  flag(c){ return FLAGS[c]||'🌍'; },
  esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
  fmt(d){ if(!d)return''; const[y,m,dd]=d.split('-'); return`${dd}/${m}/${y}`; },
  uniq(arr){ return [...new Set(arr)].filter(Boolean).sort((a,b)=>a.localeCompare(b)); },
  int(v){ const n=parseInt(v,10); return isNaN(n)?null:Math.max(0,n); },
  // Expand an availability rule into concrete dates for a given year/month
  expandAvail(rule, y, m){
    const mStr = `${y}-${S2(m+1)}`;
    const first = new Date(y, m, 1), last = new Date(y, m+1, 0);
    const dates = [];
    const mode = rule.repeatMode||'none';
    const base = new Date(rule.startDate);
    const end = rule.endDate ? new Date(rule.endDate) : null;
    const until = rule.repeatUntil ? new Date(rule.repeatUntil) : last;
    if(mode==='none'){
      if(end){
        let d=new Date(Math.max(base,first));
        const stop=new Date(Math.min(end,last));
        while(d<=stop){ dates.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
      } else if(rule.startDate.startsWith(mStr)) dates.push(rule.startDate);
    } else if(mode==='weekly'){
      let d=new Date(base);
      while(d<=until){
        if(d>=first&&d<=last) dates.push(d.toISOString().slice(0,10));
        d.setDate(d.getDate()+7);
      }
    } else if(mode==='monthly'){
      let d=new Date(base);
      while(d<=until){
        if(d>=first&&d<=last) dates.push(d.toISOString().slice(0,10));
        d.setMonth(d.getMonth()+1);
      }
    }
    return dates;
  }
};
function S2(n){ return String(n).padStart(2,'0'); }
function el(tag,cls){ const e=document.createElement(tag); if(cls)e.className=cls; return e; }

// ════════════════════════════════════
// LOCAL STORAGE
// ════════════════════════════════════
const LS = {
  g(k,fb=null){ try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb}catch{return fb} },
  s(k,v){ try{localStorage.setItem(k,JSON.stringify(v))}catch{} },
  rm(k){ localStorage.removeItem(k); },
  getCfg(){ return this.g('acfg',null); },
  setCfg(c){ this.s('acfg',c); }
};

// ════════════════════════════════════
// FIREBASE
// ════════════════════════════════════
let fapp, fauth, fdb;
function fbRef(path){ return fdb.ref(path); }
async function fbGet(path){ const s=await fbRef(path).get(); return s.val(); }
async function fbSet(path,val){ await fbRef(path).set(val); }
async function fbUpdate(path,val){ await fbRef(path).update(val); }
async function fbDel(path){ await fbRef(path).remove(); }
async function fbPush(path,val){ const r=fbRef(path).push(); await r.set({...val,id:r.key}); return r.key; }

// ════════════════════════════════════
// IN-MEMORY CACHE
// ════════════════════════════════════
const Cache = {
  users:{}, clients:{}, entries:{}, availability:{},
  async loadAll(){
    const [u,c,e,a]=await Promise.all([fbGet('users'),fbGet('clients'),fbGet('entries'),fbGet('availability')]);
    this.users=u||{}; this.clients=c||{}; this.entries=e||{}; this.availability=a||{};
  },
  usersArr(){ return Object.values(this.users); },
  clientsArr(){ return Object.values(this.clients); },
  entriesArr(){ return Object.values(this.entries); },
  availArr(){ return Object.values(this.availability); },
  clientsFor(uid){ return this.clientsArr().filter(c=>(c.userIds||[]).includes(uid)); },
  availForUser(uid){ return this.availArr().filter(a=>a.userId===uid); }
};

// ════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════
const M = {
  open(id){ document.getElementById(id).classList.add('open'); },
  close(id){ document.getElementById(id).classList.remove('open'); }
};
document.querySelectorAll('.mov').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open');}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.mov.open').forEach(o=>o.classList.remove('open'));});
const Spin={on(){document.getElementById('spin').classList.add('on');},off(){document.getElementById('spin').classList.remove('on');}};
let _tid;
function toast(msg,type='ok'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show '+(type==='err'?'bad':'ok');
  clearTimeout(_tid); _tid=setTimeout(()=>t.classList.remove('show'),3000);
}
function show(name){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById('s-'+name).classList.add('active'); }

// ════════════════════════════════════
// SETUP
// ════════════════════════════════════
const Setup = {
  connect(){
    const raw=document.getElementById('setup-cfg').value.trim();
    const err=document.getElementById('setup-err');
    err.style.display='none';
    let cfg;
    try{
      // Strip optional variable assignment wrapper and trailing semicolon
      const clean=raw.replace(/^const\s+firebaseConfig\s*=\s*/,'').replace(/;?\s*$/,'');
      // Use Function() to handle JS object literals (unquoted keys) as well as strict JSON
      cfg = new Function('return ('+clean+')')();
    } catch{
      err.innerHTML='<strong>Invalid config.</strong> Paste the exact config object from Firebase — it starts with <code>{</code> and ends with <code>}</code>.';
      err.style.display='block'; return;
    }
    if(!cfg.apiKey||!cfg.databaseURL){
      err.innerHTML='<strong>Config looks incomplete.</strong> Make sure it includes <code>apiKey</code> and <code>databaseURL</code>.';
      err.style.display='block'; return;
    }
    LS.setCfg(cfg);
    location.reload();
  },
  reset(){
    if(!confirm('Reset Firebase config? You will need to reconnect.')) return;
    LS.rm('acfg'); location.reload();
  }
};

// ════════════════════════════════════
// AUTH
// ════════════════════════════════════
const Auth = {
  async signIn(){
    const err=document.getElementById('login-err');
    err.style.display='none';
    try{
      console.log('Google sign-in clicked');
      console.log('fauth exists?', !!fauth);
      
      const provider=new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({hd:ALLOWED_DOMAIN});
      
       const result = await fauth.signInWithPopup(provider);
      console.log('Sign-in success:', result);
      
    } catch(e){
      console.error('Google sign-in failed:', e.code, e.message, e);
      if(e.code === 'auth/popup-closed-by-user') return;
      err.innerHTML = 'Sign-in failed: ' + U.esc(e.message);
      err.style.display = 'block';
    }
  },
  async signOut(){
    await fauth.signOut();
    App.user=null;
    show('login');
  }
};

// ════════════════════════════════════
// APP
// ════════════════════════════════════
const App = {
  user: null,
  _pendingDate: null,

  async init(){
       const embeddedCfg = typeof {
  apiKey: "AIzaSyCK67ERv8OmlY7p12iDhncVXA03Ga1ai7Y",
  authDomain: "coradam-planner.firebaseapp.com",
  databaseURL: "https://coradam-planner-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "coradam-planner",
  storageBucket: "coradam-planner.firebasestorage.app",
  messagingSenderId: "1030102827382",
  appId: "1:1030102827382:web:f67d0a6783865d9a66ba57",
  measurementId: "G-RXDVDSZ7P1"
} !== 'undefined' ? {
  apiKey: "AIzaSyCK67ERv8OmlY7p12iDhncVXA03Ga1ai7Y",
  authDomain: "coradam-planner.firebaseapp.com",
  databaseURL: "https://coradam-planner-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "coradam-planner",
  storageBucket: "coradam-planner.firebasestorage.app",
  messagingSenderId: "1030102827382",
  appId: "1:1030102827382:web:f67d0a6783865d9a66ba57",
  measurementId: "G-RXDVDSZ7P1"
} : null;
    const cfg = LS.getCfg() || embeddedCfg;
    if(!cfg){ show('setup'); return; }
    // Init Firebase
    fapp = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    fauth=firebase.auth();
    fdb=firebase.database();
    // Detect Freshbooks OAuth callback redirect
    const _fbParam=new URLSearchParams(window.location.search).get('fb');
    if(_fbParam) history.replaceState({},'',window.location.pathname);
    if(_fbParam==='connected') this._fbConnected=true;
    if(_fbParam==='error'){
      const _fbMsg=new URLSearchParams(window.location.search).get('msg')||'Unknown error';
      this._fbError=_fbMsg;
    }
    show('login');
    // Listen for auth state
    fauth.onAuthStateChanged(async u=>{
      if(!u){ show('login'); return; }
      // Domain check
      const email=u.email||'';
      if(!email.endsWith('@'+ALLOWED_DOMAIN)){
        await fauth.signOut();
        const err=document.getElementById('login-err');
        err.innerHTML='<strong>Access denied.</strong> Only <strong>@coradam.com</strong> accounts are allowed.';
        err.style.display='block';
        return;
      }
      Spin.on();
      try{
        await Cache.loadAll();
        // Upsert user profile
        let profile=Cache.users[u.uid];
        if(!profile){
          // Check for pending pre-created profile matching this email
          const pending=Cache.usersArr().find(p=>p.pending&&p.email===email);
          if(pending){
            // Migrate pending profile to real UID
            profile={...pending,uid:u.uid,name:u.displayName||pending.name||email.split('@')[0],photo:u.photoURL||'',role:email===SUPER_ADMIN?'super_admin':'controller',pending:false,firstLogin:Date.now()};
            await fbSet(`users/${u.uid}`,profile);
            Cache.users[u.uid]=profile;
            // Clean up pending record and fix client assignments (best-effort — may fail if rules block it)
            try{
              await fbDel(`users/${pending.uid}`);
              delete Cache.users[pending.uid];
            } catch(e){ console.warn('Could not delete pending record (will be cleaned by admin):',e.message); }
            // Update client userIds that referenced the pending uid (super_admin will handle if this fails)
            try{
              for(const c of Cache.clientsArr()){
                if((c.userIds||[]).includes(pending.uid)){
                  const updated={...c,userIds:c.userIds.map(id=>id===pending.uid?u.uid:id)};
                  await fbSet(`clients/${c.id}`,updated); Cache.clients[c.id]=updated;
                }
              }
            } catch(e){ console.warn('Could not update client assignments:',e.message); }
          } else {
            profile={uid:u.uid,name:u.displayName||email.split('@')[0],email,photo:u.photoURL||'',country:'',role:email===SUPER_ADMIN?'super_admin':'controller',active:true,firstLogin:Date.now()};
            await fbSet(`users/${u.uid}`,profile);
            Cache.users[u.uid]=profile;
          }
        } else {
          // Update name/photo from Google
          const upd={...profile,name:u.displayName||profile.name,photo:u.photoURL||profile.photo,role:email===SUPER_ADMIN?'super_admin':'controller'};
          await fbSet(`users/${u.uid}`,upd);
          Cache.users[u.uid]=upd; profile=upd;
        }
        this.user=profile;
        this._afterLogin();
      } catch(e){ toast('Load error: '+e.message,'err'); }
      finally{ Spin.off(); }
    });
  },

  _fbConnected: false,
  _fbError: null,

  _afterLogin(){
    const u=this.user;
    // Set avatar
    ['hdr-avatar','adm-avatar'].forEach(id=>{
      const img=document.getElementById(id);
      if(u.photo){ img.src=u.photo; img.style.display=''; } else img.style.display='none';
    });
    if(u.role==='super_admin'){ this._goAdmin(); }
    else { this._goCalendar(); }
    // Show Freshbooks OAuth result toasts
    if(this._fbConnected){ this._fbConnected=false; setTimeout(()=>toast('Freshbooks connected! Go to Settings → Freshbooks to sync clients.','ok'),400); }
    if(this._fbError){ const m=this._fbError; this._fbError=null; setTimeout(()=>toast('Freshbooks error: '+m,'err'),400); }
  },

  _goCalendar(){
    const u=this.user;
    document.getElementById('hdr-cal-name').textContent=u.name+"'s Calendar";
    document.getElementById('hdr-cal-user').textContent=u.name;
    show('cal'); Cal.init();
  },

  _goAdmin(){
    show('adm'); Adm.init();
  },

  goSettings(){
    const u=this.user;
    document.getElementById('set-admin-tabs').style.display=u.role==='super_admin'?'block':'none';
    document.getElementById('set-profile').style.display=u.role==='controller'?'block':'none';
    if(u.role==='super_admin') Sett.tab('users');
    else { document.getElementById('profile-country').value=u.country||''; }
    show('set');
  },

  goProfile(){ this.goSettings(); },

  goBack(){
    if(this.user?.role==='super_admin'){ show('adm'); Adm.init(); }
    else{ show('cal'); }
  },

  goAdmin(){ show('adm'); Adm.init(); },

  async reload(){
    Spin.on();
    await Cache.loadAll();
    // Re-read current user profile
    if(this.user) this.user=Cache.users[this.user.uid]||this.user;
    Spin.off();
  }
};

// ════════════════════════════════════
// CALENDAR (Controller)
// ════════════════════════════════════
const Cal = {
  cur: new Date(),
  view: 'month', // 'month' | 'week' | 'list'

  init(){ this.cur=new Date(); this.render(); },

  setView(v){
    this.view=v;
    ['month','week','list'].forEach(n=>document.getElementById('vt-'+n).classList.toggle('on',n===v));
    this.render();
  },

  prev(){
    if(this.view==='week'){ this.cur=new Date(this.cur); this.cur.setDate(this.cur.getDate()-7); }
    else if(this.view==='list'){ this.cur=new Date(this.cur.getFullYear(),this.cur.getMonth()-1,1); }
    else { this.cur=new Date(this.cur.getFullYear(),this.cur.getMonth()-1,1); }
    this.render();
  },
  next(){
    if(this.view==='week'){ this.cur=new Date(this.cur); this.cur.setDate(this.cur.getDate()+7); }
    else if(this.view==='list'){ this.cur=new Date(this.cur.getFullYear(),this.cur.getMonth()+1,1); }
    else { this.cur=new Date(this.cur.getFullYear(),this.cur.getMonth()+1,1); }
    this.render();
  },

  render(){
    document.getElementById('cal-grid').style.display=this.view==='month'?'':'none';
    document.getElementById('cal-week').style.display=this.view==='week'?'':'none';
    document.getElementById('cal-list').style.display=this.view==='list'?'':'none';
    if(this.view==='month') this._renderMonth();
    else if(this.view==='week') this._renderWeek();
    else this._renderList();
  },

  _renderMonth(){
    const y=this.cur.getFullYear(), m=this.cur.getMonth(), today=U.today(), uid=App.user.uid;
    document.getElementById('cal-lbl').textContent=U.monthLabel(this.cur);

    const entries=Cache.entriesArr().filter(e=>e.userId===uid);
    const eMap={}; entries.forEach(e=>{ (eMap[e.date]=eMap[e.date]||[]).push(e); });

    // Build availability map for this month
    const aMap={};
    Cache.availForUser(uid).forEach(rule=>{
      U.expandAvail(rule,y,m).forEach(date=>{ (aMap[date]=aMap[date]||[]).push(rule); });
    });

    const firstWd=U.wd(y,m,1), dCount=U.daysInMonth(y,m), prevDays=U.prevDays(y,m);
    const grid=document.getElementById('cal-grid');
    while(grid.children.length>7) grid.removeChild(grid.lastChild);

    // Leading days
    for(let i=firstWd-1;i>=0;i--){ const d=el('div','cal-day oth'); d.innerHTML=`<div class="dn">${prevDays-i}</div>`; grid.appendChild(d); }

    for(let day=1;day<=dCount;day++){
      const ds=`${y}-${S2(m+1)}-${S2(day)}`;
      const isT=ds===today;
      const de=eMap[ds]||[];
      const avRules=aMap[ds]||[];
      const hasAvail=avRules.some(r=>r.type==='available');
      const hasUnavail=avRules.some(r=>r.type==='unavailable');

      let cls='cal-day';
      if(isT) cls+=' is-today';
      else if(hasUnavail) cls+=' is-unavail';
      else if(hasAvail) cls+=' is-avail';

      let chips='';
      de.forEach(e=>{
        const cc=U.chipCls(e.slot);
        chips+=`<div class="chip ${cc}" onclick="event.stopPropagation();Slot.edit('${e.id}')" title="${U.esc(e.slot+' – '+(e.clientName||'')+(e.factory?' @ '+e.factory:''))}">${U.esc(e.clientName||e.slot)}</div>`;
      });
      if(hasAvail&&!hasUnavail) chips+=`<div class="av-tag av-tag-yes">✓ Available</div>`;
      if(hasUnavail) chips+=`<div class="av-tag av-tag-no">✗ Unavailable</div>`;

      const d=el('div',cls);
      d.innerHTML=`<div class="dn">${day}</div><div class="dslots">${chips}</div>`;
      d.onclick=()=>this._dayClick(ds, de, avRules);
      grid.appendChild(d);
    }

    // Trailing
    const total=Math.ceil((firstWd+dCount)/7)*7;
    for(let i=1;i<=total-firstWd-dCount;i++){ const d=el('div','cal-day oth'); d.innerHTML=`<div class="dn">${i}</div>`; grid.appendChild(d); }
  },

  _dayClick(ds, de, avRules){
    if(de.length===0 && avRules.length===0){
      App._pendingDate=ds;
      document.getElementById('m-day-title').textContent=U.fmt(ds);
      M.open('m-day');
    } else if(de.length>0){
      Slot.edit(de[0].id);
    } else {
      Avail.openForDate(ds, avRules[0]);
    }
  },

  _renderWeek(){
    const today=U.today();
    // Find Monday of current week
    const d=new Date(this.cur);
    const dow=d.getDay()===0?6:d.getDay()-1;
    d.setDate(d.getDate()-dow);
    const monday=new Date(d);
    const days=[];
    for(let i=0;i<7;i++){
      const dd=new Date(monday); dd.setDate(monday.getDate()+i); days.push(dd);
    }
    const startLabel=days[0].toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    const endLabel=days[6].toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    document.getElementById('cal-lbl').textContent=startLabel+' – '+endLabel;

    const uid=App.user.uid;
    const entries=Cache.entriesArr().filter(e=>e.userId===uid);
    const eMap={}; entries.forEach(e=>{ (eMap[e.date]=eMap[e.date]||[]).push(e); });
    const aMap={};
    const ymSeen=new Set();
    days.forEach(d=>{
      const key=d.getFullYear()+'-'+d.getMonth();
      if(!ymSeen.has(key)){
        ymSeen.add(key);
        Cache.availForUser(uid).forEach(rule=>{
          U.expandAvail(rule,d.getFullYear(),d.getMonth()).forEach(date=>{ (aMap[date]=aMap[date]||[]).push(rule); });
        });
      }
    });

    const WDAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const container=document.getElementById('cal-week');
    container.innerHTML='';
    const grid=document.createElement('div'); grid.className='week-grid';
    days.forEach((d,i)=>{
      const ds=d.toISOString().slice(0,10);
      const isT=ds===today;
      const de=eMap[ds]||[];
      const avRules=aMap[ds]||[];
      const hasAvail=avRules.some(r=>r.type==='available');
      const hasUnavail=avRules.some(r=>r.type==='unavailable');
      const dayDiv=document.createElement('div');
      dayDiv.className='week-day'+(isT?' is-today':hasUnavail?' is-unavail':hasAvail?' is-avail':'');
      // Header
      const hdr=document.createElement('div'); hdr.className='week-day-hdr';
      hdr.innerHTML='<span class="wdn">'+WDAYS[i]+'</span><span class="wdd">'+d.getDate()+'</span>';
      hdr.addEventListener('click',()=>this._dayClick(ds,de,avRules));
      // Body
      const body=document.createElement('div'); body.className='week-day-body';
      if(!de.length && !hasAvail && !hasUnavail){
        body.innerHTML='<span style="color:var(--txs);font-size:.7rem">Free</span>';
      } else {
        de.forEach(e=>{
          const chip=document.createElement('div');
          chip.className='chip '+U.chipCls(e.slot);
          chip.style.marginBottom='.2rem';
          chip.innerHTML=U.esc(e.clientName||e.slot)+'<div style="font-size:.62rem;opacity:.7">'+U.esc(e.factory||'')+'</div>';
          chip.addEventListener('click',ev=>{ ev.stopPropagation(); Slot.edit(e.id); });
          body.appendChild(chip);
        });
        if(hasAvail&&!hasUnavail){ const t=document.createElement('div'); t.className='av-tag av-tag-yes'; t.style.fontSize='.65rem'; t.textContent='✓ Avail'; body.appendChild(t); }
        if(hasUnavail){ const t=document.createElement('div'); t.className='av-tag av-tag-no'; t.style.fontSize='.65rem'; t.textContent='✗ Unavail'; body.appendChild(t); }
      }
      dayDiv.appendChild(hdr); dayDiv.appendChild(body);
      grid.appendChild(dayDiv);
    });
    container.appendChild(grid);
  },

  _renderList(){
    const uid=App.user.uid;
    const entries=Cache.entriesArr().filter(e=>e.userId===uid).sort((a,b)=>a.date<b.date?-1:1);
    document.getElementById('cal-lbl').textContent='All Bookings';
    const container=document.getElementById('cal-list');
    container.innerHTML='';
    if(!entries.length){
      container.innerHTML='<div class="cal-list-wrap"><div class="cl-empty">No bookings yet. Click a day to add one.</div></div>';
      return;
    }
    const wrap=document.createElement('div'); wrap.className='cal-list-wrap';
    let lastMonth='';
    entries.forEach(e=>{
      const mLabel=new Date(e.date+'T00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
      if(mLabel!==lastMonth){
        const sep=document.createElement('div'); sep.className='cl-month'; sep.textContent=mLabel;
        wrap.appendChild(sep); lastMonth=mLabel;
      }
      const d=new Date(e.date+'T00:00');
      const row=document.createElement('div'); row.className='cl-row';
      const dateDiv=document.createElement('div'); dateDiv.className='cl-date';
      dateDiv.innerHTML='<div>'+d.getDate()+'</div><div class="cl-date-sub">'+d.toLocaleDateString('en-GB',{weekday:'short'})+'</div>';
      const info=document.createElement('div'); info.className='cl-info';
      const qty=(e.expectedQty!=null||e.finalQty!=null)?(' · Exp: '+(e.expectedQty??'—')+' / Final: '+(e.finalQty??'—')):'';
      info.innerHTML='<div class="cl-client">'+U.esc(e.clientName||'—')+' <span class="badge '+U.badgeCls(e.slot)+'" style="font-size:.65rem">'+e.slot+'</span></div>'
        +'<div class="cl-detail">'+U.esc(e.factory||'')+qty+(e.notes?' · '+U.esc(e.notes):'')+'</div>';
      row.appendChild(dateDiv); row.appendChild(info);
      row.addEventListener('click',()=>Slot.edit(e.id));
      wrap.appendChild(row);
    });
    container.appendChild(wrap);
    }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

// ════════════════════════════════════
// SLOT (Booking)
// ════════════════════════════════════
const Slot = {
  _isAdmin(){ return App.user?.role==='super_admin'; },
  _setForUser(uid){
    document.getElementById('ms-for').value=uid||'';
    const nameEl=document.getElementById('ms-for-name');
    if(uid && this._isAdmin()){
      const u=Cache.users[uid];
      document.getElementById('ms-for-label').textContent=(u?.name||uid)+(u?.country?' — '+u.country:'');
      nameEl.style.display='block';
    } else {
      nameEl.style.display='none';
    }
  },
  add(date, forUid=null){
    this._reset();
    document.getElementById('ms-title').textContent='Add Booking';
    document.getElementById('ms-date').value=date||U.today();
    document.getElementById('ms-del').style.display='none';
    const targetUid=forUid||App.user.uid;
    this._setForUser(targetUid);
    this._fillClients(targetUid,'','');
    M.open('m-slot');
  },
  edit(id){
    const e=Cache.entries[id]; if(!e) return;
    if(!this._isAdmin() && e.userId!==App.user.uid) return;
    this._reset();
    document.getElementById('ms-title').textContent='Edit Booking';
    document.getElementById('ms-id').value=id;
    document.getElementById('ms-date').value=e.date;
    document.getElementById('ms-notes').value=e.notes||'';
    document.getElementById('ms-eqty').value=e.expectedQty!=null?e.expectedQty:'';
    document.getElementById('ms-fqty').value=e.finalQty!=null?e.finalQty:'';
    document.getElementById('ms-del').style.display='inline-flex';
    this.pick(e.slot);
    this._setForUser(e.userId);
    this._fillClients(e.userId||App.user.uid, e.clientId||'', e.factory||'');
    M.open('m-slot');
  },
  pick(type){
    document.getElementById('ms-type').value=type;
    ['sb-f','sb-a','sb-p'].forEach(id=>document.getElementById(id).className='slt-btn');
    if(type==='Full Day') document.getElementById('sb-f').classList.add('on-full');
    else if(type==='Half Day AM') document.getElementById('sb-a').classList.add('on-am');
    else document.getElementById('sb-p').classList.add('on-pm');
  },
  _reset(){
    ['ms-id','ms-date','ms-notes','ms-eqty','ms-fqty'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('ms-type').value='';
    document.getElementById('ms-err').style.display='none';
    ['sb-f','sb-a','sb-p'].forEach(id=>document.getElementById(id).className='slt-btn');
  },
  _fillClients(uid,selCid,selFac){
    const clients=Cache.clientsFor(uid);
    const cs=document.getElementById('ms-client');
    cs.innerHTML='<option value="">Select client…</option>';
    clients.forEach(c=>cs.innerHTML+=`<option value="${c.id}" ${c.id===selCid?'selected':''}>${U.esc(c.name)}</option>`);
    this._fillFacs(selCid,selFac);
  },
  _fillFacs(cid,selFac){
    const fs=document.getElementById('ms-factory');
    fs.innerHTML='<option value="">Select factory…</option>';
    const c=Cache.clients[cid]; if(!c) return;
    (c.factories||[]).forEach(f=>fs.innerHTML+=`<option value="${U.esc(f)}" ${f===selFac?'selected':''}>${U.esc(f)}</option>`);
    if(selFac&&!(c.factories||[]).includes(selFac)) fs.innerHTML+=`<option value="${U.esc(selFac)}" selected>${U.esc(selFac)}</option>`;
  },
  onClientChange(){ this._fillFacs(document.getElementById('ms-client').value,''); },
  async save(){
    const id=document.getElementById('ms-id').value;
    const date=document.getElementById('ms-date').value;
    const type=document.getElementById('ms-type').value;
    const cid=document.getElementById('ms-client').value;
    const fac=document.getElementById('ms-factory').value;
    const eqty=U.int(document.getElementById('ms-eqty').value);
    const fqty=U.int(document.getElementById('ms-fqty').value);
    const notes=document.getElementById('ms-notes').value.trim();
    const err=document.getElementById('ms-err');
    err.style.display='none';
    if(!date){err.textContent='Please select a date.';err.style.display='block';return;}
    if(!type){err.textContent='Please select a time slot.';err.style.display='block';return;}
    if(!cid){err.textContent='Please select a client.';err.style.display='block';return;}
    if(!fac){err.textContent='Please select a factory.';err.style.display='block';return;}
    // Determine target user (admin books for pre-set controller, others for themselves)
    const targetUid=document.getElementById('ms-for').value||App.user.uid;
    const targetUser=Cache.users[targetUid]||App.user;
    const c=Cache.clients[cid];
    const conflict=Cache.entriesArr().find(e=>e.id!==id&&e.userId===targetUid&&e.date===date&&e.slot===type);
    if(conflict){err.textContent=`${targetUser.name} already has a "${type}" on this date.`;err.style.display='block';return;}
    Spin.on();
    try{
      const eid=id||U.uuid();
      const base=id?{...Cache.entries[id]}:{};
      const entry={...base,id:eid,userId:targetUid,userName:targetUser.name,userEmail:targetUser.email,userCountry:targetUser.country||'',date,slot:type,clientId:cid,clientName:c?.name||'',factory:fac,expectedQty:eqty,finalQty:fqty,notes,updated:Date.now(),created:base.created||Date.now()};
      await fbSet(`entries/${eid}`,entry);
      Cache.entries[eid]=entry;
      M.close('m-slot');
      if(this._isAdmin()){ Adm.refresh(); } else { Cal.render(); }
      toast(id?'Booking updated.':'Booking saved.');
    } catch(e){ toast('Save failed: '+e.message,'err'); }
    finally{ Spin.off(); }
  },
  async del(){
    const id=document.getElementById('ms-id').value;
    if(!id||!confirm('Delete this booking?')) return;
    Spin.on();
    try{
      await fbDel(`entries/${id}`);
      delete Cache.entries[id];
      M.close('m-slot');
      if(this._isAdmin()){ Adm.refresh(); } else { Cal.render(); }
      toast('Booking deleted.');
    } catch(e){ toast('Delete failed.','err'); }
    finally{ Spin.off(); }
  }
};

// ════════════════════════════════════
// AVAILABILITY
// ════════════════════════════════════
const Avail = {
  openForDate(date, existingRule=null){
    this._reset();
    document.getElementById('ma-title').textContent=existingRule?'Edit Availability':'Set Availability — '+U.fmt(date);
    if(existingRule){
      document.getElementById('ma-id').value=existingRule.id||'';
      document.getElementById('ma-del').style.display='inline-flex';
      this.pickType(existingRule.type);
      this.pickSlot(existingRule.slot||'Full Day');
      document.getElementById('ma-repeat').value=existingRule.repeatMode||'none';
      document.getElementById('ma-date').value=existingRule.startDate||date;
      document.getElementById('ma-from').value=existingRule.startDate||date;
      document.getElementById('ma-to').value=existingRule.endDate||'';
      document.getElementById('ma-until').value=existingRule.repeatUntil||'';
      document.getElementById('ma-note').value=existingRule.note||'';
      this.onRepeatChange();
    } else {
      document.getElementById('ma-date').value=date;
      document.getElementById('ma-from').value=date;
      this.pickSlot('Full Day');
    }
    M.open('m-avail');
  },
  openBulk(){
    this._reset();
    document.getElementById('ma-title').textContent='Set Availability';
    document.getElementById('ma-date').value=U.today();
    document.getElementById('ma-from').value=U.today();
    this.pickSlot('Full Day');
    M.open('m-avail');
  },
  pickType(type){
    document.getElementById('ma-type').value=type;
    document.getElementById('av-yes').className='av-btn'+(type==='available'?' on-yes':'');
    document.getElementById('av-no').className='av-btn'+(type==='unavailable'?' on-no':'');
  },
  pickSlot(slot){
    document.getElementById('ma-slot').value=slot;
    ['ma-sb-f','ma-sb-a','ma-sb-p'].forEach(id=>document.getElementById(id).className='slt-btn');
    if(slot==='Full Day') document.getElementById('ma-sb-f').classList.add('on-full');
    else if(slot==='Half Day AM') document.getElementById('ma-sb-a').classList.add('on-am');
    else document.getElementById('ma-sb-p').classList.add('on-pm');
  },
  onRepeatChange(){
    const v=document.getElementById('ma-repeat').value;
    document.getElementById('ma-date-single').style.display=v==='range'?'none':'block';
    document.getElementById('ma-date-range').style.display=v==='range'?'block':'none';
    document.getElementById('ma-until-wrap').style.display=(v==='weekly'||v==='monthly')?'block':'none';
  },
  _reset(){
    document.getElementById('ma-id').value='';
    document.getElementById('ma-type').value='';
    document.getElementById('ma-slot').value='';
    document.getElementById('ma-repeat').value='none';
    document.getElementById('ma-date').value='';
    document.getElementById('ma-from').value='';
    document.getElementById('ma-to').value='';
    document.getElementById('ma-until').value='';
    document.getElementById('ma-note').value='';
    document.getElementById('ma-err').style.display='none';
    document.getElementById('ma-del').style.display='none';
    ['av-yes','av-no'].forEach(id=>document.getElementById(id).className='av-btn');
    ['ma-sb-f','ma-sb-a','ma-sb-p'].forEach(id=>document.getElementById(id).className='slt-btn');
    this.onRepeatChange();
  },
  async save(){
    const id=document.getElementById('ma-id').value;
    const type=document.getElementById('ma-type').value;
    const slot=document.getElementById('ma-slot').value;
    const repeatMode=document.getElementById('ma-repeat').value;
    const note=document.getElementById('ma-note').value.trim();
    const err=document.getElementById('ma-err');
    err.style.display='none';
    if(!type){err.textContent='Please select Available or Unavailable.';err.style.display='block';return;}
    if(!slot){err.textContent='Please select a time slot.';err.style.display='block';return;}

    let startDate, endDate=null, repeatUntil=null;
    if(repeatMode==='range'){
      startDate=document.getElementById('ma-from').value;
      endDate=document.getElementById('ma-to').value;
      if(!startDate||!endDate){err.textContent='Please fill in both From and To dates.';err.style.display='block';return;}
      if(endDate<startDate){err.textContent='End date must be after start date.';err.style.display='block';return;}
    } else {
      startDate=document.getElementById('ma-date').value;
      if(!startDate){err.textContent='Please select a date.';err.style.display='block';return;}
      if(repeatMode==='weekly'||repeatMode==='monthly'){
        repeatUntil=document.getElementById('ma-until').value;
        if(!repeatUntil){err.textContent='Please select an end date for the repeat.';err.style.display='block';return;}
      }
    }

    const u=App.user;
    Spin.on();
    try{
      const aid=id||U.uuid();
      const rule={id:aid,userId:u.uid,userName:u.name,userCountry:u.country||'',startDate,endDate,slot,type,repeatMode,repeatUntil,note,created:Date.now()};
      await fbSet(`availability/${aid}`,rule);
      Cache.availability[aid]=rule;
      M.close('m-avail'); Cal.render();
      toast('Availability saved.');
    } catch(e){ toast('Save failed: '+e.message,'err'); }
    finally{ Spin.off(); }
  },
  async del(){
    const id=document.getElementById('ma-id').value;
    if(!id||!confirm('Delete this availability rule?')) return;
    Spin.on();
    try{
      await fbDel(`availability/${id}`);
      delete Cache.availability[id];
      M.close('m-avail'); Cal.render();
      toast('Rule deleted.');
    } catch(e){ toast('Delete failed.','err'); }
    finally{ Spin.off(); }
  }
};

// ════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════
const Adm = {
  cur: new Date(),
  view: 'tl',
  filtered: [],
  country: '',

  init(){
    this.cur=new Date();
    document.getElementById('f-mo').value=U.monthKey(this.cur);
    this._buildCountryBar();
    this._fillFilterOpts();
    this.applyFilters();
  },

  async refresh(){
    Spin.on(); await Cache.loadAll(); Spin.off();
    this.init(); toast('Dashboard refreshed.');
  },

  _buildCountryBar(){
    const bar=document.getElementById('country-bar');
    bar.innerHTML='';
    const all=el('div','c-chip'+(this.country===''?' on':''));
    all.textContent='🌍 All countries'; all.onclick=()=>this._setCountry('');
    bar.appendChild(all);
    COUNTRIES.forEach(c=>{
      const chip=el('div','c-chip'+(this.country===c?' on':''));
      chip.textContent=FLAGS[c]+' '+c;
      chip.onclick=()=>this._setCountry(c);
      bar.appendChild(chip);
    });
  },

  _setCountry(c){
    this.country=c;
    this._buildCountryBar();
    this.applyFilters();
  },

  setView(v){
    this.view=v;
    document.getElementById('vw-tl').style.display=v==='tl'?'block':'none';
    document.getElementById('vw-wk').style.display=v==='wk'?'block':'none';
    document.getElementById('vw-ls').style.display=v==='ls'?'block':'none';
    ['tl','wk','ls'].forEach(id=>document.getElementById('nt-'+id).className='ntab'+(v===id?' on':''));
    this._render();
  },

  prev(){
    if(this.view==='wk'){ this.cur=new Date(this.cur); this.cur.setDate(this.cur.getDate()-7); this._render(); return; }
    this.cur=new Date(this.cur.getFullYear(),this.cur.getMonth()-1,1); document.getElementById('f-mo').value=U.monthKey(this.cur); this.applyFilters();
  },
  next(){
    if(this.view==='wk'){ this.cur=new Date(this.cur); this.cur.setDate(this.cur.getDate()+7); this._render(); return; }
    this.cur=new Date(this.cur.getFullYear(),this.cur.getMonth()+1,1); document.getElementById('f-mo').value=U.monthKey(this.cur); this.applyFilters();
  },

  _fillFilterOpts(){
    const all=Cache.entriesArr();
    const users=U.uniq(all.map(e=>e.userName));
    const clients=U.uniq(all.map(e=>e.clientName));
    const facs=U.uniq(all.map(e=>e.factory));
    const fill=(id,items)=>{ const s=document.getElementById(id),cur=s.value,base=s.options[0].outerHTML; s.innerHTML=base+items.map(x=>`<option ${cur===x?'selected':''}>${U.esc(x)}</option>`).join(''); };
    fill('f-us',users); fill('f-cl',clients); fill('f-fa',facs);
  },

  applyFilters(){
    const mk=document.getElementById('f-mo').value;
    if(mk){ const[y,m]=mk.split('-').map(Number); this.cur=new Date(y,m-1,1); }
    document.getElementById('adm-lbl').textContent=U.monthLabel(this.cur);
    const us=document.getElementById('f-us').value;
    const cl=document.getElementById('f-cl').value;
    const fa=document.getElementById('f-fa').value;
    const cur=U.monthKey(this.cur);
    this.filtered=Cache.entriesArr().filter(e=>{
      if(mk&&!e.date.startsWith(cur)) return false;
      if(this.country&&e.userCountry!==this.country) return false;
      if(us&&e.userName!==us) return false;
      if(cl&&e.clientName!==cl) return false;
      if(fa&&e.factory!==fa) return false;
      return true;
    });
    this._fillFilterOpts();
    this._renderStats();
    this._render();
  },

  clearFilters(){
    ['f-us','f-cl','f-fa'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('f-mo').value=U.monthKey(this.cur);
    this.applyFilters();
  },

  _renderStats(){
    const mk=U.monthKey(this.cur);
    const mo=Cache.entriesArr().filter(e=>e.date.startsWith(mk));
    const fmo=this.filtered;
    const aud=Cache.usersArr().filter(u=>u.role==='controller'&&u.active).length;
    const cli=U.uniq(fmo.map(e=>e.clientName)).length;
    const full=fmo.filter(e=>e.slot==='Full Day').length;
    const half=fmo.filter(e=>e.slot!=='Full Day').length;
    const expT=fmo.reduce((s,e)=>s+(e.expectedQty||0),0);
    const finT=fmo.reduce((s,e)=>s+(e.finalQty||0),0);
    document.getElementById('adm-stats').innerHTML=
      `<div class="stat"><div class="sv">${aud}</div><div class="sl">Controllers</div></div>`+
      `<div class="stat"><div class="sv">${fmo.length}</div><div class="sl">Bookings${this.country?' ('+this.country+')':''}</div></div>`+
      `<div class="stat"><div class="sv">${cli}</div><div class="sl">Clients</div></div>`+
      `<div class="stat"><div class="sv">${full}</div><div class="sl">Full days</div></div>`+
      `<div class="stat"><div class="sv">${half}</div><div class="sl">Half days</div></div>`+
      `<div class="stat"><div class="sv">${expT||'—'}</div><div class="sl">Exp. qty total</div></div>`+
      `<div class="stat"><div class="sv">${finT||'—'}</div><div class="sl">Final qty total</div></div>`;
  },

  _render(){ if(this.view==='tl') this._renderTl(); else if(this.view==='wk') this._renderWk(); else this._renderList(); },

  _renderTl(){
    const y=this.cur.getFullYear(), m=this.cur.getMonth();
    const dCount=U.daysInMonth(y,m), today=U.today();

    // Filtered users (by country)
    const allUsers=Cache.usersArr().filter(u=>u.role==='controller'&&u.active&&(!this.country||u.country===this.country));
    allUsers.sort((a,b)=>(a.country||'').localeCompare(b.country||'')||a.name.localeCompare(b.name));

    // Entry map by userId+date
    const eMap={};
    Cache.entriesArr().forEach(e=>{
      const k=e.userId+'|'+e.date; (eMap[k]=eMap[k]||[]).push(e);
    });

    // Availability map by userId+date
    const aMap={};
    Cache.availArr().forEach(rule=>{
      U.expandAvail(rule,y,m).forEach(date=>{
        const k=rule.userId+'|'+date; (aMap[k]=aMap[k]||[]).push(rule);
      });
    });

    if(!allUsers.length){
      document.getElementById('tl-tbl').innerHTML='<tr><td style="padding:2rem;text-align:center;color:var(--txs)">No controllers found for this country. Add users in ⚙ Settings.</td></tr>';
      return;
    }

    let hdr='<thead><tr><th style="text-align:left;padding:.4rem .6rem">Controller</th>';
    for(let d=1;d<=dCount;d++){
      const ds=`${y}-${S2(m+1)}-${S2(d)}`;
      const isT=ds===today, isW=U.isWeekend(y,m,d);
      const wd=new Date(y,m,d).toLocaleString('en-GB',{weekday:'short'}).slice(0,2);
      hdr+=`<th class="${isT?'tc-td':isW?'wknd-col':''}">${wd}<br>${d}</th>`;
    }
    hdr+='</tr></thead>';

    let body='<tbody>';
    let lastCountry='';
    allUsers.forEach(u=>{
      // Country group separator
      if(u.country!==lastCountry&&u.country){
        lastCountry=u.country;
        body+=`<tr style="background:#f1f5f9"><td colspan="${dCount+1}" style="padding:.3rem .6rem;font-size:.7rem;font-weight:800;color:var(--txs);text-transform:uppercase;letter-spacing:.06em">${U.flag(u.country)} ${U.esc(u.country)}</td></tr>`;
      }
      body+=`<tr><td style="padding:.4rem .6rem"><div class="tl-un">${U.esc(u.name)}</div>${u.country?`<div class="tl-co">${U.flag(u.country)} ${U.esc(u.country)}</div>`:''}</td>`;
      for(let d=1;d<=dCount;d++){
        const ds=`${y}-${S2(m+1)}-${S2(d)}`;
        const isT=ds===today, isW=U.isWeekend(y,m,d);
        const de=eMap[u.uid+'|'+ds]||[];
        const av=aMap[u.uid+'|'+ds]||[];
        const hasAv=av.some(r=>r.type==='available'), hasUn=av.some(r=>r.type==='unavailable');
        let dots='';
        de.forEach(e=>{
          const dc=U.dotCls(e.slot);
          const tip=`${U.esc(u.name)}: ${U.esc(e.slot)} – ${U.esc(e.clientName||'')} @ ${U.esc(e.factory||'')}${e.expectedQty!=null?' | Exp: '+e.expectedQty:''}${e.finalQty!=null?' | Final: '+e.finalQty:''}`;
          dots+=`<div class="tl-dot ${dc}" data-tip="${tip.replace(/"/g,'&quot;')}" data-eid="${e.id}" style="cursor:pointer"></div>`;
        });
        if(hasAv&&!hasUn) dots+=`<div class="av-dot av-y" title="Available"></div>`;
        if(hasUn) dots+=`<div class="av-dot av-n" title="Unavailable"></div>`;
        const cellClick=de.length===0?`onclick="Slot.add('${ds}','${u.uid}')" title="Add booking for ${U.esc(u.name)}" style="cursor:pointer"`:``;
        body+=`<td class="${isT?'tc-td':isW?'wknd-col':''}"><div class="tl-cell" ${cellClick}>${dots}</div></td>`;
      }
      body+='</tr>';
    });
    body+='</tbody>';

    document.getElementById('tl-tbl').innerHTML=hdr+body;
    const tip=document.getElementById('tip');
    document.getElementById('tl-tbl').querySelectorAll('.tl-dot').forEach(dot=>{
      dot.addEventListener('mouseenter',e=>{ tip.textContent=e.target.dataset.tip||''; tip.style.display='block'; });
      dot.addEventListener('mousemove',e=>{ tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY-10)+'px'; });
      dot.addEventListener('mouseleave',()=>{ tip.style.display='none'; });
      dot.addEventListener('click',e=>{ e.stopPropagation(); tip.style.display='none'; Slot.edit(e.target.dataset.eid); });
    });
  },

  _renderWk(){
    const today=U.today();
    // Monday of cur week
    const base=new Date(this.cur);
    const dow=base.getDay()===0?6:base.getDay()-1;
    base.setDate(base.getDate()-dow);
    const days=[]; for(let i=0;i<7;i++){ const d=new Date(base); d.setDate(base.getDate()+i); days.push(d); }
    const startLabel=days[0].toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    const endLabel=days[6].toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    document.getElementById('adm-lbl').textContent=`${startLabel} – ${endLabel}`;
    // All active controllers
    const allUsers=Cache.usersArr().filter(u=>u.role==='controller'&&u.active&&(!this.country||u.country===this.country));
    allUsers.sort((a,b)=>(a.country||'').localeCompare(b.country||'')||a.name.localeCompare(b.name));
    const WDAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    // Build entry map
    const eMap={};
    Cache.entriesArr().forEach(e=>{ const k=e.userId+'|'+e.date; (eMap[k]=eMap[k]||[]).push(e); });
    if(!allUsers.length){ document.getElementById('wk-content').innerHTML='<div style="padding:2rem;text-align:center;color:var(--txs)">No controllers for this filter.</div>'; return; }
    let html='<div style="overflow-x:auto"><table class="tl" style="min-width:700px"><thead><tr><th style="text-align:left;padding:.4rem .6rem;min-width:110px">Controller</th>';
    days.forEach((d,i)=>{ const ds=d.toISOString().slice(0,10); const isT=ds===today,isW=d.getDay()===0||d.getDay()===6; html+=`<th class="${isT?'tc-td':isW?'wknd-col':''}">${WDAYS[i]}<br>${d.getDate()}</th>`; });
    html+='</tr></thead><tbody>';
    let lastCountry='';
    allUsers.forEach(u=>{
      if(u.country!==lastCountry&&u.country){ lastCountry=u.country; html+=`<tr style="background:#f1f5f9"><td colspan="8" style="padding:.3rem .6rem;font-size:.7rem;font-weight:800;color:var(--txs);text-transform:uppercase">${U.flag(u.country)} ${U.esc(u.country)}</td></tr>`; }
      html+=`<tr><td style="padding:.4rem .6rem"><div class="tl-un">${U.esc(u.name)}</div></td>`;
      days.forEach(d=>{
        const ds=d.toISOString().slice(0,10);
        const isT=ds===today, isW=d.getDay()===0||d.getDay()===6;
        const de=eMap[u.uid+'|'+ds]||[];
        let cells='';
        de.forEach(e=>{ cells+=`<div class="tl-dot ${U.dotCls(e.slot)}" data-eid="${e.id}" style="cursor:pointer" title="${U.esc(e.slot+' – '+(e.clientName||'')+(e.factory?' @ '+e.factory:''))}"></div>`; });
        const click=de.length===0?`onclick="Slot.add('${ds}','${u.uid}')" style="cursor:pointer" title="Add booking"`:'' ;
        html+=`<td class="${isT?'tc-td':isW?'wknd-col':''}"><div class="tl-cell" ${click}>${cells||''}</div></td>`;
      });
      html+='</tr>';
    });
    html+='</tbody></table></div>';
    document.getElementById('wk-content').innerHTML=html;
    // Bind dot clicks
    document.getElementById('wk-content').querySelectorAll('.tl-dot[data-eid]').forEach(dot=>{
      dot.addEventListener('click',e=>{ e.stopPropagation(); Slot.edit(e.target.dataset.eid); });
    });
  },

  _renderList(){
    const f=this.filtered;
    if(!f.length){ document.getElementById('ls-content').innerHTML='<div class="empty"><div class="empty-ic">📭</div><div class="empty-t">No bookings found</div><div class="empty-s">Adjust filters above.</div></div>'; return; }
    const sorted=[...f].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
    let html='<div style="overflow-x:auto"><table class="ltab"><thead><tr><th>Date</th><th>Controller</th><th>Country</th><th>Slot</th><th>Client</th><th>Factory</th><th>Exp. Qty</th><th>Final Qty</th><th>Notes</th></tr></thead><tbody>';
    sorted.forEach(e=>{
      html+=`<tr style="cursor:pointer" onclick="Slot.edit('${e.id}')" title="Click to edit"><td><strong>${U.fmt(e.date)}</strong></td><td>${U.flag(e.userCountry)} ${U.esc(e.userName)}</td><td>${U.esc(e.userCountry)}</td><td><span class="badge ${U.badgeCls(e.slot)}">${U.esc(e.slot)}</span></td><td>${U.esc(e.clientName)}</td><td>${U.esc(e.factory)}</td><td style="text-align:right">${e.expectedQty!=null?e.expectedQty:'<span style="color:var(--txs)">—</span>'}</td><td style="text-align:right">${e.finalQty!=null?e.finalQty:'<span style="color:var(--txs)">—</span>'}</td><td style="color:var(--txs);font-size:.76rem">${U.esc(e.notes)}</td></tr>`;
    });
    html+='</tbody></table></div>';
    document.getElementById('ls-content').innerHTML=html;
  },

  exportCSV(){
    const f=this.filtered;
    if(!f.length){ toast('No entries to export.','err'); return; }
    const sorted=[...f].sort((a,b)=>a.date<b.date?-1:1);
    let csv='Date,Controller,Country,Slot,Client,Factory,Expected Qty,Final Qty,Notes\n';
    sorted.forEach(e=>{ csv+=[e.date,e.userName,e.userCountry,e.slot,e.clientName,e.factory,e.expectedQty??'',e.finalQty??'',e.notes||''].map(v=>'"'+String(v||'').replace(/"/g,'""')+'"').join(',')+'\n'; });
    const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),download:`coradam-planner-${U.monthKey(this.cur)}.csv`});
    a.click(); toast('CSV exported.');
  }
};

// ════════════════════════════════════
// SETTINGS
// ════════════════════════════════════
const Sett = {
  _tab:'users',

  tab(name){
    this._tab=name;
    document.querySelectorAll('.stab').forEach((t,i)=>t.classList.toggle('on',['users','clients','data','freshbooks'][i]===name));
    document.querySelectorAll('.gtab').forEach(t=>t.classList.remove('on'));
    document.getElementById('gt-'+name).classList.add('on');
    if(name==='users') this._renderUsers();
    if(name==='clients') this._renderClients();
    if(name==='freshbooks') FB.render();
  },

  init(){ this.tab(this._tab); },

  _renderUsers(){
    const users=Cache.usersArr().filter(u=>u.role!=='super_admin').sort((a,b)=>(a.country||'').localeCompare(b.country||'')||a.name.localeCompare(b.name));
    if(!users.length){ document.getElementById('u-tbody').innerHTML=`<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--txs)">No controllers yet. Click "+ Add Controller" to pre-register them by email.</td></tr>`; return; }
    document.getElementById('u-tbody').innerHTML=users.map(u=>{
      const uClients=Cache.clientsArr().filter(c=>(c.userIds||[]).includes(u.uid)).map(c=>U.esc(c.name)).join(', ')||'<span style="color:var(--txs)">none</span>';
      const statusBadge=u.pending?'<span class="badge" style="background:#f59e0b;color:#fff">Pending</span>':`<span class="badge ${u.active?'b-on':'b-off'}">${u.active?'Active':'Inactive'}</span>`;
      return `<tr><td><strong>${U.esc(u.name||u.email.split('@')[0])}</strong></td><td style="font-size:.76rem">${U.esc(u.email)}</td><td>${u.country?U.flag(u.country)+' '+U.esc(u.country):'<span style="color:var(--txs)">—</span>'}</td><td style="font-size:.76rem">${uClients}</td><td>${statusBadge}</td><td style="white-space:nowrap"><button class="btn btn-s btn-sm" onclick="Sett.editUser('${u.uid}')">Edit</button> <button class="btn btn-d btn-sm" onclick="Sett.deleteUser('${u.uid}')">Delete</button></td></tr>`;
    }).join('');
  },

  openInvite(){
    document.getElementById('inv-email').value='';
    document.getElementById('inv-country').value='';
    document.getElementById('inv-err').style.display='none';
    M.open('m-invite');
  },

  async inviteController(){
    const email=document.getElementById('inv-email').value.trim().toLowerCase();
    const country=document.getElementById('inv-country').value;
    const err=document.getElementById('inv-err');
    err.style.display='none';
    if(!email){ err.textContent='Please enter an email address.'; err.style.display='block'; return; }
    if(!email.endsWith('@'+ALLOWED_DOMAIN)){ err.textContent='Only @coradam.com addresses are allowed.'; err.style.display='block'; return; }
    if(Cache.usersArr().find(u=>u.email===email)){ err.textContent='This email is already registered.'; err.style.display='block'; return; }
    Spin.on();
    try{
      const uid='pending_'+U.uuid();
      const name=email.split('@')[0].replace(/\./g,' ').replace(/\b\w/g,c=>c.toUpperCase());
      const profile={uid,email,name,country,role:'controller',active:true,pending:true,created:Date.now()};
      await fbSet(`users/${uid}`,profile); Cache.users[uid]=profile;
      M.close('m-invite'); this._renderUsers(); toast('Controller added.');
    } catch(e){ err.textContent='Save failed: '+(e?.message||e); err.style.display='block'; }
    finally{ Spin.off(); }
  },

  editUser(uid){
    const u=Cache.users[uid]; if(!u) return;
    document.getElementById('mu-title').textContent='Edit — '+u.name;
    document.getElementById('mu-uid').value=uid;
    document.getElementById('mu-country').value=u.country||'';
    document.getElementById('mu-err').style.display='none';
    // Fill client checkboxes
    const clients=Cache.clientsArr();
    document.getElementById('mu-clients').innerHTML=clients.length?clients.map(c=>`<label class="chk-item"><input type="checkbox" value="${c.id}" ${(c.userIds||[]).includes(uid)?'checked':''}>${U.esc(c.name)}</label>`).join(''):'<div style="color:var(--txs);font-size:.8rem;padding:.3rem">No clients yet.</div>';
    M.open('m-user');
  },

  async saveUser(){
    const uid=document.getElementById('mu-uid').value;
    const country=document.getElementById('mu-country').value;
    const err=document.getElementById('mu-err');
    err.style.display='none';
    const checkedClientIds=[...document.querySelectorAll('#mu-clients input:checked')].map(cb=>cb.value);
    Spin.on();
    try{
      // Update user country
      const u={...Cache.users[uid],country};
      await fbSet(`users/${uid}`,u); Cache.users[uid]=u;
      // Update client assignments
      for(const c of Cache.clientsArr()){
        const wasIn=(c.userIds||[]).includes(uid);
        const shouldBeIn=checkedClientIds.includes(c.id);
        if(wasIn!==shouldBeIn){
          const newIds=shouldBeIn?[...(c.userIds||[]),uid]:(c.userIds||[]).filter(id=>id!==uid);
          const updated={...c,userIds:newIds};
          await fbSet(`clients/${c.id}`,updated); Cache.clients[c.id]=updated;
        }
      }
      M.close('m-user'); this._renderUsers(); toast('Controller updated.');
    } catch(e){ console.error('saveUser error',e); err.textContent='Save failed: '+(e?.message||e); err.style.display='block'; }
    finally{ Spin.off(); }
  },

  async deleteUser(uid){
    const u=Cache.users[uid]; if(!u) return;
    if(!confirm(`Delete ${u.name||u.email}? This will also remove all their bookings and availability rules.`)) return;
    Spin.on();
    try{
      // Remove from client assignments
      for(const c of Cache.clientsArr()){
        if((c.userIds||[]).includes(uid)){
          const updated={...c,userIds:c.userIds.filter(id=>id!==uid)};
          await fbSet(`clients/${c.id}`,updated); Cache.clients[c.id]=updated;
        }
      }
      // Delete entries
      for(const e of Cache.entriesArr().filter(e=>e.userId===uid)){
        await fbDel(`entries/${e.id}`); delete Cache.entries[e.id];
      }
      // Delete availability rules
      for(const a of Cache.availArr().filter(a=>a.userId===uid)){
        await fbDel(`availability/${a.id}`); delete Cache.avail[a.id];
      }
      // Delete user profile
      await fbDel(`users/${uid}`); delete Cache.users[uid];
      this._renderUsers(); toast('Controller deleted.');
    } catch(e){ toast('Delete failed: '+(e?.message||e),'err'); }
    finally{ Spin.off(); }
  },

  async saveProfile(){
    const country=document.getElementById('profile-country').value;
    const uid=App.user.uid;
    Spin.on();
    try{
      const u={...Cache.users[uid],country};
      await fbSet(`users/${uid}`,u); Cache.users[uid]=u; App.user=u;
      toast('Profile saved.');
    } catch{ toast('Save failed.','err'); }
    finally{ Spin.off(); }
  },

  _renderClients(){
    const clients=Cache.clientsArr().sort((a,b)=>a.name.localeCompare(b.name));
    if(!clients.length){ document.getElementById('c-tbody').innerHTML=`<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--txs)">No clients yet.</td></tr>`; return; }
    document.getElementById('c-tbody').innerHTML=clients.map(c=>{
      const facs=(c.factories||[]).join(', ')||'—';
      const auds=(c.userIds||[]).map(uid=>Cache.users[uid]?.name||'').filter(Boolean).join(', ')||'—';
      return `<tr><td><strong>${U.esc(c.name)}</strong></td><td style="font-size:.76rem;color:var(--txs)">${U.esc(facs)}</td><td style="font-size:.76rem">${U.esc(auds)}</td><td><button class="btn btn-s btn-sm" onclick="Sett.editClient('${c.id}')">Edit</button></td></tr>`;
    }).join('');
  },

  openAddClient(){
    document.getElementById('mc-title').textContent='Add Client';
    document.getElementById('mc-id').value='';
    document.getElementById('mc-name').value='';
    document.getElementById('mc-facs').value='';
    document.getElementById('mc-err').style.display='none';
    document.getElementById('mc-del').style.display='none';
    this._fillClientUserChk([]);
    M.open('m-client');
  },

  editClient(id){
    const c=Cache.clients[id]; if(!c) return;
    document.getElementById('mc-title').textContent='Edit Client — '+c.name;
    document.getElementById('mc-id').value=id;
    document.getElementById('mc-name').value=c.name||'';
    document.getElementById('mc-facs').value=(c.factories||[]).join('\n');
    document.getElementById('mc-err').style.display='none';
    document.getElementById('mc-del').style.display='inline-flex';
    this._fillClientUserChk(c.userIds||[]);
    M.open('m-client');
  },

  _fillClientUserChk(assigned){
    const users=Cache.usersArr().filter(u=>u.role==='controller'&&u.active).sort((a,b)=>a.name.localeCompare(b.name));
    document.getElementById('mc-users').innerHTML=users.length?users.map(u=>`<label class="chk-item"><input type="checkbox" value="${u.uid}" ${assigned.includes(u.uid)?'checked':''}>${U.flag(u.country)} ${U.esc(u.name)}${u.country?' ('+u.country+')':''}</label>`).join(''):'<div style="color:var(--txs);font-size:.8rem;padding:.3rem">No controllers yet.</div>';
  },

  async saveClient(){
    const id=document.getElementById('mc-id').value;
    const name=document.getElementById('mc-name').value.trim();
    const facs=document.getElementById('mc-facs').value.split('\n').map(s=>s.trim()).filter(Boolean);
    const err=document.getElementById('mc-err');
    err.style.display='none';
    if(!name){err.textContent='Client name is required.';err.style.display='block';return;}
    const userIds=[...document.querySelectorAll('#mc-users input:checked')].map(cb=>cb.value);
    Spin.on();
    try{
      const cid=id||U.uuid();
      const client={id:cid,name,factories:facs,userIds};
      await fbSet(`clients/${cid}`,client); Cache.clients[cid]=client;
      M.close('m-client'); this._renderClients(); toast('Client saved.');
    } catch(e){ console.error('saveClient error',e); document.getElementById('mc-err').textContent='Save failed: '+(e?.message||e); document.getElementById('mc-err').style.display='block'; }
    finally{ Spin.off(); }
  },

  async delClient(){
    const id=document.getElementById('mc-id').value;
    if(!id||!confirm('Delete this client?')) return;
    Spin.on();
    try{
      await fbDel(`clients/${id}`); delete Cache.clients[id];
      M.close('m-client'); this._renderClients(); toast('Client deleted.');
    } catch{ toast('Failed.','err'); }
    finally{ Spin.off(); }
  },

  async bulkImport(){
    const IMPORT_CLIENTS=[
      {name:"Akillis",                                       factories:["HQ"]},
      {name:"AS29",                                          factories:["Orogems","Delora"]},
      {name:"Boucheron",                                     factories:["HQ"]},
      {name:"Chanel",                                        factories:["HQ"]},
      {name:"Chaumet",                                       factories:["HQ","RASELLI FRANCO SPA","BMC SPA","Nuovi","Patros"]},
      {name:"Christian Dior Couture",                        factories:["HQ","Perroud","FG"]},
      {name:"Coradam Ltd",                                   factories:["HQ"]},
      {name:"De Beers Diamond Jewellers",                    factories:["Ennovie","Eclats Jewelry","Gamma Creations","Breuning","Coringer","Zarian"]},
      {name:"DoDo Pomelatto Spa",                            factories:["Goldfine"]},
      {name:"Édéenne",                                       factories:["Gamma Creations"]},
      {name:"Eleanat",                                       factories:["PRGLUX"]},
      {name:"FRED Paris",                                    factories:["HQ"]},
      {name:"Gübelin",                                       factories:["Delora","Gamma Creations","Eclats Jewelry","Casting House"]},
      {name:"HRH sarl",                                      factories:["HQ"]},
      {name:"Idyl",                                          factories:["Casting House","Orogems","Breuning","Eclats Jewelry"]},
      {name:"Jenny Bird USA Inc.",                           factories:["Goldfine","Pranda"]},
      {name:"Kennedy Watches & Jewellery Pty Ltd",           factories:[]},
      {name:"Les Ateliers Joailliers LV",                    factories:["HQ"]},
      {name:"Les Ateliers VCA",                              factories:["HQ","Mattioli"]},
      {name:"Made Truly",                                    factories:[]},
      {name:"Manufacture des Accessoires Louis Vuitton SRL", factories:[]},
      {name:"Mayrena Paris",                                 factories:["Piyapoom","Goldfine"]},
      {name:"Mazarin Paris",                                 factories:["RGS","Orcatilla"]},
      {name:"Moltke BVBA",                                   factories:[]},
      {name:"Nicholas Moltke",                               factories:[]},
      {name:"Pérouse Paris",                                 factories:["Pranda"]},
      {name:"Prada SpA",                                     factories:["André Messika Gems","Trimoro"]},
      {name:"Repossi",                                       factories:["HQ","Big Bag S.R.L","BMC SPA","Fratelli Bovo S.r.l","Atelier Checchin S.R.L","RASELLI FRANCO SPA","Staurino"]},
      {name:"Rouvenat",                                      factories:["HQ","Trimoro"]},
      {name:"SAS Atelier Lutèce",                            factories:[]},
      {name:"Sybarite Jewellery Ltd",                        factories:["Mousson Atelier"]},
      {name:"Tiffany & Co",                                  factories:["HQ"]},
      {name:"VEVER",                                         factories:["HQ"]},
      {name:"Walking Tree EU bvba",                          factories:["Store"]},
    ];
    const existingNames=Cache.clientsArr().map(c=>c.name.toLowerCase());
    const toAdd=IMPORT_CLIENTS.filter(c=>!existingNames.includes(c.name.toLowerCase()));
    if(!toAdd.length){ toast('All clients already exist — nothing to import.'); return; }
    if(!confirm(`Import ${toAdd.length} new client(s) into the planner?\n\n${toAdd.map(c=>'• '+c.name).join('\n')}`)) return;
    Spin.on();
    try{
      for(const c of toAdd){
        const id=U.uuid();
        const client={id,name:c.name,factories:c.factories,userIds:[]};
        await fbSet(`clients/${id}`,client);
        Cache.clients[id]=client;
      }
      this._renderClients();
      toast(`${toAdd.length} client(s) imported.`);
    } catch(e){ toast('Import failed: '+e.message,'err'); }
    finally{ Spin.off(); }
  },

  async wipeAll(){
    if(!confirm('⚠ WIPE ALL data (users, clients, bookings, availability) permanently?\n\nThis cannot be undone.')) return;
    Spin.on();
    try{
      await Promise.all([fbDel('users'),fbDel('clients'),fbDel('entries'),fbDel('availability')]);
      await fauth.signOut();
      toast('All data wiped.'); setTimeout(()=>location.reload(),1500);
    } catch{ toast('Failed.','err'); }
    finally{ Spin.off(); }
  }
};

// ════════════════════════════════════
// FRESHBOOKS INTEGRATION
// ════════════════════════════════════
const FB = {
  _status: null,
  _clientId: null,
  _workerUrl: null,

  async render(){
    const sec=document.getElementById('gt-freshbooks');
    if(!sec) return;
    sec.innerHTML='<div style="padding:2rem;color:var(--txs);font-size:.9rem"><p>Freshbooks integration is not currently active.</p><p style="margin-top:.5rem;font-size:.8rem;opacity:.7">To enable it, a Cloudflare Worker must be deployed. Contact your administrator.</p></div>';
  },

  _build(){},
  async _saveConfig(){},
  async _disconnect(){},
  async _loadClients(){},
  async _import(){},
  async _generate(){},
  async _callWorker(){ throw new Error('Freshbooks integration not active'); }
};

// ════════════════════════════════════
// BOOT
// ════════════════════════════════════
App.init();
