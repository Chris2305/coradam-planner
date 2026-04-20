'use strict';
// ════════════════════════════════════
// FIREBASE
// ════════════════════════════════════
let fapp, fauth, fdb, fstorage;
function fbRef(path){ return fdb.ref(path); }

// Wraps any Firebase promise in a 15-second timeout so a broken or
// stalled connection surfaces as a clear error instead of an infinite spinner.
const FB_TIMEOUT_MS = 15000;
function fbTimeout(promise){
  return Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('Firebase request timed out. Please check your connection and try again.')),FB_TIMEOUT_MS))
  ]);
}

async function fbGet(path){ const s=await fbTimeout(fbRef(path).get()); return s.val(); }
async function fbSet(path,val){ await fbTimeout(fbRef(path).set(val)); }
async function fbUpdate(path,val){ await fbTimeout(fbRef(path).update(val)); }
async function fbDel(path){ await fbTimeout(fbRef(path).remove()); }
async function fbPush(path,val){ const r=fbRef(path).push(); await fbTimeout(r.set({...val,id:r.key})); return r.key; }

