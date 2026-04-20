'use strict';
// ════════════════════════════════════
// IN-MEMORY CACHE
// ════════════════════════════════════
const Cache = {
  users:{}, clients:{}, entries:{}, availability:{}, documents:{},
  async loadAll(){
    const [u,c,e,a]=await Promise.all([fbGet('users'),fbGet('clients'),fbGet('entries'),fbGet('availability')]);
    this.users=u||{}; this.clients=c||{}; this.entries=e||{}; this.availability=a||{};
    // Prime holiday cache from localStorage (no network)
    Hol._loadLS();
  },
  usersArr(){ return Object.values(this.users); },
  clientsArr(){ return Object.values(this.clients); },
  entriesArr(){ return Object.values(this.entries); },
  availArr(){ return Object.values(this.availability); },
  clientsFor(uid){ return this.clientsArr().filter(c=>(c.userIds||[]).includes(uid)); },
  availForUser(uid){ return this.availArr().filter(a=>a.userId===uid); },
  documentsFor(controllerUid){ return Object.values(this.documents[controllerUid]||{}); },
  async loadDocuments(controllerUid){
    const docs=await fbGet(`documents/${controllerUid}`);
    this.documents[controllerUid]=docs||{};
    return this.documentsFor(controllerUid);
  }
};

// ════════════════════════════════════
// ROLE HELPERS
// ════════════════════════════════════
// isBookable: users who appear on the timeline, in Off Day dropdowns, and in Reports.
// super_admin is treated as a bookable user so they can carry their own schedule.
function isBookable(u){ return (u.role==='controller'||u.role==='super_admin')&&u.active; }

