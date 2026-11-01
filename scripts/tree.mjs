const repo = process.argv[2];
const res = await fetch('https://api.github.com/repos/'+repo+'/git/trees/main?recursive=1', {headers:{'User-Agent':'node-cli'}});
const j = await res.json();
const paths = (j.tree||[]).filter(x=>x.type==='blob').map(x=>x.path);
const filtered = paths.filter(p=>/component/i.test(p) || /src\/components/i.test(p)).slice(0,20);
console.log(JSON.stringify(filtered));
