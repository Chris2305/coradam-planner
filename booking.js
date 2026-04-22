'use strict';
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
    const clients=(targetUser.role==='super_admin'
      ?Cache.clientsArr()
      :Cache.clientsFor(uid)
    ).sort((a,b)=>a.name.localeCompare(b.name));
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
    [...(c.factories||[])].sort((a,b)=>a.localeCompare(b)).forEach(f=>{ opts+=`<option value="${U.esc(f)}" ${f===selFac?'selected':''}>${U.esc(f)}</option>`; });
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

    // Helper: open the file picker (called after token is confirmed present)
    const openPicker=()=>fresh.click();

    // If Drive token is missing, re-authorize NOW while we are still within the
    // button-click user gesture (required so the browser allows the popup).
    // After auth succeeds we programmatically open the file picker.
    if(App._driveToken){
      openPicker();
    } else {
      const statusEl=document.querySelector(`.mfr-doc-status[data-midx="${mIdx}"]`);
      const btn=document.querySelector(`.mfr-doc-upload-btn[data-midx="${mIdx}"]`);
      const setStatus=(t,err)=>{ if(statusEl){ statusEl.textContent=t; statusEl.className='mfr-doc-status'+(err?' err':''); } };
      setStatus('Reconnecting Google Drive…',false);
      if(btn){ btn.style.pointerEvents='none'; btn.style.opacity='.55'; }
      Drive.authorize()
        .then(()=>{ setStatus('',false); openPicker(); })
        .catch(err=>{
          if(err.code==='auth/popup-closed-by-user'){ setStatus('',false); return; }
          setStatus('Drive connection failed: '+U.esc(err.message),true);
        })
        .finally(()=>{ if(btn){ btn.style.pointerEvents=''; btn.style.opacity=''; } });
    }
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

