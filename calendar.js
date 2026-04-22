'use strict';
// ════════════════════════════════════
// CALENDAR (Controller)
// ════════════════════════════════════
const Cal = {
  cur: new Date(),
  view: 'month', // 'month' | 'week' | 'list'

  init(){
    this.cur=new Date();
    this.view='month';
    // Reset view toggle button states to match
    ['month','week','list'].forEach(n=>document.getElementById('vt-'+n)?.classList.toggle('on',n==='month'));
    this.render();
  },

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
    document.getElementById('cal-grid').style.display=this.view==='month'?'grid':'none';
    document.getElementById('cal-week').style.display=this.view==='week'?'block':'none';
    document.getElementById('cal-list').style.display=this.view==='list'?'block':'none';
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
    if(de.length>0){
      // Existing booking — open edit modal
      Slot.edit(de[0].id);
    } else {
      // No booking yet (day is empty or just available) — always invite a new booking
      Slot.add(ds);
    }
  },

  _renderWeek(){
    try{ this._renderWeekInner(); } catch(e){
      const c=document.getElementById('cal-week');
      if(c) c.innerHTML='<div style="padding:1rem;color:red;font-size:.8rem">Week render error: '+U.esc(e.message)+'</div>';
      console.error('[Cal] _renderWeek error:',e);
    }
  },
  _renderWeekInner(){
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
    try{ this._renderListInner(); } catch(e){
      const c=document.getElementById('cal-list');
      if(c) c.innerHTML='<div style="padding:1rem;color:red;font-size:.8rem">List render error: '+U.esc(e.message)+'</div>';
      console.error('[Cal] _renderList error:',e);
    }
  },
  _renderListInner(){
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

