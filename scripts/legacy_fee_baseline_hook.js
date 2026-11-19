// Regression diagnosis only: load the original report service/route and the
// original fee-flow test without changing any working-tree implementation.
const Module=require('node:module');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const targets=new Set(['src/admin/reports/reports.service.js','src/admin/reports/reports.routes.js','tests/merchant_fee_flow.test.js']);
const original=Module._extensions['.js'];
Module._extensions['.js']=(module,filename)=>{
  const relative=path.relative(root,filename).replaceAll('\\','/');
  if(!targets.has(relative)) return original(module,filename);
  const source=execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,'show',`9675112:${relative}`],{encoding:'utf8',windowsHide:true});
  module._compile(source,filename);
};
