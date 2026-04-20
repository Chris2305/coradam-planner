'use strict';
// ════════════════════════════════════
// REPORTS (Super Admin only)
// Charts use CSS bars + raw SVG — no external CDN required (CSP restriction).
// ════════════════════════════════════
const Rpt = {
  init(){
    const y = new Date().getFullYear();
    const sel = document.getElementById('rp-year');
    if(!sel) return;
    sel.innerHTML = '';
    for(let i=y-3; i<=y+1; i++){
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = i;
      if(i===y) opt.selected = true;
      sel.appendChild(opt);
    }
    document.getElementById('rp-month').value = '0';
  },

  render(){
    const year   = +document.getElementById('rp-year').value;
    const moRaw  = document.getElementById('rp-month').value; // '0','1'-'12','q1'-'q4'
    this._renderUtil(year, moRaw);
    this._renderClients(year, moRaw);
    this._renderQtyTrend(year, moRaw);
  },

  // Return JS months (0-based) covered by the selection
  _periodMonths(moRaw){
    const q={q1:[0,1,2],q2:[3,4,5],q3:[6,7,8],q4:[9,10,11]};
    if(q[moRaw]) return q[moRaw];
    const n=+moRaw;
    if(n===0) return [0,1,2,3,4,5,6,7,8,9,10,11];
    return [n-1]; // n is 1-based
  },

  // Count Mon–Fri working days in a given month (m = 0-based JS month)
  _wDays(y, m){
    let n=0; const d=new Date(y,m,1);
    while(d.getMonth()===m){ const dow=d.getDay(); if(dow!==0&&dow!==6) n++; d.setDate(d.getDate()+1); }
    return n;
  },

  // Entries matching the selected period
  _entries(y, moRaw){
    const months=this._periodMonths(moRaw); // 0-based JS months
    return Cache.entriesArr().filter(e=>{
      if(!e.date) return false;
      const [ey,em]=e.date.split('-').map(Number);
      if(ey!==y) return false;
      return months.includes(em-1); // em is 1-based
    });
  },

  _renderUtil(y, moRaw){
    const months  = this._periodMonths(moRaw); // 0-based JS months
    const entries = this._entries(y, moRaw);
    const totalWD = months.reduce((s,m)=>s+this._wDays(y,m),0);
    const controllers = Cache.usersArr()
      .filter(u=>isBookable(u))
      .sort((a,b)=>a.name.localeCompare(b.name));

    // Pre-expand availability rules per user across the period
    const availByUser={};
    Cache.availArr().filter(r=>r.type==='available').forEach(rule=>{
      months.forEach(m=>{
        U.expandAvail(rule,y,m).forEach(d=>{
          (availByUser[rule.userId]=availByUser[rule.userId]||new Set()).add(d);
        });
      });
    });

    let html='';
    controllers.forEach(u=>{
      const ue     = entries.filter(e=>e.userId===u.uid);
      const full   = ue.filter(e=>e.slot==='Full Day').length;
      const am     = ue.filter(e=>e.slot==='Half Day AM').length;
      const pm     = ue.filter(e=>e.slot==='Half Day PM').length;
      const booked = full + (am+pm)*0.5;
      // Availability
      const availDays = (availByUser[u.uid]||new Set()).size;
      // Bar widths use availDays as denominator so bars are always meaningful
      // regardless of period length (Full Year vs single month).
      // Fall back to totalWD if no availability rules have been set yet.
      const denom = availDays || totalWD;
      const fPct      = denom ? Math.min(100,(full/denom)*100) : 0;
      const aPct      = denom ? Math.min(100,(am*0.5/denom)*100) : 0;
      const pPct      = denom ? Math.min(100,(pm*0.5/denom)*100) : 0;
      const bookedPct = denom ? Math.min(100,(booked/denom)*100) : 0;
      // Unbooked = remainder of available days
      const unbookedPct = availDays ? Math.max(0, 100 - bookedPct) : 0;
      const bkOfAvail = availDays ? Math.round(bookedPct) : null;
      const pctLabel = bkOfAvail!=null
        ? `<span class="rp-util-pct-main">${bkOfAvail}%</span><br><span style="font-size:.66rem">${availDays}d available</span>`
        : `<span class="rp-util-pct-main">${Math.round(bookedPct)}%</span>`;
      html+=`<div class="rp-util-row">`+
        `<div class="rp-util-name" title="${U.esc(u.name)}">${U.esc(u.name)}</div>`+
        `<div class="rp-util-bar-wrap">`+
          `<div class="rp-util-bar">`+
            `<div class="rp-seg rp-seg-f"  style="width:${fPct.toFixed(1)}%"></div>`+
            `<div class="rp-seg rp-seg-a"  style="width:${aPct.toFixed(1)}%"></div>`+
            `<div class="rp-seg rp-seg-p"  style="width:${pPct.toFixed(1)}%"></div>`+
            `<div class="rp-seg rp-seg-av" style="width:${unbookedPct.toFixed(1)}%"></div>`+
          `</div>`+
          `<div class="rp-util-pct">${pctLabel}</div>`+
        `</div>`+
      `</div>`;
    });
    document.getElementById('rp-util-body').innerHTML = html || '<div class="no-items">No data for this period.</div>';
  },

  _renderClients(y, moRaw){
    const entries = this._entries(y, moRaw);
    const map={};
    entries.forEach(e=>{
      const cn=e.clientName||'(unknown)';
      map[cn]=(map[cn]||0)+(e.slot==='Full Day'?1:0.5);
    });
    const sorted=Object.entries(map).sort((a,b)=>b[1]-a[1]);
    const max=sorted.length?sorted[0][1]:1;
    let html='';
    sorted.forEach(([name,days])=>{
      const pct=(days/max)*100;
      const val=days%1===0?days:days.toFixed(1);
      html+=`<div class="rp-cli-row">`+
        `<div class="rp-cli-name" title="${U.esc(name)}">${U.esc(name)}</div>`+
        `<div class="rp-cli-bar-wrap">`+
          `<div class="rp-cli-bar" style="width:${pct.toFixed(1)}%"></div>`+
          `<div class="rp-cli-val">${val}d</div>`+
        `</div>`+
      `</div>`;
    });
    document.getElementById('rp-cli-body').innerHTML = html || '<div class="no-items">No bookings for this period.</div>';
  },

  _renderQtyTrend(y, moRaw){
    const qMap={q1:[1,2,3],q2:[4,5,6],q3:[7,8,9],q4:[10,11,12]};
    const months = qMap[moRaw]||( +moRaw===0 ? Array.from({length:12},(_,i)=>i+1) : [+moRaw] );
    const allE = Cache.entriesArr().filter(e=>e.date&&e.date.startsWith(y+'-'));
    const MLBL=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const data = months.map(m=>{
      const mk=`${y}-${S2(m)}`;
      const me=allE.filter(e=>e.date.startsWith(mk));
      return { label:MLBL[m-1], exp:me.reduce((s,e)=>s+(e.expectedQty||0),0), fin:me.reduce((s,e)=>s+(e.finalQty||0),0) };
    });
    document.getElementById('rp-trend-body').innerHTML = this._lineChart(data);
  },

  _lineChart(data){
    const hasQty = data.some(d=>d.exp||d.fin);
    if(!hasQty) return '<div class="no-items">No quantity data for this period.</div>';
    const W=480, H=200, padL=44, padR=16, padT=12, padB=36;
    const cW=W-padL-padR, cH=H-padT-padB;
    const allV=data.flatMap(d=>[d.exp,d.fin]).filter(v=>v>0);
    const maxY=allV.length ? Math.ceil(Math.max(...allV)*1.15/10)*10||10 : 10;
    const n=data.length;
    const xPos=i=>padL+(n===1?cW/2:i*(cW/(n-1)));
    const yPos=v=>padT+cH-(v/maxY)*cH;

    // Horizontal grid lines
    let grid='';
    for(let i=0;i<=4;i++){
      const val=(maxY/4)*i, y=yPos(val);
      grid+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
      grid+=`<text x="${padL-4}" y="${y+4}" text-anchor="end" class="rpc-t">${Math.round(val)}</text>`;
    }
    const xlabels=data.map((d,i)=>`<text x="${xPos(i)}" y="${H-padB+14}" text-anchor="middle" class="rpc-t">${d.label}</text>`).join('');
    const pts=key=>data.map((d,i)=>`${xPos(i)},${yPos(d[key])}`).join(' ');
    const expLine=`<polyline points="${pts('exp')}" fill="none" stroke="#191d64" stroke-width="2" stroke-dasharray="5,3"/>`;
    const finLine=`<polyline points="${pts('fin')}" fill="none" stroke="#10b981" stroke-width="2.5"/>`;
    let dots='';
    data.forEach((d,i)=>{
      dots+=`<circle cx="${xPos(i)}" cy="${yPos(d.exp)}" r="3" fill="#191d64"/>`;
      dots+=`<circle cx="${xPos(i)}" cy="${yPos(d.fin)}" r="3" fill="#10b981"/>`;
    });
    const lY=H-4;
    const leg=`<line x1="${padL}" y1="${lY}" x2="${padL+20}" y2="${lY}" stroke="#191d64" stroke-width="2" stroke-dasharray="5,3"/>`+
      `<text x="${padL+24}" y="${lY+4}" class="rpc-t">Expected</text>`+
      `<line x1="${padL+95}" y1="${lY}" x2="${padL+115}" y2="${lY}" stroke="#10b981" stroke-width="2.5"/>`+
      `<text x="${padL+119}" y="${lY+4}" class="rpc-t">Final</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="rp-svg">${grid}${xlabels}${expLine}${finLine}${dots}${leg}</svg>`;
  }
};

