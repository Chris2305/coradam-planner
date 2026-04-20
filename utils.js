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
