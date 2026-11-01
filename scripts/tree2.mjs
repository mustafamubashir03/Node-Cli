const repo = process.argv[2];
const res = await fetch('https://api.github.com/repos/'+repo+'/git/trees/main?recursive=1', {headers:{'User-Agent':'node-cli'}});
const j = await res.json();
const paths = (j.tree||[]).filter(x=>x.type==='blob').map(x=>x.path);
// top-level dirs
const dirs = new Set(paths.map(p=>p.split('/')[0]));
console.log('TOPDIRS:', [...dirs]);
// src subdirs
const srcDirs = new Set(paths.filter(p=>p.startsWith('src/')).map(p=>p.split('/').slice(0,2).join('/')));
console.log('SRC:', [...srcDirs].slice(0,40));
