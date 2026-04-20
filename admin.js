'use strict';
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

