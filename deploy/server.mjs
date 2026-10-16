#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname, sep, isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';

const usage='Usage: node server.mjs [--port 8080] [--host 0.0.0.0]\nEnvironment: PORT, HOST (command-line arguments take precedence).';
let portValue=process.env.PORT||'8080',host=process.env.HOST||'0.0.0.0';
for(let i=2;i<process.argv.length;i++) {
  const arg=process.argv[i];
  if(arg==='--help'||arg==='-h'){console.log(usage);process.exit(0);}
  if(!['--port','--host'].includes(arg)||!process.argv[i+1]||process.argv[i+1].startsWith('--')){console.error(usage);process.exit(1);}
  const value=process.argv[++i];if(arg==='--port')portValue=value;else host=value;
}
if(!/^\d+$/.test(portValue)||Number(portValue)<1||Number(portValue)>65535){console.error('PORT must be an integer from 1 to 65535.');process.exit(1);}
const port=Number(portValue);
let version={name:'MYGAME',releaseId:'legacy'};
try {
  const metadata=JSON.parse(await readFile(new URL('./VERSION.json',import.meta.url),'utf8'));
  version={name:'MYGAME',version:metadata.version,releaseId:metadata.releaseId,commit:metadata.commit,builtAt:metadata.builtAt};
}catch(error){if(error.code!=='ENOENT')throw error;}
let root;
try {
  root=await realpath(fileURLToPath(new URL('./dist/',import.meta.url)));
  if(!(await stat(resolve(root,'index.html'))).isFile())throw new Error('missing index');
}catch{console.error('Missing dist/index.html. Extract the complete MYGAME deployment package.');process.exit(1);}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.wasm':'application/wasm','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.txt':'text/plain; charset=utf-8'};
const withinRoot=path=>{const rel=relative(root,path);return rel!== '..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);};
async function asset(path) {
  try {
    const canonical=await realpath(path);
    if(!withinRoot(canonical))return null;
    const info=await stat(canonical);return info.isFile()?{path:canonical,info}:null;
  }catch(error){if(['ENOENT','ENOTDIR','EACCES'].includes(error.code))return null;throw error;}
}
function encodings(header='') {
  const values=new Map();
  for(const part of header.toLowerCase().split(',')) {
    const [name,...params]=part.trim().split(';');if(!name)continue;
    const param=params.map(p=>p.trim()).find(p=>p.startsWith('q='));
    const q=param?Number(param.slice(2)):1;values.set(name,Number.isFinite(q)&&q>=0&&q<=1?q:0);
  }
  const weight=name=>values.get(name)??(name==='identity'?(values.get('*')===0?0:1):(values.get('*')??0));
  return ['br','gzip','identity'].map(name=>({name,q:weight(name)})).filter(e=>e.q>0).sort((a,b)=>b.q-a.q);
}
const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  function reply(status,body,headers={}) {
    const bytes=Buffer.from(body);res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Length':bytes.length,...headers});
    res.end(req.method==='HEAD'?undefined:bytes);
  }
  try {
    if(!['GET','HEAD'].includes(req.method)){reply(405,'Method not allowed\n',{'Allow':'GET, HEAD'});return;}
    let pathname;
    try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{reply(400,'Bad request\n');return;}
    if(pathname.includes('\0')||pathname.includes('\\')){reply(400,'Bad request\n');return;}
    if(pathname.split('/').some(part=>part.startsWith('.'))){reply(403,'Forbidden\n');return;}
    if(pathname==='/_health'){reply(200,'{"status":"ok"}\n',{'Content-Type':'application/json; charset=utf-8'});return;}
    if(pathname==='/_version'){reply(200,JSON.stringify(version)+'\n',{'Content-Type':'application/json; charset=utf-8'});return;}
    const file=resolve(root,`.${pathname.endsWith('/')?pathname+'index.html':pathname}`);
    if(!withinRoot(file)){reply(403,'Forbidden\n');return;}
    const original=await asset(file);if(!original){reply(404,'Not found\n');return;}
    let selected;
    for(const {name} of encodings(req.headers['accept-encoding'])) {
      const candidate=name==='identity'?original:await asset(`${file}.${name==='br'?'br':'gz'}`);
      if(candidate){selected={...candidate,encoding:name};break;}
    }
    res.setHeader('Vary','Accept-Encoding');
    if(!selected){reply(406,'No acceptable encoding\n');return;}
    const etag=`W/"${selected.info.size.toString(16)}-${Math.trunc(selected.info.mtimeMs).toString(16)}-${selected.encoding}"`;
    const immutable=pathname.startsWith('/assets/')&&/-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(pathname);
    res.setHeader('Content-Type',mime[extname(file).toLowerCase()]||'application/octet-stream');
    res.setHeader('Cache-Control',immutable?'public, max-age=31536000, immutable':'no-cache');
    res.setHeader('ETag',etag);
    if(selected.encoding!=='identity')res.setHeader('Content-Encoding',selected.encoding);
    if(req.headers['if-none-match']?.split(',').map(x=>x.trim()).some(x=>x===etag||x==='*')){res.writeHead(304);res.end();return;}
    res.setHeader('Content-Length',selected.info.size);
    res.writeHead(200);
    if(req.method==='HEAD'){res.end();return;}
    await pipeline(createReadStream(selected.path),res);
  }catch(error) {
    if(error.code==='ERR_STREAM_PREMATURE_CLOSE'||req.destroyed)return;
    console.error('Request failed:',error.code||error.message);
    if(!res.headersSent)reply(500,'Internal server error\n');else res.destroy();
  }
});
server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
server.on('error',error=>{console.error(`Unable to listen on ${host}:${port}: ${error.code||error.message}`);process.exit(1);});
server.listen(port,host,()=>console.log(`MYGAME listening on ${host}:${port} (health: /_health)`));
function stop(){server.close(()=>process.exit(0));server.closeIdleConnections();setTimeout(()=>process.exit(1),10000).unref();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
