const repo = process.argv[2];
const res = await fetch('https://api.github.com/repos/'+repo+'/git/trees/main?recursive=1', {headers:{'User-Agent':'node-cli'}});
const j = await res.json();
const paths = (j.tree||[]).filter(x=>x.type==='blob').map(x=>x.path);
const comps = paths.filter(p=>p.startsWith('src/content/') && /\.jsx?$/.test(p)).slice(0,10);
console.log(JSON.stringify(comps));
