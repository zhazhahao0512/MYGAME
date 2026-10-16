import { cp, mkdir, mkdtemp, readFile, writeFile, readdir, chmod, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const project=fileURLToPath(new URL('../',import.meta.url));
const output=join(project,'releases');await mkdir(output,{recursive:true});
const stage=await mkdtemp(join(tmpdir(),'mygame-package-'));
const folder=join(stage,'MYGAME-server');
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
const name=`MYGAME-server-${date}`;
const releaseId=process.env.MYGAME_RELEASE_ID||`manual-${Date.now()}`;
if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(releaseId))throw new Error('Invalid MYGAME_RELEASE_ID');
const commit=process.env.GITHUB_SHA||null;
async function files(dir) {
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if(entry.isDirectory())result.push(...await files(path));
    else if(entry.isFile())result.push(path);
    else throw new Error(`Unexpected non-regular file: ${path}`);
  }
  return result.sort();
}
try {
  await mkdir(folder);await cp(join(project,'dist'),join(folder,'dist'),{recursive:true});
  await readFile(join(folder,'dist/index.html'));
  for(const filename of ['server.mjs','start.sh','package.json','DEPLOY.md','mygame.service.example','nginx.conf.example'])await cp(join(project,'deploy',filename),join(folder,filename));
  const instructions=await readFile(join(folder,'DEPLOY.md'),'utf8');
  await writeFile(join(folder,'DEPLOY.md'),instructions.replaceAll('MYGAME-server-20261016',name));
  for(const path of await files(join(folder,'dist'))) {
    if(!/\.(js|css|html|json|svg)$/.test(path))continue;
    const content=await readFile(path);if(content.length<1024)continue;
    await writeFile(`${path}.gz`,gzipSync(content,{level:9}));
    await writeFile(`${path}.br`,brotliCompressSync(content,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}));
  }
  const licenses=join(folder,'licenses');await mkdir(licenses);
  await cp(join(project,'node_modules/phaser/LICENSE.md'),join(licenses,'phaser-MIT.txt'));
  await cp(join(project,'node_modules/eventemitter3/LICENSE'),join(licenses,'eventemitter3-MIT.txt'));
  const phaserSource=await readFile(join(project,'node_modules/phaser/dist/phaser.esm.js'),'utf8');
  const notices=[...new Set((phaserSource.match(/\/\*[\s\S]*?\*\//g)||[]).filter(comment=>/@license|copyright|permission is hereby|redistribution and use|licensed under|MIT license/i.test(comment)))];
  await writeFile(join(licenses,'phaser-embedded-notices.txt'),notices.join('\n\n'));
  const manifest=JSON.parse(await readFile(join(project,'package.json'),'utf8'));
  const phaser=JSON.parse(await readFile(join(project,'node_modules/phaser/package.json'),'utf8'));
  const events=JSON.parse(await readFile(join(project,'node_modules/eventemitter3/package.json'),'utf8'));
  await writeFile(join(folder,'VERSION.json'),JSON.stringify({name:'MYGAME',version:manifest.version,releaseId,commit,builtAt:new Date().toISOString(),minimumNode:'22.12.0',defaultPort:8080,dependencies:{phaser:phaser.version,eventemitter3:events.version},runtimeDependencies:[],buildNode:process.version},null,2)+'\n');
  const sums=[];
  for(const path of await files(folder)) {
    await chmod(path,path.endsWith('/start.sh')?0o755:0o644);
    sums.push(`${createHash('sha256').update(await readFile(path)).digest('hex')}  ${relative(folder,path).split('\\').join('/')}`);
  }
  await writeFile(join(folder,'SHA256SUMS'),sums.join('\n')+'\n');
  execFileSync('python3',['-c',[
    'import pathlib, sys, zipfile, tarfile, os',
    'folder=pathlib.Path(sys.argv[1]); output=pathlib.Path(sys.argv[2]); name=sys.argv[3]',
    'for root, dirs, files in os.walk(folder):',
    ' os.chmod(root, 0o755)',
    ' for f in files: os.chmod(pathlib.Path(root)/f, 0o755 if f=="start.sh" else 0o644)',
    'with zipfile.ZipFile(output/(name+".zip"), "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:',
    ' for path in sorted(folder.rglob("*")):',
    '  archive.write(path, path.relative_to(folder.parent))',
    'with tarfile.open(output/(name+".tar.gz"), "w:gz", compresslevel=9) as archive:',
    ' archive.add(folder, arcname=folder.name)',
  ].join('\n'),folder,output,name],{stdio:'inherit'});
  const archiveSums=[];
  for(const extension of ['.zip','.tar.gz']) {
    const filename=name+extension,data=await readFile(join(output,filename));
    archiveSums.push(`${createHash('sha256').update(data).digest('hex')}  ${filename}`);
    console.log(`${join(output,filename)} (${data.length} bytes)`);
  }
  await writeFile(join(output,`${name}.sha256`),archiveSums.join('\n')+'\n');
}finally{await rm(stage,{recursive:true,force:true});}
