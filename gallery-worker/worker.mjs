const MAX=8*1024*1024;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const text=(v,n)=>String(v||'').trim().slice(0,n);
async function owner(request,env){
  let keys;try{keys=JSON.parse(env.GALLERY_UPLOAD_KEYS||'{}');}catch{return null;}
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  if(token.length<32||token.length>256)return null;
  const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const candidate=await digest(token);
  for(const [name,key] of Object.entries(keys)){if(typeof key!=='string'||key.length<32)continue;const expected=await digest(key);let diff=0;for(let i=0;i<32;i++)diff|=candidate[i]^expected[i];if(diff===0)return name;}
  return null;
}
function imageType(bytes){
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
  if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'image/webp';
  return '';
}
export default {async fetch(request,env){
  const origin=request.headers.get('Origin'),allowed=env.ALLOWED_ORIGIN||'https://danielgreuter.github.io';
  const cors=response=>{const headers=new Headers(response.headers);headers.set('Vary','Origin');headers.set('X-Content-Type-Options','nosniff');if(origin===allowed){headers.set('Access-Control-Allow-Origin',allowed);headers.set('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');headers.set('Access-Control-Allow-Headers','Authorization,Content-Type');}return new Response(response.body,{status:response.status,headers});};
  if(origin&&origin!==allowed)return cors(json({error:'Zugriff nicht erlaubt.'},403));
  if(request.method==='OPTIONS')return cors(new Response(null,{status:204}));
  if(!env.PHOTOS)return cors(json({error:'Fotospeicher noch nicht eingerichtet.'},503));
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path==='/profile'&&request.method==='GET'){
      const object=await env.PHOTOS.get('profile/current');
      return cors(json(object?{url:url.origin+'/profile/image?v='+encodeURIComponent(object.customMetadata.version),x:Number(object.customMetadata.x),y:Number(object.customMetadata.y)}:{url:null}));
    }
    if(path==='/profile/image'&&request.method==='GET'){
      const object=await env.PHOTOS.get('profile/current');if(!object)return cors(json({error:'Profilfoto nicht gefunden.'},404));
      return cors(new Response(object.body,{headers:{'Content-Type':object.httpMetadata.contentType,'Cache-Control':'no-cache','ETag':object.httpEtag}}));
    }
    if(path==='/photos'&&request.method==='GET'){
      const page=await env.PHOTOS.list({prefix:'photos/',limit:100,cursor:url.searchParams.get('cursor')||undefined,include:['customMetadata']});
      return cors(json({photos:page.objects.map(o=>({id:o.key.slice(7),...o.customMetadata,url:url.origin+'/photos/'+encodeURIComponent(o.key.slice(7)),uploadedAt:o.uploaded.toISOString()})),cursor:page.truncated?page.cursor:null}));
    }
    if(path.startsWith('/photos/')&&request.method==='GET'){
      const id=decodeURIComponent(path.slice(8));if(!/^\d{13}-[a-f0-9-]{36}$/.test(id))return cors(json({error:'Foto nicht gefunden.'},404));
      const object=await env.PHOTOS.get('photos/'+id);if(!object)return cors(json({error:'Foto nicht gefunden.'},404));
      return cors(new Response(object.body,{headers:{'Content-Type':object.httpMetadata.contentType,'Cache-Control':'no-cache','ETag':object.httpEtag}}));
    }
    if(!['POST','DELETE'].includes(request.method))return cors(json({error:'Nicht gefunden.'},404));
    const uploader=await owner(request,env);if(!uploader)return cors(json({error:'Upload-Schlüssel ungültig.'},401));
    if(path==='/profile'&&request.method==='POST'){
      if(Number(request.headers.get('Content-Length'))>1024)return cors(json({error:'Auswahl zu lang.'},413));
      const raw=await request.text();if(raw.length>1024)return cors(json({error:'Auswahl zu lang.'},413));
      let data;try{data=JSON.parse(raw);}catch{return cors(json({error:'Auswahl ungültig.'},400));}
      if(!data||!/^\d{13}-[a-f0-9-]{36}$/.test(data.id)||!Number.isFinite(data.x)||!Number.isFinite(data.y)||data.x<0||data.x>100||data.y<0||data.y>100)return cors(json({error:'Bildausschnitt ungültig.'},400));
      const source=await env.PHOTOS.get('photos/'+data.id);if(!source)return cors(json({error:'Foto nicht gefunden.'},404));
      const version=crypto.randomUUID();await env.PHOTOS.put('profile/current',source.body,{httpMetadata:source.httpMetadata,customMetadata:{x:String(data.x),y:String(data.y),version}});
      return cors(json({url:url.origin+'/profile/image?v='+version,x:data.x,y:data.y}));
    }
    if(path==='/auth'&&request.method==='POST')return cors(json({name:uploader}));
    if(path==='/photos'&&request.method==='POST'){
      const declared=Number(request.headers.get('Content-Length'));if(declared>MAX)return cors(json({error:'Foto ist zu gross (max. 8 MB).'},413));
      const reader=request.body?.getReader();if(!reader)return cors(json({error:'Foto fehlt.'},400));let chunks=[],length=0;
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX){await reader.cancel();return cors(json({error:'Foto ist zu gross (max. 8 MB).'},413));}chunks.push(value);}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const type=imageType(bytes);if(!type)return cors(json({error:'Nur JPEG, PNG und WebP sind erlaubt.'},415));
      const date=text(url.searchParams.get('date'),10);if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))return cors(json({error:'Datum ungültig.'},400));
      const id=String(9999999999999-Date.now()).padStart(13,'0')+'-'+crypto.randomUUID();
      const meta={title:text(url.searchParams.get('title'),100),caption:text(url.searchParams.get('caption'),300),album:text(url.searchParams.get('album'),40)||'Momente',date};
      await env.PHOTOS.put('photos/'+id,bytes,{httpMetadata:{contentType:type},customMetadata:meta});return cors(json({photo:{id,...meta,url:url.origin+'/photos/'+id}},201));
    }
    if(path.startsWith('/photos/')&&request.method==='POST'){
      const id=decodeURIComponent(path.slice(8));if(!/^\d{13}-[a-f0-9-]{36}$/.test(id))return cors(json({error:'Foto nicht gefunden.'},404));
      const raw=await request.text();if(raw.length>4096)return cors(json({error:'Beschriftung zu lang.'},413));
      let data;try{data=JSON.parse(raw);}catch{return cors(json({error:'Beschriftung ungültig.'},400));}
      if(!data||typeof data!=='object'||Array.isArray(data))return cors(json({error:'Beschriftung ungültig.'},400));
      const date=text(data.date,10);if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))return cors(json({error:'Datum ungültig.'},400));
      const object=await env.PHOTOS.get('photos/'+id);if(!object)return cors(json({error:'Foto nicht gefunden.'},404));
      const meta={title:text(data.title,100),caption:text(data.caption,300),album:text(data.album,40)||'Momente',date};
      await env.PHOTOS.put('photos/'+id,object.body,{httpMetadata:object.httpMetadata,customMetadata:meta});
      return cors(json({photo:{id,...meta,url:url.origin+'/photos/'+id}}));
    }
    if(path.startsWith('/photos/')&&request.method==='DELETE'){
      const id=decodeURIComponent(path.slice(8));if(!/^\d{13}-[a-f0-9-]{36}$/.test(id))return cors(json({error:'Foto nicht gefunden.'},404));await env.PHOTOS.delete('photos/'+id);return cors(json({ok:true}));
    }
    return cors(json({error:'Nicht gefunden.'},404));
  }catch{return cors(json({error:'Anfrage fehlgeschlagen. Bitte erneut versuchen.'},500));}
}};
