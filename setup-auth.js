'use strict';
// ════════════════════════════════════
// SETUP
// ════════════════════════════════════
const Setup = {
  connect(){
    const raw=document.getElementById('setup-cfg').value.trim();
    const err=document.getElementById('setup-err');
    err.style.display='none';
    let cfg;
    try{
      // Strip optional JS variable assignment wrapper and trailing semicolon, then parse as strict JSON
      const clean=raw.replace(/^const\s+firebaseConfig\s*=\s*/,'').replace(/;?\s*$/,'');
      cfg = JSON.parse(clean);
    } catch{
      err.innerHTML='<strong>Invalid config.</strong> Paste the Firebase config as valid JSON — all keys must be in double quotes. It starts with <code>{</code> and ends with <code>}</code>.';
      err.style.display='block'; return;
    }
    if(!cfg.apiKey||!cfg.databaseURL){
      err.innerHTML='<strong>Config looks incomplete.</strong> Make sure it includes <code>apiKey</code> and <code>databaseURL</code>.';
      err.style.display='block'; return;
    }
    LS.setCfg(cfg);
    location.reload();
  },
  reset(){
    if(!confirm('Reset Firebase config? You will need to reconnect.')) return;
    LS.rm('acfg'); location.reload();
  }
};

// ════════════════════════════════════
// AUTH
// ════════════════════════════════════
const Auth = {
  async signIn(){
    const err=document.getElementById('login-err');
    err.style.display='none';
    try{
      const provider=new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({hd:ALLOWED_DOMAIN});
      // Request Drive.file scope for document upload feature
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      const result=await fauth.signInWithPopup(provider);
      // Store Google OAuth access token for Drive API calls
      if(result.credential) App._driveToken=result.credential.accessToken||null;
    } catch(e){
      log.error('Google sign-in failed:', e.code, e.message, e);
      if(e.code === 'auth/popup-closed-by-user') return;
      err.innerHTML = 'Sign-in failed: ' + U.esc(e.message);
      err.style.display = 'block';
    }
  },
  async signOut(){
    await fauth.signOut();
    App.user=null;
    show('login');
  }
};

