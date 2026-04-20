'use strict';
// ════════════════════════════════════
// AVAILABILITY
// ════════════════════════════════════
const Avail = {
  openForDate(date, existingRule=null, forUid=null){
    this._reset();
    document.getElementById('ma-title').textContent=existingRule?'Edit Availability':'Set Availability — '+U.fmt(date);
    document.getElementById('ma-for').value=forUid||'';
    const noteEl=document.getElementById('ma-for-note');
    if(forUid && App.user?.role==='team_manager'){
      const u=Cache.users[forUid];
      document.getElementById('ma-for-label').textContent=u?u.name:forUid;
      noteEl.style.display='block';
    } else { noteEl.style.display='none'; }
    if(existingRule){
      document.getElementById('ma-id').value=existingRule.id||'';
      document.getElementById('ma-del').style.display='inline-flex';
      this.pickType(existingRule.type);
      this.pickSlot(existingRule.slot||'Full Day');
      document.getElementById('ma-repeat').value=existingRule.repeatMode||'none';
      document.getElementById('ma-date').value=existingRule.startDate||date;
      document.getElementById('ma-from').value=existingRule.startDate||date;
      document.getElementById('ma-to').value=existingRule.endDate||'';
      document.getElementById('ma-until').value=existingRule.repeatUntil||'';
      document.getElementById('ma-note').value=existingRule.note||'';
      this.onRepeatChange();
    } else {
      document.getElementById('ma-date').value=date;
      document.getElementById('ma-from').value=date;
      this.pickSlot('Full Day');
    }
    M.open('m-avail');
  },
  openBulk(forUid=null){
    this._reset();
    document.getElementById('ma-title').textContent='Set Availability';
    document.getElementById('ma-for').value=forUid||'';
    const noteEl=document.getElementById('ma-for-note');
    if(forUid && App.user?.role==='team_manager'){
      const u=Cache.users[forUid];
      document.getElementById('ma-for-label').textContent=u?u.name:forUid;
      noteEl.style.display='block';
    } else { noteEl.style.display='none'; }
    document.getElementById('ma-date').value=U.today();
    document.getElementById('ma-from').value=U.today();
    this.pickSlot('Full Day');
    M.open('m-avail');
  },
  pickType(type){
    document.getElementById('ma-type').value=type;
    document.getElementById('av-yes').className='av-btn'+(type==='available'?' on-yes':'');
    document.getElementById('av-no').className='av-btn'+(type==='unavailable'?' on-no':'');
  },
  pickSlot(slot){
    document.getElementById('ma-slot').value=slot;
    ['ma-sb-f','ma-sb-a','ma-sb-p'].forEach(id=>document.getElementById(id).className='slt-btn');
    if(slot==='Full Day') document.getElementById('ma-sb-f').classList.add('on-full');
    else if(slot==='Half Day AM') document.getElementById('ma-sb-a').classList.add('on-am');
    else document.getElementById('ma-sb-p').classList.add('on-pm');
  },
  onRepeatChange(){
    const v=document.getElementById('ma-repeat').value;
    document.getElementById('ma-date-single').style.display=v==='range'?'none':'block';
    document.getElementById('ma-date-range').style.display=v==='range'?'block':'none';
    document.getElementById('ma-until-wrap').style.display=(v==='weekly'||v==='monthly')?'block':'none';
  },
  _reset(){
    document.getElementById('ma-id').value='';
    document.getElementById('ma-for').value='';
    document.getElementById('ma-type').value='';
    document.getElementById('ma-slot').value='';
    document.getElementById('ma-repeat').value='none';
    document.getElementById('ma-date').value='';
    document.getElementById('ma-from').value='';
    document.getElementById('ma-to').value='';
    document.getElementById('ma-until').value='';
    document.getElementById('ma-note').value='';
    document.getElementById('ma-err').style.display='none';
    document.getElementById('ma-del').style.display='none';
    document.getElementById('ma-for-note').style.display='none';
    ['av-yes','av-no'].forEach(id=>document.getElementById(id).className='av-btn');
    ['ma-sb-f','ma-sb-a','ma-sb-p'].forEach(id=>document.getElementById(id).className='slt-btn');
    this.onRepeatChange();
  },
  async save(){
    const id=document.getElementById('ma-id').value;
    const type=document.getElementById('ma-type').value;
    const slot=document.getElementById('ma-slot').value;
    const repeatMode=document.getElementById('ma-repeat').value;
    const note=document.getElementById('ma-note').value.trim();
    const err=document.getElementById('ma-err');
    err.style.display='none';
    if(!type){err.textContent='Please select Available or Unavailable.';err.style.display='block';return;}
    if(!slot){err.textContent='Please select a time slot.';err.style.display='block';return;}

    let startDate, endDate=null, repeatUntil=null;
    if(repeatMode==='range'){
      startDate=document.getElementById('ma-from').value;
      endDate=document.getElementById('ma-to').value;
      if(!startDate||!endDate){err.textContent='Please fill in both From and To dates.';err.style.display='block';return;}
      if(endDate<startDate){err.textContent='End date must be after start date.';err.style.display='block';return;}
    } else {
      startDate=document.getElementById('ma-date').value;
      if(!startDate){err.textContent='Please select a date.';err.style.display='block';return;}
      if(repeatMode==='weekly'||repeatMode==='monthly'){
        repeatUntil=document.getElementById('ma-until').value;
        if(!repeatUntil){err.textContent='Please select an end date for the repeat.';err.style.display='block';return;}
      }
    }

    const targetUid=document.getElementById('ma-for').value||App.user.uid;
    const u=Cache.users[targetUid]||App.user;
    Spin.on();
    try{
      const aid=id||U.uuid();
      const rule={id:aid,userId:targetUid,userName:u.name,userCountry:u.country||'',startDate,endDate,slot,type,repeatMode,repeatUntil,note,created:Date.now()};
      await fbSet(`availability/${aid}`,rule);
      Cache.availability[aid]=rule;
      M.close('m-avail');
      if(App.user?.role==='team_manager'){ Mgr.refresh(); } else { Cal.render(); }
      toast('Availability saved.');
    } catch(e){ toast('Save failed: '+e.message,'err'); }
    finally{ Spin.off(); }
  },
  async del(){
    const id=document.getElementById('ma-id').value;
    if(!id||!confirm('Delete this availability rule?')) return;
    Spin.on();
    try{
      await fbDel(`availability/${id}`);
      delete Cache.availability[id];
      M.close('m-avail');
      if(App.user?.role==='team_manager'){ Mgr.refresh(); } else { Cal.render(); }
      toast('Rule deleted.');
    } catch(e){ toast('Delete failed.','err'); }
    finally{ Spin.off(); }
  }
};

