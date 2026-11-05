const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pageHarness } = require('./helpers/ui-page-harness');
const turn = () => new Promise(resolve => setImmediate(resolve));
const targets = () => ({category:'text',targets:['epub','docx']});
const ok = () => ({status:200,body:{fileName:'book.epub',downloadUrl:'/downloads/11111111-1111-4111-8111-111111111111'}});

test('EPUB source encoding defaults to strict auto, keeps language choice and resets for new files', async () => {
  const page=await pageHarness(ok,{}, {targets});
  assert.equal(page.find('#textEncodingField')?.hidden,true);
  await page.select(['book.txt']);assert.equal(page.find('#textEncodingField').hidden,false);
  assert.equal(page.find('#textEncoding').value,'auto');
  assert.deepEqual(page.find('#textEncoding').options.map(option=>option.value),['auto','utf-8','gb18030','utf-16le','utf-16be']);
  page.find('#textEncoding').value='gb18030';
  const language=page.find('#languageSelect');language.value='zh-CN';await language.dispatch('change');
  assert.equal(page.find('#textEncoding').value,'gb18030');assert.equal(page.find('[data-i18n="textEncoding.label"]').textContent,'源文件编码');
  await page.select(['another.txt']);assert.equal(page.find('#textEncoding').value,'auto');
  await page.find('#clearButton').dispatch('click');assert.equal(page.find('#textEncodingField').hidden,true);
});

test('encoding is captured once for a converting batch and its control stays disabled until it ends', async () => {
  let release;const held=new Promise(resolve=>{release=resolve;});const encodings=[];
  const page=await pageHarness((_file,index,_url,form)=>{encodings.push(form.get('textEncoding'));return index===1?held:ok();},{},{targets});
  await page.select(['one.txt','two.md']);page.find('#textEncoding').value='gb18030';const pending=page.convert();await turn();
  assert.equal(page.find('#textEncoding').disabled,true);page.find('#textEncoding').value='utf-8';
  release(ok());await pending;assert.deepEqual(encodings,['gb18030','gb18030']);assert.equal(page.find('#textEncoding').disabled,false);
});

test('encoding is sent only for raw text EPUB inputs, including mixed book and text batches', async () => {
  const forms=[];const page=await pageHarness((file,_index,_url,form)=>{forms.push({name:file.name,encoding:form.get('textEncoding')});return ok();},{},{targets});
  for(const ext of ['txt','md','markdown','html','htm','json','log','xml','yaml','yml','csv','tsv']){
    await page.select(['book.'+ext]);assert.equal(page.find('#textEncodingField').hidden,false,ext);
    page.find('#textEncoding').value='utf-16be';await page.convert();assert.equal(forms.at(-1).encoding,'utf-16be',ext);
  }
  await page.select(['book.txt']);page.find('#targetSelect').value='docx';await page.find('#targetSelect').dispatch('change');
  assert.equal(page.find('#textEncodingField').hidden,true);await page.convert();assert.equal(forms.at(-1).encoding,null);
  await page.select(['book.mobi']);page.find('#targetSelect').value='epub';await page.find('#targetSelect').dispatch('change');
  assert.equal(page.find('#textEncodingField').hidden,true);await page.convert();assert.equal(forms.at(-1).encoding,null);
  await page.select(['book.mobi','book.txt']);page.find('#targetSelect').value='epub';await page.find('#targetSelect').dispatch('change');
  assert.equal(page.find('#textEncodingField').hidden,false);page.find('#textEncoding').value='gb18030';await page.convert();
  assert.deepEqual(forms.slice(-2),[{name:'book.mobi',encoding:null},{name:'book.txt',encoding:'gb18030'}]);
});

test('strict auto decoding error stays explicit and encoding can be corrected before retry', async () => {
  const encodings=[];const page=await pageHarness((_file,_index,_url,form)=>{const encoding=form.get('textEncoding');encodings.push(encoding);return encoding==='auto'?{status:422,body:{errorCode:'TEXT_ENCODING_REQUIRED',error:'Choose the source encoding.',messages:{enUS:'Choose the source encoding.',zhCN:'请选择源文件编码。'}}}:ok();},{},{targets});
  await page.select(['gbk.txt']);await page.convert();assert.equal(encodings[0],'auto');
  assert.match(page.find('#batchList').textContent,/TEXT_ENCODING_REQUIRED/);assert.equal(page.find('#downloadButton').hidden,true);assert.equal(page.find('#textEncoding').disabled,false);
  page.find('#textEncoding').value='gb18030';await page.convert();assert.deepEqual(encodings,['auto','gb18030']);assert.equal(page.find('#downloadButton').hidden,false);
});
