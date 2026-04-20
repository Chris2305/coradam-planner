'use strict';
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

