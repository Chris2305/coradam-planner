'use strict';
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

  // ── Impersonation ──
  on('btn-adm-viewas', 'click', ()=>Impersonate.openPicker());
  on('btn-imp-exit',   'click', ()=>Impersonate.stop());
  on('btn-imp-cancel', 'click', ()=>M.close('m-impersonate'));

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
