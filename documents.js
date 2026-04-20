'use strict';
// ════════════════════════════════════
// DOCS (Firebase Storage — per controller documents)
// ════════════════════════════════════
const Docs = {
  async upload(input, controllerUid){
    const file=input.files[0]; if(!file) return;
    if(!fstorage){ toast('Firebase Storage is not initialised. Check index.html for the Storage SDK script.','err'); return; }
    const statusEl=document.getElementById('mgr-doc-status');
    if(statusEl){ statusEl.textContent='Uploading…'; statusEl.className='mgr-doc-status uploading'; }
    Spin.on();
    try{
      const docId=U.uuid();
      // Sanitise filename — remove path traversal chars, keep extension
      const safeName=file.name.replace(/[^a-zA-Z0-9._\- ]/g,'_').slice(0,200)||'document';
      const storePath=`documents/${controllerUid}/${docId}/${safeName}`;
      const storageRef=fstorage.ref(storePath);
      await storageRef.put(file,{contentType:file.type||'application/octet-stream'});
      const downloadURL=await storageRef.getDownloadURL();
      const meta={
        id:docId,
        controllerUid,
        controllerName:Cache.users[controllerUid]?.name||'',
        name:safeName,
        storagePath:storePath,
        downloadURL,
        contentType:file.type||'application/octet-stream',
        size:file.size,
        uploadedBy:App.user.uid,
        uploadedByName:App.user.name,
        created:Date.now()
      };
      await fbSet(`documents/${controllerUid}/${docId}`,meta);
      if(!Cache.documents[controllerUid]) Cache.documents[controllerUid]={};
      Cache.documents[controllerUid][docId]=meta;
      if(statusEl){ statusEl.textContent='Uploaded successfully!'; statusEl.className='mgr-doc-status ok'; setTimeout(()=>{ statusEl.textContent=''; statusEl.className='mgr-doc-status'; },3000); }
      Mgr._renderDocs();
      toast('Document uploaded.');
    } catch(e){ if(statusEl){ statusEl.textContent='Upload failed: '+e.message; statusEl.className='mgr-doc-status err'; } toast('Upload failed: '+e.message,'err'); }
    finally{ Spin.off(); input.value=''; }
  },

  async del(docId, controllerUid){
    const meta=Cache.documents[controllerUid]?.[docId];
    if(!meta||!confirm('Delete "'+meta.name+'"? This cannot be undone.')) return;
    Spin.on();
    try{
      if(meta.storagePath && fstorage) await fstorage.ref(meta.storagePath).delete();
      await fbDel(`documents/${controllerUid}/${docId}`);
      delete Cache.documents[controllerUid][docId];
      Mgr._renderDocs();
      toast('Document deleted.');
    } catch(e){ toast('Delete failed: '+e.message,'err'); }
    finally{ Spin.off(); }
  }
};

