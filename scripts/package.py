from pathlib import Path
import platform,subprocess,sys,shutil,urllib.request,hashlib,tarfile,zipfile,os,json
ROOT=Path(__file__).resolve().parent.parent
system='win32' if sys.platform=='win32' else 'darwin' if sys.platform=='darwin' else sys.platform
arch=subprocess.check_output(['node','-p','process.arch'],text=True).strip()
if (system,arch) not in [('darwin','arm64'),('darwin','x64'),('win32','x64')]:raise SystemExit('Unsupported release target')
label=('windows' if system=='win32' else 'macos')+'-'+arch;version='24.15.0';cache=ROOT/'.cache';cache.mkdir(exist_ok=True)
archive=f'node-v{version}-'+('win-'+arch+'.zip' if system=='win32' else f'darwin-{arch}.tar.gz')
def download(name):
 target=cache/name
 if not target.exists():
  with urllib.request.urlopen(f'https://nodejs.org/dist/v{version}/{name}',timeout=90) as r:target.write_bytes(r.read())
 return target
checks=download('SHASUMS256.txt').read_text();expected=next(l.split()[0] for l in checks.splitlines() if l.split()[-1]==archive);payload=download(archive)
assert hashlib.sha256(payload.read_bytes()).hexdigest()==expected,'Node.js checksum mismatch'
extract=cache/label;extract.mkdir(exist_ok=True)
if system=='win32':
 with zipfile.ZipFile(payload) as z:z.extractall(extract)
else:
 with tarfile.open(payload) as t:t.extractall(extract,filter='data')
nodeRoot=next(p for p in extract.iterdir() if p.is_dir())
out=ROOT/'dist'/f'md-rag-{label}';assert not out.exists(), 'Clean dist before packaging';out.mkdir(parents=True)
for name in ['src','public','native']:shutil.copytree(ROOT/name,out/name)
(out/'scripts').mkdir();shutil.copy(ROOT/'scripts/portable-control.mjs',out/'scripts/portable-control.mjs');(out/'data').mkdir()
for name in ['package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md']:shutil.copy(ROOT/name,out/name)
(out/'.env').write_text('ZVEC_PORT=7789\n')
shutil.copytree(ROOT/'node_modules',out/'node_modules',symlinks=True)
if system=='win32':
 (out/'runtime').mkdir();shutil.copy(nodeRoot/'node.exe',out/'runtime/node.exe');shutil.copy(nodeRoot/'LICENSE',out/'runtime/LICENSE.node.txt')
 for p in ROOT.glob('*.cmd'):shutil.copy(p,out/p.name)
else:
 (out/'runtime/bin').mkdir(parents=True);shutil.copy2(nodeRoot/'bin/node',out/'runtime/bin/node');shutil.copy(nodeRoot/'LICENSE',out/'runtime/LICENSE.node.txt')
 subprocess.run(['swiftc','-O','-target',('arm64' if arch=='arm64' else 'x86_64')+'-apple-macosx13.0',str(ROOT/'native/ChooseSource.swift'),'-o',str(out/'native/ChooseSource')],check=True)
 for p in ROOT.glob('*.command'):shutil.copy2(p,out/p.name);(out/p.name).chmod(0o755)
# Test exactly the packaged runtime, native engine and launcher before creating an archive.
subprocess.run(['node',str(ROOT/'tests/smoke.mjs'),str(out)],check=True)
target=ROOT/'dist'/f'md-rag-{label}.zip'
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in [out]+sorted(out.rglob('*')):
  if p.is_symlink():raise RuntimeError('Unexpected dependency symlink; ship resolved files')
  z.write(p,p.relative_to(out.parent).as_posix())
with zipfile.ZipFile(target) as z:
 assert z.testzip() is None
 assert not any(n.startswith(out.name+'/data/') and n!=out.name+'/data/' for n in z.namelist())
(rootHash:=ROOT/'dist'/f'md-rag-{label}.sha256').write_text(hashlib.sha256(target.read_bytes()).hexdigest()+'  '+target.name+'\n')
print('Packaged and tested:',target.name)
