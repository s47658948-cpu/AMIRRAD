import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const store = getStore({ name: "yanker-data", consistency: "strong" });

const now = () => Date.now();
const id = (p="id") => `${p}_${now()}_${crypto.randomBytes(5).toString("hex")}`;
const hash = s => crypto.createHash("sha256").update(String(s ?? "")).digest("hex");

async function read(key, fallback) {
  const v = await store.get(key, { type: "json" });
  return v ?? fallback;
}
async function write(key, value) {
  await store.setJSON(key, value);
  return value;
}

function cookies(req){
  const raw=req.headers.get("cookie")||"";
  return Object.fromEntries(raw.split(";").map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf("="); return i<0?[x,""]:[x.slice(0,i),decodeURIComponent(x.slice(i+1))];
  }));
}
async function session(req){
  const sid=cookies(req).yanker_session;
  if(!sid) return null;
  return await read(`session:${sid}`, null);
}
async function requireLogin(req){
  const s=await session(req);
  if(!s) throw new Error("ابتدا وارد حساب شوید.");
  return s;
}
function isAdmin(s){ return s && ["owner","admin","moderator"].includes(s.role); }
async function requireAdmin(req){
  const s=await requireLogin(req);
  if(!isAdmin(s)) throw new Error("دسترسی مدیریت ندارید.");
  return s;
}
function json(data,status=200,extra={}){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      ...extra
    }
  });
}
function cookie(name,value,maxAge=60*60*24*30){
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}
function clearCookie(name){ return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`; }

async function ensureData(){
  const users=await read("users",[]);
  if(!users.length){
    const username=(process.env.ADMIN_USERNAME||"owner").trim().toLowerCase();
    const password=process.env.ADMIN_PASSWORD||"Yanker@Admin#2026";
    users.push({id:id("usr"),username,displayName:"YANKER Owner",role:"owner",passwordHash:hash(password),createdAt:now()});
    await write("users",users);
  }
  await read("members",[]) || await write("members",[]);
  await read("requests",[]) || await write("requests",[]);
  await read("tickets",[]) || await write("tickets",[]);
  await read("announcements",[]) || await write("announcements",[]);
  await read("rules",[
    "داشتن سن شهری بالای ۷ سال",
    "داشتن سن واقعی بالای ۱۴ سال",
    "انجام حداقل ۳ کوئست روزانه",
    "حضور در کپچرهای روزانه",
    "احترام کامل به اعضا",
    "داشتن حداقل ۱۵ ساعت Play Time در هفته"
  ]) || await write("rules",[]);
}

async function loginUser(username,password){
  const users=await read("users",[]);
  const u=users.find(x=>x.username===String(username).trim().toLowerCase());
  if(!u || u.passwordHash!==hash(password)) throw new Error("نام کاربری یا رمز عبور اشتباه است.");
  const sid=crypto.randomBytes(32).toString("hex");
  await write(`session:${sid}`,{username:u.username,role:u.role,displayName:u.displayName,createdAt:now()});
  return {user:{username:u.username,displayName:u.displayName,role:u.role,createdAt:u.createdAt},sid};
}

function publicUser(u){return {id:u.id,username:u.username,displayName:u.displayName,role:u.role,createdAt:u.createdAt};}

async function handle(req){
  await ensureData();
  const url=new URL(req.url), action=url.searchParams.get("action")||"";
  const method=req.method.toUpperCase();
  const body=method==="GET"?{}:await req.json().catch(()=>({}));
  const s=await session(req);

  if(action==="health") return json({ok:true,service:"YANKER API"});
  if(action==="user-login" && method==="POST"){
    const r=await loginUser(body.username,body.password);
    return json(r,200,{"Set-Cookie":cookie("yanker_session",r.sid)});
  }
  if(action==="user-register" && method==="POST"){
    const username=String(body.username||"").trim().toLowerCase();
    const displayName=String(body.displayName||"").trim();
    const password=String(body.password||"");
    if(!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error("نام کاربری نامعتبر است.");
    if(password.length<6) throw new Error("رمز عبور حداقل ۶ کاراکتر باشد.");
    const users=await read("users",[]);
    if(users.some(u=>u.username===username)) throw new Error("این نام کاربری قبلاً ثبت شده است.");
    const u={id:id("usr"),username,displayName,role:"user",passwordHash:hash(password),createdAt:now()};
    users.push(u); await write("users",users);
    const sid=crypto.randomBytes(32).toString("hex");
    await write(`session:${sid}`,{username,role:"user",displayName,createdAt:now()});
    return json({user:publicUser(u)},200,{"Set-Cookie":cookie("yanker_session",sid)});
  }
  if(action==="logout"){
    const sid=cookies(req).yanker_session;
    if(sid) await store.delete(`session:${sid}`);
    return json({ok:true},200,{"Set-Cookie":clearCookie("yanker_session")});
  }

  if(action==="user-login" && method!=="POST") throw new Error("روش درخواست نامعتبر است.");
  if(!s) throw new Error("ابتدا وارد حساب شوید.");

  if(action==="members"){
    const members=await read("members",[]);
    return json({members:members.map(m=>({...m,status:m.status||"online"}))});
  }
  if(action==="requests"){
    const a=await requireAdmin(req);
    return json({requests:await read("requests",[])});
  }
  if(action==="my-status"){
    const username=String(body.username||url.searchParams.get("username")||s.username).toLowerCase();
    const requests=(await read("requests",[])).filter(r=>r.username===username);
    const members=(await read("members",[])).filter(m=>m.username===username);
    const member=members[0]||null;
    return json({requests,member});
  }

  if(action==="request" && method==="POST"){
    const username=s.username;
    const requests=await read("requests",[]);
    const pending=requests.find(r=>r.username===username && r.status==="pending");
    if(pending) throw new Error("یک درخواست در حال بررسی دارید.");
    const r={
      id:id("req"),username,name:String(body.name||s.displayName),discord:String(body.discord||"").trim(),
      cityAge:Number(body.cityAge),realAge:Number(body.realAge),playtime:Number(body.playtime),
      reason:String(body.reason||"").trim(),status:"pending",createdAt:now(),reviewedBy:null,reviewedAt:null
    };
    if(r.cityAge<7) throw new Error("سن شهری باید حداقل ۷ سال باشد.");
    if(r.realAge<14) throw new Error("سن واقعی باید حداقل ۱۴ سال باشد.");
    if(r.reason.length<15) throw new Error("دلیل عضویت را کامل‌تر بنویسید.");
    requests.unshift(r); await write("requests",requests);
    return json({request:r});
  }

  if(action==="review" && method==="POST"){
    const a=await requireAdmin(req);
    const requests=await read("requests",[]);
    const r=requests.find(x=>x.id===body.id);
    if(!r) throw new Error("درخواست پیدا نشد.");
    r.status=body.decision==="approve"?"approved":"rejected";
    r.reviewedBy=a.username; r.reviewedAt=now();
    await write("requests",requests);
    let members=await read("members",[]);
    if(r.status==="approved"){
      let m=members.find(x=>x.username===r.username);
      if(!m){
        m={id:id("mem"),username:r.username,name:r.name,rank:"Recruit",status:"online",joinedAt:now(),gender:r.gender||"male"};
        members.unshift(m);
      }
      r.memberId=m.id;
      await write("members",members);
    }
    return json({request:r,member:members.find(x=>x.username===r.username)||null});
  }

  if(action==="member-delete" && method==="POST"){
    await requireAdmin(req);
    let members=await read("members",[]);
    members=members.filter(m=>m.id!==body.id);
    await write("members",members); return json({ok:true});
  }
  if(action==="member-rank" && method==="POST"){
    await requireAdmin(req);
    const members=await read("members",[]);
    const m=members.find(x=>x.id===body.id);
    if(!m) throw new Error("عضو پیدا نشد.");
    m.rank=String(body.rank||"Recruit"); await write("members",members);
    return json({member:m});
  }

  if(action==="announcements"){
    return json({announcements:await read("announcements",[])});
  }
  if(action==="announcement-create" && method==="POST"){
    const a=await requireAdmin(req);
    const list=await read("announcements",[]);
    const x={id:id("ann"),title:String(body.title||"").trim(),body:String(body.body||"").trim(),author:a.displayName||a.username,date:now(),published:true};
    list.unshift(x); await write("announcements",list); return json({announcement:x});
  }
  if(action==="announcement-update" && method==="POST"){
    await requireAdmin(req);
    const list=await read("announcements",[]), x=list.find(a=>a.id===body.id);
    if(!x) throw new Error("اطلاعیه پیدا نشد.");
    x.title=String(body.title||"").trim(); x.body=String(body.body||"").trim(); await write("announcements",list);
    return json({announcement:x});
  }
  if(action==="announcement-delete" && method==="POST"){
    await requireAdmin(req);
    await write("announcements",(await read("announcements",[])).filter(a=>a.id!==body.id));
    return json({ok:true});
  }

  if(action==="tickets"){
    const list=await read("tickets",[]);
    return json({tickets:list.filter(t=>t.username===s.username)});
  }
  if(action==="tickets-admin"){
    await requireAdmin(req); return json({tickets:await read("tickets",[])});
  }
  if(action==="ticket-create" && method==="POST"){
    const list=await read("tickets",[]);
    const last=list.filter(t=>t.username===s.username).sort((a,b)=>b.createdAt-a.createdAt)[0];
    if(last && now()-last.createdAt<10000) throw new Error("برای تیکت بعدی چند ثانیه صبر کنید.");
    const t={id:id("tic"),username:s.username,name:s.displayName,subject:String(body.subject||"").trim(),status:"open",createdAt:now(),updatedAt:now(),messages:[
      {id:id("msg"),sender:"user",senderName:s.displayName,body:String(body.message||"").trim(),createdAt:now()}
    ]};
    if(!t.subject || !t.messages[0].body) throw new Error("موضوع و پیام الزامی است.");
    list.unshift(t); await write("tickets",list); return json({ticket:t});
  }
  if(action==="ticket-create-admin" && method==="POST"){
    const a=await requireAdmin(req), list=await read("tickets",[]);
    const t={id:id("tic"),username:String(body.username),name:String(body.name||body.username),subject:String(body.subject||"").trim(),status:"answered",createdAt:now(),updatedAt:now(),messages:[
      {id:id("msg"),sender:"admin",senderName:a.displayName||a.username,body:String(body.message||"").trim(),createdAt:now()}
    ]};
    list.unshift(t); await write("tickets",list); return json({ticket:t});
  }
  if(action==="ticket-reply" && method==="POST"){
    const list=await read("tickets",[]), t=list.find(x=>x.id===body.id);
    if(!t) throw new Error("تیکت پیدا نشد.");
    const admin=isAdmin(s);
    if(!admin && t.username!==s.username) throw new Error("دسترسی به این تیکت ندارید.");
    if(t.status==="closed") throw new Error("این تیکت بسته شده است.");
    const msg=String(body.message||"").trim(); if(!msg) throw new Error("پیام خالی است.");
    t.messages.push({id:id("msg"),sender:admin?"admin":"user",senderName:admin?(s.displayName||s.username):(s.displayName||s.username),body:msg,createdAt:now()});
    t.status=admin?"answered":"open"; t.updatedAt=now();
    await write("tickets",list); return json({ticket:t});
  }
  if(action==="ticket-close-own" && method==="POST"){
    const list=await read("tickets",[]), t=list.find(x=>x.id===body.id && x.username===s.username);
    if(!t) throw new Error("تیکت پیدا نشد."); t.status="closed"; t.updatedAt=now(); await write("tickets",list); return json({ticket:t});
  }
  if(action==="ticket-close" && method==="POST"){
    await requireAdmin(req);
    const list=await read("tickets",[]), t=list.find(x=>x.id===body.id);
    if(!t) throw new Error("تیکت پیدا نشد."); t.status="closed"; t.updatedAt=now(); await write("tickets",list); return json({ticket:t});
  }
  if(action==="ticket-delete" && method==="POST"){
    await requireAdmin(req);
    await write("tickets",(await read("tickets",[])).filter(t=>t.id!==body.id)); return json({ok:true});
  }

  if(action==="rules"){
    return json({rules:await read("rules",[])});
  }
  if(action==="rules-save" && method==="POST"){
    await requireAdmin(req); await write("rules",Array.isArray(body.rules)?body.rules:[]); return json({rules:await read("rules",[])});
  }

  if(action==="users"){
    await requireAdmin(req); return json({users:(await read("users",[])).map(publicUser)});
  }
  if(action==="user-role" && method==="POST"){
    await requireAdmin(req);
    const users=await read("users",[]), u=users.find(x=>x.id===body.id);
    if(!u) throw new Error("کاربر پیدا نشد.");
    u.role=body.role; await write("users",users); return json({user:publicUser(u)});
  }

  throw new Error("action ناشناخته است.");
}

export default async (req) => {
  try { return await handle(req); }
  catch(e){ return json({error:e.message||"خطای سرور"},400); }
};
