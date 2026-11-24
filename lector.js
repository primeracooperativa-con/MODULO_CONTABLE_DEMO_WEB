import {interpretarComprobante,numberValue} from './interpretar.mjs';
const $=id=>document.getElementById(id), h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sectors=['Empaque','Frío','Administración','Limpieza','Librería','Taller Interno','Taller Externo'];
const categories=['GEN-REP · Repuestos','GEN-LUB · Lubricantes','GEN-ELE · Electricidad','GEN-REF · Refrigeración','GEN-CON · Consumibles','GEN-LIM · Limpieza','GEN-QUI · Químicos','GEN-MAN · Mantenimiento','GEN-OTR · Otros materiales'];
let current=null, selected=null, previewURL=null, busy=false;
const demoText=`PINTURERÍA FICTICIA DEL SUR · DOCUMENTO DEMO SIN VALIDEZ FISCAL\nA FACTURA Fecha 12/11/2026\nPto. Venta 0003    Cpbte Nro: 00000127\nCuit 20999999999\nCliente: COOPERATIVA DEMO - NO REAL\nContado\nCódigo Cantidad Med Detalle Precio Bonifica Importe\nR1 2.00 UNI RODAMIENTO FICTICIO 6205 5,000.00 10,000.00\nP2 1.00 UNI PINCEL DE PRUEBA 2,000.00 2,000.00\nNeto 12,000.00\nIVA 2,520.00\nTOTAL 14,520.00\nDEMO · SIN VALIDEZ FISCAL`;
function status(msg,mode=''){const el=$('status');el.className='notice '+mode;el.textContent=msg;}
function prog(p){$('progress').classList.remove('hidden');$('progress').value=p;}
function readyFile(file){if(!file)return; if(file.size>15*1024*1024){status('El archivo supera 15 MB. Probá otro.','error');return;}
  if(!(/\.pdf$/i.test(file.name)||/image\/(jpeg|png|webp)/i.test(file.type))){status('Formato no permitido. Usá PDF, JPG, PNG o WEBP.','error');return;}
  selected=file;current=null;$('form').classList.add('hidden');$('intro').classList.remove('hidden');$('fileLabel').textContent=`${file.name} · ${(file.size/1024).toFixed(1)} KB`;$('read').disabled=false;$('reviewBadge').textContent='SIN LEER';$('reviewBadge').className='pill warn';
  if(previewURL) URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(file);
  $('preview').replaceChildren();const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);const el=document.createElement(isPdf?'iframe':'img');el.src=previewURL;if(isPdf)el.title='Vista local del PDF';else el.alt='Vista del comprobante';$('preview').appendChild(el);$('pages').textContent='Vista local';status('Archivo seleccionado. Tocá «Leer automáticamente».');$('progress').classList.add('hidden');
}
$('pick').onclick=()=>$('file').click();$('file').onchange=e=>readyFile(e.target.files[0]);
for(const evt of ['dragenter','dragover']) $('drop').addEventListener(evt,e=>{e.preventDefault();$('drop').classList.add('drag');});
for(const evt of ['dragleave','drop']) $('drop').addEventListener(evt,e=>{e.preventDefault();$('drop').classList.remove('drag');});
$('drop').addEventListener('drop',e=>readyFile(e.dataTransfer.files[0]));
$('reset').onclick=()=>{if(busy)return;selected=null;current=null;$('file').value='';$('fileLabel').textContent='Ningún documento seleccionado';$('read').disabled=true;$('form').classList.add('hidden');$('intro').classList.remove('hidden');$('intro').textContent='Elegí un archivo o utilizá el ejemplo ficticio.';$('reviewBadge').textContent='SIN LEER';$('pages').textContent='';$('progress').classList.add('hidden');if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('preview').innerHTML='<span class="muted">Acá podrás comparar el documento con los datos interpretados.</span>';status('Se descartó la lectura anterior.');};
function loadScript(url,globalName){if(window[globalName])return Promise.resolve();return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.crossOrigin='anonymous';s.onload=()=>window[globalName]?resolve():reject(new Error('No se inicializó '+globalName));s.onerror=()=>reject(new Error('No se pudo cargar '+globalName+' desde Internet'));document.head.appendChild(s);});}
const pdfLibUrl='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const ocrLibUrl='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
async function getPdf(){await loadScript(pdfLibUrl,'pdfjsLib');window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';return window.pdfjsLib;}
async function makeOcrWorker(){await loadScript(ocrLibUrl,'Tesseract');return await window.Tesseract.createWorker('spa+eng',1,{logger:m=>{if(m.progress!=null)prog(Math.max(4,Math.min(95,Math.round(m.progress*100))));}});}
function groupPdfText(content){const items=content.items.filter(x=>typeof x.str==='string'&&x.str.trim()).map(x=>({s:x.str.trim(),x:x.transform[4],y:x.transform[5],w:x.width||0})).sort((a,b)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x);let rows=[];
  for(const item of items){let row=rows.find(r=>Math.abs(r.y-item.y)<=2);if(!row){row={y:item.y,its:[]};rows.push(row);}row.its.push(item);}
  rows.sort((a,b)=>b.y-a.y);
  return rows.map(row=>{let lastEnd=null;return row.its.sort((a,b)=>a.x-b.x).map(it=>{let spaces='';if(lastEnd!==null){const gap=it.x-lastEnd;spaces=gap>22?'     ':gap>4?'  ':gap>0?' ':'';}lastEnd=Math.max(it.x+it.w,lastEnd||0);return spaces+it.s;}).join('');}).join('\n');
}
async function ocrImages(list){const worker=await makeOcrWorker();let texts=[];try {for(let i=0;i<list.length;i++){status(`OCR: leyendo página ${i+1} de ${list.length}...`);const {data}=await worker.recognize(list[i]);texts.push(data.text||'');}}finally{await worker.terminate();}return texts.join('\n');}
async function readPdf(file){const pdfjs=await getPdf();const bytes=new Uint8Array(await file.arrayBuffer());const pdf=await pdfjs.getDocument({data:bytes}).promise;const texts=[];const scanPages=[];let pageCount=Math.min(pdf.numPages,6);
  for(let p=1;p<=pageCount;p++){
    status(`Leyendo texto digital, página ${p}/${pdf.numPages}...`);prog(p/pageCount*28);
    const page=await pdf.getPage(p), cont=await page.getTextContent();const text=groupPdfText(cont);texts.push(text);
    if(text.replace(/\s/g,'').length<50){ const view=page.getViewport({scale:2});const canvas=document.createElement('canvas');canvas.width=Math.round(view.width);canvas.height=Math.round(view.height);await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;scanPages.push(canvas);}
  }
  const digital=texts.join('\n');let scanned='';if(scanPages.length){status(`El PDF tiene ${scanPages.length} página(s) sin texto suficiente. Iniciando OCR...`);scanned=await ocrImages(scanPages);}
  return {text:digital+'\n'+scanned, method:scanPages.length?'PDF digital + OCR de páginas escaneadas':'Texto digital PDF',pages:pdf.numPages,truncated:pdf.numPages>pageCount};
}
async function improveImage(source){
 const bitmap=await createImageBitmap(source);
 const scale=Math.min(3,Math.max(1,1800/Math.max(bitmap.width,1)),3000/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');
 canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
 const img=ctx.getImageData(0,0,canvas.width,canvas.height);
 for(let i=0;i<img.data.length;i+=4){const gray=0.299*img.data[i]+0.587*img.data[i+1]+0.114*img.data[i+2];const g=Math.max(0,Math.min(255,(gray-128)*1.45+150));img.data[i]=img.data[i+1]=img.data[i+2]=g;img.data[i+3]=255;}
 ctx.putImageData(img,0,0);return canvas;
}
async function readImage(file){
 status('Iniciando OCR de la imagen...');
 const worker=await makeOcrWorker();
 try{
  const first=(await worker.recognize(file)).data;
  let data=first, retried=false;
  if(interpretarComprobante(first.text||'','imagen').articulos.length===0 || (first.confidence||0)<50){
    status('La foto necesita una segunda lectura: ampliando y mejorando contraste...');
    try{const canvas=await improveImage(file);const second=(await worker.recognize(canvas)).data;retried=true;
      const score=x=>interpretarComprobante(x.text||'','imagen').articulos.length*20+(x.text||'').length/40+(x.confidence||0)/10;
      if(score(second)>score(first))data=second;
    }catch(e){console.warn('No se pudo optimizar la imagen',e);}
  }
  return {text:data.text||'',method:retried?'OCR en imagen (dos lecturas)':'OCR en imagen',pages:1,truncated:false,confidence:data.confidence};
 }finally{await worker.terminate();}
}
$('read').onclick=async()=>{if(!selected||busy)return;busy=true;$('read').disabled=true;$('sample').disabled=true;prog(3);status('Preparando reconocimiento...');try{
  const isPdf=selected.type==='application/pdf'||/\.pdf$/i.test(selected.name);
  const output=isPdf?await readPdf(selected):await readImage(selected);
  if(!output.text.trim())throw new Error('No se reconoció texto en el archivo. Podés probar otra imagen más nítida.');
  current=interpretarComprobante(output.text,selected.name);current.metodo=output.method;current.paginas=output.pages;if(output.truncated)current.advertencias.push('Se procesaron solo las primeras 6 páginas de este PDF.');
  if(output.confidence!=null&&output.confidence<55)current.advertencias.push('Lectura OCR con baja confianza. Verificá cada dato contra la imagen.');
  render();
  if(current.articulos.length===0)status('Se reconoció texto, pero no se pudieron identificar artículos. Abrí «Ver texto extraído» y corregí los campos o agregá artículos.','warning');
  else status('Lectura terminada: '+current.articulos.length+' artículo(s). Revisá los datos contra la foto.','ok');prog(100);$('pages').textContent=`${output.pages} página(s) · ${output.method}`;
}catch(e){status('No se pudo completar la lectura: '+(e.message||e)+'. Revisá tu conexión a Internet, el formato y la nitidez.','error');$('progress').classList.add('hidden');}
finally{busy=false;$('read').disabled=!selected;$('sample').disabled=false;}
};
$('sample').onclick=()=>{if(busy)return;selected=null;$('read').disabled=true;$('file').value='';$('fileLabel').textContent='Ejemplo inventado (sin archivo)';if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('preview').innerHTML='<div class="muted" style="text-align:center;padding:24px">Ejemplo de texto ficticio incorporado.<br>No es una factura PDF.</div>';current=interpretarComprobante(demoText,'EJEMPLO_FICTICIO_INTERNO');current.metodo='Ejemplo de texto ficticio';render();status('Ejemplo ficticio cargado. Probá corregir campos y exportar el resultado.','ok');$('pages').textContent='Texto de ejemplo';};
const field=(key,label,wide=false)=>`<div class="${wide?'full':''}"><label for="f_${key}">${h(label)}</label><input id="f_${key}" data-field="${key}" value="${h(current[key]??'')}"></div>`;
const cash=(key,label)=>`<div><label>${h(label)} ($)</label><input inputmode="decimal" data-money="${key}" value="${current[key]==null?'':h(formatValue(current[key]))}" placeholder="No informado"></div>`;
function formatValue(x){return x==null?'':Number(x).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function choose(options,value='',placeholder='Seleccionar...'){return `<option value="">${h(placeholder)}</option>`+options.map(s=>`<option value="${h(s)}" ${value===s?'selected':''}>${h(s)}</option>`).join('');}
const types=['Factura','Remito','Ticket','Nota de crédito','Nota de débito','No determinado'];
function rowCard(item,i){return `<div class="rline"><div class="rhead"><strong>Artículo ${i+1}</strong><button class="btn sm" data-remove="${i}">Eliminar</button></div><div><label>Descripción original</label><input data-index="${i}" data-item="descripcion" value="${h(item.descripcion)}"></div><div class="fields3" style="margin-top:10px"><div><label>Cantidad</label><input data-index="${i}" data-itemnum="cantidad" inputmode="decimal" value="${h(item.cantidad??'')}"></div><div><label>Unidad</label><input data-index="${i}" data-item="unidad" value="${h(item.unidad)}"></div><div><label>Código del proveedor</label><input data-index="${i}" data-item="codigo_proveedor" value="${h(item.codigo_proveedor)}"></div></div><div class="fields" style="margin-top:10px"><div><label>Precio unitario ($)</label><input data-index="${i}" data-itemnum="precio_unitario" inputmode="decimal" value="${h(formatValue(item.precio_unitario))}" placeholder="No informado"></div><div><label>Importe ($)</label><input data-index="${i}" data-itemnum="importe" inputmode="decimal" value="${h(formatValue(item.importe))}" placeholder="No informado"></div></div><div class="fields" style="margin-top:10px"><div><label>Descuento % (si figura)</label><input data-index="${i}" data-itemnum="descuento_porcentaje" inputmode="decimal" value="${h(item.descuento_porcentaje??'')}" placeholder="No informado"></div><div><label>IVA % (si figura)</label><input data-index="${i}" data-itemnum="iva_porcentaje" inputmode="decimal" value="${h(item.iva_porcentaje??'')}" placeholder="No informado"></div></div><div class="fields" style="margin-top:10px"><div><label>Sector a confirmar</label><select data-index="${i}" data-item="sector">${choose(sectors,item.sector,'Sin asignar')}</select></div><div><label>Identificación del artículo</label><select data-index="${i}" data-item="identificacion">${choose(['Pendiente','Artículo confirmado','Coincidencia por verificar','Genérico provisional'],item.identificacion)}</select></div></div><div class="rubros ${item.identificacion==='Genérico provisional'?'':'hidden'}" data-rubro="${i}"><label>Rubro genérico provisional</label><select data-index="${i}" data-item="codigo_generico">${choose(categories,item.codigo_generico)}</select></div>${item.advertencia_ocr?`<div class="notice warning" style="margin-top:9px">${h(item.advertencia_ocr)}</div>`:''}<div class="actions" style="margin-top:11px"><button class="btn sm" data-calc="${i}">Calcular cantidad × precio</button></div></div>`;}
function render(){if(!current)return;$('intro').classList.add('hidden');$('form').classList.remove('hidden');$('reviewBadge').textContent=current.revisado_local?'REVISADO EN DEMO':'POR REVISAR';$('reviewBadge').className='pill '+(current.revisado_local?'':'warn');$('form').innerHTML=`<div class="section"><div class="sectiontitle"><h3>Identificación del comprobante</h3><span class="hint">${h(current.metodo)}</span></div><div class="fields"><div><label>Tipo</label><select data-field="tipo">${choose(types,current.tipo)}</select></div><div><label>Letra (si corresponde)</label><select data-field="letra">${choose(['A','B','C','M','E'],current.letra,'Sin letra')}</select></div>${field('numero','Número')}${field('fecha','Fecha (DD/MM/AAAA)')}${field('proveedor','Proveedor',true)}${field('cuit_proveedor','CUIT proveedor')}${field('cuit_comprador','CUIT cliente')}${field('identificacion_proveedor','Identificación proveedor (si no es CUIT)')}${field('identificacion_comprador','Identificación cliente (si no es CUIT)')}${field('condicion_venta','Condición de venta')}${field('cae','CAE (si figura)')}</div></div><div class="section"><div class="sectiontitle"><h3>Importes</h3><span class="hint">Si no figuran, dejalos vacíos</span></div><div class="fields3">${cash('subtotal_bruto','Subtotal bruto')}${cash('descuento_documento','Descuento documento')}${cash('neto','Neto gravado')}${cash('iva','IVA total')}${cash('percepcion_iibb','Percepción IIBB')}${cash('total','Total')}</div><div id="checks" class="recalc"></div></div><div class="section"><div class="sectiontitle"><h3>Artículos reconocidos · ${current.articulos.length}</h3><button class="btn sm" id="add">+ Agregar</button></div>${current.articulos.map(rowCard).join('')||'<div class="notice warning">No se detectaron renglones confiables. Agregalos manualmente si los hay.</div>'}</div><div class="section"><h3>Referencias (opcional)</h3><div class="fields">${field('referencia_operacion','Operación relacionada')}${field('referencia_comprobante','Comprobante vinculado')}</div></div><div class="section"><h3>Control y exportación</h3><div id="alerts"></div><div style="margin:12px 0"><label>Observaciones</label><textarea rows="2" id="notes" placeholder="Aclaraciones de la revisión">${h(current.observaciones)}</textarea></div><div class="actions"><button class="btn dark" id="approve">Marcar como revisado</button><button class="btn primary" id="exportJSON">Exportar JSON</button><button class="btn" id="exportCSV">Descargar CSV</button></div><p class="hint" style="margin-top:11px">Estos archivos se descargan localmente. No registran una compra, no crean stock y no se envían al ERP.</p><details><summary>Ver texto extraído</summary><pre>${h(current.texto_extraido)}</pre></details></div>`;validate();}
function validate(){if(!current)return;const w=[...current.advertencias];
  if(current.total!=null&&current.neto!=null){
    const estimated=current.neto+(current.iva||0)+(current.percepcion_iibb||0);
    const diff=Math.abs(estimated-current.total);
    $('checks').textContent=diff<=.06?'✓ Neto + IVA + percepciones coincide con el total (según conceptos detectados).':`⚠ La composición de importes difiere del total en $${formatValue(diff)}. Revisá descuentos y otros conceptos.`;
    $('checks').className='recalc '+(diff<=.06?'ok':'bad');
  }else{
    $('checks').textContent=current.tipo==='Remito'?'Remito: los importes comerciales pueden estar vacíos.':'No se puede comprobar toda la composición del total porque faltan conceptos. Revisá el documento.';
    $('checks').className='recalc';
  }
  if(current.articulos.some(a=>!a.sector))w.push('Uno o más artículos todavía no tienen sector confirmado.');
  if(current.articulos.some(a=>a.identificacion==='Genérico provisional'&&!a.codigo_generico))w.push('Hay artículos genéricos sin rubro asignado.');
  if(current.articulos.some(a=>a.importe!=null&&a.cantidad!=null&&a.precio_unitario!=null&&a.descuento_porcentaje!=null&&Math.abs(a.cantidad*a.precio_unitario*(1-a.descuento_porcentaje/100)-a.importe)>.08))w.push('Al menos un artículo tiene diferencia entre cantidad, precio, descuento e importe.');
  $('alerts').innerHTML=w.length?`<div class="notice warning" style="margin-top:10px"><b>Advertencias para revisar:</b><ul>${[...new Set(w)].map(x=>`<li>${h(x)}</li>`).join('')}</ul></div>`:'<div class="notice ok" style="margin-top:10px">Sin advertencias adicionales detectadas. Verificá visualmente el documento.</div>';
}
$('form').addEventListener('input',e=>{if(!current)return;const t=e.target; if(t.dataset.field!==undefined)current[t.dataset.field]=t.value;if(t.dataset.money!==undefined)current[t.dataset.money]=t.value.trim()?numberValue(t.value):null;const i=Number(t.dataset.index);if(t.dataset.item!==undefined && current.articulos[i]){current.articulos[i][t.dataset.item]=t.value;if(t.dataset.item==='identificacion')$('form').querySelector(`[data-rubro="${i}"]`)?.classList.toggle('hidden',t.value!=='Genérico provisional');}if(t.dataset.itemnum!==undefined && current.articulos[i])current.articulos[i][t.dataset.itemnum]=t.value.trim()?numberValue(t.value):null;if(t.id==='notes')current.observaciones=t.value;current.revisado_local=false;$('reviewBadge').textContent='POR REVISAR';$('reviewBadge').className='pill warn';validate();});
$('form').addEventListener('click',e=>{if(!current)return;const b=e.target.closest('button');if(!b)return;const i=Number(b.dataset.remove??b.dataset.calc);if(b.id==='add'){current.articulos.push({codigo_proveedor:'',cantidad:null,unidad:'',descripcion:'',precio_unitario:null,descuento_porcentaje:null,iva_porcentaje:null,importe:null,sector:'',identificacion:'Pendiente',codigo_generico:''});render();return;}if(b.dataset.remove!==undefined){current.articulos.splice(i,1);render();return;}if(b.dataset.calc!==undefined){const a=current.articulos[i];if(a.cantidad!=null&&a.precio_unitario!=null){a.importe=Math.round(a.cantidad*a.precio_unitario*(1-(a.descuento_porcentaje||0)/100)*100)/100;render();}else status('Faltan cantidad o precio unitario para calcular el importe.','warning');return;}if(b.id==='approve'){current.revisado_local=true;render();status('Marcado como revisado en esta pantalla. No fue enviado al ERP.','ok');return;}if(b.id==='exportJSON'){download('json');return;}if(b.id==='exportCSV'){download('csv');return;}});
function fileName(){return (current.numero||'sin_numero').replace(/[^a-zA-Z0-9-_]/g,'_');}
function download(fmt){const obj=structuredClone(current);delete obj.texto_extraido;obj.fecha_exportacion=new Date().toISOString();obj.ambiente='DEMO';obj.no_registra_stock=true;obj.no_contabiliza=true;let blob,name;
  if(fmt==='json'){blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json;charset=utf-8'});name=`lectura_${fileName()}.json`;}else{const cols=['tipo','letra','numero','fecha','proveedor','cuit_proveedor','cuit_comprador','identificacion_proveedor','identificacion_comprador','subtotal_bruto','descuento_documento','neto','iva','percepcion_iibb','total','referencia_operacion','referencia_comprobante','descripcion','cantidad','unidad','precio_unitario','descuento_porcentaje','iva_porcentaje','importe','sector','identificacion','codigo_generico'];const csv=[cols.join(';'),...(obj.articulos.length?obj.articulos:[{}]).map(r=>cols.map(k=>'"'+String((r[k]??obj[k]??'')).replace(/"/g,'""')+'"').join(';'))].join('\r\n');blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});name=`lectura_${fileName()}.csv`;}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Archivo exportado a tu computadora. No se envió al ERP.','ok');}
