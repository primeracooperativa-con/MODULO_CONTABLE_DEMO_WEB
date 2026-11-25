// Motor de interpretacion experimental (local) para comprobantes argentinos.
// No conecta con sistemas contables ni valida comprobantes fiscalmente.
const simple = s => String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const amount = '(?:-?\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{2})?|-?\\d+(?:[.,]\\d{1,2})?)';
export function numberValue(input) {
  let s=String(input??'').trim().replace(/\s/g,'').replace(/[^\d,.-]/g,'');
  if(!s||s==='-')return null;
  const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
  if(comma>=0&&dot>=0)s=comma>dot?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
  else if(comma>=0) s=(s.length-comma-1===3&&s.indexOf(',')===comma)?s.replace(/,/g,''):s.replace(',','.');
  else if(dot>=0&&s.length-dot-1===3&&s.indexOf('.')===dot)s=s.replace('.','');
  const n=Number(s);return Number.isFinite(n)?n:null;
}
const numAtEnd=new RegExp('('+amount+')\\s*$');
function valueAtEnd(line){const m=line.match(numAtEnd);return m?numberValue(m[1]):null;}
function extractLineValue(lines,regex){for(const line of [...lines].reverse()){if(regex.test(simple(line))){const v=valueAtEnd(line);if(v!==null)return v;}}return null;}
function article(desc,q,unit,price=null,sum=null,discount=null,rate=null,code=''){
 return {codigo_proveedor:code,cantidad:q,unidad:unit,descripcion:desc.trim(),precio_unitario:price,descuento_porcentaje:discount,iva_porcentaje:rate,importe:sum,sector:'',identificacion:'Pendiente',codigo_generico:''};
}
function parseTable(lines,tipo){
 const data=[],head=lines.findIndex(x=>/\b(DESCRIPCI[OÓ]N|DETALLE)\b/i.test(x)&&/\b(CANT|CANTIDAD|PRECIO|IMPORTE|UNIDAD|MED)\b/i.test(x));
 if(head<0)return data;
 const tail=/(?:^|\s)(?:SUBTOTAL|NETO\s+GRAVADO|NETO\s+TOTAL|DESCUENTO\s+DOCUMENTO|PERCEPCI[OÓ]N|TOTAL\s+ARS|TOTAL\s+A\s+PAGAR|DISCRIMINACI[OÓ]N|SIN\s+VALORIZACI[OÓ]N|IVA\s+INCLUIDO)(?:\b|\s)/i;
 const units='un|uni|unid(?:ades)?|u|kg|kgs|g|gr|l|lt|lts|m|mt|mts|rollo|rollos|paq|pack|par|caja|bolsa|pza|pz|pcs';
 const money='(-?[0-9][0-9.,]*)';
 const full=new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+('+units+')\\s+'+money+'\\s+(\\d{1,3}|[—-])\\s+(\\d{1,3}(?:[.,]\\d+)?|[—-])\\s+'+money+'\\s*$','i');
 const withPrice=new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+('+units+')\\s+'+money+'\\s+'+money+'\\s*$','i');
 const withoutPrice=new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+('+units+')\\s*$','i');
 const codeFirst=new RegExp('^([A-Z0-9./-]{1,12})\\s+(\\d+(?:[.,]\\d+)?)\\s+('+units+')\\s+(.+?)\\s+'+money+'\\s+(?:'+money+'\\s+)?'+money+'\\s*$','i');
 for(const raw of lines.slice(head+1)){
   const t=raw.replace(/\s+/g,' ').trim();if(!t)continue;
   if(tail.test(t))break;
   if(/^(?:CODIGO|DESCRIPCION|DESCRIPCIÓN|ART[IÍ]CULO|CANTIDAD)\b/i.test(t))continue;
   let m=t.match(full);
   if(m){data.push(article(m[1],numberValue(m[2]),m[3],numberValue(m[4]),numberValue(m[7]),m[5]==='—'||m[5]==='-'?null:numberValue(m[5]),m[6]==='—'||m[6]==='-'?null:numberValue(m[6])));continue;}
   m=t.match(codeFirst);
   if(m && !/\b(FACTURA|REMITO|CLIENTE)\b/i.test(m[4])){
      const s=valueAtEnd(t), price=numberValue(m[5]);
      data.push(article(m[4],numberValue(m[2]),m[3],price,s,null,null,m[1]));continue;
   }
   m=t.match(withPrice);
   if(m){data.push(article(m[1],numberValue(m[2]),m[3],numberValue(m[4]),numberValue(m[5])));continue;}
   if(tipo==='Remito') {m=t.match(withoutPrice);if(m){data.push(article(m[1],numberValue(m[2]),m[3]));continue;}}
 }
 return data.slice(0,200);
}
function parseTickets(lines){
 let head=lines.findIndex(x=>/ART[IÍ]CULO\s*\/\s*CANT/i.test(x));
 if(head<0)return [];
 const list=[];let prev=null;
 const qtyLine=new RegExp('^(\\d+(?:[.,]\\d+)?)\\s+(un|uni|kg|g|l|lt|m|paq|par|rollo|pza|caja|pack|pag)\\s*[x×]\\s*('+amount+')\\s+('+amount+')\\s*$','i');
 for(let i=head+1;i<lines.length;i++){
   const s=lines[i].replace(/\s+/g,' ').trim();if(!s)continue;
   if(/^\s*(?:SUBTOTAL|TOTAL|PAGO|SIN VALIDEZ FISCAL)\b/i.test(s))break;
   const disc=s.match(/(?:DTO|DESCUENTO)\s*(\d+(?:[.,]\d+)?)\s*%\s*:?\s*[-−]?\s*([\d.,]+)/i);
   if(disc&&list.length){list.at(-1).descuento_porcentaje=numberValue(disc[1]);list.at(-1).descuento_importe=numberValue(disc[2]);continue;}
   const m=s.match(qtyLine);
   if(m&&prev){const a=article(prev,numberValue(m[1]),m[2].toLowerCase()==='pag'?'paq':m[2],numberValue(m[3]),numberValue(m[4]));if(m[2].toLowerCase()==='pag')a.advertencia_ocr='Unidad interpretada como paq (OCR leyó pag). Revisar.';list.push(a);prev=null;continue;}
   if(!/^\s*(?:ART[IÍ]CULO|CANT|IMPORTE|P\. UNIT|DTO)\b/i.test(s))prev=s;
 }
 return list.slice(0,200);
}
function parseLegacy(lines){
 const head=lines.findIndex(x=>/\b(CODIGO|CÓDIGO|CANTIDAD|DETALLE)\b/i.test(x)&&/\b(PRECIO|IMPORTE|DETALLE)\b/i.test(x));
 if(head<0)return [];
 const out=[];
 for(const t of lines.slice(head+1)){
 if(/^(?:DISCRIMINACI[OÓ]N|NETO|TOTAL|SON PESOS|CAE)\b/i.test(t))break;
 const m=t.trim().replace(/\s+/g,' ').match(/^([A-Z0-9-]{1,12})\s+(\d+(?:[.,]\d+)?)\s+(UNI|UN|KG|L|LT|M|PAQ)\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)$/i);
 if(m)out.push(article(m[4],numberValue(m[2]),m[3],numberValue(m[5]),numberValue(m[6]),null,null,m[1]));
 }return out;
}
// Reconocimiento adicional para tablas de facturas con servicios y precios en columnas.
function parseServiceTable(lines) {
 const found=[];
 for(const raw of lines){
  const t=raw.replace(/\s+/g,' ').trim().replace(/(\d{3,7})\s+(\d{2})$/,'$1,$2');
  if(!t || /\b(?:IMPORTE NETO|TOTAL DE|SUBTOTAL|PUNTO DE VENTA|FECHA DE EMISION)\b/i.test(t))continue;
  const m=t.match(/^(\d{1,4})\s+(.{6,}?)\s+(\d{1,4}[.,]\d{2})\s+(otras(?:\s+unidades)?|ovas|oras|unidades|unid(?:ades)?|uni|un|kg|kgs|lts?|mts?|paq|caja)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d{1,2}(?:[.,]\d)?)\s*%\s+([\d.,]+)$/i);
  if(!m)continue;
  const [,code,desc,q,unit,price,discount,sum,rate,gross]=m;
  const qty=numberValue(q),unitPrice=numberValue(price),net=numberValue(sum),vat=numberValue(rate),discountNum=numberValue(discount);
  if(qty==null||unitPrice==null||net==null||vat==null||discountNum==null||qty<=0||vat>27||vat<0)continue;
  if(Math.abs(qty*unitPrice*(1-discountNum/100)-net)>Math.max(.15,net*.02))continue;
  const grossNum=numberValue(gross);
  if(grossNum===null||Math.abs(net*(1+vat/100)-grossNum)>Math.max(.2,net*.025))continue;
  const row=article(desc,qty,/^otras\b/i.test(unit)?'otras unidades':unit,unitPrice,net,discountNum,vat,code);
  row.importe_con_iva=grossNum;
  if(/^(ovas|oras)$/i.test(unit))row.advertencia_ocr='Unidad poco legible en imagen (OCR: '+unit+'). Verificá la original.';
  if(/\b(?:contrate|comisione)\b/i.test(desc))row.advertencia_ocr=(row.advertencia_ocr?row.advertencia_ocr+' ':'')+'Descripción posiblemente incompleta; cotejá el original.';
  found.push(row);
 }
 return found.slice(0,200);
}
function moneyAfterLabel(lines,rx){
 for(let i=lines.length-1;i>=0;i--){
  const line=simple(lines[i]);if(!rx.test(line))continue;
  const val=valueAtEnd(lines[i]);
  if(val!==null&&!/(?:\bUSD|\bUSO|\bARS|\bIVA\s*\d+(?:[.,]\d+)?%?)\s*:?\s*$/i.test(line))return val;
  for(let j=i+1;j<=Math.min(lines.length-1,i+2);j++){
   const next=lines[j].trim();if(!next)continue;
   if(/^(?:\$|USD|USO|ARS)?\s*[\d.,]+\s*\|?$/i.test(next))return numberValue(next);
   break;
  }
 }
 return null;
}
function identifyCurrency(text){
 const t=simple(text),m=t.match(/MONEDA\s*[:;]?\s*(USD|USO|U\$S|US\$|ARS|PESOS?|EUR|EUROS?)/);
 if(m){const v=m[1];return /^(USD|USO|U\$S|US\$)$/.test(v)?'USD':/^(ARS|PESOS?)$/.test(v)?'ARS':'EUR';}
 if(/DOLAR\s+ESTADOUNIDENSE/.test(t)||/PRECIO\s+UNIT\S*\s*\(\s*USD\s*\)/.test(t))return 'USD';
 if(/\b(?:PESOS ARGENTINOS|MONEDA\s*[:;]\s*ARS)\b/.test(t))return 'ARS';
 return '';
}

export function interpretarComprobante(text, name='', zones={}){
 const original=String(text||'').replace(/\r/g,'').replace(/(\d[.,])\s+(\d{2})(?=\D|$)/g,'$1$2');
 const lines=original.split('\n').map(x=>x.trim()).filter(Boolean);
 const normal=lines.map(simple);
 const summaryLines=String(zones.summaryText||'').split('\n').map(x=>x.trim()).filter(Boolean);
 const tableLines=String(zones.tableText||'').split('\n').map(x=>x.trim()).filter(Boolean);
 const headerLines=String(zones.headerText||'').split('\n').map(x=>x.trim()).filter(Boolean);
 const heading=normal.findIndex(s=>/^(?:FACTURA\s*[ABCME]?$|[ABCME]\s+FACTURA\b|REMITO\s*$|TICKET\s*$|TICKET\s+FISCAL\s*$|NOTA\s+DE\s+(?:CR[EÉ]DITO|D[EÉ]BITO)\s*$)/.test(s));
 const hline=heading>=0?normal[heading]:'';
 let tipo=/^REMITO/.test(hline)?'Remito':/^TICKET/.test(hline)?'Ticket':/^NOTA DE CREDITO/.test(hline)?'Nota de crédito':/^NOTA DE DEBITO/.test(hline)?'Nota de débito':/FACTURA/.test(hline)?'Factura':'No determinado';
 if(tipo==='No determinado'){
   const start=normal.slice(0,18).join(' ');
   tipo=/\bFACTURA\b/.test(start)?'Factura':/\bREMITO\b/.test(start)?'Remito':/\bTICKET\b/.test(start)?'Ticket':'No determinado';
 }
 let letra=tipo==='Factura'?(hline.match(/FACTURA\s+([ABCME])\b/)||hline.match(/\b([ABCME])\s+FACTURA\b/)||[])[1]||'':'';
 if(!letra&&tipo==='Factura'){
  const upper=headerLines.map(simple),all=upper.join(' '),at=upper.findIndex(x=>/\bFACTURA\b/.test(x));
  if(at>=0)letra=upper.slice(Math.max(0,at-3),at+4).find(x=>/^[ABCME]$/.test(x))||'';
  if(!letra){const adj=all.match(/\b([ABCME])\s+FACTURA\b|\bFACTURA\s+([ABCME])\b/);if(adj)letra=adj[1]||adj[2]||'';}
  if(!letra&&/\bCOD\.?\s*0?1\b/.test(all+' '+normal.slice(0,12).join(' ')))letra='A';
 }
 let proveedor='';
 const candidates=heading>=0?lines.slice(0,heading):lines.slice(0,10);
 for(const raw of candidates){
  const q=raw.trim(),t=simple(q);
  if(/^(?:DOCUMENTO|SIN VALIDEZ|DOMICILIO|ID FISCAL|CUIT|IVA|ORIGINAL|FACTURA|A FACTURA|FECHA|COD|PTO|PUNTO|COMP|CPBTE|RAZON SOCIAL|INGRESOS BRUTOS|CONDICION|PERIODO|HASTA|MONEDA|IMPORTE|CLIENTE)\b/.test(t))continue;
  if(/\bFACTURA\b/.test(t)||/^[ABCME]$/.test(t)||/^[\d.,: /-]+$/.test(t))continue;
  if(/^[\p{L}][\p{L} .&-]{4,80}$/u.test(q)&&!/[.:]$/.test(q)){proveedor=q;break;}
 }
 if(!proveedor){
  const named=lines.find(x=>/^(?:PROVEEDOR|RAZ[OÓ]N SOCIAL(?:\s+DEL\s+EMISOR)?)\s*:\s*\S.{2,}/i.test(x));
  if(named)proveedor=named.replace(/^[^:]*:\s*/,'').trim();
 }
 const dateMatch=original.match(/\b(?:FECHA(?:\s+DE\s+EMISION)?|EMISION)\s*[:\s]*(\d{2}[/-]\d{2}[/-]\d{4})/i);
 let fecha=dateMatch?dateMatch[1]:(original.match(/\b(\d{2}[/-]\d{2}[/-]\d{4})\b/)||[])[1]||'';
 let numero='';
 const numrx=/\b(?:N[°ºo.]\s*|NRO\.?\s*|NUMERO\s*[:]?\s*)(\d{4,5})\s*[-/]\s*(\d{5,12})/i;
 const nm=original.match(numrx);
 if(nm)numero=nm[1].padStart(4,'0')+'-'+nm[2].padStart(8,'0');
 if(!numero){const pv=(original.match(/\bPTO\.?\s*VENTA\s*:?\s*(\d{1,5})/i)||[])[1];const n=(original.match(/\bCPBTE\s*NRO\s*:?\s*(\d{4,12})/i)||[])[1];if(pv&&n)numero=pv.padStart(4,'0')+'-'+n.padStart(8,'0');}
 if(!numero){const fm=original.match(/\bFAC\s+(\d{1,5})\s+[ABCME]\s+(\d{4,12})/i);if(fm)numero=fm[1].padStart(4,'0')+'-'+fm[2].padStart(8,'0');}
 if(!numero){
  const together=original+'\n'+headerLines.join('\n');
  const pv=(together.match(/\b(?:PUNTO\s+DE\s+VENTA|PTO\.?\s*(?:DE\s*)?VENTA)\s*:?\s*(\d{1,5})/i)||[])[1];
  const cb=(together.match(/\b(?:COMP\.?\s*NRO\.?|CPBTE\.?\s*NRO\.?|COMPROBANTE\s*(?:NUMERO|NRO\.?))\s*:?\s*(\d{4,12})/i)||[])[1];
  if(pv&&cb)numero=pv.padStart(5,'0')+'-'+cb.padStart(8,'0');
 }
 const cup=(original.match(/\bCUIT\s*:?\s*([0-9\s-]{11,16})\b/i)||[])[1]||'';
 const ids=[...original.matchAll(/\b(?:ID\s+FISCAL\s+FICTICIO|ID\s+CLIENTE)\s*:\s*(DEMO-[A-Z]\d+)/gi)].map(x=>x[1]);
 const own=(original.match(/ID\s+FISCAL\s+FICTICIO\s*:\s*(DEMO-[A-Z]\d+)/i)||[])[1]||'';
 const client=(original.match(/ID\s+CLIENTE\s*:\s*(DEMO-[A-Z]\d+)/i)||[])[1]||'';
 const cuits=[...original.matchAll(/\bCUIT\s*:?\s*(\d[\d\s-]{9,16}\d)/gi)].map(x=>x[1].replace(/\D/g,''));
 let total=moneyAfterLabel(summaryLines,/(?:IMPORTE|IMPORTO)\s+TOTAL\b/)??extractLineValue(lines,/(?:^|\s{3,})TOTAL(?:\s+ARS|\s*\$|\s+A\s+PAGAR)?\b/);
 let subtotal=extractLineValue(lines,/^SUBTOTAL(?:\s+BRUTO)?\b/);
 let descuento=extractLineValue(lines,/^(?:DESCUENTO(?:\s+DOCUMENTO)?|BONIF(?:ICACI[OÓ]N)?)\b/);
 let neto=moneyAfterLabel(summaryLines,/(?:IMPORTE|IMPORTO)\s+NETO\s+GRAVADO\b/)??extractLineValue(lines,/^NETO(?:\s+GRAVADO)?\b/);
 const ivas=lines.filter(x=>/^IVA\s+\d+(?:[.,]\d+)?\s*%/i.test(x)).map(valueAtEnd).filter(x=>x!==null);
 let iva=moneyAfterLabel(summaryLines,/^IVA\s+21\s*%/)??(ivas.length?Math.round(ivas.reduce((a,b)=>a+b,0)*100)/100:extractLineValue(lines,/^IVA\s+(?!INCLUIDO)/));
 const percepcion_iibb=extractLineValue(lines,/^PERCEPCI[OÓ]N\s+IIBB\b/);
 let articles=tipo==='Ticket'?parseTickets(lines):parseTable(lines,tipo);
 if(!articles.length&&tipo!=='Ticket')articles=parseLegacy(lines);
 const zoneArticles=parseServiceTable(tableLines);
 if(zoneArticles.length>articles.length)articles=zoneArticles;
 const moneda=identifyCurrency(original+'\n'+(zones.summaryText||'')+'\n'+(zones.tableText||''));
 let netoEstimado=false;
 if(neto==null&&articles.length&&articles.every(a=>a.importe!=null)&&tipo==='Factura'){
  const sum=articles.reduce((acc,a)=>acc+a.importe,0);
  if(sum>0){neto=Math.round(sum*100)/100;netoEstimado=true;}
 }
 const condition=(original.match(/\b(?:CONTADO|CUENTA CORRIENTE|TRANSFERENCIA|EFECTIVO|TARJETA(?:\s+DE\s+D[EÉ]BITO)?)\b/i)||[])[0]||'';
 const ref=(original.match(/\bOPERACI[OÓ]N\s+(DEMO-\d+)/i)||[])[1]||'';
 const link=(original.match(/\b(?:FACTURA\s*[ABCME]?|REMITO)\s+(\d{4,5})-(\d{5,12})/i)||[]);
 const alertas=[];
 if(tipo==='No determinado')alertas.push('Tipo de comprobante no identificado con seguridad.');
 if(!proveedor)alertas.push('Proveedor no identificado. El campo se deja vacío; no se completan nombres sin evidencia.');
 if(!moneda)alertas.push('Moneda no identificada. Confirmá ARS, USD u otra antes de exportar.');
 if(netoEstimado)alertas.push('Neto calculado a partir de renglones; no fue leído directamente.');
 if(!fecha)alertas.push('No se encontró la fecha.');
 if(!numero)alertas.push('No se encontró el número de comprobante.');
 if(!articles.length)alertas.push('No se reconocieron artículos. Revisá el documento y la calidad de la imagen.');
 if(articles.some(a=>a.advertencia_ocr))alertas.push('Una o más unidades fueron normalizadas por posible error OCR: verificá las originales.');
 if(tipo==='Remito'&&total===null)alertas.push('Remito sin precios: se mantienen vacíos hasta recibir otro documento.');
 if(neto!==null&&iva!==null&&total!==null){const dif=Math.abs(neto+iva+(percepcion_iibb||0)-total);if(dif>.06)alertas.push('El total no coincide con neto + IVA + percepciones; verificá descuentos y conceptos adicionales.');}
 if(total!=null && articles.length && articles.every(a=>a.importe!=null)){
  let sum=articles.reduce((s,a)=>s+a.importe,0);if(tipo==='Factura'&&neto!=null&&Math.abs(sum-neto)>.08)alertas.push('La suma de importes de artículos difiere del neto: revisar redondeos y descuentos.');
 }
 return {tipo,letra,numero,fecha,proveedor,moneda,cuit_proveedor:cuits[0]||'',cuit_comprador:cuits[1]||'',identificacion_proveedor:own,identificacion_comprador:client,condicion_venta:condition,cae:(original.match(/\bCAE\s*:?\s*(\d{10,18})/i)||[])[1]||'',neto,iva,total,subtotal_bruto:subtotal,descuento_documento:descuento,percepcion_iibb,referencia_operacion:ref,referencia_comprobante:link.length?link[1]+'-'+link[2]:'',articulos:articles,advertencias:alertas,observaciones:'',texto_extraido:original,metodo:'',paginas:1,nombre_archivo:name,revisado_local:false};
}
