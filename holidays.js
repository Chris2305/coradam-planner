'use strict';
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

