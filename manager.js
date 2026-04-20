'use strict';
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

