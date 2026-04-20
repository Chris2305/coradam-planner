'use strict';
function el(tag,cls){ const e=document.createElement(tag); if(cls)e.className=cls; return e; }
// ════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════
const M = {
  open(id){ document.getElementById(id).classList.add('open'); },
  close(id){ document.getElementById(id).classList.remove('open'); }
};
document.querySelectorAll('.mov').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open');}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.mov.open').forEach(o=>o.classList.remove('open'));});
const Spin={on(){document.getElementById('spin').classList.add('on');},off(){document.getElementById('spin').classList.remove('on');}};
let _tid;
function toast(msg,type='ok'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show '+(type==='err'?'bad':'ok');
  clearTimeout(_tid); _tid=setTimeout(()=>t.classList.remove('show'),3000);
}
function show(name){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById('s-'+name).classList.add('active'); }

