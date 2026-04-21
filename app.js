'use strict';
// ════════════════════════════════════
// IMPERSONATION (super_admin only)
// ════════════════════════════════════
// Allows the super_admin to view and operate the app exactly as another user.
// Activating it swaps App.user to the target profile. Since Firebase Auth
// stays as the super_admin, all security-rule checks still pass (the super_admin
// role allows writing any entry). Data written while impersonating carries the
// impersonated user's uid, which is the intended behaviour.
const Impersonate = {
  _realUser: null,   // original super_admin profile; non-null ⟺ impersonation is active

  active(){ return this._realUser !== null; },

  // Open the user-picker modal (admin screen only).
  openPicker(){
    const users = Cache.usersArr()
      .filter(u => u.uid !== App.user.uid && u.active && !u.pending)
      .sort((a,b) => (a.country||'').localeCompare(b.country||'') || a.name.localeCompare(b.name));

    const list = document.getElementById('imp-user-list');
    if(!users.length){
      list.innerHTML = '<p style="color:var(--txs);font-size:.85rem;padding:.5rem 0">No other active users found.</p>';
    } else {
      list.innerHTML = users.map(u =>
        `<button class="imp-user-btn" data-uid="${U.esc(u.uid)}">` +
          `<span class="imp-user-name">${U.esc(u.name)}</span>` +
          `<span class="imp-user-meta">${U.flag(u.country||'')} ${U.esc(u.country||'–')} · ${U.esc(u.role.replace('_',' '))}</span>` +
        `</button>`
      ).join('');
      list.querySelectorAll('.imp-user-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          M.close('m-impersonate');
          this.start(btn.dataset.uid);
        });
      });
    }
    M.open('m-impersonate');
  },

  // Begin impersonating the given uid.
  start(uid){
    const target = Cache.users[uid];
    if(!target){ toast('User not found','err'); return; }

    // Preserve the real super_admin
    this._realUser = App.user;
    // Switch global user context
    App.user = {...target};

    this._showBanner();

    // Navigate to the screen that matches the impersonated role
    if(target.role === 'super_admin')      { App._goAdmin();   }
    else if(target.role === 'team_manager'){ App._goManager(); }
    else                                   { App._goCalendar();}
  },

  // Stop impersonating and return to the admin dashboard.
  stop(){
    if(!this._realUser) return;
    App.user = this._realUser;
    this._realUser = null;
    this._hideBanner();
    // Restore the admin's avatar
    const u = App.user;
    ['hdr-avatar','adm-avatar'].forEach(id => {
      const img = document.getElementById(id);
      if(!img) return;
      if(u.photo){ img.src = u.photo; img.style.display = ''; }
      else        { img.style.display = 'none'; }
    });
    App._goAdmin();
  },

  _showBanner(){
    const u   = App.user;
    const lbl = document.getElementById('imp-bar-label');
    const roleLabel = u.role.replace('_', ' ');
    lbl.textContent = `👁 Viewing as ${u.name}${u.country ? ' · ' + u.country : ''} (${roleLabel})`;
    document.getElementById('imp-bar').classList.remove('d-none');
    document.body.classList.add('imp-active');
  },

  _hideBanner(){
    document.getElementById('imp-bar').classList.add('d-none');
    document.body.classList.remove('imp-active');
  },
};

// ════════════════════════════════════
// APP
// ════════════════════════════════════
const App = {
  user: null,
  _pendingDate: null,
  _driveToken: null,

  async init(){
       const embeddedCfg = typeof __FIREBASE_CONFIG__ !== 'undefined' ? __FIREBASE_CONFIG__ : null;
    const cfg = LS.getCfg() || embeddedCfg;
    if(!cfg){ show('setup'); return; }
    // Init Firebase
    fapp = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    fauth=firebase.auth();
    fdb=firebase.database();
    if(typeof firebase.storage === 'function') fstorage=firebase.storage();
    // Early RTDB connectivity check — surfaces a clear error within 5s if the
    // database is unreachable (not created, wrong URL, or network blocked).
    // Firebase's .info/connected is a WebSocket-based indicator; if it doesn't
    // fire true within 5 seconds the database endpoint is likely invalid.
    (function(){
      const dbUrl = cfg.databaseURL || '(missing databaseURL)';
      let seen = false;
      const timer = setTimeout(()=>{
        if(!seen){
          const err = document.getElementById('login-err');
          if(err){
            err.innerHTML = '<strong>Cannot reach Firebase database.</strong><br>URL: <code>'+U.esc(dbUrl)+'</code><br>Please verify this matches <em>Firebase Console → Realtime Database</em> and that the database has been created.';
            err.style.display = 'block';
          }
          log.error('[Coradam] RTDB unreachable after 5s. databaseURL:', dbUrl);
        }
      }, 5000);
      fdb.ref('.info/connected').on('value', snap=>{
        seen = true;
        clearTimeout(timer);
        log.info('[Coradam] RTDB connected:', snap.val(), '| databaseURL:', dbUrl);
        fdb.ref('.info/connected').off('value');
      });
    })();
    // Detect Freshbooks OAuth callback redirect
    const _fbParam=new URLSearchParams(window.location.search).get('fb');
    if(_fbParam) history.replaceState({},'',window.location.pathname);
    if(_fbParam==='connected') this._fbConnected=true;
    if(_fbParam==='error'){
      const _fbMsg=new URLSearchParams(window.location.search).get('msg')||'Unknown error';
      this._fbError=_fbMsg;
    }
    show('login');
    // Listen for auth state
    fauth.onAuthStateChanged(async u=>{
      if(!u){ show('login'); return; }
      // Domain check
      const email=u.email||'';
      if(!email.endsWith('@'+ALLOWED_DOMAIN)){
        await fauth.signOut();
        const err=document.getElementById('login-err');
        err.innerHTML='<strong>Access denied.</strong> Only <strong>@coradam.com</strong> accounts are allowed.';
        err.style.display='block';
        return;
      }
      Spin.on();
      try{
        await Cache.loadAll();
        // Upsert user profile
        let profile=Cache.users[u.uid];
        if(!profile){
          // Check for pending pre-created profile matching this email
          const pending=Cache.usersArr().find(p=>p.pending&&p.email===email);
          if(pending){
            // Migrate pending profile to real UID
            // Preserve existing role from the pending record (never derive role client-side from email)
            profile={...pending,uid:u.uid,name:u.displayName||pending.name||email.split('@')[0],photo:u.photoURL||'',role:pending.role||'controller',pending:false,firstLogin:Date.now()};
            await fbSet(`users/${u.uid}`,profile);
            Cache.users[u.uid]=profile;
            // Clean up pending record and fix client assignments (best-effort — may fail if rules block it)
            try{
              await fbDel(`users/${pending.uid}`);
              delete Cache.users[pending.uid];
            } catch(e){ log.warn('Could not delete pending record (will be cleaned by admin):',e.message); }
            // Update client userIds that referenced the pending uid (super_admin will handle if this fails)
            try{
              for(const c of Cache.clientsArr()){
                if((c.userIds||[]).includes(pending.uid)){
                  const updated={...c,userIds:c.userIds.map(id=>id===pending.uid?u.uid:id)};
                  await fbSet(`clients/${c.id}`,updated); Cache.clients[c.id]=updated;
                }
              }
            } catch(e){ log.warn('Could not update client assignments:',e.message); }
          } else {
            // New profiles always start as 'controller'; super_admin role is set by the admin in Firebase
            profile={uid:u.uid,name:u.displayName||email.split('@')[0],email,photo:u.photoURL||'',country:'',role:'controller',active:true,firstLogin:Date.now()};
            await fbSet(`users/${u.uid}`,profile);
            Cache.users[u.uid]=profile;
          }
        } else {
          // Update only name/photo from Google — role is managed by admin, never overwritten here
          const upd={name:u.displayName||profile.name,photo:u.photoURL||profile.photo};
          await fbUpdate(`users/${u.uid}`,upd);
          const merged={...profile,...upd};
          Cache.users[u.uid]=merged; profile=merged;
        }
        this.user=profile;
        this._afterLogin();
      } catch(e){
        // Include error code when available (e.g. PERMISSION_DENIED, auth/unauthorized-domain)
        const code = e.code ? ' ['+e.code+']' : '';
        toast('Load error: '+e.message+code,'err');
        log.error('[Coradam] onAuthStateChanged error:', e);
      }
      finally{ Spin.off(); }
    });
  },

  _fbConnected: false,
  _fbError: null,

  _afterLogin(){
    const u=this.user;
    // Set avatar
    ['hdr-avatar','adm-avatar'].forEach(id=>{
      const img=document.getElementById(id);
      if(u.photo){ img.src=u.photo; img.style.display=''; } else img.style.display='none';
    });
    if(u.role==='super_admin'){ this._goAdmin(); }
    else if(u.role==='team_manager'){ this._goManager(); }
    else { this._goCalendar(); }
    // Show Freshbooks OAuth result toasts
    if(this._fbConnected){ this._fbConnected=false; setTimeout(()=>toast('Freshbooks connected! Go to Settings → Freshbooks to sync clients.','ok'),400); }
    if(this._fbError){ const m=this._fbError; this._fbError=null; setTimeout(()=>toast('Freshbooks error: '+m,'err'),400); }
  },

  _goCalendar(){
    const u=this.user;
    document.getElementById('hdr-cal-name').textContent=u.name+"'s Calendar";
    document.getElementById('hdr-cal-user').textContent=u.name;
    show('cal'); Cal.init();
  },

  _goAdmin(){
    show('adm'); Adm.init();
  },

  _goManager(){
    show('mgr'); Mgr.init();
  },

  goSettings(){
    const u=this.user;
    document.getElementById('set-admin-tabs').style.display=u.role==='super_admin'?'block':'none';
    // All roles can update their own country (super_admin uses it for the timeline grouping)
    document.getElementById('set-profile').style.display='block';
    document.getElementById('profile-country').value=u.country||'';
    if(u.role==='super_admin') Sett.tab('users');
    show('set');
  },

  goProfile(){ this.goSettings(); },

  goBack(){
    if(this.user?.role==='super_admin'){
      show('adm');
      // Re-render without resetting month/filters: Adm.init() would jump back to today.
      Adm._buildCountryBar(); Adm._fillFilterOpts(); Adm.applyFilters();
    } else if(this.user?.role==='team_manager'){
      show('mgr'); Mgr.init();
    } else{ show('cal'); }
  },

  goAdmin(){
    show('adm');
    Adm._buildCountryBar(); Adm._fillFilterOpts(); Adm.applyFilters();
  },

  async reload(){
    Spin.on();
    try{
      await Cache.loadAll();
      // Re-read current user profile
      if(this.user) this.user=Cache.users[this.user.uid]||this.user;
    } catch(e){ toast('Reload failed: '+e.message,'err'); }
    finally{ Spin.off(); }
  }
};

