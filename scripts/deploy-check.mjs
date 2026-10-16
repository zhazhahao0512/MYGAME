import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { chromium } from 'playwright-core';
const archive=resolve(process.argv[2]||'releases/MYGAME-server-20261016.zip');
const stage=await mkdtemp(join(tmpdir(),'mygame-deploy-check-'));
const extracted=join(stage,'folder with spaces');await mkdir(extracted);
execFileSync('python3',['-m','zipfile','-e',archive,extracted]);
const root=join(extracted,'MYGAME-server');
const port=Number(process.env.DEPLOY_TEST_PORT||5291),base=`http://127.0.0.1:${port}`;
let server,browser;
function raw(path,method='GET',headers={}) {
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method,headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});
    req.on('error',reject);req.end();
  });
}
async function start(args,env) {
  let output='';
  server=spawn('sh',[join(root,'start.sh'),...args],{cwd:tmpdir(),env:{...process.env,...env},stdio:'pipe'});
  server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
  let online=false;
  for(let i=0;i<80;i++) {
    if(server.exitCode!==null)throw new Error(output);
    try{if((await fetch(`${base}/_health`)).ok){online=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(online,output);assert.ok(output.includes(`127.0.0.1:${port}`),output);
}
async function stop(){if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');const [code]=await exited;assert.equal(code,0);}server=null;}
try {
  // Verify the actual archive contents, before adding a deliberate traversal fixture.
  execFileSync('sha256sum',['-c','SHA256SUMS'],{cwd:root,stdio:'pipe'});
  const entries=await readdir(root);assert.ok(!entries.includes('node_modules')&&!entries.includes('src')&&!entries.includes('.git'));
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));assert.equal(Object.keys(manifest.dependencies||{}).length,0);
  for(const value of ['0','65536','1.5','invalid']) {
    const result=spawnSync(process.execPath,[join(root,'server.mjs'),'--port',value],{encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/PORT must/);
  }
  await start([String(port)],{PORT:'invalid',HOST:'127.0.0.1'}); // CLI precedence and arbitrary cwd.
  const occupied=spawnSync(process.execPath,[join(root,'server.mjs'),'--port',String(port),'--host','127.0.0.1'],{encoding:'utf8',timeout:5000});
  assert.equal(occupied.status,1);assert.match(occupied.stderr,/EADDRINUSE/);
  const home=await raw('/');assert.equal(home.status,200);assert.match(home.headers['content-type'],/text\/html/);assert.equal(home.headers['cache-control'],'no-cache');
  const deployedVersion=await raw('/_version');
  const metadata=JSON.parse(await readFile(join(root,'VERSION.json'),'utf8'));
  assert.equal(deployedVersion.status,200);assert.equal(deployedVersion.headers['cache-control'],'no-store');
  assert.equal(JSON.parse(deployedVersion.body).releaseId,metadata.releaseId);assert.ok(metadata.releaseId);
  assert.equal(JSON.parse(deployedVersion.body).commit,metadata.commit);
  const html=home.body.toString(),entry=html.match(/src="([^\"]+\.js)"/)[1];
  const path=new URL(entry,base).pathname,original=await readFile(join(root,'dist',path.slice(1)));
  const plain=await raw(path);assert.equal(plain.status,200);assert.deepEqual(plain.body,original);assert.match(plain.headers['content-type'],/javascript/);assert.match(plain.headers['cache-control'],/immutable/);
  const gzip=await raw(path,'GET',{'Accept-Encoding':'gzip'});assert.equal(gzip.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(gzip.body),original);
  const br=await raw(path,'GET',{'Accept-Encoding':'br, gzip'});assert.equal(br.headers['content-encoding'],'br');assert.deepEqual(brotliDecompressSync(br.body),original);
  const identity=await raw(path,'GET',{'Accept-Encoding':'br;q=0,gzip;q=0'});assert.equal(identity.headers['content-encoding'],undefined);assert.deepEqual(identity.body,original);
  const denied=await raw(path,'GET',{'Accept-Encoding':'*;q=0,identity;q=0'});assert.equal(denied.status,406);
  const head=await raw(path,'HEAD',{'Accept-Encoding':'gzip'});assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),gzip.body.length);
  const cached=await raw(path,'GET',{'Accept-Encoding':'gzip','If-None-Match':gzip.headers.etag});assert.equal(cached.status,304);assert.equal(cached.body.length,0);
  assert.equal((await raw('/missing.js')).status,404);assert.equal((await raw('/server.mjs')).status,404);
  assert.equal((await raw('/.git/config')).status,403);assert.equal((await raw('/..%2fserver.mjs')).status,403);
  assert.equal((await raw('/%00')).status,400);assert.equal((await raw('/%ZZ')).status,400);
  const method=await raw('/','POST');assert.equal(method.status,405);assert.equal(method.headers.allow,'GET, HEAD');
  await writeFile(join(stage,'outside.txt'),'outside');await symlink(join(stage,'outside.txt'),join(root,'dist','escape.txt'));
  assert.equal((await raw('/escape.txt')).status,404);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],remote=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(/^https?:/.test(req.url())&&new URL(req.url()).origin!==base)remote.push(req.url());});
  await page.goto(base);await page.locator('[data-act="preview-menu"]').click();await page.locator('[data-page="battle"]').click();
  await page.waitForFunction(()=>Number(document.querySelector('#battle-canvas')?.dataset.tick)>125);
  assert.equal(await page.locator('canvas').count(),1);assert.equal(await page.locator('.unit-statuses').count(),5);
  await page.locator('[data-act="pause"]').click();const tick=await page.locator('#battle-canvas').getAttribute('data-tick');
  await page.waitForTimeout(250);assert.equal(await page.locator('#battle-canvas').getAttribute('data-tick'),tick);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[],'packaged game must not request a CDN or hosted backend');
  await browser.close();browser=null;await stop();
  await start([],{PORT:String(port),HOST:'127.0.0.1'});assert.equal((await raw('/_health')).status,200);await stop();
  const tarDir=join(stage,'tar');await mkdir(tarDir);execFileSync('tar',['-xzf',archive.replace(/\.zip$/,'.tar.gz'),'-C',tarDir]);
  execFileSync('sha256sum',['-c','SHA256SUMS'],{cwd:join(tarDir,'MYGAME-server'),stdio:'pipe'});
  console.log('Deployment checks passed: ZIP/tar checksums; isolated extraction without node_modules; CLI/env ports; arbitrary cwd; conflict/invalid-port failures; MIME, gzip/Brotli, HEAD/304; traversal protection; actual Phaser battle and pause; zero external HTTP requests.');
} finally {if(browser)await browser.close();await stop();await rm(stage,{recursive:true,force:true});}
