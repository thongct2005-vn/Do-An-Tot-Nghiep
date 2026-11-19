// Local acceptance host: real report middleware/routes plus a Flutter artifact.
// No background jobs; only a newly-created test database is allowed.
const path=require('node:path');
const fs=require('node:fs');
const Module=require('node:module');
if(process.env.NODE_ENV!=='test' || !/^merchant_test_/.test(process.env.DB_NAME || '')) throw Error('Isolated test database required');
const express=require('express');
const app=express();
let routes;
if(process.env.REPORT_RELEASE==='before') {
  const origin=path.resolve(__dirname,'../src/admin/reports');
  const load=(name,override)=>{
    const filename=path.join(origin,name),module=new Module(filename);
    module.filename=filename;module.paths=Module._nodeModulePaths(origin);
    const localRequire=Module.createRequire(filename);
    module.require=id=>id==='./reports.service' && override?override:localRequire(id);
    module._compile(fs.readFileSync(path.join(process.env.REPORT_BASELINE_DIR,name),'utf8'),filename);
    return module.exports;
  };
  routes=load('reports.routes.js',load('reports.service.js'));
}else routes=require('../src/admin/reports/reports.routes');
app.use('/api/v2/admin/reports',routes);
app.use(express.static(process.env.REPORT_FRONTEND_DIR));
app.use((error,req,res,next)=>res.status(error.statusCode || 500).json({message:error.message}));
const server=app.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
process.on('message',async message=>{if(message==='stop'){server.close(async()=>{await require('../src/config/database').end();process.exit(0);});}});
