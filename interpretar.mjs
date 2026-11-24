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
export function interpretarComprobante(text, name=''){
 const original=String(text||'').replace(/\r/g,'').replace(/(\d[.,])\s+(\d{2})(?=\D|$)/g,'$1$2');
 const lines=original.split('\n').map(x=>x.trim()).filter(Boolean);
 const normal=lines.map(simple);
 const heading=normal.findIndex(s=>/^(?:FACTURA\s*[ABCME]?$|[ABCME]\s+FACTURA\b|REMITO\s*$|TICKET\s*$|TICKET\s+FISCAL\s*$|NOTA\s+DE\s+(?:CR[EÉ]DITO|D[EÉ]BITO)\s*$)/.test(s));
 const hline=heading>=0?normal[heading]:'';
 let tipo=/^REMITO/.test(hline)?'Remito':/^TICKET/.test(hline)?'Ticket':/^NOTA DE CREDITO/.test(hline)?'Nota de crédito':/^NOTA DE DEBITO/.test(hline)?'Nota de débito':/FACTURA/.test(hline)?'Factura':'No determinado';
 if(tipo==='No determinado'){
   const start=normal.slice(0,18).join(' ');
   tipo=/\bFACTURA\b/.test(start)?'Factura':/\bREMITO\b/.test(start)?'Remito':/\bTICKET\b/.test(start)?'Ticket':'No determinado';
 }
 let letra=tipo==='Factura'?(hline.match(/FACTURA\s+([ABCME])\b/)||hline.match(/\b([ABCME])\s+FACTURA\b/)||[])[1]||'':'';
 let proveedor='';
 const providerCandidates=heading>=0?lines.slice(0,heading):lines.slice(0,12);
 for(const s of providerCandidates){
 if(/^(?:DOCUMENTO\s+FICTICIO|SIN\s+VALIDEZ|DOMICILIO|ID\s+FISCAL|CUIT|IVA|ORIGINAL|A\s+FACTURA|FECHA|COD\s*0?1|PTO\.?\s*VENTA)\b/i.test(s))continue;
 if(/\bFACTURA\b/.test(simple(s)))continue;
 if(/[a-zA-ZÁÉÍÓÚÑáéíóúñ]{3}/.test(s)){proveedor=s.slice(0,110).trim();break;}
 }
 if(!proveedor&&heading>=0)proveedor=lines.find(x=>/[a-zA-Z]{4}/.test(x)&&!/DOCUMENTO FICTICIO|SIN VALIDEZ|DOMICILIO|ID FISCAL/i.test(x))||'';
 const dateMatch=original.match(/\b(?:FECHA(?:\s+DE\s+EMISION)?|EMISION)\s*[:\s]*(\d{2}[/-]\d{2}[/-]\d{4})/i);
 let fecha=dateMatch?dateMatch[1]:(original.match(/\b(\d{2}[/-]\d{2}[/-]\d{4})\b/)||[])[1]||'';
 let numero='';
 const numrx=/\b(?:N[°ºo.]\s*|NRO\.?\s*|NUMERO\s*[:]?\s*)(\d{4,5})\s*[-/]\s*(\d{5,12})/i;
 const nm=original.match(numrx);
 if(nm)numero=nm[1].padStart(4,'0')+'-'+nm[2].padStart(8,'0');
 if(!numero){const pv=(original.match(/\bPTO\.?\s*VENTA\s*:?\s*(\d{1,5})/i)||[])[1];const n=(original.match(/\bCPBTE\s*NRO\s*:?\s*(\d{4,12})/i)||[])[1];if(pv&&n)numero=pv.padStart(4,'0')+'-'+n.padStart(8,'0');}
 if(!numero){const fm=original.match(/\bFAC\s+(\d{1,5})\s+[ABCME]\s+(\d{4,12})/i);if(fm)numero=fm[1].padStart(4,'0')+'-'+fm[2].padStart(8,'0');}
 const cup=(original.match(/\bCUIT\s*:?\s*([0-9\s-]{11,16})\b/i)||[])[1]||'';
 const ids=[...original.matchAll(/\b(?:ID\s+FISCAL\s+FICTICIO|ID\s+CLIENTE)\s*:\s*(DEMO-[A-Z]\d+)/gi)].map(x=>x[1]);
 const own=(original.match(/ID\s+FISCAL\s+FICTICIO\s*:\s*(DEMO-[A-Z]\d+)/i)||[])[1]||'';
 const client=(original.match(/ID\s+CLIENTE\s*:\s*(DEMO-[A-Z]\d+)/i)||[])[1]||'';
 const cuits=[...original.matchAll(/\bCUIT\s*:?\s*(\d[\d\s-]{9,16}\d)/gi)].map(x=>x[1].replace(/\D/g,''));
 let total=extractLineValue(lines,/(?:^|\s{3,})TOTAL(?:\s+ARS|\s*\$|\s+A\s+PAGAR)?\b/);
 let subtotal=extractLineValue(lines,/^SUBTOTAL(?:\s+BRUTO)?\b/);
 let descuento=extractLineValue(lines,/^(?:DESCUENTO(?:\s+DOCUMENTO)?|BONIF(?:ICACI[OÓ]N)?)\b/);
 let neto=extractLineValue(lines,/^NETO(?:\s+GRAVADO)?\b/);
 const ivas=lines.filter(x=>/^IVA\s+\d+(?:[.,]\d+)?\s*%/i.test(x)).map(valueAtEnd).filter(x=>x!==null);
 const iva=ivas.length?Math.round(ivas.reduce((a,b)=>a+b,0)*100)/100:extractLineValue(lines,/^IVA\s+(?!INCLUIDO)/);
 const percepcion_iibb=extractLineValue(lines,/^PERCEPCI[OÓ]N\s+IIBB\b/);
 let articles=tipo==='Ticket'?parseTickets(lines):parseTable(lines,tipo);
 if(!articles.length&&tipo!=='Ticket')articles=parseLegacy(lines);
 const condition=(original.match(/\b(?:CONTADO|CUENTA CORRIENTE|TRANSFERENCIA|EFECTIVO|TARJETA(?:\s+DE\s+D[EÉ]BITO)?)\b/i)||[])[0]||'';
 const ref=(original.match(/\bOPERACI[OÓ]N\s+(DEMO-\d+)/i)||[])[1]||'';
 const link=(original.match(/\b(?:FACTURA\s*[ABCME]?|REMITO)\s+(\d{4,5})-(\d{5,12})/i)||[]);
 const alertas=[];
 if(tipo==='No determinado')alertas.push('Tipo de comprobante no identificado con seguridad.');
 if(!proveedor)alertas.push('No se identificó el proveedor.');
 if(!fecha)alertas.push('No se encontró la fecha.');
 if(!numero)alertas.push('No se encontró el número de comprobante.');
 if(!articles.length)alertas.push('No se reconocieron artículos. Revisá el documento y la calidad de la imagen.');
 if(articles.some(a=>a.advertencia_ocr))alertas.push('Una o más unidades fueron normalizadas por posible error OCR: verificá las originales.');
 if(tipo==='Remito'&&total===null)alertas.push('Remito sin precios: se mantienen vacíos hasta recibir otro documento.');
 if(neto!==null&&iva!==null&&total!==null){const dif=Math.abs(neto+iva+(percepcion_iibb||0)-total);if(dif>.06)alertas.push('El total no coincide con neto + IVA + percepciones; verificá descuentos y conceptos adicionales.');}
 if(total!=null && articles.length && articles.every(a=>a.importe!=null)){
  let sum=articles.reduce((s,a)=>s+a.importe,0);if(tipo==='Factura'&&neto!=null&&Math.abs(sum-neto)>.08)alertas.push('La suma de importes de artículos difiere del neto: revisar redondeos y descuentos.');
 }
 return {tipo,letra,numero,fecha,proveedor,cuit_proveedor:cuits[0]||'',cuit_comprador:cuits[1]||'',identificacion_proveedor:own,identificacion_comprador:client,condicion_venta:condition,cae:(original.match(/\bCAE\s*:?\s*(\d{10,18})/i)||[])[1]||'',neto,iva,total,subtotal_bruto:subtotal,descuento_documento:descuento,percepcion_iibb,referencia_operacion:ref,referencia_comprobante:link.length?link[1]+'-'+link[2]:'',articulos:articles,advertencias:alertas,observaciones:'',texto_extraido:original,metodo:'',paginas:1,nombre_archivo:name,revisado_local:false};
}
