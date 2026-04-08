'use strict';
// ════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════
const ALLOWED_DOMAIN = 'coradam.com';
const COUNTRIES = ['Italy','Thailand','France','Portugal','Spain','India'];
const FLAGS = {Italy:'🇮🇹',Thailand:'🇹🇭',France:'🇫🇷',Portugal:'🇵🇹',Spain:'🇪🇸',India:'🇮🇳'};

// ════════════════════════════════════
// DEBUG LOGGING
// Set DEBUG = true locally to restore console output.
// In production this is false so no internal state leaks to the browser console.
// ════════════════════════════════════
const DEBUG = false;
const log = {
  info:  (...a) => { if (DEBUG) console.log(...a);   },
  warn:  (...a) => { if (DEBUG) console.warn(...a);  },
  error: (...a) => { if (DEBUG) console.error(...a); },
};

// ════════════════════════════════════
// UTILS
// ════════════════════════════════════
const U = {
  uuid(){ return crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)}); },
  today(){ const d=new Date(); return `${d.getFullYear()}-${S2(d.getMonth()+1)}-${S2(d.getDate())}`; },
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
    const base = parseLocalDate(rule.startDate);
    const end = rule.endDate ? parseLocalDate(rule.endDate) : null;
    const until = rule.repeatUntil ? parseLocalDate(rule.repeatUntil) : last;
    if(mode==='none'){
      if(end){
        let d=new Date(Math.max(base,first));
        const stop=new Date(Math.min(end,last));
        while(d<=stop){ dates.push(localDateStr(d)); d.setDate(d.getDate()+1); }
      } else if(rule.startDate.startsWith(mStr)) dates.push(rule.startDate);
    } else if(mode==='weekly'){
      let d=new Date(base);
      while(d<=until){
        if(d>=first&&d<=last) dates.push(localDateStr(d));
        d.setDate(d.getDate()+7);
      }
    } else if(mode==='monthly'){
      let d=new Date(base);
      while(d<=until){
        if(d>=first&&d<=last) dates.push(localDateStr(d));
        d.setMonth(d.getMonth()+1);
      }
    }
    return dates;
  }
};
function S2(n){ return String(n).padStart(2,'0'); }
// Use local calendar date (not UTC) so cells/dates match wall-clock day in all timezones
function localDateStr(d){ return `${d.getFullYear()}-${S2(d.getMonth()+1)}-${S2(d.getDate())}`; }
// Parse a YYYY-MM-DD string as local midnight (avoids UTC-shift on new Date('YYYY-MM-DD'))
function parseLocalDate(s){ const[y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd); }
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
let fapp, fauth, fdb, fstorage;
function fbRef(path){ return fdb.ref(path); }

// Wraps any Firebase promise in a 15-second timeout so a broken or
// stalled connection surfaces as a clear error instead of an infinite spinner.
const FB_TIMEOUT_MS = 15000;
function fbTimeout(promise){
  return Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('Firebase request timed out. Please check your connection and try again.')),FB_TIMEOUT_MS))
  ]);
}

async function fbGet(path){ const s=await fbTimeout(fbRef(path).get()); return s.val(); }
async function fbSet(path,val){ await fbTimeout(fbRef(path).set(val)); }
async function fbUpdate(path,val){ await fbTimeout(fbRef(path).update(val)); }
async function fbDel(path){ await fbTimeout(fbRef(path).remove()); }
async function fbPush(path,val){ const r=fbRef(path).push(); await fbTimeout(r.set({...val,id:r.key})); return r.key; }

// ════════════════════════════════════
// IN-MEMORY CACHE
// ════════════════════════════════════
const Cache = {
  users:{}, clients:{}, entries:{}, availability:{}, documents:{},
  async loadAll(){
    const [u,c,e,a]=await Promise.all([fbGet('users'),fbGet('clients'),fbGet('entries'),fbGet('availability')]);
    this.users=u||{}; this.clients=c||{}; this.entries=e||{}; this.availability=a||{};
  },
  usersArr(){ return Object.values(this.users); },
  clientsArr(){ return Object.values(this.clients); },
  entriesArr(){ return Object.values(this.entries); },
  availArr(){ return Object.values(this.availability); },
  clientsFor(uid){ return this.clientsArr().filter(c=>(c.userIds||[]).includes(uid)); },
  availForUser(uid){ return this.availArr().filter(a=>a.userId===uid); },
  documentsFor(controllerUid){ return Object.values(this.documents[controllerUid]||{}); },
  async loadDocuments(controllerUid){
    const docs=await fbGet(`documents/${controllerUid}`);
    this.documents[controllerUid]=docs||{};
    return this.documentsFor(controllerUid);
  }
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
      // Strip optional JS variable assignment wrapper and trailing semicolon, then parse as strict JSON
      const clean=raw.replace(/^const\s+firebaseConfig\s*=\s*/,'').replace(/;?\s*$/,'');
      cfg = JSON.parse(clean);
    } catch{
      err.innerHTML='<strong>Invalid config.</strong> Paste the Firebase config as valid JSON — all keys must be in double quotes. It starts with <code>{</code> and ends with <code>}</code>.';
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
      const provider=new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({hd:ALLOWED_DOMAIN});
      // Request Drive.file scope for document upload feature
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      const result=await fauth.signInWithPopup(provider);
      // Store Google OAuth access token for Drive API calls
      if(result.credential) App._driveToken=result.credential.accessToken||null;
    } catch(e){
      log.error('Google sign-in failed:', e.code, e.message, e);
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
  _driveToken: null,

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
    if(typeof firebase.storage === 'function') fstorage=firebase.storage();
    // Early RTDB connectivity check — surfaces a clear error within 5s if the
    // database is unreachable (not created, wrong URL, or network blocked).
    // Firebase's .info/connected is a WebSocket-based indicator; if it doesn't
    // fire true within 5 seconds the database endpoint is likely invalid.
    (function(){
      const dbUrl = cfg.databaseURL || '(missing databaseURL)';
      let seen = false;
      const timer = setTimeout(()=>{
        if(!seen){
          const err = document.getElementById('login-err');
          if(err){
            err.innerHTML = '<strong>Cannot reach Firebase database.</strong><br>URL: <code>'+U.esc(dbUrl)+'</code><br>Please verify this matches <em>Firebase Console → Realtime Database</em> and that the database has been created.';
            err.style.display = 'block';
          }
          log.error('[Coradam] RTDB unreachable after 5s. databaseURL:', dbUrl);
        }
      }, 5000);
      fdb.ref('.info/connected').on('value', snap=>{
        seen = true;
        clearTimeout(timer);
        log.info('[Coradam] RTDB connected:', snap.val(), '| databaseURL:', dbUrl);
        fdb.ref('.info/connected').off('value');
      });
    })();
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
            // Preserve existing role from the pending record (never derive role client-side from email)
            profile={...pending,uid:u.uid,name:u.displayName||pending.name||email.split('@')[0],photo:u.photoURL||'',role:pending.role||'controller',pending:false,firstLogin:Date.now()};
            await fbSet(`users/${u.uid}`,profile);
            Cache.users[u.uid]=profile;
            // Clean up pending record and fix client assignments (best-effort — may fail if rules block it)
            try{
              await fbDel(`users/${pending.uid}`);
              delete Cache.users[pending.uid];
            } catch(e){ log.warn('Could not delete pending record (will be cleaned by admin):',e.message); }
            // Update client userIds that referenced the pending uid (super_admin will handle if this fails)
            try{
              for(const c of Cache.clientsArr()){
                if((c.userIds||[]).includes(pending.uid)){
                  const updated={...c,userIds:c.userIds.map(id=>id===pending.uid?u.uid:id)};
                  await fbSet(`clients/${c.id}`,updated); Cache.clients[c.id]=updated;
                }
              }
            } catch(e){ log.warn('Could not update client assignments:',e.message); }
          } else {
            // New profiles always start as 'controller'; super_admin role is set by the admin in Firebase
            profile={uid:u.uid,name:u.displayName||email.split('@')[0],email,photo:u.photoURL||'',country:'',role:'controller',active:true,firstLogin:Date.now()};
            await fbSet(`users/${u.uid}`,profile);
            Cache.users[u.uid]=profile;
          }
        } else {
          // Update only name/photo from Google — role is managed by admin, never overwritten here
          const upd={name:u.displayName||profile.name,photo:u.photoURL||profile.photo};
          await fbUpdate(`users/${u.uid}`,upd);
          const merged={...profile,...upd};
          Cache.users[u.uid]=merged; profile=merged;
        }
        this.user=profile;
        this._afterLogin();
      } catch(e){
        // Include error code when available (e.g. PERMISSION_DENIED, auth/unauthorized-domain)
        const code = e.code ? ' ['+e.code+']' : '';
        toast('Load error: '+e.message+code,'err');
        log.error('[Coradam] onAuthStateChanged error:', e);
      }
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
    else if(u.role==='team_manager'){ this._goManager(); }
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

  _goManager(){
    show('mgr'); Mgr.init();
  },

  goSettings(){
    const u=this.user;
    document.getElementById('set-admin-tabs').style.display=u.role==='super_admin'?'block':'none';
    document.getElementById('set-profile').style.display=(u.role==='controller'||u.role==='team_manager')?'block':'none';
    if(u.role==='super_admin') Sett.tab('users');
    else { document.getElementById('profile-country').value=u.country||''; }
    show('set');
  },

  goProfile(){ this.goSettings(); },

  goBack(){
    if(this.user?.role==='super_admin'){
      show('adm');
      // Re-render without resetting month/filters: Adm.init() would jump back to today.
      Adm._buildCountryBar(); Adm._fillFilterOpts(); Adm.applyFilters();
    } else if(this.user?.role==='team_manager'){
      show('mgr'); Mgr.init();
    } else{ show('cal'); }
  },

  goAdmin(){
    show('adm');
    Adm._buildCountryBar(); Adm._fillFilterOpts(); Adm.applyFilters();
  },

  async reload(){
    Spin.on();
    try{
      await Cache.loadAll();
      // Re-read current user profile
      if(this.user) this.user=Cache.users[this.user.uid]||this.user;
    } catch(e){ toast('Reload failed: '+e.message,'err'); }
    finally{ Spin.off(); }
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
        chips+=`<div class="chip ${cc}" data-eid="${U.esc(e.id)}" title="${U.esc(e.slot+' – '+(e.clientName||'')+(e.factory?' @ '+e.factory:''))}">${U.esc(e.clientName||e.slot)}</div>`;
      });
      if(hasAvail&&!hasUnavail) chips+=`<div class="av-tag av-tag-yes">✓ Available</div>`;
      if(hasUnavail) chips+=`<div class="av-tag av-tag-no">✗ Unavailable</div>`;

      const d=el('div',cls);
      d.innerHTML=`<div class="dn">${day}</div><div class="dslots">${chips}</div>`;
      // Bind chip clicks via addEventListener (onclick attributes are blocked by CSP)
      d.querySelectorAll('.chip[data-eid]').forEach(chip=>{
        chip.addEventListener('click',ev=>{ ev.stopPropagation(); Slot.edit(chip.dataset.eid); });
      });
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
      const ds=localDateStr(d);
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
        body.innerHTML='<span class="cal-free-lbl">Free</span>';
      } else {
        de.forEach(e=>{
          const chip=document.createElement('div');
          chip.className='chip '+U.chipCls(e.slot);
          chip.style.marginBottom='.2rem';
          chip.innerHTML=U.esc(e.clientName||e.slot)+'<div class="chip-sub">'+U.esc(e.factory||'')+'</div>';
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
      info.innerHTML='<div class="cl-client">'+U.esc(e.clientName||'—')+' <span class="badge badge-sm '+U.badgeCls(e.slot)+'">'+e.slot+'</span></div>'
        +'<div class="cl-detail">'+U.esc(e.factory||'')+qty+(e.notes?' · '+U.esc(e.notes):'')+'</div>';
      row.appendChild(dateDiv); row.appendChild(info);
      row.addEventListener('click',()=>Slot.edit(e.id));
      wrap.appendChild(row);
    });
    container.appendChild(wrap);
  }
};

// NOTE: App is booted at the bottom of this file via _bindEvents() + App.init().
// A DOMContentLoaded listener is NOT used here because the script tag is at the
// bottom of <body>, so the DOM is fully parsed before this code runs. Adding a
// second DOMContentLoaded handler would call App.init() twice and register a
// duplicate onAuthStateChanged listener.

// ════════════════════════════════════
// SLOT (Booking)
// ════════════════════════════════════
const Slot = {
  _isAdmin(){ return App.user?.role==='super_admin'; },
  // Returns true if the current user may create/edit/delete entries for forUid
  _canManage(forUid){
    const u=App.user; if(!u) return false;
    if(u.role==='super_admin') return true;
    if(u.role==='team_manager') return !!(u.managedControllerIds||{})[forUid];
    return u.uid===forUid;
  },
  _setForUser(uid){
    document.getElementById('ms-for').value=uid||'';
    const nameEl=document.getElementById('ms-for-name');
    if(uid && (this._isAdmin()||App.user?.role==='team_manager')){
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
    // Pre-fill range start date so the user doesn't have to re-enter it when switching modes
    document.getElementById('ms-from').value=date||U.today();
    document.getElementById('ms-del').style.display='none';
    // Show recurrence panel in add mode
    document.getElementById('ms-recur-wrap').style.display='block';
    const targetUid=forUid||App.user.uid;
    this._setForUser(targetUid);
    this._fillClients(targetUid,'','');
    M.open('m-slot');
  },
  edit(id){
    const e=Cache.entries[id]; if(!e) return;
    if(!this._canManage(e.userId)) return;
    this._reset();
    document.getElementById('ms-title').textContent='Edit Booking';
    document.getElementById('ms-id').value=id;
    document.getElementById('ms-date').value=e.date;
    document.getElementById('ms-notes').value=e.notes||'';
    document.getElementById('ms-eqty').value=e.expectedQty!=null?e.expectedQty:'';
    document.getElementById('ms-fqty').value=e.finalQty!=null?e.finalQty:'';
    document.getElementById('ms-del').style.display='inline-flex';
    // Hide recurrence in edit mode — edits always affect a single occurrence
    document.getElementById('ms-recur-wrap').style.display='none';
    document.getElementById('btn-save-slot').textContent='Save booking';
    this.pick(e.slot);
    this._setForUser(e.userId);
    this._fillClients(e.userId||App.user.uid, e.clientId||'', e.factory||'');
    // Show documents section in edit mode
    document.getElementById('ms-docs-wrap').style.display='block';
    this._renderDocs(e);
    // Wire upload input — re-attach each open to avoid duplicate listeners
    const inp=document.getElementById('ms-doc-input');
    inp.value=''; // reset file input
    const fresh=inp.cloneNode(true);
    inp.parentNode.replaceChild(fresh,inp);
    fresh.addEventListener('change',()=>Drive.uploadFromInput(fresh,id));
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
    ['ms-id','ms-date','ms-notes','ms-eqty','ms-fqty','ms-from','ms-to','ms-until'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('ms-type').value='';
    document.getElementById('ms-repeat').value='none';
    document.getElementById('ms-err').style.display='none';
    document.getElementById('ms-docs-wrap').style.display='none';
    document.getElementById('ms-docs-list').innerHTML='';
    document.getElementById('ms-doc-status').textContent='';
    document.getElementById('ms-doc-status').className='';
    ['sb-f','sb-a','sb-p'].forEach(id=>document.getElementById(id).className='slt-btn');
    document.querySelectorAll('#ms-wd-btns .wd-btn').forEach(b=>b.classList.remove('on'));
    this.onRepeatChange(); // resets sub-section visibility and button label
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

  _renderDocs(entry){
    const docs=entry.documents||[];
    const list=document.getElementById('ms-docs-list');
    if(!docs.length){ list.innerHTML='<div style="font-size:.78rem;color:var(--txs)">No documents yet.</div>'; return; }
    const ICONS={'application/pdf':'📄','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'📊','application/vnd.ms-excel':'📊','text/csv':'📋','image':'🖼','video':'🎞'};
    list.innerHTML=docs.map(d=>{
      const ico=ICONS[d.mimeType]||( d.mimeType?.startsWith('image')? ICONS['image'] : d.mimeType?.startsWith('video')? ICONS['video'] : '📎' );
      return `<div class="doc-item"><span class="doc-item-icon">${ico}</span><a href="${U.esc(d.webViewLink)}" target="_blank" rel="noopener" class="doc-item-name">${U.esc(d.name)}</a></div>`;
    }).join('');
  },

  // ── Recurrence UI visibility ──────────────────────────────────────────
  onRepeatChange(){
    const v=document.getElementById('ms-repeat').value;
    const hasRange=v==='range'||v==='weekdays';
    document.getElementById('ms-single-date').style.display=hasRange?'none':'block';
    document.getElementById('ms-rdate-range').style.display=hasRange?'block':'none';
    document.getElementById('ms-runtil-wrap').style.display=(v==='weekly'||v==='monthly')?'block':'none';
    document.getElementById('ms-rwd-wrap').style.display=v==='weekdays'?'block':'none';
    document.getElementById('btn-save-slot').textContent=v==='none'?'Save booking':'Create bookings';
  },

  // ── Date expansion for recurring bookings ─────────────────────────────
  // Returns an array of ISO date strings based on the current repeat mode.
  _expandDates(){
    const v=document.getElementById('ms-repeat').value;
    const date=document.getElementById('ms-date').value;
    const from=document.getElementById('ms-from').value;
    const to=document.getElementById('ms-to').value;
    const until=document.getElementById('ms-until').value;
    const wdSel=[...document.querySelectorAll('#ms-wd-btns .wd-btn.on')].map(b=>+b.dataset.wd);
    // Parse a YYYY-MM-DD string in local time (avoids UTC midnight off-by-one)
    const parseD=s=>{ const[y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
    const fmt=d=>`${d.getFullYear()}-${S2(d.getMonth()+1)}-${S2(d.getDate())}`;
    if(v==='none') return date?[date]:[];
    if(v==='range'){
      const dates=[]; let d=parseD(from); const end=parseD(to);
      while(d<=end){ dates.push(fmt(d)); d.setDate(d.getDate()+1); }
      return dates;
    }
    if(v==='weekly'){
      const dates=[]; let d=parseD(date); const end=parseD(until);
      while(d<=end){ dates.push(fmt(d)); d.setDate(d.getDate()+7); }
      return dates;
    }
    if(v==='monthly'){
      const dates=[]; let d=parseD(date); const end=parseD(until);
      while(d<=end){ dates.push(fmt(d)); d.setMonth(d.getMonth()+1); }
      return dates;
    }
    if(v==='weekdays'){
      // wdSel uses Monday-first: 0=Mon … 6=Sun; JS getDay(): 0=Sun 1=Mon … 6=Sat
      const dates=[]; let d=parseD(from); const end=parseD(to);
      while(d<=end){
        const dow=d.getDay(); const mf=dow===0?6:dow-1;
        if(wdSel.includes(mf)) dates.push(fmt(d));
        d.setDate(d.getDate()+1);
      }
      return dates;
    }
    return [];
  },
  async save(){
    const id=document.getElementById('ms-id').value;
    const date=document.getElementById('ms-date').value;
    const repeat=document.getElementById('ms-repeat').value;
    const from=document.getElementById('ms-from').value;
    const to=document.getElementById('ms-to').value;
    const until=document.getElementById('ms-until').value;
    const type=document.getElementById('ms-type').value;
    const cid=document.getElementById('ms-client').value;
    const fac=document.getElementById('ms-factory').value;
    const eqty=U.int(document.getElementById('ms-eqty').value);
    const fqty=U.int(document.getElementById('ms-fqty').value);
    const notes=document.getElementById('ms-notes').value.trim();
    const wdSel=[...document.querySelectorAll('#ms-wd-btns .wd-btn.on')];
    const err=document.getElementById('ms-err');
    err.style.display='none';

    // ── Date validation (mode-aware) ─────────────────────────────────────
    const needsRange=repeat==='range'||repeat==='weekdays';
    const needsUntil=repeat==='weekly'||repeat==='monthly';
    if(!needsRange&&!date){ err.textContent='Please select a date.'; err.style.display='block'; return; }
    if(needsRange){
      if(!from){ err.textContent='Please select a start date.'; err.style.display='block'; return; }
      if(!to){ err.textContent='Please select an end date.'; err.style.display='block'; return; }
      if(to<from){ err.textContent='End date must be after start date.'; err.style.display='block'; return; }
    }
    if(needsUntil){
      if(!until){ err.textContent='Please fill in "Repeat until".'; err.style.display='block'; return; }
      if(until<date){ err.textContent='"Repeat until" must be on or after the start date.'; err.style.display='block'; return; }
    }
    if(repeat==='weekdays'&&!wdSel.length){ err.textContent='Please select at least one day of the week.'; err.style.display='block'; return; }

    // ── Slot / client / factory ──────────────────────────────────────────
    if(!type){ err.textContent='Please select a time slot.'; err.style.display='block'; return; }
    if(!cid){ err.textContent='Please select a client.'; err.style.display='block'; return; }
    if(!fac){ err.textContent='Please select a factory.'; err.style.display='block'; return; }

    const targetUid=document.getElementById('ms-for').value||App.user.uid;
    const targetUser=Cache.users[targetUid]||App.user;
    const c=Cache.clients[cid];

    // ── Single-entry path (edit or no-repeat add) ────────────────────────
    if(id||repeat==='none'){
      const conflict=Cache.entriesArr().find(e=>e.id!==id&&e.userId===targetUid&&e.date===date&&e.slot===type);
      if(conflict){ err.textContent=`${targetUser.name} already has a "${type}" on this date.`; err.style.display='block'; return; }
      Spin.on();
      try{
        const eid=id||U.uuid();
        const base=id?{...Cache.entries[id]}:{};
        const entry={...base,id:eid,userId:targetUid,userName:targetUser.name,userEmail:targetUser.email,userCountry:targetUser.country||'',date,slot:type,clientId:cid,clientName:c?.name||'',factory:fac,expectedQty:eqty,finalQty:fqty,notes,updated:Date.now(),created:base.created||Date.now()};
        await fbSet(`entries/${eid}`,entry); Cache.entries[eid]=entry;
        M.close('m-slot');
        if(this._isAdmin()){ Adm.refresh(); }
        else if(App.user?.role==='team_manager'){ Mgr.refresh(); }
        else { Cal.render(); }
        toast(id?'Booking updated.':'Booking saved.');
      } catch(e){ toast('Save failed: '+e.message,'err'); }
      finally{ Spin.off(); }
      return;
    }

    // ── Recurring path ───────────────────────────────────────────────────
    const dates=this._expandDates();
    if(!dates.length){ err.textContent='No dates generated — check your recurrence settings.'; err.style.display='block'; return; }
    if(dates.length>365){ err.textContent=`Too many occurrences (${dates.length}). Shorten the period.`; err.style.display='block'; return; }

    // Partition into skip (conflict) vs create
    const toCreate=[], skipped=[];
    for(const d of dates){
      if(Cache.entriesArr().find(e=>e.userId===targetUid&&e.date===d&&e.slot===type)) skipped.push(d);
      else toCreate.push(d);
    }
    if(!toCreate.length){ err.textContent=`All ${dates.length} date${dates.length>1?'s':''} already have a "${type}" booking.`; err.style.display='block'; return; }

    Spin.on();
    try{
      for(const d of toCreate){
        const eid=U.uuid();
        const entry={id:eid,userId:targetUid,userName:targetUser.name,userEmail:targetUser.email,userCountry:targetUser.country||'',date:d,slot:type,clientId:cid,clientName:c?.name||'',factory:fac,expectedQty:eqty,finalQty:fqty,notes,updated:Date.now(),created:Date.now()};
        await fbSet(`entries/${eid}`,entry); Cache.entries[eid]=entry;
      }
      M.close('m-slot');
      if(this._isAdmin()){ Adm.refresh(); }
      else if(App.user?.role==='team_manager'){ Mgr.refresh(); }
      else { Cal.render(); }
      const msg=skipped.length
        ?`${toCreate.length} booking${toCreate.length>1?'s':''} created. ${skipped.length} skipped (conflict).`
        :`${toCreate.length} booking${toCreate.length>1?'s':''} created.`;
      toast(msg);
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
      if(this._isAdmin()){ Adm.refresh(); }
      else if(App.user?.role==='team_manager'){ Mgr.refresh(); }
      else { Cal.render(); }
      toast('Booking deleted.');
    } catch(e){ toast('Delete failed.','err'); }
    finally{ Spin.off(); }
  }
};

// ════════════════════════════════════
// AVAILABILITY
// ════════════════════════════════════
const Avail = {
  openForDate(date, existingRule=null, forUid=null){
    this._reset();
    document.getElementById('ma-title').textContent=existingRule?'Edit Availability':'Set Availability — '+U.fmt(date);
    document.getElementById('ma-for').value=forUid||'';
    const noteEl=document.getElementById('ma-for-note');
    if(forUid && App.user?.role==='team_manager'){
      const u=Cache.users[forUid];
      document.getElementById('ma-for-label').textContent=u?u.name:forUid;
      noteEl.style.display='block';
    } else { noteEl.style.display='none'; }
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
  openBulk(forUid=null){
    this._reset();
    document.getElementById('ma-title').textContent='Set Availability';
    document.getElementById('ma-for').value=forUid||'';
    const noteEl=document.getElementById('ma-for-note');
    if(forUid && App.user?.role==='team_manager'){
      const u=Cache.users[forUid];
      document.getElementById('ma-for-label').textContent=u?u.name:forUid;
      noteEl.style.display='block';
    } else { noteEl.style.display='none'; }
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
    document.getElementById('ma-for').value='';
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
    document.getElementById('ma-for-note').style.display='none';
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

    const targetUid=document.getElementById('ma-for').value||App.user.uid;
    const u=Cache.users[targetUid]||App.user;
    Spin.on();
    try{
      const aid=id||U.uuid();
      const rule={id:aid,userId:targetUid,userName:u.name,userCountry:u.country||'',startDate,endDate,slot,type,repeatMode,repeatUntil,note,created:Date.now()};
      await fbSet(`availability/${aid}`,rule);
      Cache.availability[aid]=rule;
      M.close('m-avail');
      if(App.user?.role==='team_manager'){ Mgr.refresh(); } else { Cal.render(); }
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
      M.close('m-avail');
      if(App.user?.role==='team_manager'){ Mgr.refresh(); } else { Cal.render(); }
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
    Rpt.init();
  },

  async refresh(){
    // Use try/finally so Spin.off() is guaranteed even if Cache.loadAll() rejects or times out.
    Spin.on();
    try{
      await Cache.loadAll();
      // Re-apply filters without resetting the current month/country — init() would call
      // new Date() and reset the view to today, losing the admin's current position.
      this._buildCountryBar();
      this._fillFilterOpts();
      this.applyFilters();
      if(this.view==='rp') Rpt.render();
      toast('Dashboard refreshed.');
    } catch(e){ toast('Refresh failed: '+e.message,'err'); }
    finally{ Spin.off(); }
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
    ['tl','wk','ls','rp'].forEach(id=>{
      const vEl=document.getElementById('vw-'+id);
      if(vEl) vEl.style.display=v===id?'block':'none';
      const tEl=document.getElementById('nt-'+id);
      if(tEl) tEl.className='ntab'+(v===id?' on':'');
    });
    const isRp=v==='rp';
    document.getElementById('adm-fbar').style.display  = isRp?'none':'';
    document.getElementById('adm-stats').style.display = isRp?'none':'';
    document.getElementById('country-bar').style.display = isRp?'none':'';
    if(isRp){ Rpt.render(); } else { this._render(); }
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

  // ── Per-half-day state resolver ─────────────────────────────────────────
  // Returns the dominant state for either the AM or PM half of a given cell.
  // Priority: booking > absence > (other-half-booked → green) > unavailable > available > empty
  _halfState(de, av, isAm){
    const sh   = isAm ? 'Half Day AM' : 'Half Day PM';
    const otSh = isAm ? 'Half Day PM' : 'Half Day AM';
    const bF    = de.find(e=>e.slot==='Full Day');
    const bH    = de.find(e=>e.slot===sh);
    const bOth  = de.find(e=>e.slot===otSh);
    // 1. Booking on this half (or full day)
    if(bF) return {type:'booked',slot:'Full Day',e:bF};
    if(bH) return {type:'booked',slot:sh,e:bH};
    // 2. Absence (holiday/sick) when this half is otherwise free
    const absence=av.find(r=>r.type==='absence');
    if(absence) return {type:'absence',absenceType:absence.absenceType,r:absence};
    // 3. If the opposite half is booked → show this half as available (slot is open)
    if(bOth) return {type:'avail'};
    // 4. Unavailability rule
    const uF=av.find(r=>r.type==='unavailable'&&r.slot==='Full Day');
    const uH=av.find(r=>r.type==='unavailable'&&r.slot===sh);
    if(uF||uH) return {type:'unavail',r:uF||uH};
    // 5. Availability rule
    const aF=av.find(r=>r.type==='available'&&r.slot==='Full Day');
    const aH=av.find(r=>r.type==='available'&&r.slot===sh);
    if(aF||aH) return {type:'avail',r:aF||aH};
    return {type:'empty'};
  },

  // ── Half-day HTML builder ────────────────────────────────────────────────
  // Renders one horizontal bar (AM or PM) for the timeline cell.
  _halfHtml(st, isAm, ds, uid){
    const sl=isAm?'AM':'PM';
    let cls='tl-half', tip='', eid='';
    if(st.type==='booked'){
      // All bookings (Full Day / Half AM / Half PM) use the same blue colour
      cls+=' tl-h-bk-f';
      tip=`${U.esc(st.e.slot)} – ${U.esc(st.e.clientName||'')}${st.e.factory?' @ '+U.esc(st.e.factory):''}${st.e.expectedQty!=null?' | Exp: '+st.e.expectedQty:''}${st.e.finalQty!=null?' | Final: '+st.e.finalQty:''}`;
      eid=st.e.id;
    } else if(st.type==='absence'){
      cls+=st.absenceType==='holiday'?' tl-h-hol':' tl-h-sick';
      const icon=st.absenceType==='holiday'?'🏖':'🤒';
      tip=`${sl}: ${icon} ${st.absenceType==='holiday'?'Holiday':'Sick day'}${st.r?.note?' — '+U.esc(st.r.note):''}`;
    } else if(st.type==='unavail'){
      cls+=' tl-h-un'; tip=`${sl}: Unavailable${st.r&&st.r.note?' — '+U.esc(st.r.note):''}`;
    } else if(st.type==='avail'){
      cls+=' tl-h-av'; tip=`${sl}: Available${st.r&&st.r.note?' — '+U.esc(st.r.note):''}`;
    } else {
      cls+=' tl-h-empty'; tip=`Add booking — ${sl}`;
    }
    const attrs=eid?`data-eid="${eid}"`:`data-date="${ds}" data-uid="${uid}"`;
    return `<div class="${cls}" ${attrs} title="${tip.replace(/"/g,'&quot;')}"></div>`;
  },

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
      document.getElementById('tl-tbl').innerHTML='<tr><td class="tbl-empty">No controllers found for this country. Add users in ⚙ Settings.</td></tr>';
      return;
    }

    let hdr='<thead><tr><th class="tl-hdr-cell">Controller</th>';
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
        body+=`<tr class="tl-grp-row"><td colspan="${dCount+1}" class="tl-grp-cell">${U.flag(u.country)} ${U.esc(u.country)}</td></tr>`;
      }
      body+=`<tr><td class="tl-name-cell"><div class="tl-un">${U.esc(u.name)}</div>${u.country?`<div class="tl-co">${U.flag(u.country)} ${U.esc(u.country)}</div>`:''}</td>`;
      for(let d=1;d<=dCount;d++){
        const ds=`${y}-${S2(m+1)}-${S2(d)}`;
        const isT=ds===today, isW=U.isWeekend(y,m,d);
        const de=eMap[u.uid+'|'+ds]||[];
        const av=aMap[u.uid+'|'+ds]||[];
        // Build AM and PM half states independently (booking > unavail > avail > empty)
        const amSt=this._halfState(de,av,true), pmSt=this._halfState(de,av,false);
        const amH=this._halfHtml(amSt,true,ds,u.uid), pmH=this._halfHtml(pmSt,false,ds,u.uid);
        body+=`<td class="${isT?'tc-td':isW?'wknd-col':''}"><div class="tl-cell">${amH}${pmH}</div></td>`;
      }
      body+='</tr>';
    });
    body+='</tbody>';

    document.getElementById('tl-tbl').innerHTML=hdr+body;
    const tbl=document.getElementById('tl-tbl');
    const tip=document.getElementById('tip');
    // Booked halves → open edit modal
    tbl.querySelectorAll('.tl-half[data-eid]').forEach(h=>{
      h.addEventListener('click',e=>{ e.stopPropagation(); tip.style.display='none'; Slot.edit(h.dataset.eid); });
    });
    // Empty halves → open add-booking modal
    tbl.querySelectorAll('.tl-half[data-date]').forEach(h=>{
      h.addEventListener('click',()=>Slot.add(h.dataset.date, h.dataset.uid));
    });
    // Tooltip for all halves (available/unavailable show info only)
    tbl.querySelectorAll('.tl-half').forEach(h=>{
      h.addEventListener('mouseenter',()=>{ if(h.title){ tip.textContent=h.title; tip.style.display='block'; } });
      h.addEventListener('mousemove',e=>{ tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY-10)+'px'; });
      h.addEventListener('mouseleave',()=>{ tip.style.display='none'; });
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
    // Build availability map for the 7 displayed days
    const weekDates=days.map(d=>localDateStr(d));
    const aMap={};
    Cache.availArr().forEach(rule=>{
      const months=[...new Set(weekDates.map(d=>d.slice(0,7)))];
      months.forEach(mk=>{ const[my,mm]=mk.split('-').map(Number); U.expandAvail(rule,my,mm-1).forEach(date=>{ if(weekDates.includes(date)){ const k=rule.userId+'|'+date; (aMap[k]=aMap[k]||[]).push(rule); } }); });
    });
    if(!allUsers.length){ document.getElementById('wk-content').innerHTML='<div class="tbl-empty">No controllers for this filter.</div>'; return; }
    let html='<div class="tl-scroll-wrap"><table class="tl tl-min-700"><thead><tr><th class="wk-hdr-cell">Controller</th>';
    days.forEach((d,i)=>{ const ds=localDateStr(d); const isT=ds===today,isW=d.getDay()===0||d.getDay()===6; html+=`<th class="${isT?'tc-td':isW?'wknd-col':''}">${WDAYS[i]}<br>${d.getDate()}</th>`; });
    html+='</tr></thead><tbody>';
    let lastCountry='';
    allUsers.forEach(u=>{
      if(u.country!==lastCountry&&u.country){ lastCountry=u.country; html+=`<tr class="tl-grp-row"><td colspan="8" class="tl-grp-cell">${U.flag(u.country)} ${U.esc(u.country)}</td></tr>`; }
      html+=`<tr><td class="tl-name-cell"><div class="tl-un">${U.esc(u.name)}</div></td>`;
      days.forEach(d=>{
        const ds=localDateStr(d);
        const isT=ds===today, isW=d.getDay()===0||d.getDay()===6;
        const de=eMap[u.uid+'|'+ds]||[];
        const av=aMap[u.uid+'|'+ds]||[];
        const amSt=this._halfState(de,av,true), pmSt=this._halfState(de,av,false);
        const amH=this._halfHtml(amSt,true,ds,u.uid), pmH=this._halfHtml(pmSt,false,ds,u.uid);
        html+=`<td class="${isT?'tc-td':isW?'wknd-col':''}"><div class="tl-cell">${amH}${pmH}</div></td>`;
      });
      html+='</tr>';
    });
    html+='</tbody></table></div>';
    document.getElementById('wk-content').innerHTML=html;
    const wkc=document.getElementById('wk-content');
    const wkTip=document.getElementById('tip');
    // Booked halves → edit modal
    wkc.querySelectorAll('.tl-half[data-eid]').forEach(h=>{
      h.addEventListener('click',e=>{ e.stopPropagation(); wkTip.style.display='none'; Slot.edit(h.dataset.eid); });
    });
    // Empty halves → add booking modal
    wkc.querySelectorAll('.tl-half[data-date]').forEach(h=>{
      h.addEventListener('click',()=>Slot.add(h.dataset.date, h.dataset.uid));
    });
    // Tooltip on all halves
    wkc.querySelectorAll('.tl-half').forEach(h=>{
      h.addEventListener('mouseenter',()=>{ if(h.title){ wkTip.textContent=h.title; wkTip.style.display='block'; } });
      h.addEventListener('mousemove',e=>{ wkTip.style.left=(e.clientX+12)+'px'; wkTip.style.top=(e.clientY-10)+'px'; });
      h.addEventListener('mouseleave',()=>{ wkTip.style.display='none'; });
    });
  },

  _renderList(){
    const f=this.filtered;
    if(!f.length){ document.getElementById('ls-content').innerHTML='<div class="empty"><div class="empty-ic">📭</div><div class="empty-t">No bookings found</div><div class="empty-s">Adjust filters above.</div></div>'; return; }
    const sorted=[...f].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
    let html='<div class="ov-x-auto"><table class="ltab"><thead><tr><th>Date</th><th>Controller</th><th>Country</th><th>Slot</th><th>Client</th><th>Factory</th><th>Exp. Qty</th><th>Final Qty</th><th>Notes</th></tr></thead><tbody>';
    sorted.forEach(e=>{
      html+=`<tr data-eid="${e.id}" title="Click to edit"><td><strong>${U.fmt(e.date)}</strong></td><td>${U.flag(e.userCountry)} ${U.esc(e.userName)}</td><td>${U.esc(e.userCountry)}</td><td><span class="badge ${U.badgeCls(e.slot)}">${U.esc(e.slot)}</span></td><td>${U.esc(e.clientName)}</td><td>${U.esc(e.factory)}</td><td class="tbl-right">${e.expectedQty!=null?e.expectedQty:'<span class="tbl-qty-dash">—</span>'}</td><td class="tbl-right">${e.finalQty!=null?e.finalQty:'<span class="tbl-qty-dash">—</span>'}</td><td class="tbl-notes">${U.esc(e.notes)}</td></tr>`;
    });
    html+='</tbody></table></div>';
    document.getElementById('ls-content').innerHTML=html;
    // Bind row clicks — onclick attributes are CSP-blocked in dynamically generated HTML
    document.getElementById('ls-content').querySelectorAll('tr[data-eid]').forEach(row=>{
      row.addEventListener('click',()=>Slot.edit(row.dataset.eid));
    });
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
    // ── Controllers ──
    const controllers=Cache.usersArr().filter(u=>u.role==='controller').sort((a,b)=>(a.country||'').localeCompare(b.country||'')||a.name.localeCompare(b.name));
    if(!controllers.length){
      document.getElementById('u-tbody').innerHTML=`<tr><td colspan="6" class="tbl-empty">No controllers yet. Click "+ Add Team Member" to pre-register them by email.</td></tr>`;
    } else {
      document.getElementById('u-tbody').innerHTML=controllers.map(u=>{
        const uClients=Cache.clientsArr().filter(c=>(c.userIds||[]).includes(u.uid)).map(c=>U.esc(c.name)).join(', ')||'<span class="tbl-qty-dash">none</span>';
        const statusBadge=u.pending?'<span class="badge badge-pending">Pending</span>':`<span class="badge ${u.active?'b-on':'b-off'}">${u.active?'Active':'Inactive'}</span>`;
        return `<tr><td><strong>${U.esc(u.name||u.email.split('@')[0])}</strong></td><td class="tbl-email">${U.esc(u.email)}</td><td>${u.country?U.flag(u.country)+' '+U.esc(u.country):'<span class="tbl-qty-dash">—</span>'}</td><td class="tbl-email">${uClients}</td><td>${statusBadge}</td><td class="tbl-nowrap"><button class="btn btn-s btn-sm" data-action="edit" data-uid="${U.esc(u.uid)}">Edit</button> <button class="btn btn-d btn-sm" data-action="delete" data-uid="${U.esc(u.uid)}">Delete</button></td></tr>`;
      }).join('');
      document.getElementById('u-tbody').querySelectorAll('button[data-action]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          if(btn.dataset.action==='edit') Sett.editUser(btn.dataset.uid);
          else if(btn.dataset.action==='delete') Sett.deleteUser(btn.dataset.uid);
        });
      });
    }
    // ── Team Managers ──
    const managers=Cache.usersArr().filter(u=>u.role==='team_manager').sort((a,b)=>a.name.localeCompare(b.name));
    const mgrSection=document.getElementById('u-mgr-section');
    if(managers.length){
      mgrSection.style.display='block';
      document.getElementById('u-mgr-tbody').innerHTML=managers.map(u=>{
        const assignedCtrls=Object.keys(u.managedControllerIds||{}).map(id=>Cache.users[id]?.name||'').filter(Boolean).join(', ')||'<span class="tbl-qty-dash">none</span>';
        const statusBadge=u.pending?'<span class="badge badge-pending">Pending</span>':`<span class="badge ${u.active?'b-on':'b-off'}">${u.active?'Active':'Inactive'}</span>`;
        return `<tr><td><strong>${U.esc(u.name||u.email.split('@')[0])}</strong></td><td class="tbl-email">${U.esc(u.email)}</td><td class="tbl-email">${assignedCtrls}</td><td>${statusBadge}</td><td class="tbl-nowrap"><button class="btn btn-s btn-sm" data-action="edit" data-uid="${U.esc(u.uid)}">Edit</button> <button class="btn btn-d btn-sm" data-action="delete" data-uid="${U.esc(u.uid)}">Delete</button></td></tr>`;
      }).join('');
      document.getElementById('u-mgr-tbody').querySelectorAll('button[data-action]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          if(btn.dataset.action==='edit') Sett.editUser(btn.dataset.uid);
          else if(btn.dataset.action==='delete') Sett.deleteUser(btn.dataset.uid);
        });
      });
    } else {
      mgrSection.style.display='none';
    }
  },

  openInvite(){
    document.getElementById('inv-email').value='';
    document.getElementById('inv-role').value='controller';
    document.getElementById('inv-country').value='';
    document.getElementById('inv-country-wrap').style.display='block';
    document.getElementById('inv-err').style.display='none';
    M.open('m-invite');
  },

  // Show/hide country field based on role (team managers don't need a country)
  onInviteRoleChange(){
    const role=document.getElementById('inv-role').value;
    document.getElementById('inv-country-wrap').style.display=role==='controller'?'block':'none';
  },

  async inviteController(){
    const email=document.getElementById('inv-email').value.trim().toLowerCase();
    const role=document.getElementById('inv-role').value||'controller';
    const country=role==='controller'?document.getElementById('inv-country').value:'';
    const err=document.getElementById('inv-err');
    err.style.display='none';
    if(!email){ err.textContent='Please enter an email address.'; err.style.display='block'; return; }
    if(!email.endsWith('@'+ALLOWED_DOMAIN)){ err.textContent='Only @coradam.com addresses are allowed.'; err.style.display='block'; return; }
    if(Cache.usersArr().find(u=>u.email===email)){ err.textContent='This email is already registered.'; err.style.display='block'; return; }
    Spin.on();
    try{
      const uid='pending_'+U.uuid();
      const name=email.split('@')[0].replace(/\./g,' ').replace(/\b\w/g,c=>c.toUpperCase());
      const profile={uid,email,name,country,role,active:true,pending:true,created:Date.now()};
      if(role==='team_manager') profile.managedControllerIds={};
      await fbSet(`users/${uid}`,profile); Cache.users[uid]=profile;
      M.close('m-invite'); this._renderUsers();
      toast(role==='team_manager'?'Team manager added.':'Controller added.');
    } catch(e){ err.textContent='Save failed: '+(e?.message||e); err.style.display='block'; }
    finally{ Spin.off(); }
  },

  editUser(uid){
    const u=Cache.users[uid]; if(!u) return;
    document.getElementById('mu-title').textContent='Edit — '+u.name;
    document.getElementById('mu-uid').value=uid;
    document.getElementById('mu-country').value=u.country||'';
    document.getElementById('mu-err').style.display='none';

    const isManager=u.role==='team_manager';
    // Show/hide sections based on role
    document.getElementById('mu-client-section').style.display=isManager?'none':'block';
    document.getElementById('mu-avail-section').style.display=isManager?'none':'block';
    document.getElementById('mu-ctrl-section').style.display=isManager?'block':'none';

    if(isManager){
      // Build controller assignment checkboxes
      const activeControllers=Cache.usersArr().filter(c=>c.role==='controller'&&c.active);
      document.getElementById('mu-controllers').innerHTML=activeControllers.length
        ?activeControllers.map(c=>`<label class="chk-item"><input type="checkbox" value="${U.esc(c.uid)}" ${!!(u.managedControllerIds||{})[c.uid]?'checked':''}>${U.esc(c.name)}${c.country?' '+U.flag(c.country):''}</label>`).join('')
        :'<div class="no-items">No active controllers yet.</div>';
    } else {
      // Fill client checkboxes
      const clients=Cache.clientsArr();
      document.getElementById('mu-clients').innerHTML=clients.length?clients.map(c=>`<label class="chk-item"><input type="checkbox" value="${c.id}" ${(c.userIds||[]).includes(uid)?'checked':''}>${U.esc(c.name)}</label>`).join(''):'<div class="no-items">No clients yet.</div>';
      // Build weekly availability grid (Mon=0 … Fri=4, Monday-first convention)
      const wa=u.weeklyAvail||{0:{am:true,pm:true},1:{am:true,pm:true},2:{am:true,pm:true},3:{am:true,pm:true},4:{am:true,pm:true},5:{am:false,pm:false},6:{am:false,pm:false}};
      const DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const grid=document.getElementById('mu-avail-grid');
      grid.innerHTML='';
      DAYS.forEach((lbl,i)=>{
        const col=el('div','av-week-col');
        const day=el('div','av-week-lbl'); day.textContent=lbl;
        const amBar=el('div','av-week-half'+(wa[i]?.am?' on-am':'')); amBar.dataset.wd=i; amBar.dataset.half='am'; amBar.title=lbl+' AM';
        const pmBar=el('div','av-week-half'+(wa[i]?.pm?' on-pm':'')); pmBar.dataset.wd=i; pmBar.dataset.half='pm'; pmBar.title=lbl+' PM';
        const sub=el('div','av-week-sub'); sub.textContent='AM / PM';
        col.append(day,amBar,pmBar,sub);
        grid.appendChild(col);
      });
      // Bind toggle events (re-attached each open to avoid stale listeners)
      grid.querySelectorAll('.av-week-half').forEach(b=>{
        b.addEventListener('click',()=>{
          if(b.dataset.half==='am') b.classList.toggle('on-am');
          else b.classList.toggle('on-pm');
        });
      });
    }
    M.open('m-user');
  },

  // ── Sync weeklyAvail template to real availability rules ─────────────────
  // Creates/replaces one "weekly" repeat rule per active weekday (Mon–Fri).
  // These rules are tagged fromWeeklyAvail:true so they can be cleanly replaced.
  // Start dates: week of 2020-01-06 (Mon) so every weekday since then is covered.
  // repeatUntil: today + 10 years (≈ the default requested).
  async _syncWeeklyAvailRules(uid, weeklyAvail){
    const u=Cache.users[uid];
    // Delete all previous auto-generated weekly rules for this user —
    // including untagged ones from earlier app versions that lack fromWeeklyAvail.
    const old=Cache.availArr().filter(r=>r.userId===uid&&(r.fromWeeklyAvail||(r.type==='available'&&r.repeatMode==='weekly')));
    for(const r of old){ await fbDel(`availability/${r.id}`); delete Cache.availability[r.id]; }
    // Build new rules (Mon=0 … Fri=4, Monday-first index)
    // Mon–Sun anchor dates (week of 2020-01-06). Index matches DAYS in editUser.
    const BASE=['2020-01-06','2020-01-07','2020-01-08','2020-01-09','2020-01-10','2020-01-11','2020-01-12'];
    const until=new Date(); until.setFullYear(until.getFullYear()+10);
    const repeatUntil=`${until.getFullYear()}-${S2(until.getMonth()+1)}-${S2(until.getDate())}`;
    for(let i=0;i<7;i++){
      const wa=weeklyAvail[i];
      if(!wa||(!wa.am&&!wa.pm)) continue; // weekday disabled — skip
      const slot=(wa.am&&wa.pm)?'Full Day':wa.am?'Half Day AM':'Half Day PM';
      const id=U.uuid();
      const rule={id,userId:uid,userName:u?.name||'',type:'available',slot,
                  startDate:BASE[i],repeatMode:'weekly',repeatUntil,
                  note:'',fromWeeklyAvail:true,created:Date.now()};
      await fbSet(`availability/${id}`,rule); Cache.availability[id]=rule;
    }
  },

  async saveUser(){
    const uid=document.getElementById('mu-uid').value;
    const u=Cache.users[uid]; if(!u) return;
    const country=document.getElementById('mu-country').value;
    const err=document.getElementById('mu-err');
    err.style.display='none';

    // ── Team manager: only save country + controller assignments ──
    if(u.role==='team_manager'){
      const checkedControllerIds=[...document.querySelectorAll('#mu-controllers input:checked')].map(cb=>cb.value);
      // Store as a map {uid: true} — required for Firebase RTDB rules to check membership via .child(uid).exists()
      const managedControllerIds=Object.fromEntries(checkedControllerIds.map(id=>[id,true]));
      Spin.on();
      try{
        const updated={...u,country,managedControllerIds};
        await fbSet(`users/${uid}`,updated); Cache.users[uid]=updated;
        M.close('m-user'); this._renderUsers(); toast('Team manager updated.');
      } catch(e){ log.error('saveUser(manager) error',e); err.textContent='Save failed: '+(e?.message||e); err.style.display='block'; }
      finally{ Spin.off(); }
      return;
    }

    // ── Controller: existing save logic ──
    const checkedClientIds=[...document.querySelectorAll('#mu-clients input:checked')].map(cb=>cb.value);
    // Collect weeklyAvail from the grid
    const weeklyAvail={};
    document.querySelectorAll('#mu-avail-grid .av-week-half').forEach(b=>{
      const i=+b.dataset.wd;
      if(!weeklyAvail[i]) weeklyAvail[i]={am:false,pm:false};
      if(b.dataset.half==='am') weeklyAvail[i].am=b.classList.contains('on-am');
      else weeklyAvail[i].pm=b.classList.contains('on-pm');
    });
    Spin.on();
    try{
      // Update user country + weeklyAvail
      const updated={...u,country,weeklyAvail};
      await fbSet(`users/${uid}`,updated); Cache.users[uid]=updated;
      // Sync weekly availability rules (creates repeating "available" rules for 10 years)
      await this._syncWeeklyAvailRules(uid, weeklyAvail);
      // Update client assignments
      for(const c of Cache.clientsArr()){
        const wasIn=(c.userIds||[]).includes(uid);
        const shouldBeIn=checkedClientIds.includes(c.id);
        if(wasIn!==shouldBeIn){
          const newIds=shouldBeIn?[...(c.userIds||[]),uid]:(c.userIds||[]).filter(id=>id!==uid);
          const updated2={...c,userIds:newIds};
          await fbSet(`clients/${c.id}`,updated2); Cache.clients[c.id]=updated2;
        }
      }
      M.close('m-user'); this._renderUsers(); toast('Controller updated — availability rules applied for 10 years.');
    } catch(e){ log.error('saveUser error',e); err.textContent='Save failed: '+(e?.message||e); err.style.display='block'; }
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
        await fbDel(`availability/${a.id}`); delete Cache.availability[a.id];
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
    if(!clients.length){ document.getElementById('c-tbody').innerHTML=`<tr><td colspan="4" class="tbl-empty">No clients yet.</td></tr>`; return; }
    document.getElementById('c-tbody').innerHTML=clients.map(c=>{
      const facs=(c.factories||[]).join(', ')||'—';
      const auds=(c.userIds||[]).map(uid=>Cache.users[uid]?.name||'').filter(Boolean).join(', ')||'—';
      return `<tr><td><strong>${U.esc(c.name)}</strong></td><td class="tbl-detail">${U.esc(facs)}</td><td class="tbl-email">${U.esc(auds)}</td><td><button class="btn btn-s btn-sm" data-cid="${U.esc(c.id)}">Edit</button></td></tr>`;
    }).join('');
    // Bind edit buttons — onclick attributes in innerHTML are blocked by CSP
    document.getElementById('c-tbody').querySelectorAll('button[data-cid]').forEach(btn=>{
      btn.addEventListener('click',()=>Sett.editClient(btn.dataset.cid));
    });
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
    document.getElementById('mc-users').innerHTML=users.length?users.map(u=>`<label class="chk-item"><input type="checkbox" value="${u.uid}" ${assigned.includes(u.uid)?'checked':''}>${U.flag(u.country)} ${U.esc(u.name)}${u.country?' ('+u.country+')':''}</label>`).join(''):'<div class="no-items">No controllers yet.</div>';
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
    } catch(e){ log.error('saveClient error',e); document.getElementById('mc-err').textContent='Save failed: '+(e?.message||e); document.getElementById('mc-err').style.display='block'; }
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
    // Client data is never hardcoded in source. Import from a CSV file instead.
    // CSV format: one row per client. First column = client name, remaining columns = factory names.
    // Example: Chaumet,HQ,RASELLI FRANCO SPA,BMC SPA
    const input=document.createElement('input');
    input.type='file'; input.accept='.csv,text/csv'; input.style.display='none';
    document.body.appendChild(input);
    input.addEventListener('change', async ()=>{
      const file=input.files[0];
      document.body.removeChild(input);
      if(!file) return;
      let text;
      try{ text=await file.text(); } catch{ toast('Could not read file.','err'); return; }
      const lines=text.split(/\r?\n/).filter(l=>l.trim());
      const existingNames=Cache.clientsArr().map(c=>c.name.toLowerCase());
      const toAdd=[];
      for(const line of lines){
        const cols=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
        const name=cols[0]; const factories=cols.slice(1).filter(Boolean);
        if(!name||existingNames.includes(name.toLowerCase())) continue;
        toAdd.push({name,factories});
      }
      if(!toAdd.length){ toast('All clients already exist — nothing to import.'); return; }
      if(!confirm(`Import ${toAdd.length} new client(s) from CSV?`)) return;
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
    });
    input.click();
  },

  async wipeAll(){
    const phrase=prompt('⚠ This permanently deletes ALL users, clients, bookings, and availability.\n\nType WIPE ALL DATA to confirm:');
    if(phrase!=='WIPE ALL DATA'){ toast('Wipe cancelled — phrase did not match.'); return; }
    // Write audit entry before any data is deleted
    try{
      await fbSet('audit_log/wipe_'+Date.now(),{action:'wipe_all',by:App.user?.email||'unknown',at:Date.now()});
    } catch(e){ log.warn('Audit log write failed:',e.message); }
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
    sec.innerHTML='<div class="fb-inactive"><p>Freshbooks integration is not currently active.</p><p class="fb-inactive-sub">To enable it, a Cloudflare Worker must be deployed. Contact your administrator.</p></div>';
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
// OFF DAY — Holiday & Sick Day management (Super Admin only)
// Stored in `availability` collection with type:'absence'.
// Rendered as orange (holiday) or pink (sick) bars in the timeline.
// ════════════════════════════════════
const OffDay = {
  open(){
    const sel=document.getElementById('od-uid');
    const users=Cache.usersArr().filter(u=>u.role==='controller'&&u.active).sort((a,b)=>a.name.localeCompare(b.name));
    sel.innerHTML='<option value="">Select controller…</option>'+users.map(u=>`<option value="${U.esc(u.uid)}">${U.esc(u.name)}</option>`).join('');
    // Reset new-entry fields
    document.getElementById('od-type').value='';
    document.getElementById('od-from').value='';
    document.getElementById('od-to').value='';
    document.getElementById('od-note').value='';
    document.getElementById('od-err').style.display='none';
    ['od-hol','od-sick'].forEach(id=>document.getElementById(id).classList.remove('on'));
    this._renderList();
    M.open('m-offday');
  },

  pickType(t){
    document.getElementById('od-type').value=t;
    document.getElementById('od-hol').classList.toggle('on',t==='holiday');
    document.getElementById('od-sick').classList.toggle('on',t==='sick');
  },

  _renderList(){
    const uid=document.getElementById('od-uid').value;
    const list=document.getElementById('od-list');
    if(!uid){ list.innerHTML='<div class="no-items">Select a controller to view their off days.</div>'; return; }
    const absences=Cache.availArr()
      .filter(r=>r.userId===uid&&r.type==='absence')
      .sort((a,b)=>a.startDate.localeCompare(b.startDate));
    if(!absences.length){ list.innerHTML='<div class="no-items">No off days recorded for this controller.</div>'; return; }
    list.innerHTML='<div class="od-list">'+absences.map(a=>{
      const isHol=a.absenceType==='holiday';
      const icon=isHol?'🏖':'🤒';
      const label=isHol?'Holiday':'Sick day';
      const tagCls=isHol?'od-type-hol':'od-type-sick';
      const range=(a.endDate&&a.endDate!==a.startDate)?`${U.fmt(a.startDate)} → ${U.fmt(a.endDate)}`:U.fmt(a.startDate);
      return `<div class="od-item"><span class="od-icon">${icon}</span><span class="od-range">${range}</span><span class="od-type-tag ${tagCls}">${label}</span><span class="od-note-txt">${U.esc(a.note||'')}</span><button class="btn btn-d btn-sm" data-aid="${U.esc(a.id)}">✕</button></div>`;
    }).join('')+'</div>';
    list.querySelectorAll('button[data-aid]').forEach(btn=>{
      btn.addEventListener('click',()=>this.del(btn.dataset.aid));
    });
  },

  async del(id){
    if(!confirm('Delete this off day record?')) return;
    Spin.on();
    try{
      await fbDel(`availability/${id}`); delete Cache.availability[id];
      this._renderList();
      Adm.refresh();
      toast('Off day deleted.');
    } catch(e){ toast('Delete failed: '+e.message,'err'); }
    finally{ Spin.off(); }
  },

  async save(){
    const uid=document.getElementById('od-uid').value;
    const type=document.getElementById('od-type').value;
    const from=document.getElementById('od-from').value;
    const to=document.getElementById('od-to').value;
    const note=document.getElementById('od-note').value.trim();
    const err=document.getElementById('od-err');
    err.style.display='none';
    if(!uid){ err.textContent='Please select a controller.'; err.style.display='block'; return; }
    if(!type){ err.textContent='Please select a type — Holiday or Sick Day.'; err.style.display='block'; return; }
    if(!from){ err.textContent='Please select a start date.'; err.style.display='block'; return; }
    if(!to){ err.textContent='Please select an end date.'; err.style.display='block'; return; }
    if(to<from){ err.textContent='End date must be on or after the start date.'; err.style.display='block'; return; }
    const u=Cache.users[uid];
    const id=U.uuid();
    const record={id,userId:uid,userName:u?.name||'',type:'absence',absenceType:type,
                  slot:'Full Day',startDate:from,endDate:to,repeatMode:'none',
                  note,fromOffDay:true,created:Date.now()};
    Spin.on();
    try{
      await fbSet(`availability/${id}`,record); Cache.availability[id]=record;
      // Reset entry fields (keep controller selected)
      document.getElementById('od-type').value='';
      document.getElementById('od-from').value='';
      document.getElementById('od-to').value='';
      document.getElementById('od-note').value='';
      ['od-hol','od-sick'].forEach(id=>document.getElementById(id).classList.remove('on'));
      this._renderList();
      Adm.refresh();
      const days=(new Date(to)-new Date(from))/86400000+1;
      toast(`${days} day${days>1?'s':''} of ${type==='holiday'?'holiday':'sick leave'} recorded for ${u?.name||uid}.`);
    } catch(e){ err.textContent='Save failed: '+e.message; err.style.display='block'; }
    finally{ Spin.off(); }
  }
};

// ════════════════════════════════════
// GOOGLE DRIVE INTEGRATION
// Uses Drive REST API v3 with the OAuth access token obtained at sign-in.
// Scope: https://www.googleapis.com/auth/drive.file (only files created by this app).
// Folder hierarchy: {Controller Name} → {Client Name} → {Factory Name} → {Date}
// The controller root folder is shared with c.nocher@coradam.com on first upload.
// ════════════════════════════════════
const DRIVE_SHARE_EMAIL = 'c.nocher@coradam.com';
const Drive = {
  // Obtain a valid Drive access token, prompting re-auth if needed
  async _token(){
    if(App._driveToken) return App._driveToken;
    // Re-auth to obtain Google OAuth access token with Drive scope
    const provider=new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    const result=await fauth.currentUser.reauthenticateWithPopup(provider);
    App._driveToken=result.credential.accessToken;
    return App._driveToken;
  },

  // Drive REST helper — JSON request
  async _api(method, path, body, token){
    const res=await fetch(`https://www.googleapis.com/drive/v3/${path}`,{
      method, headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined
    });
    if(!res.ok){ const t=await res.text(); throw new Error(`Drive API ${method} ${path}: ${res.status} ${t}`); }
    return res.json();
  },

  // Find a folder by name under parent (or root if parentId null)
  async _findFolder(name, parentId, token){
    const par=parentId?` and '${parentId}' in parents`:'';
    const q=`name='${name.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${par}`;
    const res=await this._api('GET',`files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,null,token);
    return res.files?.[0]?.id||null;
  },

  // Get-or-create a folder
  async _folder(name, parentId, token){
    const existing=await this._findFolder(name,parentId,token);
    if(existing) return existing;
    const meta={name,mimeType:'application/vnd.google-apps.folder'};
    if(parentId) meta.parents=[parentId];
    const res=await this._api('POST','files',meta,token);
    return res.id;
  },

  // Share a folder (reader access) with DRIVE_SHARE_EMAIL
  async _share(folderId, token){
    await this._api('POST',`files/${folderId}/permissions`,{role:'reader',type:'user',emailAddress:DRIVE_SHARE_EMAIL},token);
  },

  // Multipart upload — returns file ID
  async _upload(file, parentId, token){
    const meta={name:file.name,parents:[parentId]};
    const boundary='-------coradam_boundary';
    const metaPart=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`;
    const filePart=`--${boundary}\r\nContent-Type: ${file.type||'application/octet-stream'}\r\n\r\n`;
    const closing=`\r\n--${boundary}--`;
    // Build multipart body as Uint8Array for correct binary handling
    const enc=new TextEncoder();
    const fileBytes=await file.arrayBuffer();
    const combined=new Uint8Array(enc.encode(metaPart).byteLength+enc.encode(filePart).byteLength+fileBytes.byteLength+enc.encode(closing).byteLength);
    let off=0;
    const write=b=>{ combined.set(b,off); off+=b.byteLength; };
    write(enc.encode(metaPart)); write(enc.encode(filePart));
    write(new Uint8Array(fileBytes)); write(enc.encode(closing));
    const res=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',{
      method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':`multipart/related; boundary=${boundary}`},
      body:combined
    });
    if(!res.ok){ const t=await res.text(); throw new Error(`Drive upload failed: ${res.status} ${t}`); }
    return res.json();
  },

  // Main entry point: upload a file and attach it to an entry
  async uploadFromInput(input, entryId){
    const file=input.files?.[0]; if(!file) return;
    const entry=Cache.entries[entryId]; if(!entry) return;
    const status=document.getElementById('ms-doc-status');
    const lbl=document.getElementById('ms-doc-upload-lbl');
    status.textContent='Uploading…'; status.className='doc-status';
    lbl.style.pointerEvents='none'; lbl.style.opacity='.55';
    try{
      const token=await this._token();
      const user=Cache.users[entry.userId]||App.user;
      // Get-or-create controller root folder
      let rootId=user.driveRootFolderId;
      if(!rootId){
        rootId=await this._folder(user.name,null,token);
        // Share with c.nocher@coradam.com (once, on creation)
        await this._share(rootId,token);
        const upd={...user,driveRootFolderId:rootId};
        await fbUpdate(`users/${user.uid}`,{driveRootFolderId:rootId});
        Cache.users[user.uid]=upd;
      }
      // Folder chain: client → factory → date
      const clientId =await this._folder(entry.clientName||'Unknown',rootId,token);
      const factoryId=await this._folder(entry.factory||'Unknown',clientId,token);
      const dateId   =await this._folder(entry.date,factoryId,token);
      // Upload file
      const result=await this._upload(file,dateId,token);
      // Persist document reference in Firebase
      const doc={id:U.uuid(),name:file.name,mimeType:file.type||'',driveId:result.id,webViewLink:result.webViewLink,uploadedAt:Date.now()};
      const docs=[...(entry.documents||[]),doc];
      await fbUpdate(`entries/${entryId}`,{documents:docs});
      Cache.entries[entryId]={...entry,documents:docs};
      // Refresh docs list in modal
      Slot._renderDocs(Cache.entries[entryId]);
      status.textContent='Uploaded successfully.';
    } catch(e){
      log.error('Drive upload error',e);
      status.textContent='Upload failed: '+e.message;
      status.className='doc-status err';
    } finally{
      lbl.style.pointerEvents=''; lbl.style.opacity='';
      input.value='';
    }
  }
};

// ════════════════════════════════════
// REPORTS (Super Admin only)
// Charts use CSS bars + raw SVG — no external CDN required (CSP restriction).
// ════════════════════════════════════
const Rpt = {
  init(){
    const y = new Date().getFullYear();
    const sel = document.getElementById('rp-year');
    if(!sel) return;
    sel.innerHTML = '';
    for(let i=y-3; i<=y+1; i++){
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = i;
      if(i===y) opt.selected = true;
      sel.appendChild(opt);
    }
    document.getElementById('rp-month').value = '0';
  },

  render(){
    const year   = +document.getElementById('rp-year').value;
    const moRaw  = document.getElementById('rp-month').value; // '0','1'-'12','q1'-'q4'
    this._renderUtil(year, moRaw);
    this._renderClients(year, moRaw);
    this._renderQtyTrend(year, moRaw);
  },

  // Return JS months (0-based) covered by the selection
  _periodMonths(moRaw){
    const q={q1:[0,1,2],q2:[3,4,5],q3:[6,7,8],q4:[9,10,11]};
    if(q[moRaw]) return q[moRaw];
    const n=+moRaw;
    if(n===0) return [0,1,2,3,4,5,6,7,8,9,10,11];
    return [n-1]; // n is 1-based
  },

  // Count Mon–Fri working days in a given month (m = 0-based JS month)
  _wDays(y, m){
    let n=0; const d=new Date(y,m,1);
    while(d.getMonth()===m){ const dow=d.getDay(); if(dow!==0&&dow!==6) n++; d.setDate(d.getDate()+1); }
    return n;
  },

  // Entries matching the selected period
  _entries(y, moRaw){
    const months=this._periodMonths(moRaw); // 0-based JS months
    return Cache.entriesArr().filter(e=>{
      if(!e.date) return false;
      const [ey,em]=e.date.split('-').map(Number);
      if(ey!==y) return false;
      return months.includes(em-1); // em is 1-based
    });
  },

  _renderUtil(y, moRaw){
    const months  = this._periodMonths(moRaw); // 0-based JS months
    const entries = this._entries(y, moRaw);
    const totalWD = months.reduce((s,m)=>s+this._wDays(y,m),0);
    const controllers = Cache.usersArr()
      .filter(u=>u.role==='controller'&&u.active)
      .sort((a,b)=>a.name.localeCompare(b.name));

    // Pre-expand availability rules per user across the period
    const availByUser={};
    Cache.availArr().filter(r=>r.type==='available').forEach(rule=>{
      months.forEach(m=>{
        U.expandAvail(rule,y,m).forEach(d=>{
          (availByUser[rule.userId]=availByUser[rule.userId]||new Set()).add(d);
        });
      });
    });

    let html='';
    controllers.forEach(u=>{
      const ue     = entries.filter(e=>e.userId===u.uid);
      const full   = ue.filter(e=>e.slot==='Full Day').length;
      const am     = ue.filter(e=>e.slot==='Half Day AM').length;
      const pm     = ue.filter(e=>e.slot==='Half Day PM').length;
      const booked = full + (am+pm)*0.5;
      // Availability
      const availDays = (availByUser[u.uid]||new Set()).size;
      // Bar widths use availDays as denominator so bars are always meaningful
      // regardless of period length (Full Year vs single month).
      // Fall back to totalWD if no availability rules have been set yet.
      const denom = availDays || totalWD;
      const fPct      = denom ? Math.min(100,(full/denom)*100) : 0;
      const aPct      = denom ? Math.min(100,(am*0.5/denom)*100) : 0;
      const pPct      = denom ? Math.min(100,(pm*0.5/denom)*100) : 0;
      const bookedPct = denom ? Math.min(100,(booked/denom)*100) : 0;
      // Unbooked = remainder of available days
      const unbookedPct = availDays ? Math.max(0, 100 - bookedPct) : 0;
      const bkOfAvail = availDays ? Math.round(bookedPct) : null;
      const pctLabel = bkOfAvail!=null
        ? `<span class="rp-util-pct-main">${bkOfAvail}%</span><br><span style="font-size:.66rem">${availDays}d available</span>`
        : `<span class="rp-util-pct-main">${Math.round(bookedPct)}%</span>`;
      html+=`<div class="rp-util-row">`+
        `<div class="rp-util-name" title="${U.esc(u.name)}">${U.esc(u.name)}</div>`+
        `<div class="rp-util-bar-wrap">`+
          `<div class="rp-util-bar">`+
            `<div class="rp-seg rp-seg-f"  style="width:${fPct.toFixed(1)}%"></div>`+
            `<div class="rp-seg rp-seg-a"  style="width:${aPct.toFixed(1)}%"></div>`+
            `<div class="rp-seg rp-seg-p"  style="width:${pPct.toFixed(1)}%"></div>`+
            `<div class="rp-seg rp-seg-av" style="width:${unbookedPct.toFixed(1)}%"></div>`+
          `</div>`+
          `<div class="rp-util-pct">${pctLabel}</div>`+
        `</div>`+
      `</div>`;
    });
    document.getElementById('rp-util-body').innerHTML = html || '<div class="no-items">No data for this period.</div>';
  },

  _renderClients(y, moRaw){
    const entries = this._entries(y, moRaw);
    const map={};
    entries.forEach(e=>{
      const cn=e.clientName||'(unknown)';
      map[cn]=(map[cn]||0)+(e.slot==='Full Day'?1:0.5);
    });
    const sorted=Object.entries(map).sort((a,b)=>b[1]-a[1]);
    const max=sorted.length?sorted[0][1]:1;
    let html='';
    sorted.forEach(([name,days])=>{
      const pct=(days/max)*100;
      const val=days%1===0?days:days.toFixed(1);
      html+=`<div class="rp-cli-row">`+
        `<div class="rp-cli-name" title="${U.esc(name)}">${U.esc(name)}</div>`+
        `<div class="rp-cli-bar-wrap">`+
          `<div class="rp-cli-bar" style="width:${pct.toFixed(1)}%"></div>`+
          `<div class="rp-cli-val">${val}d</div>`+
        `</div>`+
      `</div>`;
    });
    document.getElementById('rp-cli-body').innerHTML = html || '<div class="no-items">No bookings for this period.</div>';
  },

  _renderQtyTrend(y, moRaw){
    const qMap={q1:[1,2,3],q2:[4,5,6],q3:[7,8,9],q4:[10,11,12]};
    const months = qMap[moRaw]||( +moRaw===0 ? Array.from({length:12},(_,i)=>i+1) : [+moRaw] );
    const allE = Cache.entriesArr().filter(e=>e.date&&e.date.startsWith(y+'-'));
    const MLBL=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const data = months.map(m=>{
      const mk=`${y}-${S2(m)}`;
      const me=allE.filter(e=>e.date.startsWith(mk));
      return { label:MLBL[m-1], exp:me.reduce((s,e)=>s+(e.expectedQty||0),0), fin:me.reduce((s,e)=>s+(e.finalQty||0),0) };
    });
    document.getElementById('rp-trend-body').innerHTML = this._lineChart(data);
  },

  _lineChart(data){
    const hasQty = data.some(d=>d.exp||d.fin);
    if(!hasQty) return '<div class="no-items">No quantity data for this period.</div>';
    const W=480, H=200, padL=44, padR=16, padT=12, padB=36;
    const cW=W-padL-padR, cH=H-padT-padB;
    const allV=data.flatMap(d=>[d.exp,d.fin]).filter(v=>v>0);
    const maxY=allV.length ? Math.ceil(Math.max(...allV)*1.15/10)*10||10 : 10;
    const n=data.length;
    const xPos=i=>padL+(n===1?cW/2:i*(cW/(n-1)));
    const yPos=v=>padT+cH-(v/maxY)*cH;

    // Horizontal grid lines
    let grid='';
    for(let i=0;i<=4;i++){
      const val=(maxY/4)*i, y=yPos(val);
      grid+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
      grid+=`<text x="${padL-4}" y="${y+4}" text-anchor="end" class="rpc-t">${Math.round(val)}</text>`;
    }
    const xlabels=data.map((d,i)=>`<text x="${xPos(i)}" y="${H-padB+14}" text-anchor="middle" class="rpc-t">${d.label}</text>`).join('');
    const pts=key=>data.map((d,i)=>`${xPos(i)},${yPos(d[key])}`).join(' ');
    const expLine=`<polyline points="${pts('exp')}" fill="none" stroke="#191d64" stroke-width="2" stroke-dasharray="5,3"/>`;
    const finLine=`<polyline points="${pts('fin')}" fill="none" stroke="#10b981" stroke-width="2.5"/>`;
    let dots='';
    data.forEach((d,i)=>{
      dots+=`<circle cx="${xPos(i)}" cy="${yPos(d.exp)}" r="3" fill="#191d64"/>`;
      dots+=`<circle cx="${xPos(i)}" cy="${yPos(d.fin)}" r="3" fill="#10b981"/>`;
    });
    const lY=H-4;
    const leg=`<line x1="${padL}" y1="${lY}" x2="${padL+20}" y2="${lY}" stroke="#191d64" stroke-width="2" stroke-dasharray="5,3"/>`+
      `<text x="${padL+24}" y="${lY+4}" class="rpc-t">Expected</text>`+
      `<line x1="${padL+95}" y1="${lY}" x2="${padL+115}" y2="${lY}" stroke="#10b981" stroke-width="2.5"/>`+
      `<text x="${padL+119}" y="${lY+4}" class="rpc-t">Final</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="rp-svg">${grid}${xlabels}${expLine}${finLine}${dots}${leg}</svg>`;
  }
};

// ════════════════════════════════════
// MANAGER DASHBOARD (team_manager role)
// ════════════════════════════════════
const Mgr = {
  _uid: null,   // selected controller uid
  _tab: 'bookings', // 'bookings' | 'avail' | 'docs'
  _cur: new Date(),

  init(){
    this._cur=new Date();
    const ctrls=this._myControllers();
    // Reset to first controller if current is not in list
    if(!this._uid||!ctrls.find(u=>u.uid===this._uid)){
      this._uid=ctrls[0]?.uid||null;
    }
    this._tab='bookings';
    this._render();
  },

  refresh(){
    this._render();
  },

  _myControllers(){
    const ids=Object.keys(App.user?.managedControllerIds||{});
    return ids.map(uid=>Cache.users[uid]).filter(u=>u&&u.active);
  },

  _render(){
    this._renderCtrlTabs();
    this._renderPanel();
  },

  _renderCtrlTabs(){
    const ctrls=this._myControllers();
    const bar=document.getElementById('mgr-ctrl-bar');
    if(!ctrls.length){
      bar.innerHTML='<div class="mgr-no-ctrls">No controllers assigned yet — ask an administrator to assign you controllers.</div>';
      return;
    }
    bar.innerHTML=ctrls.map(u=>
      `<button class="mgr-ctrl-btn${this._uid===u.uid?' active':''}" data-uid="${U.esc(u.uid)}">${U.esc(u.name)}${u.country?' '+U.flag(u.country):''}</button>`
    ).join('');
    bar.querySelectorAll('.mgr-ctrl-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        this._uid=btn.dataset.uid;
        this._tab='bookings';
        this._render();
      });
    });
  },

  _renderPanel(){
    if(!this._uid){
      document.getElementById('mgr-panel').style.display='none';
      return;
    }
    document.getElementById('mgr-panel').style.display='block';
    const u=Cache.users[this._uid];
    document.getElementById('mgr-ctrl-name').textContent=(u?.name||'Controller')+(u?.country?' — '+u.country:'');
    document.getElementById('mgr-month-lbl').textContent=U.monthLabel(this._cur);
    // Tab active state
    ['bookings','avail','docs'].forEach(t=>{
      document.getElementById('mgr-tab-'+t).classList.toggle('on',this._tab===t);
    });
    // Show/hide nav (only for bookings and avail)
    document.getElementById('mgr-nav').style.display=(this._tab==='docs')?'none':'flex';
    // Show/hide add buttons
    document.getElementById('btn-mgr-book').style.display=(this._tab==='bookings')?'inline-flex':'none';
    document.getElementById('btn-mgr-avail').style.display=(this._tab==='avail')?'inline-flex':'none';
    // Render content
    if(this._tab==='bookings') this._renderBookings();
    else if(this._tab==='avail') this._renderAvail();
    else this._renderDocs();
  },

  setTab(t){ this._tab=t; this._renderPanel(); },

  prev(){
    this._cur=new Date(this._cur.getFullYear(),this._cur.getMonth()-1,1);
    this._renderPanel();
  },
  next(){
    this._cur=new Date(this._cur.getFullYear(),this._cur.getMonth()+1,1);
    this._renderPanel();
  },

  addBooking(){
    if(!this._uid) return;
    Slot.add(U.today(), this._uid);
  },

  addAvail(){
    if(!this._uid) return;
    Avail.openBulk(this._uid);
  },

  _renderBookings(){
    const mStr=U.monthKey(this._cur);
    const entries=Cache.entriesArr()
      .filter(e=>e.userId===this._uid&&e.date?.startsWith(mStr))
      .sort((a,b)=>a.date.localeCompare(b.date));
    let html='';
    if(!entries.length){
      html='<div class="mgr-empty-list">No bookings this month. Click "+ Booking" to add one.</div>';
    } else {
      entries.forEach(e=>{
        const cls=U.slotCls(e.slot);
        html+=`<div class="mgr-entry-row">
          <div class="mgr-entry-date">${U.fmt(e.date)}</div>
          <div class="mgr-entry-slot"><span class="chip c-${U.esc(cls)}">${U.esc(e.slot)}</span></div>
          <div class="mgr-entry-detail">${U.esc(e.clientName||'')}${e.factory?' &mdash; '+U.esc(e.factory):''}</div>
          <button class="btn btn-s btn-sm mgr-edit-btn" data-id="${U.esc(e.id)}">Edit</button>
        </div>`;
      });
    }
    document.getElementById('mgr-content-body').innerHTML=html;
    document.querySelectorAll('.mgr-edit-btn').forEach(btn=>{
      btn.addEventListener('click',()=>Slot.edit(btn.dataset.id));
    });
  },

  _renderAvail(){
    const rules=Cache.availArr()
      .filter(a=>a.userId===this._uid)
      .sort((a,b)=>a.startDate.localeCompare(b.startDate));
    let html='';
    if(!rules.length){
      html='<div class="mgr-empty-list">No availability rules. Click "🗓 Set Availability" to add one.</div>';
    } else {
      rules.forEach(r=>{
        const typeIcon=r.type==='available'?'✅':'🚫';
        const repeatLabel=r.repeatMode&&r.repeatMode!=='none'?' · '+r.repeatMode:'';
        const dateStr=r.endDate?`${U.fmt(r.startDate)} – ${U.fmt(r.endDate)}`:U.fmt(r.startDate);
        html+=`<div class="mgr-avail-row">
          <div class="mgr-avail-icon">${typeIcon}</div>
          <div class="mgr-avail-info">
            <div class="mgr-avail-date">${dateStr}${repeatLabel}</div>
            <div class="mgr-avail-slot">${U.esc(r.slot||'')}${r.note?' — '+U.esc(r.note):''}</div>
          </div>
        </div>`;
      });
    }
    document.getElementById('mgr-content-body').innerHTML=html;
  },

  async _renderDocs(){
    document.getElementById('mgr-content-body').innerHTML='<div class="mgr-loading">Loading…</div>';
    try{
      const docs=await Cache.loadDocuments(this._uid);
      const ctrl=Cache.users[this._uid];
      let html=`<div class="mgr-docs-toolbar">
        <span class="mgr-docs-folder">📁 ${U.esc(ctrl?.name||'Controller')}</span>
        <label class="btn btn-p btn-sm" for="mgr-doc-input">⬆ Upload document</label>
        <input type="file" id="mgr-doc-input" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.gif,.webp" style="display:none">
      </div>
      <div id="mgr-doc-status" class="mgr-doc-status"></div>`;
      if(!docs.length){
        html+='<div class="mgr-empty-list">No documents yet. Upload PDFs, images or Word docs.</div>';
      } else {
        const sorted=[...docs].sort((a,b)=>b.created-a.created);
        sorted.forEach(d=>{
          const ico=d.contentType?.startsWith('image')?'🖼':d.contentType?.includes('pdf')?'📄':(d.contentType?.includes('spreadsheet')||d.contentType?.includes('excel'))?'📊':d.name?.endsWith('.docx')||d.name?.endsWith('.doc')?'📝':'📎';
          html+=`<div class="mgr-doc-row">
            <span class="mgr-doc-ico">${ico}</span>
            <a href="${U.esc(d.downloadURL)}" target="_blank" rel="noopener" class="mgr-doc-name">${U.esc(d.name)}</a>
            <span class="mgr-doc-by">by ${U.esc(d.uploadedByName||'')}</span>
            <button class="btn btn-d btn-sm mgr-doc-del" data-id="${U.esc(d.id)}">Delete</button>
          </div>`;
        });
      }
      document.getElementById('mgr-content-body').innerHTML=html;
      // Bind upload input
      const inp=document.getElementById('mgr-doc-input');
      inp.addEventListener('change',()=>Docs.upload(inp, this._uid));
      // Bind delete buttons
      document.querySelectorAll('.mgr-doc-del').forEach(btn=>{
        btn.addEventListener('click',()=>Docs.del(btn.dataset.id, this._uid));
      });
    } catch(e){ document.getElementById('mgr-content-body').innerHTML=`<div class="mgr-empty-list err-text">Failed to load documents: ${U.esc(e.message)}</div>`; }
  }
};

// ════════════════════════════════════
// DOCS (Firebase Storage — per controller documents)
// ════════════════════════════════════
const Docs = {
  async upload(input, controllerUid){
    const file=input.files[0]; if(!file) return;
    if(!fstorage){ toast('Firebase Storage is not initialised. Check index.html for the Storage SDK script.','err'); return; }
    const statusEl=document.getElementById('mgr-doc-status');
    if(statusEl){ statusEl.textContent='Uploading…'; statusEl.className='mgr-doc-status uploading'; }
    Spin.on();
    try{
      const docId=U.uuid();
      // Sanitise filename — remove path traversal chars, keep extension
      const safeName=file.name.replace(/[^a-zA-Z0-9._\- ]/g,'_').slice(0,200)||'document';
      const storePath=`documents/${controllerUid}/${docId}/${safeName}`;
      const storageRef=fstorage.ref(storePath);
      await storageRef.put(file,{contentType:file.type||'application/octet-stream'});
      const downloadURL=await storageRef.getDownloadURL();
      const meta={
        id:docId,
        controllerUid,
        controllerName:Cache.users[controllerUid]?.name||'',
        name:safeName,
        storagePath:storePath,
        downloadURL,
        contentType:file.type||'application/octet-stream',
        size:file.size,
        uploadedBy:App.user.uid,
        uploadedByName:App.user.name,
        created:Date.now()
      };
      await fbSet(`documents/${controllerUid}/${docId}`,meta);
      if(!Cache.documents[controllerUid]) Cache.documents[controllerUid]={};
      Cache.documents[controllerUid][docId]=meta;
      if(statusEl){ statusEl.textContent='Uploaded successfully!'; statusEl.className='mgr-doc-status ok'; setTimeout(()=>{ statusEl.textContent=''; statusEl.className='mgr-doc-status'; },3000); }
      Mgr._renderDocs();
      toast('Document uploaded.');
    } catch(e){ if(statusEl){ statusEl.textContent='Upload failed: '+e.message; statusEl.className='mgr-doc-status err'; } toast('Upload failed: '+e.message,'err'); }
    finally{ Spin.off(); input.value=''; }
  },

  async del(docId, controllerUid){
    const meta=Cache.documents[controllerUid]?.[docId];
    if(!meta||!confirm('Delete "'+meta.name+'"? This cannot be undone.')) return;
    Spin.on();
    try{
      if(meta.storagePath && fstorage) await fstorage.ref(meta.storagePath).delete();
      await fbDel(`documents/${controllerUid}/${docId}`);
      delete Cache.documents[controllerUid][docId];
      Mgr._renderDocs();
      toast('Document deleted.');
    } catch(e){ toast('Delete failed: '+e.message,'err'); }
    finally{ Spin.off(); }
  }
};

// ════════════════════════════════════
// EVENT BINDINGS (replaces inline onclick/onchange)
// All handlers are attached here so the CSP can forbid unsafe-inline scripts.
// ════════════════════════════════════
function _bindEvents(){
  function on(id, evt, fn){ const el=document.getElementById(id); if(el) el.addEventListener(evt,fn); }

  // ── Manager screen ──
  on('btn-signout-mgr', 'click', ()=>Auth.signOut());
  on('btn-mgr-settings','click', ()=>App.goSettings());
  on('btn-mgr-prev',    'click', ()=>Mgr.prev());
  on('btn-mgr-next',    'click', ()=>Mgr.next());
  on('btn-mgr-book',   'click', ()=>Mgr.addBooking());
  on('btn-mgr-avail',  'click', ()=>Mgr.addAvail());
  on('mgr-tab-bookings','click', ()=>Mgr.setTab('bookings'));
  on('mgr-tab-avail',   'click', ()=>Mgr.setTab('avail'));
  on('mgr-tab-docs',    'click', ()=>Mgr.setTab('docs'));

  // ── Setup screen ──
  on('btn-setup-save',  'click', ()=>Setup.connect());
  on('btn-setup-reset', 'click', ()=>Setup.reset());

  // ── Login screen ──
  on('btn-google-signin','click',()=>Auth.signIn());

  // ── Controller calendar header ──
  on('btn-avail-open', 'click', ()=>Avail.openBulk());
  on('btn-go-profile', 'click', ()=>App.goProfile());
  on('btn-signout-cal','click', ()=>Auth.signOut());

  // ── Calendar navigation & views ──
  on('btn-cal-prev','click',()=>Cal.prev());
  on('btn-cal-next','click',()=>Cal.next());
  on('vt-month',    'click',()=>Cal.setView('month'));
  on('vt-week',     'click',()=>Cal.setView('week'));
  on('vt-list',     'click',()=>Cal.setView('list'));

  // ── Admin header ──
  on('nt-tl',          'click',()=>Adm.setView('tl'));
  on('nt-wk',          'click',()=>Adm.setView('wk'));
  on('nt-ls',          'click',()=>Adm.setView('ls'));
  on('nt-rp',          'click',()=>Adm.setView('rp'));
  on('btn-adm-refresh','click',()=>Adm.refresh());
  on('btn-adm-offday', 'click',()=>OffDay.open());
  on('btn-rp-apply',   'click',()=>Rpt.render());
  on('rp-year',        'change',()=>Rpt.render());
  on('rp-month',       'change',()=>Rpt.render());
  on('btn-adm-csv',    'click',()=>Adm.exportCSV());
  on('btn-adm-settings','click',()=>App.goSettings());
  on('btn-signout-adm','click',()=>Auth.signOut());

  // ── Admin filters ──
  on('f-mo','change',()=>Adm.applyFilters());
  on('f-us','change',()=>Adm.applyFilters());
  on('f-cl','change',()=>Adm.applyFilters());
  on('f-fa','change',()=>Adm.applyFilters());
  on('btn-adm-clear','click',()=>Adm.clearFilters());
  on('btn-adm-prev', 'click',()=>Adm.prev());
  on('btn-adm-next', 'click',()=>Adm.next());

  // ── Settings header ──
  on('hdr-set-back', 'click',()=>App.goBack());
  on('btn-signout-set','click',()=>Auth.signOut());

  // ── Settings tabs ──
  on('stab-users',      'click',()=>Sett.tab('users'));
  on('stab-clients',    'click',()=>Sett.tab('clients'));
  on('stab-data',       'click',()=>Sett.tab('data'));
  on('stab-freshbooks', 'click',()=>Sett.tab('freshbooks'));

  // ── Settings actions ──
  on('btn-invite-ctrl', 'click',()=>Sett.openInvite());
  on('btn-import-csv',  'click',()=>Sett.bulkImport());
  on('btn-add-client',  'click',()=>Sett.openAddClient());
  on('btn-wipe-all',    'click',()=>Sett.wipeAll());
  on('btn-change-cfg',  'click',()=>Setup.reset());
  on('btn-save-profile','click',()=>Sett.saveProfile());

  // ── Booking modal ──
  on('sb-f',          'click',()=>Slot.pick('Full Day'));
  on('sb-a',          'click',()=>Slot.pick('Half Day AM'));
  on('sb-p',          'click',()=>Slot.pick('Half Day PM'));
  on('ms-client',     'change',()=>Slot.onClientChange());
  on('ms-repeat',     'change',()=>Slot.onRepeatChange());
  on('ms-del',        'click',()=>Slot.del());
  on('btn-cancel-slot','click',()=>M.close('m-slot'));
  on('btn-save-slot', 'click',()=>Slot.save());
  // Weekday toggle buttons (Mon–Sun)
  document.querySelectorAll('#ms-wd-btns .wd-btn').forEach(b=>b.addEventListener('click',()=>b.classList.toggle('on')));

  // ── Day picker modal ──
  on('btn-day-book', 'click',()=>{ M.close('m-day'); Slot.add(App._pendingDate); });
  on('btn-day-avail','click',()=>{ M.close('m-day'); Avail.openForDate(App._pendingDate); });
  on('btn-cancel-day','click',()=>M.close('m-day'));

  // ── Availability modal ──
  on('av-yes',          'click',()=>Avail.pickType('available'));
  on('av-no',           'click',()=>Avail.pickType('unavailable'));
  on('ma-sb-f',         'click',()=>Avail.pickSlot('Full Day'));
  on('ma-sb-a',         'click',()=>Avail.pickSlot('Half Day AM'));
  on('ma-sb-p',         'click',()=>Avail.pickSlot('Half Day PM'));
  on('ma-repeat',       'change',()=>Avail.onRepeatChange());
  on('ma-del',          'click',()=>Avail.del());
  on('btn-cancel-avail','click',()=>M.close('m-avail'));
  on('btn-save-avail',  'click',()=>Avail.save());

  // ── User edit modal ──
  on('btn-cancel-user','click',()=>M.close('m-user'));
  on('btn-save-user',  'click',()=>Sett.saveUser());

  // ── Invite modal ──
  on('btn-cancel-invite','click',()=>M.close('m-invite'));
  on('btn-do-invite',    'click',()=>Sett.inviteController());
  on('inv-role',         'change',()=>Sett.onInviteRoleChange());

  // ── Client modal ──
  on('mc-del',          'click',()=>Sett.delClient());
  on('btn-cancel-client','click',()=>M.close('m-client'));
  on('btn-save-client', 'click',()=>Sett.saveClient());

  // ── Off Day modal ──
  on('btn-cancel-offday','click',()=>M.close('m-offday'));
  on('btn-save-offday',  'click',()=>OffDay.save());
  on('od-hol',           'click',()=>OffDay.pickType('holiday'));
  on('od-sick',          'click',()=>OffDay.pickType('sick'));
  on('od-uid',           'change',()=>OffDay._renderList());
}

// ════════════════════════════════════
// BOOT
// ════════════════════════════════════
_bindEvents();
App.init();
