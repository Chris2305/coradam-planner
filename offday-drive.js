'use strict';
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

