'use strict';
// ════════════════════════════════════
// MANUFACTURER NORMALISATION
// Feature 3+4: bookings now carry a manufacturers[] array. Legacy entries
// (factory / expectedQty / finalQty / documents on the top-level) are
// transparently upgraded in-memory on read via normalizeEntry().
// ════════════════════════════════════
function normalizeManufacturers(entry){
  if(!entry) return [];
  if(Array.isArray(entry.manufacturers)&&entry.manufacturers.length){
    return entry.manufacturers.map(m=>({
      factory: m.factory||'',
      expectedQty: m.expectedQty!=null?m.expectedQty:null,
      finalQty: m.finalQty!=null?m.finalQty:null,
      documents: Array.isArray(m.documents)?m.documents:[]
    }));
  }
  // Legacy: synthesize a single manufacturer from top-level fields
  return [{
    factory: entry.factory||'',
    expectedQty: entry.expectedQty!=null?entry.expectedQty:null,
    finalQty: entry.finalQty!=null?entry.finalQty:null,
    documents: Array.isArray(entry.documents)?entry.documents:[]
  }];
}

// Convenience readers used by renderers — always operate on normalized form.
function entryHasDocs(entry){
  return normalizeManufacturers(entry).some(m=>Array.isArray(m.documents)&&m.documents.length>0);
}
function entryDocCount(entry){
  return normalizeManufacturers(entry).reduce((s,m)=>s+(Array.isArray(m.documents)?m.documents.length:0),0);
}
function entryFactoryLabel(entry){
  const mfrs=normalizeManufacturers(entry).filter(m=>m.factory);
  if(!mfrs.length) return '';
  if(mfrs.length===1) return mfrs[0].factory;
  return `${mfrs[0].factory} +${mfrs.length-1}`;
}
function entryTotalExpected(entry){
  const mfrs=normalizeManufacturers(entry);
  const filled=mfrs.filter(m=>m.expectedQty!=null);
  if(!filled.length) return null;
  return filled.reduce((s,m)=>s+m.expectedQty,0);
}
function entryTotalFinal(entry){
  const mfrs=normalizeManufacturers(entry);
  const filled=mfrs.filter(m=>m.finalQty!=null);
  if(!filled.length) return null;
  return filled.reduce((s,m)=>s+m.finalQty,0);
}

