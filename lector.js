import {interpretarComprobante,numberValue} from './interpretar_v10.mjs';
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
// OCR por zonas: cabecera, renglones y totales tienen estructuras distintas.
async function photoZone(file,a,b,style='gray'){
 const bitmap=await createImageBitmap(file);
 const top=Math.floor(bitmap.height*a),height=Math.max(1,Math.floor(bitmap.height*b)-top);
 const scale=Math.max(1,Math.min(3,2800/bitmap.width,2800/height));
 const w=Math.round(bitmap.width*scale),h=Math.round(height*scale);
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
 ctx.drawImage(bitmap,0,top,bitmap.width,height,0,0,w,h);bitmap.close?.();
 const img=ctx.getImageData(0,0,w,h),pix=img.data;
 if(style==='gray'){
  for(let i=0;i<pix.length;i+=4){const g=Math.round(.299*pix[i]+.587*pix[i+1]+.114*pix[i+2]);pix[i]=pix[i+1]=pix[i+2]=g;pix[i+3]=255;}
 }else if(style==='adaptive'){
  const gray=new Uint8Array(w*h),integral=new Float64Array((w+1)*(h+1));
  for(let y=0;y<h;y++){let sum=0;for(let x=0;x<w;x++){const i=y*w+x,k=i*4,g=Math.round(.299*pix[k]+.587*pix[k+1]+.114*pix[k+2]);gray[i]=g;sum+=g;integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+sum;}}
  const radius=Math.max(10,Math.round(14*scale/3));
  for(let y=0;y<h;y++){const ya=Math.max(0,y-radius),yb=Math.min(h-1,y+radius);for(let x=0;x<w;x++){
   const xa=Math.max(0,x-radius),xb=Math.min(w-1,x+radius),area=(xb-xa+1)*(yb-ya+1);
   const sum=integral[(yb+1)*(w+1)+xb+1]-integral[ya*(w+1)+xb+1]-integral[(yb+1)*(w+1)+xa]+integral[ya*(w+1)+xa];
   const g=gray[y*w+x]<sum/area-9?0:255,k=(y*w+x)*4;
   pix[k]=pix[k+1]=pix[k+2]=g;pix[k+3]=255;
  }}
 }
 ctx.putImageData(img,0,0);return canvas;
}
// Recorte de tabla con escala calculada sobre la region, no sobre la pagina completa.
async function photoTableZone(file,a,b){
 const bitmap=await createImageBitmap(file);
 const top=Math.floor(bitmap.height*a),height=Math.max(1,Math.floor(bitmap.height*b)-top);
 const scale=Math.min(2.2,2800/bitmap.width,2800/height);
 const width=Math.max(1,Math.round(bitmap.width*scale)),outHeight=Math.max(1,Math.round(height*scale));
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=outHeight;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='#fff';ctx.fillRect(0,0,width,outHeight);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(bitmap,0,top,bitmap.width,height,0,0,width,outHeight);bitmap.close?.();
 const image=ctx.getImageData(0,0,width,outHeight),pixels=image.data;
 for(let i=0;i<pixels.length;i+=4){const gray=Math.round(.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2]);pixels[i]=pixels[i+1]=pixels[i+2]=gray;pixels[i+3]=255;}
 ctx.putImageData(image,0,0);return canvas;
}
// Lectura estructural de tablas: separa las columnas cuando el OCR general pierde el orden.
async function photoColumnZone(file,xRatio,yRatio,wRatio,hRatio){
 const bitmap=await createImageBitmap(file);
 const x=Math.max(0,Math.floor(bitmap.width*xRatio)),y=Math.max(0,Math.floor(bitmap.height*yRatio));
 const w=Math.min(bitmap.width-x,Math.max(1,Math.floor(bitmap.width*wRatio)));
 const h=Math.min(bitmap.height-y,Math.max(1,Math.floor(bitmap.height*hRatio)));
 const scale=Math.max(1,Math.min(4,2400/w,2400/h));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,x,y,w,h,0,0,canvas.width,canvas.height);bitmap.close?.();
 const image=ctx.getImageData(0,0,canvas.width,canvas.height),pixels=image.data;
 for(let i=0;i<pixels.length;i+=4){const g=Math.round(.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2]);pixels[i]=pixels[i+1]=pixels[i+2]=g;pixels[i+3]=255;}
 ctx.putImageData(image,0,0);return canvas;
}
async function readRemitoColumns(file,worker){
 const specs={
  code:[85/1465,610/2047,110/1465,210/2047],
  qty:[245/1465,610/2047,70/1465,210/2047],
  unit:[405/1465,610/2047,90/1465,210/2047],
  desc:[565/1465,610/2047,450/1465,210/2047]
 };
 const read=async spec=>{
  const [x,y,w,h]=spec;
  await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
  const result=(await worker.recognize(await photoColumnZone(file,x,y,w,h))).data;
  return String(result.text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 };
 const codeRaw=await read(specs.code),qtyRaw=await read(specs.qty),unitRaw=await read(specs.unit),descRaw=await read(specs.desc);
 const codes=codeRaw.filter(x=>/^[A-Z0-9][A-Z0-9._/-]{1,20}$/i.test(x)&&/[A-Z]/i.test(x)&&!/^(CODIGO|COD|CANTIDAD|UNIDAD|DESCRIPCION)$/i.test(x));
 const quantities=qtyRaw.filter(x=>/^\d+(?:[.,]\d+)?$/.test(x)||/^[aIl]$/.test(x));
 const units=unitRaw.filter(x=>/^(?:unid(?:ad(?:es)?)?|uni|bolsa|rollo|pack|paq|bidon|caja|serv(?:icio)?|kg|g|lt|lts|ml|m|par|pares)$/i.test(x.normalize('NFD').replace(/[\u0300-\u036f]/g,'')));
 const descriptions=descRaw.filter(x=>x.length>=5&&!/^(?:unidad(?:es)?|descripci[oó]n|c[oó]digo)$/i.test(x)&&!/^(?:unid|cantidad)$/i.test(x));
 if(codes.length<2||codes.length!==descriptions.length)return '';
 return codes.map((code,i)=>code+' '+(quantities[i]||'')+' '+(units[i]||'')+' '+descriptions[i]).join('\n');
}
// OCR sobre el bloque fisico del emisor (arriba, a la izquierda).
// Evita confundir la razon social del comprador con la del proveedor.
async function photoIssuerRegion(file){
 const bitmap=await createImageBitmap(file);
 const x=Math.floor(bitmap.width*.075),y=Math.floor(bitmap.height*.063);
 const w=Math.min(bitmap.width-x,Math.max(1,Math.round(bitmap.width*.447)));
 const h=Math.min(bitmap.height-y,Math.max(1,Math.round(bitmap.height*.165)));
 const scale=Math.max(1,Math.min(2.2,2200/w,1800/h));
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(bitmap,x,y,w,h,0,0,canvas.width,canvas.height);bitmap.close?.();
 const data=ctx.getImageData(0,0,canvas.width,canvas.height);
 for(let i=0;i<data.data.length;i+=4){const g=Math.round(.299*data.data[i]+.587*data.data[i+1]+.114*data.data[i+2]);data.data[i]=data.data[i+1]=data.data[i+2]=g;data.data[i+3]=255;}
 ctx.putImageData(data,0,0);return canvas;
}
async function readImage(file){
 status('OCR: leyendo cabecera, renglones y totales por separado...');
 const worker=await makeOcrWorker();
 try{
  await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
  const full=(await worker.recognize(await photoZone(file,0,1,'gray'))).data;
  status('OCR: identificando los artículos...');
  await worker.setParameters({tessedit_pageseg_mode:'6'});
  const table=(await worker.recognize(await photoZone(file,.20,.73,'gray'))).data;
  status('OCR: cotejando importes...');
  await worker.setParameters({tessedit_pageseg_mode:'3'});
  const summary=(await worker.recognize(await photoZone(file,.63,1,'adaptive'))).data;
  let headerText=full.text||'',summaryText=summary.text||'',supplierText='';
  // La ubicacion del emisor es evidencia: no alcanza con detectar la frase 'razon social'.
  const initialType=interpretarComprobante(full.text||'','imagen').tipo;
  if(initialType==='Factura'||initialType==='Remito'){
   status('OCR: separando los datos del proveedor de los datos del cliente...');
   await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
   const issuer=(await worker.recognize(await photoIssuerRegion(file))).data;
   supplierText=issuer.text||'';
  }
  let tableText=table.text||'';
  const prelim=interpretarComprobante(full.text||'','imagen',{tableText,summaryText});
  let tableFocusText='';
  let tableFocusError='';
  if(initialType==='Remito'){
   status('OCR: leyendo la tabla completa en un recorte de alta resolución...');
   try{
    await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
    const focused=(await worker.recognize(await photoTableZone(file,.29,.49))).data;
    tableFocusText=focused.text||'';
    if(tableFocusText.trim())tableText+='\n'+tableFocusText;
    else tableFocusError='La segunda lectura de la tabla no devolvió texto.';
   }catch(e){
    tableFocusError='No se pudo completar la segunda lectura de la tabla.';
    console.warn(tableFocusError,e);
   }
   const afterFocus=interpretarComprobante(full.text||'','imagen',{tableText,summaryText});
   const codeList=[...new Set(((full.text||'')+'\n'+tableText).match(/\b[A-Z0-9]{1,10}-[A-Z0-9]{1,10}[)\]]?/gi)||[])].filter(x=>/[A-Z]/i.test(x));
   const allText=(full.text||'')+'\n'+tableText;
   const hasColumns=/c[oó]digo/i.test(allText)&&/cantidad/i.test(allText)&&/unidad/i.test(allText)&&/descripci[oó]n/i.test(allText);
   if(hasColumns&&codeList.length>afterFocus.articulos.length){
    status('OCR: reconstruyendo la tabla por columnas para recuperar renglones omitidos...');
    try{
     const columnRows=await readRemitoColumns(file,worker);
     if(columnRows)tableText=columnRows+'\n'+tableText;
     else tableFocusError='La lectura por columnas no pudo reconstruir todos los renglones; podés agregarlos manualmente.';
    }catch(e){
     tableFocusError='No se pudo reconstruir la tabla por columnas; podés agregar los artículos manualmente.';
     console.warn(tableFocusError,e);
    }
   }
  }
  if(!prelim.numero||!prelim.fecha||!prelim.proveedor||prelim.proveedor.length<8){
   status('OCR: verificando por separado el encabezado de la fotografía...');
   await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
   const head=(await worker.recognize(await photoZone(file,0,.36,'gray'))).data;
   headerText+='\n'+(head.text||'');
  }
  if(prelim.total==null){
   status('OCR: verificando por separado el cuadro de totales...');
   await worker.setParameters({tessedit_pageseg_mode:'6'});
   const foot=(await worker.recognize(await photoZone(file,.66,.94,'gray'))).data;
   summaryText+='\n'+(foot.text||'');
  }
  return {text:full.text||'',tableText,tableFocusText,tableFocusError,summaryText,headerText,supplierText,method:'OCR por zonas · revisión manual disponible',pages:1,truncated:false,confidence:Math.min(full.confidence??100,table.confidence??100,summary.confidence??100)};
 }finally{await worker.terminate();}
}
$('read').onclick=async()=>{if(!selected||busy)return;busy=true;$('read').disabled=true;$('sample').disabled=true;prog(3);status('Preparando reconocimiento...');try{
  const isPdf=selected.type==='application/pdf'||/\.pdf$/i.test(selected.name);
  const output=isPdf?await readPdf(selected):await readImage(selected);
  if(!output.text.trim())throw new Error('No se reconoció texto en el archivo. Podés probar otra imagen más nítida.');
  current=interpretarComprobante(output.text,selected.name,{tableText:output.tableText||'',summaryText:output.summaryText||'',headerText:output.headerText||'',supplierText:output.supplierText||''});current.metodo=output.method;if(output.tableFocusError)current.advertencias.push(output.tableFocusError);if(current.tipo==='Remito'){current.codigos_detectados=[...new Set(((output.text||'')+'\n'+(output.tableText||'')).match(/\b[A-Z0-9]{1,10}-[A-Z0-9]{1,10}[)\]]?/gi)||[])].filter(x=>/[A-Z]/i.test(x));}current.paginas=output.pages;if(output.truncated)current.advertencias.push('Se procesaron solo las primeras 6 páginas de este PDF.');
  if(output.confidence!=null&&output.confidence<55)current.advertencias.push('Lectura OCR con baja confianza. Verificá cada dato contra la imagen.');
  render();
  if(current.articulos.length===0)status('Se reconoció texto, pero no se pudieron identificar artículos. Abrí «Ver texto extraído» y corregí los campos o agregá artículos.','warning');
  else status('Lectura terminada: '+current.articulos.length+' artículo(s). Revisá los datos contra la foto.','ok');prog(100);$('pages').textContent=`${output.pages} página(s) · ${output.method}`;
}catch(e){status('No se pudo completar la lectura: '+(e.message||e)+'. Revisá tu conexión a Internet, el formato y la nitidez.','error');$('progress').classList.add('hidden');}
finally{busy=false;$('read').disabled=!selected;$('sample').disabled=false;}
};
$('sample').onclick=()=>{if(busy)return;selected=null;$('read').disabled=true;$('file').value='';$('fileLabel').textContent='Ejemplo inventado (sin archivo)';if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('preview').innerHTML='<div class="muted" style="text-align:center;padding:24px">Ejemplo de texto ficticio incorporado.<br>No es una factura PDF.</div>';current=interpretarComprobante(demoText,'EJEMPLO_FICTICIO_INTERNO');current.metodo='Ejemplo de texto ficticio';render();status('Ejemplo ficticio cargado. Probá corregir campos y exportar el resultado.','ok');$('pages').textContent='Texto de ejemplo';};
const field=(key,label,wide=false)=>`<div class="${wide?'full':''}"><label for="f_${key}">${h(label)}</label><input id="f_${key}" data-field="${key}" value="${h(current[key]??'')}"></div>`;
const cash=(key,label)=>`<div><label>${h(label)} (${h(current.moneda||'moneda por confirmar')})</label><input inputmode="decimal" data-money="${key}" value="${current[key]==null?'':h(formatValue(current[key]))}" placeholder="No informado"></div>`;
function formatValue(x){return x==null?'':Number(x).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function choose(options,value='',placeholder='Seleccionar...'){return `<option value="">${h(placeholder)}</option>`+options.map(s=>`<option value="${h(s)}" ${value===s?'selected':''}>${h(s)}</option>`).join('');}
const types=['Factura','Remito','Ticket','Nota de crédito','Nota de débito','No determinado'];
function rowCard(item,i){return `<div class="rline"><div class="rhead"><strong>Artículo ${i+1} ${item.origen==='Agregado manualmente'?'<span class="pill warn">Agregado manualmente</span>':''}</strong><button class="btn sm" data-remove="${i}">Eliminar</button></div><div><label>Descripción original</label><input data-index="${i}" data-item="descripcion" value="${h(item.descripcion)}"></div><div class="fields3" style="margin-top:10px"><div><label>Cantidad</label><input data-index="${i}" data-itemnum="cantidad" inputmode="decimal" value="${h(item.cantidad??'')}"></div><div><label>Unidad</label><input data-index="${i}" data-item="unidad" value="${h(item.unidad)}"></div><div><label>Código del proveedor</label><input data-index="${i}" data-item="codigo_proveedor" value="${h(item.codigo_proveedor)}"></div></div><div class="fields" style="margin-top:10px"><div><label>Precio unitario (${h(current.moneda||'moneda por confirmar')})</label><input data-index="${i}" data-itemnum="precio_unitario" inputmode="decimal" value="${h(formatValue(item.precio_unitario))}" placeholder="No informado"></div><div><label>Importe (${h(current.moneda||'moneda por confirmar')})</label><input data-index="${i}" data-itemnum="importe" inputmode="decimal" value="${h(formatValue(item.importe))}" placeholder="No informado"></div></div><div class="fields" style="margin-top:10px"><div><label>Descuento % (si figura)</label><input data-index="${i}" data-itemnum="descuento_porcentaje" inputmode="decimal" value="${h(item.descuento_porcentaje??'')}" placeholder="No informado"></div><div><label>IVA % (si figura)</label><input data-index="${i}" data-itemnum="iva_porcentaje" inputmode="decimal" value="${h(item.iva_porcentaje??'')}" placeholder="No informado"></div></div><div class="fields" style="margin-top:10px"><div><label>Sector a confirmar</label><select data-index="${i}" data-item="sector">${choose(sectors,item.sector,'Sin asignar')}</select></div><div><label>Identificación del artículo</label><select data-index="${i}" data-item="identificacion">${choose(['Pendiente','Artículo confirmado','Coincidencia por verificar','Genérico provisional'],item.identificacion)}</select></div></div><div class="rubros ${item.identificacion==='Genérico provisional'?'':'hidden'}" data-rubro="${i}"><label>Rubro genérico provisional</label><select data-index="${i}" data-item="codigo_generico">${choose(categories,item.codigo_generico)}</select></div>${item.advertencia_ocr?`<div class="notice warning" style="margin-top:9px">${h(item.advertencia_ocr)}</div>`:''}<div class="actions" style="margin-top:11px"><button class="btn sm" data-calc="${i}">Calcular cantidad × precio</button></div></div>`;}
function render(){if(!current)return;$('intro').classList.add('hidden');$('form').classList.remove('hidden');$('reviewBadge').textContent=current.revisado_local?'REVISADO EN DEMO':'POR REVISAR';$('reviewBadge').className='pill '+(current.revisado_local?'':'warn');$('form').innerHTML=`<div class="section"><div class="sectiontitle"><h3>Identificación del comprobante</h3><span class="hint">${h(current.metodo)}</span></div><div class="fields"><div><label>Tipo</label><select data-field="tipo">${choose(types,current.tipo)}</select></div><div><label>Letra (si corresponde)</label><select data-field="letra">${choose(['A','B','C','M','E'],current.letra,'Sin letra')}</select></div>${field('numero','Número')}${field('fecha','Fecha (DD/MM/AAAA)')}<div><label>Moneda original</label><select data-field="moneda">${choose(['ARS','USD','EUR'],current.moneda,'No determinada')}</select></div>${field('proveedor','Proveedor',true)}${field('cuit_proveedor','CUIT proveedor')}${field('cuit_comprador','CUIT cliente')}${field('identificacion_proveedor','Identificación proveedor (si no es CUIT)')}${field('identificacion_comprador','Identificación cliente (si no es CUIT)')}${field('condicion_venta','Condición de venta')}${field('cae','CAE (si figura)')}${field('cai','CAI (si figura)')}${field('fecha_vto_cae','Vencimiento CAE (si figura)')}</div></div><div class="section"><div class="sectiontitle"><h3>Importes</h3><span class="hint">Si no figuran, dejalos vacíos</span></div><div class="fields3">${cash('subtotal_bruto','Subtotal bruto')}${cash('descuento_documento','Descuento documento')}${cash('neto','Neto gravado')}${cash('iva','IVA discriminado')}${cash('iva_contenido','IVA contenido (sin sumar al total)')}${cash('percepcion_iibb','Percepción IIBB')}${cash('percepcion_iva','Percepción IVA')}${cash('otros_tributos','Otros tributos')}${cash('total','Total')}</div><div id="checks" class="recalc"></div></div><div class="section"><div class="sectiontitle"><h3>Artículos reconocidos · ${current.articulos.length}</h3><button class="btn primary sm" id="add" aria-label="Agregar artículo faltante">+ Agregar artículo faltante</button></div>${current.tipo==='Remito'&&current.codigos_detectados?.length>current.articulos.length?'<div class="notice warning" style="margin-bottom:10px">El documento muestra '+current.codigos_detectados.length+' códigos de artículo, pero se interpretaron '+current.articulos.length+' renglones. Agregá el artículo que falta y completá sus datos mirando el remito.</div>':''}<p class="hint">Si el lector omitió un producto, podés incorporarlo manualmente. Se incluirá en la exportación para revisión.</p>${current.articulos.map(rowCard).join('')||'<div class="notice warning">No se detectaron renglones confiables. Agregá los artículos manualmente si los hay.</div>'}</div><div class="section"><h3>Referencias (opcional)</h3><div class="fields">${field('referencia_operacion','Operación relacionada')}${field('referencia_comprobante','Comprobante vinculado')}${field('orden_compra','Orden de compra')}</div></div><div class="section"><h3>Control y exportación</h3><div id="alerts"></div><div style="margin:12px 0"><label>Observaciones</label><textarea rows="2" id="notes" placeholder="Aclaraciones de la revisión">${h(current.observaciones)}</textarea></div><div class="actions"><button class="btn dark" id="approve">Marcar como revisado</button><button class="btn primary" id="exportJSON">Exportar JSON</button><button class="btn" id="exportCSV">Descargar CSV</button></div><p class="hint" style="margin-top:11px">Estos archivos se descargan localmente. No registran una compra, no crean stock y no se envían al ERP.</p><details><summary>Ver texto extraído</summary><pre>${h(current.texto_extraido)}</pre></details></div>`;validate();}
function validate(){if(!current)return;const w=[...current.advertencias];if(current.tipo==='Remito'&&current.codigos_detectados?.length>current.articulos.length)w.push('El OCR detectó '+current.codigos_detectados.length+' posibles códigos y se interpretaron '+current.articulos.length+' artículos. Puede haber códigos ajenos a la tabla: cotejá todos los renglones con el original y agregá manualmente los que falten. Esta advertencia no impide cerrar la revisión si ya verificaste el documento.');
  if(current.total!=null&&current.neto!=null){
    const trib=current.otros_tributos ?? ((current.percepcion_iibb||0)+(current.percepcion_iva||0));
    const estimated=current.neto+(current.iva||0)+trib;
    const diff=Math.abs(estimated-current.total);
    $('checks').textContent=diff<=.06?'✓ Neto + IVA + percepciones coincide con el total (según conceptos detectados).':`⚠ La composición de importes difiere del total en ${h(current.moneda||'moneda por confirmar')} ${formatValue(diff)}. Revisá descuentos y otros conceptos.`;
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
$('form').addEventListener('input',e=>{if(!current)return;const t=e.target; if(t.dataset.field!==undefined)current[t.dataset.field]=t.value;if(t.dataset.money!==undefined)current[t.dataset.money]=t.value.trim()?numberValue(t.value):null;if(t.dataset.field==='moneda'){render();return;}const i=Number(t.dataset.index);if(t.dataset.item!==undefined && current.articulos[i]){current.articulos[i][t.dataset.item]=t.value;if(t.dataset.item==='identificacion')$('form').querySelector(`[data-rubro="${i}"]`)?.classList.toggle('hidden',t.value!=='Genérico provisional');}if(t.dataset.itemnum!==undefined && current.articulos[i])current.articulos[i][t.dataset.itemnum]=t.value.trim()?numberValue(t.value):null;if(t.id==='notes')current.observaciones=t.value;current.revisado_local=false;$('reviewBadge').textContent='POR REVISAR';$('reviewBadge').className='pill warn';validate();});
$('form').addEventListener('click',e=>{if(!current)return;const b=e.target.closest('button');if(!b)return;const i=Number(b.dataset.remove??b.dataset.calc);if(b.id==='add'){current.articulos.push({codigo_proveedor:'',cantidad:null,unidad:'',descripcion:'',precio_unitario:null,descuento_porcentaje:null,iva_porcentaje:null,importe:null,sector:'',identificacion:'Pendiente',codigo_generico:'',origen:'Agregado manualmente'});current.revisado_local=false;render();status('Artículo agregado. Completá descripción, cantidad, unidad y código si figura en el comprobante.','ok');return;}if(b.dataset.remove!==undefined){current.articulos.splice(i,1);render();return;}if(b.dataset.calc!==undefined){const a=current.articulos[i];if(a.cantidad!=null&&a.precio_unitario!=null){a.importe=Math.round(a.cantidad*a.precio_unitario*(1-(a.descuento_porcentaje||0)/100)*100)/100;render();}else status('Faltan cantidad o precio unitario para calcular el importe.','warning');return;}if(b.id==='approve'){if(!current.articulos.length){status('No se puede marcar como revisado un comprobante con cero artículos reconocidos. Agregá o corregí los renglones primero.','warning');return;}if(current.articulos.some(a=>!String(a.descripcion||'').trim())){status('Hay artículos sin descripción. Completalos antes de marcar como revisado.','warning');return;}if(current.articulos.some(a=>a.cantidad==null||!Number.isFinite(Number(a.cantidad))||Number(a.cantidad)<=0)){status('Hay artículos con cantidad pendiente o inválida. Completá y verificá sus cantidades antes de marcar el comprobante como revisado.','warning');return;}if(current.tipo==='Remito'&&current.articulos.some(a=>!String(a.unidad||'').trim())){status('Hay artículos sin unidad de medida. Completá ese dato antes de marcar el remito como revisado.','warning');return;}current.revisado_local=true;render();status('Marcado como revisado en esta pantalla. No fue enviado al ERP.','ok');return;}if(b.id==='exportJSON'){download('json');return;}if(b.id==='exportCSV'){download('csv');return;}});
function fileName(){return (current.numero||'sin_numero').replace(/[^a-zA-Z0-9-_]/g,'_');}
function download(fmt){const obj=structuredClone(current);delete obj.texto_extraido;obj.fecha_exportacion=new Date().toISOString();obj.ambiente='DEMO';obj.no_registra_stock=true;obj.no_contabiliza=true;let blob,name;
  if(fmt==='json'){blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json;charset=utf-8'});name=`lectura_${fileName()}.json`;}else{const cols=['tipo','letra','numero','fecha','fecha_vto_cae','moneda','proveedor','cuit_proveedor','cuit_comprador','identificacion_proveedor','identificacion_comprador','subtotal_bruto','descuento_documento','neto','iva','iva_contenido','percepcion_iibb','percepcion_iva','otros_tributos','total','referencia_operacion','referencia_comprobante','orden_compra','cai','cae','descripcion','cantidad','unidad','precio_unitario','descuento_porcentaje','iva_porcentaje','importe','sector','identificacion','codigo_generico'];const csv=[cols.join(';'),...(obj.articulos.length?obj.articulos:[{}]).map(r=>cols.map(k=>'"'+String((r[k]??obj[k]??'')).replace(/"/g,'""')+'"').join(';'))].join('\r\n');blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});name=`lectura_${fileName()}.csv`;}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Archivo exportado a tu computadora. No se envió al ERP.','ok');}
