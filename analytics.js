'use strict';
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

