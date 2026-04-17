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
// HOLIDAYS — Official national public holidays (Nager.Date public API)
// Drives: (a) orange highlight on calendar based on controller's country,
//         (b) skipping of recurring bookings on national holidays.
// ════════════════════════════════════
const COUNTRY_CODES = {Italy:'IT',Thailand:'TH',France:'FR',Portugal:'PT',Spain:'ES',India:'IN'};
const Hol = {
  // In-memory cache: { 'IT': { 2026: [{date,name}], 2027: [...] } }
  cache: {},
  _inflight: {},       // prevents duplicate concurrent fetches
  _lsKey(code, year){ return `hol:${code}:${year}`; },

  // Load cached data from localStorage into memory at startup
  _loadLS(){
    try{
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(!k||!k.startsWith('hol:')) continue;
        const [,code,year]=k.split(':');
        const raw=localStorage.getItem(k);
        if(!raw) continue;
        const data=JSON.parse(raw);
        // Refresh if stored data is older than 30 days (in case API corrects a holiday)
        if(!data._fetched||(Date.now()-data._fetched>30*86400000)){ localStorage.removeItem(k); continue; }
        (this.cache[code]=this.cache[code]||{})[year]=data.items||[];
      }
    } catch(e){ log.warn('Hol LS load failed',e); }
  },

  _code(country){ return COUNTRY_CODES[country]||null; },

  // Returns array of {date:'YYYY-MM-DD', name, localName} or [] — never throws.
  async forYear(country, year){
    const code=this._code(country); if(!code) return [];
    (this.cache[code]=this.cache[code]||{});
    if(this.cache[code][year]) return this.cache[code][year];
    const key=`${code}:${year}`;
    if(this._inflight[key]) return this._inflight[key];
    this._inflight[key]=(async()=>{
      try{
        const res=await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`);
        if(!res.ok) throw new Error('HTTP '+res.status);
        const data=await res.json();
        const items=(data||[]).map(h=>({date:h.date,name:h.name||h.localName||'Holiday',localName:h.localName||h.name||''}));
        this.cache[code][year]=items;
        try{ localStorage.setItem(this._lsKey(code,year),JSON.stringify({items,_fetched:Date.now()})); }catch{}
        return items;
      } catch(e){
        log.warn(`Holiday fetch failed ${country} ${year}:`,e.message);
        this.cache[code][year]=[]; // cache empty so we don't retry immediately
        return [];
      } finally{
        delete this._inflight[key];
      }
    })();
    return this._inflight[key];
  },

  // Synchronous lookup — returns {date,name} or null. Requires prior prefetch.
  get(country, dateStr){
    const code=this._code(country); if(!code||!dateStr) return null;
    const year=dateStr.slice(0,4);
    const list=this.cache[code]?.[year]; if(!list) return null;
    return list.find(h=>h.date===dateStr)||null;
  },
  is(country, dateStr){ return !!this.get(country,dateStr); },

  // Ensures all years touched by a date range are loaded. Safe to call repeatedly.
  async prefetchRange(country, startDate, endDate){
    if(!country) return;
    const y1=parseInt((startDate||'').slice(0,4))||new Date().getFullYear();
    const y2=parseInt((endDate||startDate||'').slice(0,4))||y1;
    const years=[]; for(let y=y1;y<=y2;y++) years.push(y);
    await Promise.all(years.map(y=>this.forYear(country,y)));
  },

  // Prefetch for a calendar view (current year and neighbours)
  async prefetchForView(country, centerDate){
    if(!country) return;
    const y=centerDate.getFullYear();
    await Promise.all([y-1,y,y+1].map(yy=>this.forYear(country,yy)));
  }
};

// ════════════════════════════════════
// MANUFACTURER NORMALISATION
// Feature 3+4: bookings now carry a manufacturers[] array. Legacy entries
// (factory / expectedQty / finalQty / documents on the top-level) are
// transparently upgraded in-memory on read via normalizeEntry().
// ════════════════════════════════════
function normalizeManufacturers(entry){
  if(!entry) return [];
  if(Array.isArray(entry.manufacturers)&&entry.manufacturers.length){
    return entry.manufacturers.map(m=>({
      factory: m.factory||'',
      expectedQty: m.expectedQty!=null?m.expectedQty:null,
      finalQty: m.finalQty!=null?m.finalQty:null,
      documents: Array.isArray(m.documents)?m.documents:[]
    }));
  }
  // Legacy: synthesize a single manufacturer from top-level fields
  return [{
    factory: entry.factory||'',
    expectedQty: entry.expectedQty!=null?entry.expectedQty:null,
    finalQty: entry.finalQty!=null?entry.finalQty:null,
    documents: Array.isArray(entry.documents)?entry.documents:[]
  }];
}

// Convenience readers used by renderers — always operate on normalized form.
function entryHasDocs(entry){
  return normalizeManufacturers(entry).some(m=>Array.isArray(m.documents)&&m.documents.length>0);
}
function entryDocCount(entry){
  return normalizeManufacturers(entry).reduce((s,m)=>s+(Array.isArray(m.documents)?m.documents.length:0),0);
}
function entryFactoryLabel(entry){
  const mfrs=normalizeManufacturers(entry).filter(m=>m.factory);
  if(!mfrs.length) return '';
  if(mfrs.length===1) return mfrs[0].factory;
  return `${mfrs[0].factory} +${mfrs.length-1}`;
}
function entryTotalExpected(entry){
  const mfrs=normalizeManufacturers(entry);
  const filled=mfrs.filter(m=>m.expectedQty!=null);
  if(!filled.length) return null;
  return filled.reduce((s,m)=>s+m.expectedQty,0);
}
function entryTotalFinal(entry){
  const mfrs=normalizeManufacturers(entry);
  const filled=mfrs.filter(m=>m.finalQty!=null);
  if(!filled.length) return null;
  return filled.reduce((s,m)=>s+m.finalQty,0);
}

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
    // Prime holiday cache from localStorage (no network)
    Hol._loadLS();
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
// ROLE HELPERS
// ════════════════════════════════════
// isBookable: users who appear on the timeline, in Off Day dropdowns, and in Reports.
// super_admin is treated as a bookable user so they can carry their own schedule.
function isBookable(u){ return (u.role==='controller'||u.role==='super_admin')&&u.active; }

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
    // All roles can update their own country (super_admin uses it for the timeline grouping)
    document.getElementById('set-profile').style.display='block';
    document.getElementById('profile-country').value=u.country||'';
    if(u.role==='super_admin') Sett.tab('users');
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

  // Kick off holiday prefetch for the current country+year(s) — repaint when ready.
  _prefetchHolidays(){
    const country=App.user?.country;
    if(!country) return;
    const center=new Date(this.cur);
    Hol.prefetchForView(country,center).then(()=>{ this.render(); });
  },

  // Build one chip HTML fragment for a booking (shared by month + week views).
  // Shows client name (or slot) with a 📎 paperclip when documents are attached.
  _chipHtml(e){
    const cc=U.chipCls(e.slot);
    const factoryLbl=entryFactoryLabel(e);
    const tooltip=e.slot+' – '+(e.clientName||'')+(factoryLbl?' @ '+factoryLbl:'');
    const clip=entryHasDocs(e)?'<span class="has-docs-icon" title="Has attached documents">📎</span>':'';
    return `<div class="chip ${cc}" data-eid="${U.esc(e.id)}" title="${U.esc(tooltip)}">${U.esc(e.clientName||e.slot)}${clip}</div>`;
  },

  _renderMonth(){
    const y=this.cur.getFullYear(), m=this.cur.getMonth(), today=U.today(), uid=App.user.uid;
    const country=App.user?.country||'';
    document.getElementById('cal-lbl').textContent=U.monthLabel(this.cur);

    // Ensure holiday cache is warm for this view (fires network on cache miss)
    if(country){
      const needed=[y-1,y,y+1].some(yr=>!Hol.cache[Hol._code(country)]?.[yr]);
      if(needed) this._prefetchHolidays();
    }

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
      const hol=country?Hol.get(country,ds):null;

      let cls='cal-day';
      if(isT) cls+=' is-today';
      else if(hol) cls+=' is-holiday';
      else if(hasUnavail) cls+=' is-unavail';
      else if(hasAvail) cls+=' is-avail';

      // Split bookings into AM and PM lanes (Full Day shows in both to make the day unambiguous)
      const amBookings=de.filter(e=>e.slot==='Half Day AM'||e.slot==='Full Day');
      const pmBookings=de.filter(e=>e.slot==='Half Day PM'||e.slot==='Full Day');
      const amChips=amBookings.map(e=>this._chipHtml(e)).join('');
      const pmChips=pmBookings.map(e=>this._chipHtml(e)).join('');

      let body=`<div class="dslot-half dslot-am"><span class="dslot-half-lbl">AM</span>${amChips}</div>`+
               `<div class="dslot-half dslot-pm"><span class="dslot-half-lbl">PM</span>${pmChips}</div>`;
      let extra='';
      if(hol) extra+=`<div class="hol-tag" title="${U.esc(hol.name)}">🏖 ${U.esc(hol.name)}</div>`;
      if(hasAvail&&!hasUnavail) extra+=`<div class="av-tag av-tag-yes">✓ Available</div>`;
      if(hasUnavail) extra+=`<div class="av-tag av-tag-no">✗ Unavailable</div>`;

      const d=el('div',cls);
      d.innerHTML=`<div class="dn">${day}</div><div class="dslots">${body}${extra}</div>`;
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
    const country=App.user?.country||'';
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

    // Warm holiday cache for years touched by this week
    if(country){
      const years=[...new Set(days.map(dd=>dd.getFullYear()))];
      const needed=years.some(yr=>!Hol.cache[Hol._code(country)]?.[yr]);
      if(needed){ Promise.all(years.map(yr=>Hol.forYear(country,yr))).then(()=>this.render()); }
    }

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
      const hol=country?Hol.get(country,ds):null;
      const dayDiv=document.createElement('div');
      let wdClasses='week-day';
      if(isT) wdClasses+=' is-today';
      else if(hol) wdClasses+=' is-holiday';
      else if(hasUnavail) wdClasses+=' is-unavail';
      else if(hasAvail) wdClasses+=' is-avail';
      dayDiv.className=wdClasses;
      // Header
      const hdr=document.createElement('div'); hdr.className='week-day-hdr';
      hdr.innerHTML='<span class="wdn">'+WDAYS[i]+'</span><span class="wdd">'+d.getDate()+'</span>';
      hdr.addEventListener('click',()=>this._dayClick(ds,de,avRules));
      // Body with AM/PM split lanes matching the admin timeline layout
      const body=document.createElement('div'); body.className='week-day-body';
      if(hol){
        const h=document.createElement('div'); h.className='hol-tag';
        h.textContent='🏖 '+(hol.name||'Holiday'); h.title=hol.name||'';
        body.appendChild(h);
      }
      const amBookings=de.filter(e=>e.slot==='Half Day AM'||e.slot==='Full Day');
      const pmBookings=de.filter(e=>e.slot==='Half Day PM'||e.slot==='Full Day');
      const buildLane=(cls, label, bookings)=>{
        const lane=document.createElement('div'); lane.className='week-half '+cls;
        const lbl=document.createElement('div'); lbl.className='week-half-lbl'; lbl.textContent=label;
        lane.appendChild(lbl);
        if(!bookings.length){
          const ph=document.createElement('span'); ph.className='cal-free-lbl'; ph.textContent='—';
          lane.appendChild(ph);
        } else bookings.forEach(e=>{
          const chip=document.createElement('div');
          chip.className='chip '+U.chipCls(e.slot);
          const clip=entryHasDocs(e)?'<span class="has-docs-icon" title="Has documents">📎</span>':'';
          chip.innerHTML=U.esc(e.clientName||e.slot)+clip+'<div class="chip-sub">'+U.esc(entryFactoryLabel(e))+'</div>';
          chip.addEventListener('click',ev=>{ ev.stopPropagation(); Slot.edit(e.id); });
          lane.appendChild(chip);
        });
        return lane;
      };
      body.appendChild(buildLane('week-am','AM',amBookings));
      body.appendChild(buildLane('week-pm','PM',pmBookings));
      if(hasAvail&&!hasUnavail){ const t=document.createElement('div'); t.className='av-tag av-tag-yes'; t.style.fontSize='.65rem'; t.textContent='✓ Avail'; body.appendChild(t); }
      if(hasUnavail){ const t=document.createElement('div'); t.className='av-tag av-tag-no'; t.style.fontSize='.65rem'; t.textContent='✗ Unavail'; body.appendChild(t); }
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
      const te=entryTotalExpected(e), tf=entryTotalFinal(e);
      const qty=(te!=null||tf!=null)?(' · Exp: '+(te??'—')+' / Final: '+(tf??'—')):'';
      const docCount=entryDocCount(e);
      const docsBadge=docCount>0?`<span class="cl-docs-badge" title="${docCount} document${docCount>1?'s':''} attached">📎 ${docCount}</span>`:'';
      info.innerHTML='<div class="cl-client">'+U.esc(e.clientName||'—')+' <span class="badge badge-sm '+U.badgeCls(e.slot)+'">'+e.slot+'</span>'+docsBadge+'</div>'
        +'<div class="cl-detail">'+U.esc(entryFactoryLabel(e))+qty+(e.notes?' · '+U.esc(e.notes):'')+'</div>';
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
  // Current modal's manufacturer list (kept in JS memory, serialized on save).
  // Shape: [{ factory, expectedQty|null, finalQty|null, documents:[] }]
  _mfrs: [],
  _activeEntryId: '',          // the entry id currently being edited (for doc uploads)

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
    this._fillClients(targetUid,'');
    this._mfrs=[{factory:'',expectedQty:null,finalQty:null,documents:[]}];
    this._renderMfrs();
    this._checkHolidayWarn();
    M.open('m-slot');
  },
  edit(id){
    const e=Cache.entries[id]; if(!e) return;
    if(!this._canManage(e.userId)) return;
    this._reset();
    this._activeEntryId=id;
    document.getElementById('ms-title').textContent='Edit Booking';
    document.getElementById('ms-id').value=id;
    document.getElementById('ms-date').value=e.date;
    document.getElementById('ms-notes').value=e.notes||'';
    document.getElementById('ms-del').style.display='inline-flex';
    // Hide recurrence in edit mode — edits always affect a single occurrence
    document.getElementById('ms-recur-wrap').style.display='none';
    document.getElementById('btn-save-slot').textContent='Save booking';
    this.pick(e.slot);
    this._setForUser(e.userId);
    this._fillClients(e.userId||App.user.uid, e.clientId||'');
    // Hydrate manufacturers list from entry (normalizes legacy single-mfr bookings)
    this._mfrs=normalizeManufacturers(e).map(m=>({...m, documents:[...(m.documents||[])]}));
    if(!this._mfrs.length) this._mfrs=[{factory:'',expectedQty:null,finalQty:null,documents:[]}];
    this._renderMfrs();
    this._checkHolidayWarn();
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
    ['ms-id','ms-date','ms-notes','ms-from','ms-to','ms-until'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    document.getElementById('ms-type').value='';
    document.getElementById('ms-repeat').value='none';
    document.getElementById('ms-err').style.display='none';
    document.getElementById('ms-mfrs-list').innerHTML='';
    const hw=document.getElementById('ms-holiday-warn'); if(hw){ hw.style.display='none'; hw.textContent=''; }
    ['sb-f','sb-a','sb-p'].forEach(id=>document.getElementById(id).className='slt-btn');
    document.querySelectorAll('#ms-wd-btns .wd-btn').forEach(b=>b.classList.remove('on'));
    this._mfrs=[];
    this._activeEntryId='';
    this.onRepeatChange(); // resets sub-section visibility and button label
  },
  _fillClients(uid,selCid){
    // super_admin can book against any client; everyone else sees only their assigned clients
    const targetUser=Cache.users[uid]||App.user;
    const clients=targetUser.role==='super_admin'
      ?Cache.clientsArr().sort((a,b)=>a.name.localeCompare(b.name))
      :Cache.clientsFor(uid);
    const cs=document.getElementById('ms-client');
    cs.innerHTML='<option value="">Select client…</option>';
    clients.forEach(c=>cs.innerHTML+=`<option value="${c.id}" ${c.id===selCid?'selected':''}>${U.esc(c.name)}</option>`);
  },
  // When client changes we reset each mfr's factory (options depend on client)
  onClientChange(){
    // Clear factory selections (they depend on client) but keep qty/docs
    this._mfrs=this._mfrs.map(m=>({...m, factory:''}));
    this._renderMfrs();
  },

  // ── MANUFACTURERS UI ───────────────────────────────────────────
  _factoryOptsHtml(selFac){
    const cid=document.getElementById('ms-client').value;
    const c=Cache.clients[cid];
    let opts='<option value="">Select factory…</option>';
    if(!c) return opts;
    (c.factories||[]).forEach(f=>{ opts+=`<option value="${U.esc(f)}" ${f===selFac?'selected':''}>${U.esc(f)}</option>`; });
    if(selFac && !(c.factories||[]).includes(selFac)) opts+=`<option value="${U.esc(selFac)}" selected>${U.esc(selFac)}</option>`;
    return opts;
  },
  _renderMfrs(){
    const list=document.getElementById('ms-mfrs-list');
    const facOpts=(selFac)=>this._factoryOptsHtml(selFac||'');
    list.innerHTML=this._mfrs.map((m,i)=>{
      const delBtn=this._mfrs.length>1
        ? `<button type="button" class="mfr-row-del" data-midx="${i}" title="Remove this manufacturer">✕ Remove</button>`
        : '';
      return `<div class="mfr-row" data-midx="${i}">
        <div class="mfr-row-head">
          <span class="mfr-row-num">Manufacturer ${i+1}</span>
          ${delBtn}
        </div>
        <div class="fg">
          <label class="lbl">Factory</label>
          <select class="sel mfr-factory" data-midx="${i}">${facOpts(m.factory)}</select>
        </div>
        <div class="row2">
          <div class="fg"><label class="lbl">Expected Qty <span class="lbl-opt">(opt.)</span></label>
            <input type="number" class="inp inp-num mfr-eqty" data-midx="${i}" min="0" step="1" placeholder="—" value="${m.expectedQty!=null?m.expectedQty:''}"></div>
          <div class="fg"><label class="lbl">Final Qty <span class="lbl-opt">(opt.)</span></label>
            <input type="number" class="inp inp-num mfr-fqty" data-midx="${i}" min="0" step="1" placeholder="—" value="${m.finalQty!=null?m.finalQty:''}"></div>
        </div>
        <div class="mfr-docs-wrap">
          <label class="lbl">Documents</label>
          <div class="mfr-docs-list" data-midx="${i}">${this._mfrDocsHtml(m.documents||[])}</div>
          <button type="button" class="btn btn-s btn-sm mfr-doc-upload-btn" data-midx="${i}">⬆ Upload document</button>
          <div class="mfr-doc-status" data-midx="${i}"></div>
        </div>
      </div>`;
    }).join('');

    // Wire events
    list.querySelectorAll('.mfr-factory').forEach(sel=>{
      sel.addEventListener('change',()=>{ const i=+sel.dataset.midx; if(this._mfrs[i]) this._mfrs[i].factory=sel.value; });
    });
    list.querySelectorAll('.mfr-eqty').forEach(inp=>{
      inp.addEventListener('input',()=>{ const i=+inp.dataset.midx; if(this._mfrs[i]) this._mfrs[i].expectedQty=U.int(inp.value); });
    });
    list.querySelectorAll('.mfr-fqty').forEach(inp=>{
      inp.addEventListener('input',()=>{ const i=+inp.dataset.midx; if(this._mfrs[i]) this._mfrs[i].finalQty=U.int(inp.value); });
    });
    list.querySelectorAll('.mfr-row-del').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const i=+btn.dataset.midx;
        if(this._mfrs.length<=1) return;
        if(!confirm(`Remove Manufacturer ${i+1}? Any unsaved quantities or documents attached to this manufacturer will be lost.`)) return;
        this._mfrs.splice(i,1);
        this._renderMfrs();
      });
    });
    list.querySelectorAll('.mfr-doc-upload-btn').forEach(btn=>{
      btn.addEventListener('click',()=>this._uploadDocForMfr(+btn.dataset.midx));
    });
    // Per-document delete handlers (delegated)
    list.querySelectorAll('.mfr-doc-del').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const mi=+btn.dataset.midx, di=+btn.dataset.didx;
        if(this._mfrs[mi]?.documents?.[di]){
          if(!confirm('Remove this document link? (The file itself will remain in Google Drive.)')) return;
          this._mfrs[mi].documents.splice(di,1);
          this._renderMfrs();
        }
      });
    });
  },
  _mfrDocsHtml(docs){
    if(!docs||!docs.length) return '<div class="mfr-doc-status">No documents yet.</div>';
    const ICONS={'application/pdf':'📄','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'📊','application/vnd.ms-excel':'📊','text/csv':'📋','image':'🖼','video':'🎞'};
    return docs.map((d,di)=>{
      const ico=ICONS[d.mimeType]||( d.mimeType?.startsWith('image')? ICONS['image'] : d.mimeType?.startsWith('video')? ICONS['video'] : '📎' );
      // mfr index is added by caller
      return `<div class="mfr-doc-item"><span>${ico}</span><a href="${U.esc(d.webViewLink)}" target="_blank" rel="noopener">${U.esc(d.name)}</a><button type="button" class="mfr-doc-del" data-midx="__MI__" data-didx="${di}" title="Remove">✕</button></div>`;
    }).join('');
  },
  // Delegates to Drive.uploadFromInput for the given manufacturer index.
  // For Add-mode bookings (no entry id yet) we still allow upload — it saves
  // against a temporary uuid, and on save the entry is created with that id.
  _uploadDocForMfr(mIdx){
    // Ensure a stable entry id exists for Drive folder path (create one if in Add mode)
    let eid=document.getElementById('ms-id').value || this._activeEntryId;
    if(!eid){
      eid=U.uuid();
      this._activeEntryId=eid;
      document.getElementById('ms-id').value=eid;
      // Flag: this entry hasn't been persisted yet. We save it at _saveOne time.
      this._pendingCreate=true;
    }
    const inp=document.getElementById('ms-doc-input');
    inp.value='';
    const fresh=inp.cloneNode(true);
    inp.parentNode.replaceChild(fresh,inp);
    fresh.addEventListener('change',()=>Drive.uploadFromInput(fresh, eid, mIdx));
    fresh.click();
  },
  _renderMfrDocs(mIdx){
    const list=document.querySelector(`.mfr-docs-list[data-midx="${mIdx}"]`);
    if(!list) return;
    list.innerHTML=this._mfrDocsHtml(this._mfrs[mIdx]?.documents||[]).replace(/__MI__/g,String(mIdx));
    list.querySelectorAll('.mfr-doc-del').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const mi=+btn.dataset.midx, di=+btn.dataset.didx;
        if(!confirm('Remove this document link? (The file itself will remain in Google Drive.)')) return;
        this._mfrs[mi]?.documents?.splice(di,1);
        this._renderMfrs();
      });
    });
  },

  // ── HOLIDAY WARNING ───────────────────────────────────────────
  // Shown in modal when the selected date (or range) falls on a public holiday
  // for the target controller's country. Does NOT block saves (informational).
  async _checkHolidayWarn(){
    const hw=document.getElementById('ms-holiday-warn');
    if(!hw) return;
    const uid=document.getElementById('ms-for').value||App.user?.uid;
    const country=Cache.users[uid]?.country||'';
    if(!country){ hw.style.display='none'; return; }
    const date=document.getElementById('ms-date').value;
    if(!date){ hw.style.display='none'; return; }
    await Hol.prefetchRange(country,date,date);
    const h=Hol.get(country,date);
    if(h){
      hw.className='holiday-warn';
      hw.textContent=`⚠ ${U.fmt(date)} is a public holiday in ${country}: ${h.name}. You can still save this booking, but it will be skipped for recurring rules.`;
      hw.style.display='block';
    } else { hw.style.display='none'; }
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
  // Build the canonical manufacturers array + the mirrored top-level legacy fields
  // in one place, so every save path produces a consistent entry shape.
  _serializeManufacturers(){
    const mfrs=(this._mfrs||[])
      .map(m=>({
        factory: (m.factory||'').trim(),
        expectedQty: m.expectedQty!=null?m.expectedQty:null,
        finalQty: m.finalQty!=null?m.finalQty:null,
        documents: Array.isArray(m.documents)?m.documents:[]
      }))
      // Keep only rows that have at least a factory selected OR documents attached
      .filter(m=>m.factory||m.documents.length);
    return mfrs;
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

    // ── Slot / client / manufacturers ────────────────────────────────────
    if(!type){ err.textContent='Please select a time slot.'; err.style.display='block'; return; }
    if(!cid){ err.textContent='Please select a client.'; err.style.display='block'; return; }
    const manufacturers=this._serializeManufacturers();
    if(!manufacturers.length||!manufacturers.some(m=>m.factory)){
      err.textContent='Please select at least one factory/manufacturer.'; err.style.display='block'; return;
    }
    // Each selected manufacturer row must have a factory picked
    const missingFac=manufacturers.findIndex(m=>!m.factory);
    if(missingFac>=0){ err.textContent=`Manufacturer ${missingFac+1} is missing a factory. Pick one or remove the row.`; err.style.display='block'; return; }
    // Disallow the same factory being listed twice in one booking
    const facSet=new Set();
    for(const m of manufacturers){
      if(facSet.has(m.factory)){ err.textContent=`Manufacturer "${m.factory}" is listed twice — each factory can appear at most once per booking.`; err.style.display='block'; return; }
      facSet.add(m.factory);
    }

    const targetUid=document.getElementById('ms-for').value||App.user.uid;
    const targetUser=Cache.users[targetUid]||App.user;
    const c=Cache.clients[cid];

    // Legacy top-level mirror fields (kept for readers/CSV that haven't been migrated).
    // factory = first manufacturer (most representative), quantities = sums across mfrs.
    const firstFac=manufacturers[0]?.factory||'';
    const sumExp=manufacturers.reduce((s,m)=>s+(m.expectedQty!=null?m.expectedQty:0),0);
    const sumFin=manufacturers.reduce((s,m)=>s+(m.finalQty!=null?m.finalQty:0),0);
    const anyExp=manufacturers.some(m=>m.expectedQty!=null);
    const anyFin=manufacturers.some(m=>m.finalQty!=null);
    const legacyDocs=manufacturers[0]?.documents||[];

    const buildEntry=(eid,dateStr,baseCreated)=>({
      id:eid,userId:targetUid,userName:targetUser.name,userEmail:targetUser.email,userCountry:targetUser.country||'',
      date:dateStr,slot:type,clientId:cid,clientName:c?.name||'',
      // Canonical multi-manufacturer storage
      manufacturers,
      // Legacy mirrors (still read by older code paths)
      factory:firstFac,
      expectedQty:anyExp?sumExp:null,
      finalQty:anyFin?sumFin:null,
      documents:legacyDocs,
      notes,
      updated:Date.now(),created:baseCreated||Date.now()
    });

    // ── Single-entry path (edit or no-repeat add) ────────────────────────
    if(id||repeat==='none'){
      const eid=id||document.getElementById('ms-id').value||U.uuid();
      const conflict=Cache.entriesArr().find(e=>e.id!==eid&&e.userId===targetUid&&e.date===date&&e.slot===type);
      if(conflict){ err.textContent=`${targetUser.name} already has a "${type}" on this date.`; err.style.display='block'; return; }
      Spin.on();
      try{
        const base=id?{...Cache.entries[id]}:{};
        const entry=buildEntry(eid,date,base.created);
        await fbSet(`entries/${eid}`,entry); Cache.entries[eid]=entry;
        this._pendingCreate=false;
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
    // Warm holiday cache for the target country before expanding, so we can skip.
    if(targetUser.country){
      const y1=(date||from||'').slice(0,4)||String(new Date().getFullYear());
      const y2=(until||to||date||from||'').slice(0,4)||y1;
      await Hol.prefetchRange(targetUser.country, `${y1}-01-01`, `${y2}-12-31`);
    }

    const dates=this._expandDates();
    if(!dates.length){ err.textContent='No dates generated — check your recurrence settings.'; err.style.display='block'; return; }
    if(dates.length>365){ err.textContent=`Too many occurrences (${dates.length}). Shorten the period.`; err.style.display='block'; return; }

    // Partition into skip (conflict / holiday) vs create.
    // Feature 6: national holidays for the target controller's country are skipped.
    const toCreate=[], skippedConflict=[], skippedHoliday=[];
    for(const d of dates){
      if(targetUser.country && Hol.is(targetUser.country,d)){ skippedHoliday.push(d); continue; }
      if(Cache.entriesArr().find(e=>e.userId===targetUid&&e.date===d&&e.slot===type)) skippedConflict.push(d);
      else toCreate.push(d);
    }
    if(!toCreate.length){
      const reason=skippedHoliday.length&&!skippedConflict.length
        ?`All ${dates.length} date${dates.length>1?'s':''} fall on public holidays in ${targetUser.country} — nothing to create.`
        :`All ${dates.length} date${dates.length>1?'s':''} already have a "${type}" booking.`;
      err.textContent=reason; err.style.display='block'; return;
    }

    Spin.on();
    try{
      for(const d of toCreate){
        const eid=U.uuid();
        const entry=buildEntry(eid,d);
        await fbSet(`entries/${eid}`,entry); Cache.entries[eid]=entry;
      }
      M.close('m-slot');
      if(this._isAdmin()){ Adm.refresh(); }
      else if(App.user?.role==='team_manager'){ Mgr.refresh(); }
      else { Cal.render(); }
      let msg=`${toCreate.length} booking${toCreate.length>1?'s':''} created.`;
      if(skippedConflict.length) msg+=` ${skippedConflict.length} skipped (conflict).`;
      if(skippedHoliday.length)  msg+=` ${skippedHoliday.length} skipped (public holiday).`;
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
    ['tl','wk','ls','rp','an'].forEach(id=>{
      const vEl=document.getElementById('vw-'+id);
      if(vEl) vEl.style.display=v===id?'block':'none';
      const tEl=document.getElementById('nt-'+id);
      if(tEl) tEl.className='ntab'+(v===id?' on':'');
    });
    const isRp=v==='rp';
    const isAn=v==='an';
    document.getElementById('adm-fbar').style.display    = (isRp||isAn)?'none':'';
    document.getElementById('adm-stats').style.display   = (isRp||isAn)?'none':'';
    document.getElementById('country-bar').style.display = (isRp||isAn)?'none':'';
    document.getElementById('adm-nav').style.display     = (isRp||isAn)?'none':'';
    if(isRp){ Rpt.render(); }
    else if(isAn){ Anl.init(); }
    else { this._render(); }
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
      // Add has-docs marker if this entry has documents (Feature 1 — paperclip indicator)
      if(entryHasDocs(st.e)) cls+=' has-docs';
      const facLbl=entryFactoryLabel(st.e);
      const te=entryTotalExpected(st.e), tf=entryTotalFinal(st.e);
      const dc=entryDocCount(st.e);
      tip=`${U.esc(st.e.slot)} – ${U.esc(st.e.clientName||'')}${facLbl?' @ '+U.esc(facLbl):''}${te!=null?' | Exp: '+te:''}${tf!=null?' | Final: '+tf:''}${dc?' | 📎 '+dc+' doc'+(dc>1?'s':''):''}`;
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

    // Filtered users (by country) — includes super_admin as a bookable person
    const allUsers=Cache.usersArr().filter(u=>isBookable(u)&&(!this.country||u.country===this.country));
    allUsers.sort((a,b)=>(a.country||'').localeCompare(b.country||'')||a.name.localeCompare(b.name));

    // Feature 5 — prefetch holidays for every distinct country represented in this view.
    // Re-render once the network fetch lands so newly-loaded holidays appear as tags.
    const ctryList=[...new Set(allUsers.map(u=>u.country).filter(Boolean))];
    const missing=ctryList.filter(c=>!Hol.cache[Hol._code(c)]?.[y]);
    if(missing.length){
      Promise.all(missing.map(c=>Hol.forYear(c,y))).then(()=>this._render());
    }

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
        // Feature 5 — holiday overlay for this user's country on this date
        const hol=u.country?Hol.get(u.country,ds):null;
        const tdCls=(isT?'tc-td':isW?'wknd-col':'')+(hol?' tl-hol-day':'');
        const holAttr=hol?` title="🏖 ${U.esc(hol.name)}" data-hol="1"`:'';
        body+=`<td class="${tdCls}"${holAttr}><div class="tl-cell">${amH}${pmH}</div></td>`;
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
    // Feature 5 — prefetch holidays for years touched by this week, for all countries in view
    {
      const yrs=[...new Set(days.map(d=>d.getFullYear()))];
      const viewUsers=Cache.usersArr().filter(u=>isBookable(u)&&(!this.country||u.country===this.country));
      const ctries=[...new Set(viewUsers.map(u=>u.country).filter(Boolean))];
      const missing=[]; ctries.forEach(c=>yrs.forEach(yr=>{ if(!Hol.cache[Hol._code(c)]?.[yr]) missing.push([c,yr]); }));
      if(missing.length) Promise.all(missing.map(([c,yr])=>Hol.forYear(c,yr))).then(()=>this._render());
    }
    const startLabel=days[0].toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    const endLabel=days[6].toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    document.getElementById('adm-lbl').textContent=`${startLabel} – ${endLabel}`;
    // All bookable users (controllers + super_admin), filtered by country if set
    const allUsers=Cache.usersArr().filter(u=>isBookable(u)&&(!this.country||u.country===this.country));
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
        const hol=u.country?Hol.get(u.country,ds):null;
        const tdCls=(isT?'tc-td':isW?'wknd-col':'')+(hol?' tl-hol-day':'');
        const holAttr=hol?` title="🏖 ${U.esc(hol.name)}" data-hol="1"`:'';
        html+=`<td class="${tdCls}"${holAttr}><div class="tl-cell">${amH}${pmH}</div></td>`;
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
    let html='<div class="ov-x-auto"><table class="ltab"><thead><tr><th>Date</th><th>Controller</th><th>Country</th><th>Slot</th><th>Client</th><th>Factory</th><th>Exp. Qty</th><th>Final Qty</th><th>Docs</th><th>Notes</th></tr></thead><tbody>';
    sorted.forEach(e=>{
      const facLbl=entryFactoryLabel(e);
      const te=entryTotalExpected(e), tf=entryTotalFinal(e);
      const dc=entryDocCount(e);
      const docsCell=dc>0?`<span class="cl-docs-badge" title="${dc} document${dc>1?'s':''} attached">📎 ${dc}</span>`:'<span class="tbl-qty-dash">—</span>';
      html+=`<tr data-eid="${e.id}" title="Click to edit"><td><strong>${U.fmt(e.date)}</strong></td><td>${U.flag(e.userCountry)} ${U.esc(e.userName)}</td><td>${U.esc(e.userCountry)}</td><td><span class="badge ${U.badgeCls(e.slot)}">${U.esc(e.slot)}</span></td><td>${U.esc(e.clientName)}</td><td>${U.esc(facLbl)}</td><td class="tbl-right">${te!=null?te:'<span class="tbl-qty-dash">—</span>'}</td><td class="tbl-right">${tf!=null?tf:'<span class="tbl-qty-dash">—</span>'}</td><td class="tbl-right">${docsCell}</td><td class="tbl-notes">${U.esc(e.notes)}</td></tr>`;
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
    const users=Cache.usersArr().filter(u=>isBookable(u)).sort((a,b)=>a.name.localeCompare(b.name));
    sel.innerHTML='<option value="">Select person…</option>'+users.map(u=>`<option value="${U.esc(u.uid)}">${U.esc(u.name)}${u.role==='super_admin'?' ★':''}</option>`).join('');
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
  // Re-authenticate with Google to obtain a fresh Drive OAuth token.
  // Must be called directly from a user gesture (button/label click) so the
  // browser does not block the popup.
  async authorize(){
    const provider=new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    const result=await fauth.currentUser.reauthenticateWithPopup(provider);
    App._driveToken=result.credential?.accessToken||null;
    if(!App._driveToken) throw new Error('Could not obtain Drive access token — please try again.');
    return App._driveToken;
  },

  // Return the cached Drive token.  The token is guaranteed to exist here
  // because the upload label click handler calls authorize() first when needed.
  async _token(){
    if(App._driveToken) return App._driveToken;
    throw new Error('Google Drive not connected. Please click "Upload document" again to reconnect.');
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
  // Uploads a single file to Drive and attaches the metadata to the specified
  // manufacturer (mIdx) of the booking. The entry may not yet be persisted to
  // Firebase (Add mode) — in that case we only update the in-memory Slot._mfrs
  // buffer and let Slot.save() persist everything on submit.
  async uploadFromInput(input, entryId, mIdx){
    const file=input.files?.[0]; if(!file) return;
    const statusEl=document.querySelector(`.mfr-doc-status[data-midx="${mIdx}"]`);
    const btn=document.querySelector(`.mfr-doc-upload-btn[data-midx="${mIdx}"]`);
    const setStatus=(t,isErr)=>{ if(!statusEl) return; statusEl.textContent=t; statusEl.className='mfr-doc-status'+(isErr?' err':''); };
    setStatus('Uploading…', false);
    if(btn){ btn.style.pointerEvents='none'; btn.style.opacity='.55'; }
    try{
      // Resolve the owning user/clientName/factory/date — prefer in-memory Slot state
      // because the entry may not exist in Cache yet (Add mode with eager upload).
      const targetUid=document.getElementById('ms-for').value||App.user.uid;
      const user=Cache.users[targetUid]||App.user;
      const cid=document.getElementById('ms-client').value;
      const clientName=Cache.clients[cid]?.name||'Unknown';
      const dateStr=document.getElementById('ms-date').value || document.getElementById('ms-from').value || U.today();
      const factory=Slot._mfrs[mIdx]?.factory||'Unknown';

      const token=await this._token();
      // Get-or-create controller root folder
      let rootId=user.driveRootFolderId;
      if(!rootId){
        rootId=await this._folder(user.name,null,token);
        await this._share(rootId,token);
        const upd={...user,driveRootFolderId:rootId};
        await fbUpdate(`users/${user.uid}`,{driveRootFolderId:rootId});
        Cache.users[user.uid]=upd;
      }
      // Folder chain: client → factory → date
      const clientFolderId =await this._folder(clientName,rootId,token);
      const factoryFolderId=await this._folder(factory,clientFolderId,token);
      const dateFolderId   =await this._folder(dateStr,factoryFolderId,token);
      // Upload file
      const result=await this._upload(file,dateFolderId,token);
      // Attach metadata to the correct manufacturer in the editor buffer
      const doc={id:U.uuid(),name:file.name,mimeType:file.type||'',driveId:result.id,webViewLink:result.webViewLink,uploadedAt:Date.now()};
      if(!Slot._mfrs[mIdx]) return;
      Slot._mfrs[mIdx].documents=[...(Slot._mfrs[mIdx].documents||[]),doc];

      // If the entry is already persisted (edit mode), also push the update to
      // Firebase so the document survives a browser close before the user hits
      // "Save". In Add mode we rely on Slot.save() to persist everything atomically.
      if(entryId && Cache.entries[entryId]){
        const existing=Cache.entries[entryId];
        const updatedMfrs=Slot._mfrs.map(m=>({factory:m.factory||'',expectedQty:m.expectedQty!=null?m.expectedQty:null,finalQty:m.finalQty!=null?m.finalQty:null,documents:[...(m.documents||[])]}));
        await fbUpdate(`entries/${entryId}`,{manufacturers:updatedMfrs,documents:updatedMfrs[0]?.documents||[]});
        Cache.entries[entryId]={...existing, manufacturers:updatedMfrs, documents:updatedMfrs[0]?.documents||[]};
      }

      Slot._renderMfrs();
      setStatus('Uploaded successfully.', false);
    } catch(e){
      log.error('Drive upload error',e);
      setStatus('Upload failed: '+e.message, true);
    } finally{
      if(btn){ btn.style.pointerEvents=''; btn.style.opacity=''; }
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
      .filter(u=>isBookable(u))
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
        const facLbl=entryFactoryLabel(e);
        const dc=entryDocCount(e);
        const clip=dc>0?` <span class="has-docs-icon" title="${dc} document${dc>1?'s':''} attached">📎${dc>1?' '+dc:''}</span>`:'';
        html+=`<div class="mgr-entry-row">
          <div class="mgr-entry-date">${U.fmt(e.date)}</div>
          <div class="mgr-entry-slot"><span class="chip c-${U.esc(cls)}">${U.esc(e.slot)}</span></div>
          <div class="mgr-entry-detail">${U.esc(e.clientName||'')}${facLbl?' &mdash; '+U.esc(facLbl):''}${clip}</div>
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
// ANALYTICS  (FE-01 → FE-20)
// All data computed live from Cache (Firebase RTDB).
// Charts rendered via Chart.js 4.x (loaded from CDN, allowed by CSP).
// ════════════════════════════════════
const Anl = {
  _tab: 'overview',
  _filter: { dateFrom:'', dateTo:'', country:'', client:'', factory:'', controller:'' },
  _charts: {},   // Chart.js instances keyed by canvas id
  _sort:   {},   // { tableId: { col, dir } }
  _page:   {},   // { tableId: pageIndex }
  PAGE: 15,

  // ── Init ─────────────────────────────────────────────────────
  init(){
    this._readUrl();
    this._fillFilterOpts();
    this._setDefaultDates();
    this._syncFilterUI();
    // Restore sub-tab active state
    document.querySelectorAll('.an-tab').forEach(b=>b.classList.toggle('on', b.dataset.anltab===this._tab));
    ['overview','visibility','capacity','clients','forecast'].forEach(t=>{
      const p=document.getElementById('an-panel-'+t);
      if(p) p.style.display=t===this._tab?'':'none';
    });
    this._render();
  },

  _setDefaultDates(){
    if(!this._filter.dateFrom){
      const d=new Date(); d.setFullYear(d.getFullYear()-1);
      this._filter.dateFrom=localDateStr(d);
    }
    if(!this._filter.dateTo){
      const d=new Date(); d.setDate(d.getDate()+365);
      this._filter.dateTo=localDateStr(d);
    }
  },

  // Populate filter dropdowns from live cache data
  _fillFilterOpts(){
    const entries=Cache.entriesArr();
    const users=Cache.usersArr().filter(isBookable);
    const fill=(id, items)=>{
      const s=document.getElementById(id); if(!s) return;
      const cur=s.value;
      s.innerHTML='<option value="">All</option>'+
        items.map(x=>`<option${cur===x?' selected':''}>${U.esc(x)}</option>`).join('');
    };
    fill('an-country', U.uniq(users.map(u=>u.country).filter(Boolean)));
    fill('an-client',  U.uniq(entries.map(e=>e.clientName).filter(Boolean)));
    fill('an-factory', U.uniq(entries.map(e=>e.factory).filter(Boolean)));
    fill('an-ctrl',    U.uniq(users.map(u=>u.name)));
  },

  _syncFilterUI(){
    const f=this._filter;
    const v=(id,val)=>{ const e=document.getElementById(id); if(e) e.value=val||''; };
    v('an-from',f.dateFrom); v('an-to',f.dateTo);
    v('an-country',f.country); v('an-client',f.client);
    v('an-factory',f.factory); v('an-ctrl',f.controller);
  },

  applyFilter(){
    this._filter.dateFrom   = document.getElementById('an-from')?.value||'';
    this._filter.dateTo     = document.getElementById('an-to')?.value||'';
    this._filter.country    = document.getElementById('an-country')?.value||'';
    this._filter.client     = document.getElementById('an-client')?.value||'';
    this._filter.factory    = document.getElementById('an-factory')?.value||'';
    this._filter.controller = document.getElementById('an-ctrl')?.value||'';
    this._page={};
    this._render();
    this._pushUrl();
  },

  clearFilter(){
    this._filter={ dateFrom:'', dateTo:'', country:'', client:'', factory:'', controller:'' };
    this._setDefaultDates();
    this._syncFilterUI();
    this._page={};
    this._render();
    this._pushUrl();
  },

  // ── Tab routing ───────────────────────────────────────────────
  setTab(tab){
    this._tab=tab;
    document.querySelectorAll('.an-tab').forEach(b=>b.classList.toggle('on', b.dataset.anltab===tab));
    ['overview','visibility','capacity','clients','forecast'].forEach(t=>{
      const p=document.getElementById('an-panel-'+t);
      if(p) p.style.display=t===tab?'':'none';
    });
    this._render();
    this._pushUrl();
  },

  _render(){
    this._destroyAllCharts();
    const t=this._tab;
    if(t==='overview')   this._renderOverview();
    if(t==='visibility') this._renderVisibility();
    if(t==='capacity')   this._renderCapacity();
    if(t==='clients')    this._renderClients();
    if(t==='forecast')   this._renderForecast();
  },

  // ── URL state  (FE-18) ────────────────────────────────────────
  _readUrl(){
    try{
      const p=new URLSearchParams(window.location.hash.replace(/^#/,''));
      const t=p.get('an-tab');
      if(['overview','visibility','capacity','clients','forecast'].includes(t)) this._tab=t;
      if(p.get('an-from'))    this._filter.dateFrom   =p.get('an-from');
      if(p.get('an-to'))      this._filter.dateTo     =p.get('an-to');
      if(p.get('an-country')) this._filter.country    =p.get('an-country');
      if(p.get('an-client'))  this._filter.client     =p.get('an-client');
      if(p.get('an-factory')) this._filter.factory    =p.get('an-factory');
      if(p.get('an-ctrl'))    this._filter.controller =p.get('an-ctrl');
    }catch{}
  },

  _pushUrl(){
    const f=this._filter; const p=new URLSearchParams();
    p.set('an-tab',this._tab);
    if(f.dateFrom)   p.set('an-from',f.dateFrom);
    if(f.dateTo)     p.set('an-to',f.dateTo);
    if(f.country)    p.set('an-country',f.country);
    if(f.client)     p.set('an-client',f.client);
    if(f.factory)    p.set('an-factory',f.factory);
    if(f.controller) p.set('an-ctrl',f.controller);
    history.replaceState(null,'','#'+p.toString());
  },

  // ── Chart.js helpers ──────────────────────────────────────────
  _chart(id, type, data, extraOpts={}){
    this._destroyChart(id);
    const el=document.getElementById(id); if(!el) return null;
    const c=new Chart(el, { type, data, options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ boxWidth:12, font:{size:11} } }, tooltip:{ bodyFont:{size:11} } },
      ...extraOpts
    }});
    this._charts[id]=c; return c;
  },
  _destroyChart(id){ if(this._charts[id]){ this._charts[id].destroy(); delete this._charts[id]; } },
  _destroyAllCharts(){ Object.keys(this._charts).forEach(id=>this._destroyChart(id)); },

  // ── Data helpers ──────────────────────────────────────────────
  _hd(slot){ return slot==='Full Day'?2:1; },

  _leadTime(entry){
    if(!entry.created) return null;
    const ms=parseLocalDate(entry.date)-new Date(entry.created);
    return Math.max(0, Math.round(ms/86400000));
  },

  // Entries filtered by the global analytics filter
  _getEntries(){
    const f=this._filter;
    return Cache.entriesArr().filter(e=>{
      if(!e.date) return false;
      if(f.dateFrom    && e.date         < f.dateFrom) return false;
      if(f.dateTo      && e.date         > f.dateTo)   return false;
      if(f.country     && e.userCountry !== f.country)    return false;
      if(f.client      && e.clientName  !== f.client)     return false;
      if(f.factory     && e.factory     !== f.factory)    return false;
      if(f.controller  && e.userName    !== f.controller) return false;
      return true;
    });
  },

  // Passes non-date filters (used when we scope dates ourselves)
  _passesFilter(e){
    const f=this._filter;
    if(f.country    && e.userCountry !== f.country)    return false;
    if(f.client     && e.clientName  !== f.client)     return false;
    if(f.factory    && e.factory     !== f.factory)    return false;
    if(f.controller && e.userName    !== f.controller) return false;
    return true;
  },

  _sumHD(entries){ return entries.reduce((s,e)=>s+this._hd(e.slot),0); },

  // Count available half-days from availability rules over a date range.
  // optionally restricted to a set of userIds.
  _availHD(userIds, dateFrom, dateTo){
    if(!dateFrom||!dateTo) return 0;
    let count=0;
    const from=parseLocalDate(dateFrom), to=parseLocalDate(dateTo);
    const months=[];
    let d=new Date(from.getFullYear(),from.getMonth(),1);
    while(d<=to){ months.push({y:d.getFullYear(),m:d.getMonth()}); d=new Date(d.getFullYear(),d.getMonth()+1,1); }
    Cache.availArr()
      .filter(r=>r.type==='available'&&(!userIds||userIds.includes(r.userId)))
      .forEach(rule=>{
        months.forEach(({y,m})=>{
          U.expandAvail(rule,y,m).forEach(date=>{
            if(date>=dateFrom&&date<=dateTo) count+=this._hd(rule.slot);
          });
        });
      });
    return count;
  },

  _fillRate(booked, avail){ return avail?Math.min(100,Math.round(booked/avail*1000)/10):null; },

  _ltBuckets: ['0–3d','4–7d','8–14d','15–30d','31–60d','61–90d','91d+'],
  _ltBucket(days){
    if(days===null) return null;
    if(days<=3)  return '0–3d';
    if(days<=7)  return '4–7d';
    if(days<=14) return '8–14d';
    if(days<=30) return '15–30d';
    if(days<=60) return '31–60d';
    if(days<=90) return '61–90d';
    return '91d+';
  },

  // Helpers for future date windows (relative to today)
  _futureEnd(days){ return localDateStr(new Date(Date.now()+days*86400000)); },

  // ── Formatting  (FE-20) ───────────────────────────────────────
  _fmtFR(fr){ return fr===null?'—':fr.toFixed(1)+'%'; },
  _fmtDays(d){ return d===null||d===undefined?'—':Math.round(d)+' days'; },
  _fmtDate(s){ return s?U.fmt(s):'—'; },

  _statusFromFR(fr){
    if(fr===null) return {cls:'an-status-na',label:'—'};
    if(fr>=80)    return {cls:'an-status-crit',label:'High ▲'};
    if(fr>=40)    return {cls:'an-status-good',label:'Good'};
    return         {cls:'an-status-warn',label:'Low ▼'};
  },

  _deltaObj(cur, prev){
    if(cur===null||prev===null) return {val:null,cls:'kpi-neutral',arrow:'—'};
    const d=cur-prev;
    if(d>0.5)  return {val:d,cls:'kpi-up',arrow:'▲'};
    if(d<-0.5) return {val:d,cls:'kpi-dn',arrow:'▼'};
    return {val:d,cls:'kpi-neutral',arrow:'→'};
  },

  // ── KPI card  (FE-03) ─────────────────────────────────────────
  _kpi({title, value, delta, cls, tooltip}){
    const tip=tooltip?` data-tip="${U.esc(tooltip)}"`:''  ;
    const tipIco=tooltip?`<span class="an-tip-icon"${tip}>?</span>`:''  ;
    let deltaHtml='<div class="kpi-delta kpi-neutral">—</div>';
    if(delta&&delta.val!==null){
      const abs=Math.abs(delta.val);
      const str=Number.isInteger(delta.val)?abs:abs.toFixed(1);
      deltaHtml=`<div class="kpi-delta ${delta.cls}">${delta.arrow} ${str} vs prev</div>`;
    }
    return `<div class="kpi-card">
      <div class="kpi-title">${U.esc(title)}${tipIco}</div>
      <div class="kpi-value">${value??'—'}</div>
      ${deltaHtml}</div>`;
  },

  // ── Empty / error  (FE-16) ────────────────────────────────────
  _emptyHtml(msg='No data for this period.'){
    return `<div class="an-empty"><div class="an-empty-ic">📭</div><div class="an-empty-t">${U.esc(msg)}</div></div>`;
  },
  _emptyChart(canvasId, msg){
    const wrap=document.getElementById(canvasId)?.closest('.an-chart-wrap');
    if(wrap) wrap.innerHTML=this._emptyHtml(msg||'No data for this period.');
  },

  // ── Table helpers: sort + pagination  (FE-07, FE-09) ─────────
  _sortedPaged(tableId, rows, defaultCol=0){
    if(!this._sort[tableId]) this._sort[tableId]={col:defaultCol,dir:'desc'};
    if(!this._page[tableId]) this._page[tableId]=0;
    const {col,dir}=this._sort[tableId];
    const sorted=[...rows].sort((a,b)=>{
      const av=a[col]??-Infinity, bv=b[col]??-Infinity;
      if(typeof av==='string') return dir==='asc'?av.localeCompare(bv):bv.localeCompare(av);
      return dir==='asc'?av-bv:bv-av;
    });
    const pg=this._page[tableId];
    const total=sorted.length;
    const pages=Math.max(1,Math.ceil(total/this.PAGE));
    const slice=sorted.slice(pg*this.PAGE,(pg+1)*this.PAGE);
    return {slice,total,page:pg,pages};
  },

  _pagHtml(tableId, page, pages, total){
    return `<div class="an-pagination">
      <button class="an-page-btn" data-anpg="${tableId}:prev"${page===0?' disabled':''}>← Prev</button>
      <span class="an-page-info">Page ${page+1} / ${pages} &nbsp;(${total} rows)</span>
      <button class="an-page-btn" data-anpg="${tableId}:next"${page>=pages-1?' disabled':''}>Next →</button>
    </div>`;
  },

  _th(tableId, label, colIdx, sortState){
    const cls=sortState.col===colIdx?(sortState.dir==='asc'?'sort-asc':'sort-desc'):'';
    return `<th class="${cls}" data-ansort="${tableId}:${colIdx}">${U.esc(label)}</th>`;
  },

  handleSort(tableId, col){
    if(!this._sort[tableId]) this._sort[tableId]={col,dir:'desc'};
    else if(this._sort[tableId].col===col) this._sort[tableId].dir=this._sort[tableId].dir==='asc'?'desc':'asc';
    else this._sort[tableId]={col,dir:'desc'};
    this._page[tableId]=0;
    this._render();
  },

  handlePage(tableId, dir){
    if(!this._page[tableId]) this._page[tableId]=0;
    if(dir==='prev') this._page[tableId]=Math.max(0,this._page[tableId]-1);
    if(dir==='next') this._page[tableId]++;
    this._render();
  },

  // ── OVERVIEW TAB  (FE-04) ─────────────────────────────────────
  _renderOverview(){
    const entries=this._getEntries();
    const today=U.today();
    const curY=new Date().getFullYear(), curM=new Date().getMonth();
    const curMK=`${curY}-${S2(curM+1)}`;
    const prevD=new Date(curY,curM-1,1);
    const prevMK=`${prevD.getFullYear()}-${S2(prevD.getMonth()+1)}`;

    // Booked next 30 / 90 days
    const b30=this._sumHD(entries.filter(e=>e.date>=today&&e.date<=this._futureEnd(30)));
    const b90=this._sumHD(entries.filter(e=>e.date>=today&&e.date<=this._futureEnd(90)));

    // Avg booking lead time
    const lts=entries.map(e=>this._leadTime(e)).filter(v=>v!==null);
    const avgLT=lts.length?Math.round(lts.reduce((s,v)=>s+v,0)/lts.length):null;

    // Avg client visibility horizon
    const clients=U.uniq(entries.map(e=>e.clientName).filter(Boolean));
    const horizons=clients.map(c=>{
      const fut=entries.filter(e=>e.clientName===c&&e.date>=today).map(e=>e.date);
      if(!fut.length) return null;
      const last=fut.reduce((a,b)=>a>b?a:b);
      return Math.round((parseLocalDate(last)-parseLocalDate(today))/86400000);
    }).filter(h=>h!==null&&h>0);
    const avgViz=horizons.length?Math.round(horizons.reduce((s,v)=>s+v,0)/horizons.length):null;

    // Global fill rate current vs prev month
    const allE=Cache.entriesArr();
    const bookCur=this._sumHD(allE.filter(e=>e.date?.startsWith(curMK)&&this._passesFilter(e)));
    const bookPrev=this._sumHD(allE.filter(e=>e.date?.startsWith(prevMK)&&this._passesFilter(e)));
    const curTo=new Date(curY,curM+1,0).toISOString().slice(0,10);
    const prevTo=new Date(prevD.getFullYear(),prevD.getMonth()+1,0).toISOString().slice(0,10);
    const availCur =this._availHD(null,curMK+'-01',curTo);
    const availPrev=this._availHD(null,prevMK+'-01',prevTo);
    const frCur =this._fillRate(bookCur,availCur);
    const frPrev=this._fillRate(bookPrev,availPrev);
    const frDelta=this._deltaObj(frCur,frPrev);

    document.getElementById('an-ov-kpis').innerHTML=[
      this._kpi({title:'Booked next 30d', value:b30+' HD', tooltip:'Total half-days booked in the next 30 days.'}),
      this._kpi({title:'Booked next 90d', value:b90+' HD', tooltip:'Total half-days booked in the next 90 days.'}),
      this._kpi({title:'Avg booking lead time', value:this._fmtDays(avgLT), tooltip:'Average days between booking creation date and service date.'}),
      this._kpi({title:'Avg client visibility', value:this._fmtDays(avgViz), tooltip:'Average days to each client\'s last future service date.'}),
      this._kpi({title:'Fill rate — this month', value:this._fmtFR(frCur), delta:frDelta, cls:frDelta.cls, tooltip:'Percentage of available half-days booked this calendar month.'}),
      this._kpi({title:'Fill rate — prev month', value:this._fmtFR(frPrev), tooltip:'Fill rate for the previous calendar month.'}),
    ].join('');

    this._renderMonthTrend('an-ov-vis-chart', entries);
    this._renderLTDist('an-ov-lt-chart', entries);
    this._renderCountryFRChart('an-ov-fr-chart');
    this._renderClientVisTable('an-ov-cli-body', {limit:5});
    this._renderCtrlFillTable('an-ov-ctrl-body', {limit:5});
  },

  // ── VISIBILITY TAB  (FE-11) ───────────────────────────────────
  _renderVisibility(){
    const entries=this._getEntries();
    const today=U.today();
    const lts=entries.map(e=>this._leadTime(e)).filter(v=>v!==null);
    const avgLT=lts.length?Math.round(lts.reduce((s,v)=>s+v,0)/lts.length):null;
    const b30 =this._sumHD(entries.filter(e=>e.date>=today&&e.date<=this._futureEnd(30)));
    const b60 =this._sumHD(entries.filter(e=>e.date>=today&&e.date<=this._futureEnd(60)));
    const b90 =this._sumHD(entries.filter(e=>e.date>=today&&e.date<=this._futureEnd(90)));
    const b180=this._sumHD(entries.filter(e=>e.date>=today&&e.date<=this._futureEnd(180)));

    document.getElementById('an-vis-kpis').innerHTML=[
      this._kpi({title:'Avg booking lead time', value:this._fmtDays(avgLT), tooltip:'Average days between booking creation date and service date.'}),
      this._kpi({title:'Booked next 30d', value:b30+' HD', tooltip:'Half-days booked in the next 30 calendar days.'}),
      this._kpi({title:'Booked next 60d', value:b60+' HD', tooltip:'Half-days booked in the next 60 calendar days.'}),
      this._kpi({title:'Booked next 90d', value:b90+' HD', tooltip:'Half-days booked in the next 90 calendar days.'}),
      this._kpi({title:'Booked next 180d', value:b180+' HD', tooltip:'Half-days booked in the next 180 calendar days.'}),
    ].join('');

    this._renderLTDist('an-vis-lt-chart', entries);
    this._renderMonthTrend('an-vis-trend-chart', entries);
    this._renderFutureCapChart('an-vis-cap-chart');
    this._renderClientVisTable('an-vis-cli-body');
  },

  // ── CAPACITY TAB  (FE-08) ─────────────────────────────────────
  _renderCapacity(){
    const today=U.today();
    const curY=new Date().getFullYear(), curM=new Date().getMonth();
    const curMK=`${curY}-${S2(curM+1)}`;
    const prevD=new Date(curY,curM-1,1);
    const prevMK=`${prevD.getFullYear()}-${S2(prevD.getMonth()+1)}`;
    const allE=Cache.entriesArr();

    const bookCur =this._sumHD(allE.filter(e=>e.date?.startsWith(curMK)&&this._passesFilter(e)));
    const bookPrev=this._sumHD(allE.filter(e=>e.date?.startsWith(prevMK)&&this._passesFilter(e)));
    const curTo =new Date(curY,curM+1,0).toISOString().slice(0,10);
    const prevTo=new Date(prevD.getFullYear(),prevD.getMonth()+1,0).toISOString().slice(0,10);
    const availCur =this._availHD(null,curMK+'-01',curTo);
    const availPrev=this._availHD(null,prevMK+'-01',prevTo);
    const frCur =this._fillRate(bookCur,availCur);
    const frPrev=this._fillRate(bookPrev,availPrev);
    const frDelta=this._deltaObj(frCur,frPrev);

    const bookP30=this._sumHD(allE.filter(e=>e.date>=today&&e.date<=this._futureEnd(30)&&this._passesFilter(e)));
    const availP30=this._availHD(null,today,this._futureEnd(30));
    const frP30=this._fillRate(bookP30,availP30);

    document.getElementById('an-cap-kpis').innerHTML=[
      this._kpi({title:'Fill rate — this month', value:this._fmtFR(frCur), delta:frDelta, tooltip:'Percentage of available half-days booked this calendar month.'}),
      this._kpi({title:'Fill rate — prev month', value:this._fmtFR(frPrev), tooltip:'Fill rate for the previous calendar month.'}),
      this._kpi({title:'Projected fill — next 30d', value:this._fmtFR(frP30), tooltip:'Projected fill rate = booked ÷ available for the next 30 days.'}),
    ].join('');

    this._renderCountryFRChart('an-cap-fr-chart');
    this._renderFRTrendChart('an-cap-trend-chart');
    this._renderCtrlFillTable('an-cap-ctrl-body');
  },

  // ── CLIENTS TAB  (FE-13) ──────────────────────────────────────
  _renderClients(){
    const entries=this._getEntries();
    const today=U.today();

    // Segment clients by avg lead time
    const clientLT={};
    entries.forEach(e=>{ const lt=this._leadTime(e); if(lt===null) return; (clientLT[e.clientName]=clientLT[e.clientName]||[]).push(lt); });
    let strategic=0, standard=0, reactive=0;
    Object.values(clientLT).forEach(arr=>{
      const avg=arr.reduce((s,v)=>s+v,0)/arr.length;
      if(avg>=60) strategic++; else if(avg>=15) standard++; else reactive++;
    });
    const activeCount=Object.keys(clientLT).length;
    const noFutureCount=U.uniq(Cache.entriesArr().filter(e=>this._passesFilter(e)).map(e=>e.clientName).filter(Boolean))
      .filter(c=>!Cache.entriesArr().some(e=>e.clientName===c&&e.date>=today)).length;

    document.getElementById('an-cli-kpis').innerHTML=[
      this._kpi({title:'Active clients (period)', value:activeCount, tooltip:'Clients with at least one booking in the selected date range.'}),
      this._kpi({title:'Strategic (≥60d)', value:strategic, tooltip:'Clients whose average booking lead time is 60 or more days.'}),
      this._kpi({title:'Standard (15–60d)', value:standard, tooltip:'Clients whose average booking lead time is 15–60 days.'}),
      this._kpi({title:'Reactive (<15d)', value:reactive, tooltip:'Clients whose average booking lead time is under 15 days.'}),
      this._kpi({title:'No future bookings', value:noFutureCount, tooltip:'Active clients with no bookings scheduled after today.'}),
    ].join('');

    this._renderSegChart('an-cli-seg-chart', strategic, standard, reactive);
    this._renderClientLTChart('an-cli-lt-chart', entries);
    this._renderFutureByClientChart('an-cli-cap-chart');
    this._renderClientVisTable('an-cli-tbl-body');
  },

  // ── FORECAST TAB  (FE-14) ─────────────────────────────────────
  _renderForecast(){
    const today=U.today();
    const allE=Cache.entriesArr();
    const bookP30=this._sumHD(allE.filter(e=>e.date>=today&&e.date<=this._futureEnd(30)&&this._passesFilter(e)));
    const bookP60=this._sumHD(allE.filter(e=>e.date>=today&&e.date<=this._futureEnd(60)&&this._passesFilter(e)));
    const bookP90=this._sumHD(allE.filter(e=>e.date>=today&&e.date<=this._futureEnd(90)&&this._passesFilter(e)));
    const availP30=this._availHD(null,today,this._futureEnd(30));
    const availP60=this._availHD(null,today,this._futureEnd(60));
    const availP90=this._availHD(null,today,this._futureEnd(90));

    document.getElementById('an-fc-kpis').innerHTML=[
      this._kpi({title:'Proj. fill — next 30d', value:this._fmtFR(this._fillRate(bookP30,availP30)), tooltip:'Projected fill rate = booked ÷ available half-days for the next 30 days.'}),
      this._kpi({title:'Proj. fill — next 60d', value:this._fmtFR(this._fillRate(bookP60,availP60)), tooltip:'Projected fill rate for the next 60 days.'}),
      this._kpi({title:'Proj. fill — next 90d', value:this._fmtFR(this._fillRate(bookP90,availP90)), tooltip:'Projected fill rate for the next 90 days.'}),
    ].join('');

    this._renderFutureByCountryChart('an-fc-country-chart');
    this._renderAlerts();
    this._renderRemainingCapTable('an-fc-cap-body');
  },

  // ── CHART: monthly booking trend  (FE-06) ────────────────────
  _renderMonthTrend(canvasId, entries){
    const months=[];
    for(let i=11;i>=0;i--){
      const m=new Date(new Date().getFullYear(),new Date().getMonth()-i,1);
      months.push({mk:U.monthKey(m),label:m.toLocaleString('en-GB',{month:'short'})});
    }
    const data=months.map(({mk})=>this._sumHD(entries.filter(e=>e.date?.startsWith(mk))));
    if(data.every(v=>v===0)){ this._emptyChart(canvasId); return; }
    this._chart(canvasId,'line',{
      labels:months.map(m=>m.label),
      datasets:[{label:'Half-days booked',data,fill:true,tension:.4,
        borderColor:'#191d64',backgroundColor:'rgba(25,29,100,.08)',
        pointRadius:3,pointHoverRadius:5}]
    },{scales:{y:{beginAtZero:true,ticks:{stepSize:1}}},plugins:{legend:{display:false}}});
  },

  // ── CHART: lead time distribution  (FE-05) ───────────────────
  _renderLTDist(canvasId, entries){
    const counts={};
    this._ltBuckets.forEach(b=>counts[b]=0);
    let hasData=false;
    entries.forEach(e=>{ const lt=this._leadTime(e); if(lt===null) return; hasData=true; const b=this._ltBucket(lt); if(b) counts[b]++; });
    if(!hasData){ this._emptyChart(canvasId,'No lead time data — booking creation dates may be missing.'); return; }
    this._chart(canvasId,'bar',{
      labels:this._ltBuckets,
      datasets:[{label:'Bookings',data:this._ltBuckets.map(b=>counts[b]),
        backgroundColor:'rgba(25,29,100,.78)',borderRadius:4,barPercentage:.72}]
    },{scales:{y:{beginAtZero:true,ticks:{stepSize:1}}},plugins:{legend:{display:false}}});
  },

  // ── CHART: country fill rate  (FE-10) ────────────────────────
  _renderCountryFRChart(canvasId){
    const f=this._filter;
    const from=f.dateFrom||localDateStr(new Date(new Date().getFullYear()-1,0,1));
    const to  =f.dateTo  ||U.today();
    const data=COUNTRIES.map(c=>{
      if(f.country&&f.country!==c) return null;
      const userIds=Cache.usersArr().filter(u=>isBookable(u)&&u.country===c&&(!f.controller||u.name===f.controller)).map(u=>u.uid);
      const booked=this._sumHD(Cache.entriesArr().filter(e=>e.userCountry===c&&e.date>=from&&e.date<=to&&this._passesFilter(e)));
      const avail =this._availHD(userIds,from,to);
      return {c,booked,free:Math.max(0,avail-booked)};
    }).filter(Boolean).filter(d=>d.booked>0||d.free>0);
    if(!data.length){ this._emptyChart(canvasId); return; }
    this._chart(canvasId,'bar',{
      labels:data.map(d=>FLAGS[d.c]+' '+d.c),
      datasets:[
        {label:'Booked HD',   data:data.map(d=>d.booked), backgroundColor:'#191d64',borderRadius:3,stack:'s'},
        {label:'Available HD',data:data.map(d=>d.free),   backgroundColor:'#86efac',borderRadius:3,stack:'s'}
      ]
    },{scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}},
      plugins:{legend:{labels:{boxWidth:11,font:{size:10}}}}});
  },

  // ── CHART: fill rate trend  (FE-08) ──────────────────────────
  _renderFRTrendChart(canvasId){
    const months=[];
    for(let i=5;i>=0;i--){
      const m=new Date(new Date().getFullYear(),new Date().getMonth()-i,1);
      const mk=U.monthKey(m);
      const from=mk+'-01', to=new Date(m.getFullYear(),m.getMonth()+1,0).toISOString().slice(0,10);
      const booked=this._sumHD(Cache.entriesArr().filter(e=>e.date?.startsWith(mk)&&this._passesFilter(e)));
      const avail=this._availHD(null,from,to);
      months.push({label:m.toLocaleString('en-GB',{month:'short'}),fr:this._fillRate(booked,avail)});
    }
    if(months.every(m=>m.fr===null)){ this._emptyChart(canvasId,'No availability data found.'); return; }
    this._chart(canvasId,'line',{
      labels:months.map(m=>m.label),
      datasets:[{label:'Fill rate %',data:months.map(m=>m.fr),fill:true,tension:.4,
        borderColor:'#10b981',backgroundColor:'rgba(16,185,129,.09)',pointRadius:3}]
    },{scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%'}}},plugins:{legend:{display:false}}});
  },

  // ── CHART: future capacity windows  (FE-12) ──────────────────
  _renderFutureCapChart(canvasId){
    const today=U.today();
    const wins=[30,60,90,180];
    const booked=wins.map(w=>this._sumHD(Cache.entriesArr().filter(e=>e.date>=today&&e.date<=this._futureEnd(w)&&this._passesFilter(e))));
    const avail =wins.map(w=>this._availHD(null,today,this._futureEnd(w)));
    const remain=wins.map((_,i)=>Math.max(0,(avail[i]||0)-booked[i]));
    this._chart(canvasId,'bar',{
      labels:wins.map(w=>'Next '+w+'d'),
      datasets:[
        {label:'Booked HD',    data:booked, backgroundColor:'#191d64',borderRadius:3,stack:'s'},
        {label:'Remaining HD', data:remain, backgroundColor:'#86efac',borderRadius:3,stack:'s'}
      ]
    },{scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}},
      plugins:{legend:{labels:{boxWidth:11,font:{size:10}}}}});
  },

  // ── CHART: client segment donut  (FE-13) ─────────────────────
  _renderSegChart(canvasId, strategic, standard, reactive){
    if(!strategic&&!standard&&!reactive){ this._emptyChart(canvasId,'No lead time data.'); return; }
    this._chart(canvasId,'doughnut',{
      labels:['Strategic (≥60d)','Standard (15–60d)','Reactive (<15d)'],
      datasets:[{data:[strategic,standard,reactive],
        backgroundColor:['#191d64','#10b981','#f59e0b'],borderWidth:2}]
    },{plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}}}});
  },

  // ── CHART: avg lead time by client  (FE-13) ──────────────────
  _renderClientLTChart(canvasId, entries){
    const map={};
    entries.forEach(e=>{ const lt=this._leadTime(e); if(lt===null) return; (map[e.clientName]=map[e.clientName]||[]).push(lt); });
    const sorted=Object.entries(map)
      .map(([c,lts])=>({c,avg:Math.round(lts.reduce((s,v)=>s+v,0)/lts.length)}))
      .sort((a,b)=>b.avg-a.avg).slice(0,10);
    if(!sorted.length){ this._emptyChart(canvasId,'No lead time data.'); return; }
    this._chart(canvasId,'bar',{
      labels:sorted.map(d=>d.c),
      datasets:[{label:'Avg lead time (days)',data:sorted.map(d=>d.avg),
        backgroundColor:'rgba(25,29,100,.72)',borderRadius:4,barPercentage:.72}]
    },{indexAxis:'y',scales:{x:{beginAtZero:true}},plugins:{legend:{display:false}}});
  },

  // ── CHART: future capacity by client  (FE-13) ────────────────
  _renderFutureByClientChart(canvasId){
    const today=U.today(), end=this._futureEnd(90);
    const map={};
    Cache.entriesArr().filter(e=>e.date>=today&&e.date<=end&&this._passesFilter(e))
      .forEach(e=>{ map[e.clientName]=(map[e.clientName]||0)+this._hd(e.slot); });
    const sorted=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,10);
    if(!sorted.length){ this._emptyChart(canvasId); return; }
    this._chart(canvasId,'bar',{
      labels:sorted.map(d=>d[0]),
      datasets:[{label:'Booked HD (next 90d)',data:sorted.map(d=>d[1]),
        backgroundColor:'#10b981',borderRadius:4,barPercentage:.72}]
    },{indexAxis:'y',scales:{x:{beginAtZero:true}},plugins:{legend:{display:false}}});
  },

  // ── CHART: future by country  (FE-14) ────────────────────────
  _renderFutureByCountryChart(canvasId){
    const today=U.today(); const f=this._filter;
    const data=COUNTRIES.filter(c=>!f.country||f.country===c).map(c=>{
      const uids=Cache.usersArr().filter(u=>isBookable(u)&&u.country===c&&(!f.controller||u.name===f.controller)).map(u=>u.uid);
      const b30=this._sumHD(Cache.entriesArr().filter(e=>e.userCountry===c&&e.date>=today&&e.date<=this._futureEnd(30)&&this._passesFilter(e)));
      const b90=this._sumHD(Cache.entriesArr().filter(e=>e.userCountry===c&&e.date>=today&&e.date<=this._futureEnd(90)&&this._passesFilter(e)));
      const a90=this._availHD(uids,today,this._futureEnd(90));
      return {c,b30,b90,rem:Math.max(0,a90-b90)};
    }).filter(d=>d.b90>0||d.rem>0);
    if(!data.length){ this._emptyChart(canvasId); return; }
    this._chart(canvasId,'bar',{
      labels:data.map(d=>FLAGS[d.c]+' '+d.c),
      datasets:[
        {label:'Booked next 30d', data:data.map(d=>d.b30),  backgroundColor:'#191d64',borderRadius:3},
        {label:'Booked next 90d', data:data.map(d=>d.b90),  backgroundColor:'#6366f1',borderRadius:3},
        {label:'Available 90d',   data:data.map(d=>d.rem),  backgroundColor:'#86efac',borderRadius:3}
      ]
    },{scales:{y:{beginAtZero:true}},
      plugins:{legend:{labels:{boxWidth:10,font:{size:10}}}}});
  },

  // ── TABLE: client visibility  (FE-07) ────────────────────────
  _clientVisRows(){
    const today=U.today();
    const entries=this._getEntries();
    const clients=U.uniq(entries.map(e=>e.clientName).filter(Boolean));
    return clients.map(c=>{
      const ce=entries.filter(e=>e.clientName===c);
      const fut=ce.filter(e=>e.date>=today);
      const lts=ce.map(e=>this._leadTime(e)).filter(v=>v!==null);
      const lastFut=fut.length?fut.map(e=>e.date).reduce((a,b)=>a>b?a:b):null;
      const horizon=lastFut?Math.round((parseLocalDate(lastFut)-parseLocalDate(today))/86400000):0;
      const b30=this._sumHD(fut.filter(e=>e.date<=this._futureEnd(30)));
      const b90=this._sumHD(fut.filter(e=>e.date<=this._futureEnd(90)));
      const avgLT=lts.length?Math.round(lts.reduce((s,v)=>s+v,0)/lts.length):null;
      // cols: 0=name, 1=b30, 2=b90, 3=lastFut(string), 4=horizon, 5=avgLT
      return [c, b30, b90, lastFut||'', horizon, avgLT];
    });
  },

  _renderClientVisTable(bodyId, opts={}){
    const rows=this._clientVisRows();
    const el=document.getElementById(bodyId); if(!el) return;
    if(!rows.length){ el.innerHTML=this._emptyHtml(); return; }

    const tid='cli-vis';
    let displayRows, pagination='';
    if(opts.limit){
      displayRows=[...rows].sort((a,b)=>b[4]-a[4]).slice(0,opts.limit);
    } else {
      const {slice,total,page,pages}=this._sortedPaged(tid,rows,4);
      displayRows=slice;
      pagination=this._pagHtml(tid,page,pages,total);
    }
    const s=this._sort[tid]||{col:4,dir:'desc'};
    const th=(lbl,col)=>this._th(tid,lbl,col,s);

    let html=`<table class="an-tbl an-tbl-sticky"><thead><tr>
      ${th('Client',0)}${th('Next 30d HD',1)}${th('Next 90d HD',2)}
      ${th('Last Future Date',3)}${th('Visibility',4)}${th('Avg Lead Time',5)}<th>Trend</th>
    </tr></thead><tbody>`;
    displayRows.forEach(r=>{
      const tCls=r[4]>60?'an-trend-up':r[4]>14?'an-trend-flat':'an-trend-dn';
      const tLbl=r[4]>60?'▲ Strong':r[4]>14?'→ Moderate':'▼ Short';
      html+=`<tr>
        <td><strong>${U.esc(r[0])}</strong></td>
        <td>${r[1]}</td><td>${r[2]}</td>
        <td>${this._fmtDate(r[3])}</td>
        <td>${this._fmtDays(r[4])}</td>
        <td>${this._fmtDays(r[5])}</td>
        <td class="${tCls}">${tLbl}</td>
      </tr>`;
    });
    html+='</tbody></table>';
    el.innerHTML=html+pagination;
  },

  // ── TABLE: controller fill rates  (FE-09) ────────────────────
  _ctrlFillRows(){
    const today=U.today();
    const curY=new Date().getFullYear(), curM=new Date().getMonth();
    const curMK=`${curY}-${S2(curM+1)}`;
    const prevD=new Date(curY,curM-1,1);
    const prevMK=`${prevD.getFullYear()}-${S2(prevD.getMonth()+1)}`;
    const f=this._filter;
    return Cache.usersArr().filter(u=>isBookable(u)&&(!f.country||u.country===f.country)&&(!f.controller||u.name===f.controller)).map(u=>{
      const allE=Cache.entriesArr();
      const bCur =this._sumHD(allE.filter(e=>e.userId===u.uid&&e.date?.startsWith(curMK)));
      const bPrev=this._sumHD(allE.filter(e=>e.userId===u.uid&&e.date?.startsWith(prevMK)));
      const bP30 =this._sumHD(allE.filter(e=>e.userId===u.uid&&e.date>=today&&e.date<=this._futureEnd(30)));
      const curTo =new Date(curY,curM+1,0).toISOString().slice(0,10);
      const prevTo=new Date(prevD.getFullYear(),prevD.getMonth()+1,0).toISOString().slice(0,10);
      const aCur =this._availHD([u.uid],curMK+'-01',curTo);
      const aPrev=this._availHD([u.uid],prevMK+'-01',prevTo);
      const aP30 =this._availHD([u.uid],today,this._futureEnd(30));
      const frCur =this._fillRate(bCur,aCur);
      const frPrev=this._fillRate(bPrev,aPrev);
      const frP30 =this._fillRate(bP30,aP30);
      const delta =frCur!==null&&frPrev!==null?frCur-frPrev:null;
      // cols: 0=name,1=country,2=availHD,3=bookedHD,4=frCur,5=frPrev,6=delta,7=frP30
      return [u.name, u.country||'—', aCur, bCur, frCur, frPrev, delta, frP30];
    });
  },

  _renderCtrlFillTable(bodyId, opts={}){
    const rows=this._ctrlFillRows();
    const el=document.getElementById(bodyId); if(!el) return;
    if(!rows.length){ el.innerHTML=this._emptyHtml('No controllers match this filter.'); return; }

    const tid='ctrl-fill';
    let displayRows, pagination='';
    if(opts.limit){
      displayRows=[...rows].sort((a,b)=>(b[4]??-1)-(a[4]??-1)).slice(0,opts.limit);
    } else {
      const {slice,total,page,pages}=this._sortedPaged(tid,rows,4);
      displayRows=slice;
      pagination=this._pagHtml(tid,page,pages,total);
    }
    const s=this._sort[tid]||{col:4,dir:'desc'};
    const th=(lbl,col)=>this._th(tid,lbl,col,s);

    let html=`<div class="an-tbl-scroll"><table class="an-tbl an-tbl-sticky"><thead><tr>
      ${th('Controller',0)}${th('Country',1)}${th('Avail HD',2)}${th('Booked HD',3)}
      ${th('Fill Rate',4)}${th('Prev Month',5)}${th('Δ pp',6)}${th('Proj. 30d',7)}<th>Status</th>
    </tr></thead><tbody>`;
    displayRows.forEach(r=>{
      const st=this._statusFromFR(r[4]);
      const dCls=r[6]===null?'an-trend-flat':r[6]>0.5?'an-trend-up':r[6]<-0.5?'an-trend-dn':'an-trend-flat';
      const dFmt=r[6]===null?'—':(r[6]>0?'+':'')+r[6].toFixed(1)+'pp';
      const bar=`<div class="an-fr-bar-wrap"><div class="an-fr-bar"><div class="an-fr-fill" style="width:${Math.min(100,r[4]||0)}%"></div></div><span class="an-fr-pct">${this._fmtFR(r[4])}</span></div>`;
      const tooltip=`Booked ÷ Available = ${r[3]} ÷ ${r[2]||'?'}`;
      html+=`<tr>
        <td><strong>${U.esc(r[0])}</strong></td>
        <td>${FLAGS[r[1]]||''} ${U.esc(r[1])}</td>
        <td>${r[2]||'—'}</td><td>${r[3]}</td>
        <td title="${U.esc(tooltip)}">${bar}</td>
        <td>${this._fmtFR(r[5])}</td>
        <td class="${dCls}">${dFmt}</td>
        <td>${this._fmtFR(r[7])}</td>
        <td><span class="an-status ${st.cls}">${st.label}</span></td>
      </tr>`;
    });
    html+='</tbody></table></div>';
    el.innerHTML=html+pagination;
  },

  // ── TABLE: remaining sellable capacity  (FE-14) ───────────────
  _renderRemainingCapTable(bodyId){
    const today=U.today(); const f=this._filter;
    const rows=[];
    COUNTRIES.filter(c=>!f.country||f.country===c).forEach(c=>{
      const uids=Cache.usersArr().filter(u=>isBookable(u)&&u.country===c&&(!f.controller||u.name===f.controller)).map(u=>u.uid);
      [30,60,90].forEach(w=>{
        const end=this._futureEnd(w);
        const booked=this._sumHD(Cache.entriesArr().filter(e=>e.userCountry===c&&e.date>=today&&e.date<=end&&this._passesFilter(e)));
        const avail =this._availHD(uids,today,end);
        const remain=Math.max(0,avail-booked);
        const fr    =this._fillRate(booked,avail);
        if(avail>0||booked>0) rows.push({c,w,booked,avail,remain,fr});
      });
    });
    const el=document.getElementById(bodyId); if(!el) return;
    if(!rows.length){ el.innerHTML=this._emptyHtml(); return; }

    let html=`<table class="an-tbl"><thead><tr>
      <th>Country</th><th>Window</th><th>Available HD</th><th>Booked HD</th>
      <th>Remaining HD</th><th>Proj. Fill Rate</th>
    </tr></thead><tbody>`;
    rows.forEach(r=>{
      const bar=`<div class="an-fr-bar-wrap"><div class="an-fr-bar"><div class="an-fr-fill" style="width:${Math.min(100,r.fr||0)}%"></div></div><span class="an-fr-pct">${this._fmtFR(r.fr)}</span></div>`;
      html+=`<tr><td>${FLAGS[r.c]||''} ${U.esc(r.c)}</td><td>Next ${r.w}d</td>
        <td>${r.avail}</td><td>${r.booked}</td><td><strong>${r.remain}</strong></td><td>${bar}</td></tr>`;
    });
    html+='</tbody></table>';
    el.innerHTML=html;
  },

  // ── ALERTS  (FE-15) ───────────────────────────────────────────
  _renderAlerts(){
    const alerts=this._computeAlerts();
    const el=document.getElementById('an-alerts-body'); if(!el) return;
    if(!alerts.length){
      el.innerHTML='<div class="an-no-alerts">✅ No alerts — everything looks healthy based on current data.</div>';
      return;
    }
    el.innerHTML=alerts.map(a=>`<div class="an-alert-item an-alert-${a.sev}">
      <div class="an-alert-ico">${a.ico}</div>
      <div class="an-alert-txt"><div class="an-alert-lbl">${U.esc(a.title)}</div>
      <div class="an-alert-sub">${U.esc(a.detail)}</div></div></div>`).join('');
  },

  _computeAlerts(){
    const alerts=[]; const today=U.today(); const f=this._filter;
    const allE=Cache.entriesArr();

    // No future bookings for a historically active client
    U.uniq(allE.filter(e=>this._passesFilter(e)).map(e=>e.clientName).filter(Boolean)).forEach(c=>{
      if(f.client&&f.client!==c) return;
      const hasFuture=allE.some(e=>e.clientName===c&&e.date>=today);
      if(!hasFuture) alerts.push({sev:'warn',ico:'⚠️',
        title:`No future bookings — ${c}`,
        detail:'This client has past bookings but nothing scheduled after today.'});
    });

    // Country near capacity or very low fill rate
    COUNTRIES.filter(c=>!f.country||f.country===c).forEach(c=>{
      const uids=Cache.usersArr().filter(u=>isBookable(u)&&u.country===c).map(u=>u.uid);
      if(!uids.length) return;
      const end30=this._futureEnd(30);
      const booked=this._sumHD(allE.filter(e=>e.userCountry===c&&e.date>=today&&e.date<=end30&&this._passesFilter(e)));
      const avail =this._availHD(uids,today,end30);
      const fr=this._fillRate(booked,avail);
      if(fr===null) return;
      if(fr>=90) alerts.push({sev:'crit',ico:'🔴',
        title:`${c} near capacity next 30d`,
        detail:`Projected fill rate is ${fr.toFixed(1)}% — very limited availability remaining.`});
      else if(fr<30&&avail>0) alerts.push({sev:'warn',ico:'🟡',
        title:`${c} low fill rate next 30d`,
        detail:`Projected fill rate is only ${fr.toFixed(1)}% — significant capacity is unsold.`});
    });

    return alerts;
  },

  // ── CSV EXPORT  (FE-17) ───────────────────────────────────────
  exportCliVis(){
    const rows=this._clientVisRows();
    const hdr=['Client','Booked next 30d (HD)','Booked next 90d (HD)','Last Future Date','Visibility (days)','Avg Lead Time (days)'];
    this._downloadCsv(hdr, rows.map(r=>[r[0],r[1],r[2],r[3]||'',r[4],r[5]??'']), 'client-visibility.csv');
  },

  exportCtrlFill(){
    const rows=this._ctrlFillRows();
    const hdr=['Controller','Country','Available HD','Booked HD','Fill Rate %','Prev Month %','Delta pp','Proj 30d %'];
    this._downloadCsv(hdr, rows.map(r=>[r[0],r[1],r[2],r[3],r[4]??'',r[5]??'',r[6]!==null?r[6].toFixed(1):'',r[7]??'']), 'controller-fill-rates.csv');
  },

  _downloadCsv(headers, rows, filename){
    const lines=[headers.join(','),...rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(','))];
    const blob=new Blob([lines.join('\n')],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV exported.');
  },
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
  on('nt-an',          'click',()=>Adm.setView('an'));
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

  // ── Analytics filter bar  (FE-02) ──
  on('an-apply', 'click', ()=>Anl.applyFilter());
  on('an-clear', 'click', ()=>Anl.clearFilter());

  // ── Analytics CSV exports  (FE-17) ──
  on('an-ov-cli-csv',  'click', ()=>Anl.exportCliVis());
  on('an-ov-ctrl-csv', 'click', ()=>Anl.exportCtrlFill());
  on('an-vis-cli-csv', 'click', ()=>Anl.exportCliVis());
  on('an-cap-ctrl-csv','click', ()=>Anl.exportCtrlFill());
  on('an-cli-tbl-csv', 'click', ()=>Anl.exportCliVis());
  on('an-fc-cap-csv',  'click', ()=>Anl.exportCtrlFill());

  // ── Analytics sub-tabs  (FE-01) — event delegation ──
  document.getElementById('an-tabs')?.addEventListener('click', e=>{
    const tab=e.target.dataset.anltab; if(tab) Anl.setTab(tab);
  });

  // ── Analytics table sort + pagination  (FE-07, FE-09) — delegated ──
  document.addEventListener('click', e=>{
    const sort=e.target.dataset.ansort;
    if(sort){ const[tid,col]=sort.split(':'); Anl.handleSort(tid,+col); return; }
    const pg=e.target.dataset.anpg;
    if(pg){ const[tid,dir]=pg.split(':'); Anl.handlePage(tid,dir); }
  });

  // ── Analytics tooltips  (FE-20) — extend existing #tip ──
  document.addEventListener('mouseover', e=>{
    const t=e.target.closest('.an-tip-icon[data-tip]');
    if(!t) return;
    const tip=document.getElementById('tip');
    tip.textContent=t.dataset.tip; tip.style.display='block';
    const r=t.getBoundingClientRect();
    tip.style.left=Math.min(r.left+window.scrollX, window.innerWidth-250)+'px';
    tip.style.top =(r.bottom+window.scrollY+6)+'px';
  });
  document.addEventListener('mouseout', e=>{
    if(e.target.closest('.an-tip-icon[data-tip]')) document.getElementById('tip').style.display='none';
  });

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
  // Add another manufacturer row
  on('btn-add-mfr',   'click',()=>{
    Slot._mfrs.push({factory:'',expectedQty:null,finalQty:null,documents:[]});
    Slot._renderMfrs();
  });
  // Holiday warning reacts to date changes
  on('ms-date',       'change',()=>Slot._checkHolidayWarn());
  // Weekday toggle buttons (Mon–Sun)
  document.querySelectorAll('#ms-wd-btns .wd-btn').forEach(b=>b.addEventListener('click',()=>b.classList.toggle('on')));

  // ── Drive upload — pre-flight token check ──
  // The label click IS a direct user gesture, so we can open the Google auth
  // popup here without the browser blocking it.  If the Drive token is already
  // present we let the label's default behaviour (open file picker) proceed.
  // If not, we block the default, re-auth, then programmatically open the picker.
  const uploadLbl=document.getElementById('ms-doc-upload-lbl');
  if(uploadLbl){
    uploadLbl.addEventListener('click', e=>{
      if(App._driveToken) return; // token present — file picker opens normally
      e.preventDefault();
      const status=document.getElementById('ms-doc-status');
      status.textContent='Reconnecting Google Drive…'; status.className='doc-status';
      uploadLbl.style.pointerEvents='none'; uploadLbl.style.opacity='.55';
      Drive.authorize().then(()=>{
        status.textContent='';
        document.getElementById('ms-doc-input').click(); // open file picker now
      }).catch(err=>{
        if(err.code==='auth/popup-closed-by-user'){ status.textContent=''; return; }
        status.textContent='Drive connection failed: '+U.esc(err.message);
        status.className='doc-status err';
      }).finally(()=>{
        uploadLbl.style.pointerEvents=''; uploadLbl.style.opacity='';
      });
    });
  }

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
