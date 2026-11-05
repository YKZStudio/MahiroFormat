const sessionFetch = require("./helpers/authenticated-fetch");
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createBudgetedUpload, availableDiskBytes } = require("../src/upload-budget");

async function fixture(t, options={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"fm-upload-budget-"));
  const app=express();
  const upload=createBudgetedUpload({directory:root,reserveBytes:100,readFreeBytes:()=>3100,maxFileBytes:2000,...options});
  app.post("/upload",upload.array("files"),(req,res)=>res.json(req.files.map(file=>({name:file.originalname,size:file.size}))));
  app.use((error,_req,res,_next)=>res.status(413).json({errorCode:error.errorCode||error.code}));
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  return {root,url:`http://127.0.0.1:${server.address().port}/upload`};
}

test("upload streams enforce an aggregate disk budget before writing all batch files", async t=>{
  const {root,url}=await fixture(t);
  const form=new FormData();
  form.append("files",new Blob([Buffer.alloc(600)]),"a.bin");
  form.append("files",new Blob([Buffer.alloc(600)]),"b.bin");
  const response=await sessionFetch(url,{method:"POST",body:form});
  assert.equal(response.status,413);
  assert.equal((await response.json()).errorCode,"UPLOAD_DISK_BUDGET_EXCEEDED");
  assert.deepEqual(await fs.readdir(root),[],"both completed and partially written uploads must be removed");
});

test("budgeted uploads preserve every byte for admissible input", async t=>{
  const {root,url}=await fixture(t);
  const bytes=Buffer.from("中文原始内容\u0000\xff");
  const form=new FormData();form.append("files",new Blob([bytes]),"原文件.bin");
  const response=await sessionFetch(url,{method:"POST",body:form});
  assert.equal(response.status,200);
  const files=await fs.readdir(root);assert.equal(files.length,1);
  assert.deepEqual(await fs.readFile(path.join(root,files[0])),bytes);
});

test("no-space uploads reject without retaining partial files", async t=>{
  const {root,url}=await fixture(t,{readFreeBytes:()=>50});
  const form=new FormData();form.append("files",new Blob(["data"]),"a.bin");
  const response=await sessionFetch(url,{method:"POST",body:form});
  assert.equal(response.status,413);
  assert.deepEqual(await fs.readdir(root),[]);
});

test("Windows legacy Node disk probe reports space without statfs", {skip:process.platform!=="win32"},()=>{
  const current=availableDiskBytes(os.tmpdir());
  const legacy=availableDiskBytes(os.tmpdir(),{statfs:null});
  assert.ok(current>0 && legacy>0);
  assert.ok(Math.abs(current-legacy)<1024**3,"both probes address the same temporary volume");
});

test("an exclusive-open collision never deletes the pre-existing file", async t=>{
  const {root,url}=await fixture(t);
  const crypto=require('node:crypto');
  const original=crypto.randomBytes;
  const fixed=Buffer.alloc(16,1);
  const target=path.join(root,fixed.toString('hex'));
  await fs.writeFile(target,'existing owned fixture must survive');
  t.mock.method(crypto,'randomBytes',size=>size===16?Buffer.from(fixed):original(size));
  const form=new FormData();form.append('files',new Blob(['new input']),'a.bin');
  const response=await sessionFetch(url,{method:'POST',body:form});
  assert.equal(response.status,413);
  assert.equal((await response.json()).errorCode,'EEXIST');
  assert.equal(await fs.readFile(target,'utf8'),'existing owned fixture must survive');
});
