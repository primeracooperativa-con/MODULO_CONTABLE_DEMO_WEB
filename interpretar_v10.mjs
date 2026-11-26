// V10 - Lector local experimental. No registra operaciones ni modifica stock.
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
export function numberValue(v){let s=String(v??'').replace(/\s/g,'').replace(/[^\d.,-]/g,'');if(!s||s==='-')return null;let c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0)s=c>d?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(c>=0)s=s.length-c-1===3?s.replace(/,/g,''):s.replace(',','.');else if(d>=0&&s.length-d-1===3)s=s.replace('.','');let n=Number(s);return Number.isFinite(n)?n:null}
const line=x=>String(x??'').replace(/\|/g,' ').replace(/\s+/g,' ').trim();
const money=/^-?(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)$/;
const units=new Set('UN UNI UNID UNIDADES U KG KGS G L LT LTS ML M MT ROLLO ROLLOS PAQ PACK PAR CAJA BOLSA BIDON SERV SERVICIO PZA PCS'.split(' '));
function aRow(code,desc,q,unit,price=null,discount=null,rate=null,sum=null){return {codigo_proveedor:code||'',descripcion:line(desc),cantidad:q,unidad:unit||'',precio_unitario:price,descuento_porcentaje:discount,iva_porcentaje:rate,importe:sum,sector:'',identificacion:'Pendiente',codigo_generico:''}}
function invoiceRows(lines){
 let out=[];for(let raw of lines){const t=line(raw).split(' ');if(t.length<6||!/^[A-Z0-9][A-Z0-9./_-]{1,16}$/i.test(t[0]))continue;
  for(let i=2;i<t.length-2;i++){if(!/^\d+(?:[.,]\d+)?$/.test(t[i])||!units.has(norm(t[i+1])))continue;
   let tail=t.slice(i+2);if(tail.length<2||tail.length>4||!tail.every(x=>money.test(x.replace(/%$/,''))))continue;
   let q=numberValue(t[i]),price=numberValue(tail[0]),disc=tail.length>=3?numberValue(tail[1]):null,vat=tail.length===4?numberValue(tail[2].replace('%','')):null,sum=numberValue(tail.at(-1));
   if(q==null||price==null||sum==null||i<2||Math.abs(q*price*(1-(disc||0)/100)-sum)>Math.max(1,sum*.025))continue;
   out.push(aRow(t[0],t.slice(1,i).join(' '),q,t[i+1],price,disc,vat,sum));break;
  }
 }return out;
}
function remitoRows(lines){
 let out=[];for(const raw of lines){
  const t=line(raw).split(' ');if(t.length<4||!/^[A-Z0-9][A-Z0-9./_-]{1,16}$/i.test(t[0]))continue;
  if(!units.has(norm(t[2])))continue;
  const legible=/^\d+(?:[.,]\d+)?$/.test(t[1]);
  const ambiguous=/^[aIl]$/.test(t[1]);
  const q=legible?numberValue(t[1]):ambiguous?1:null;
  const desc=t.slice(3).join(' ');
  if(!desc||desc.length<5)continue;
  const row=aRow(t[0],desc,q,t[2]);
  if(ambiguous)row.advertencia_ocr='Cantidad OCR interpretada como 1 a partir de una letra. Confirmá con el original.';
  if(!legible&&!ambiguous){
   row.advertencia_ocr='Cantidad ilegible en OCR (se leyó: '+t[1]+'). Se conserva el artículo para revisión.';
  }
  out.push(row);
 }
 return out;
}
function mergeRemitoRows(groups){
 const result=[];
 const tokens=x=>norm(x).replace(/[^A-Z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
 const isSame=(a,b)=>{
  const ca=norm(a.codigo_proveedor||''),cb=norm(b.codigo_proveedor||'');
  if(ca.length>=4&&cb.length>=4&&(ca===cb||ca.startsWith(cb)||cb.startsWith(ca)))return true;
  const aa=tokens(a.descripcion),bb=tokens(b.descripcion);
  if(aa.length<3||bb.length<3)return false;
  const overlap=aa.filter(x=>bb.includes(x)).length;
  return overlap/Math.max(aa.length,bb.length)>=.78;
 };
 for(const group of groups){
  for(const row of remitoRows(group)){
   const i=result.findIndex(x=>isSame(x,row));
   if(i<0){result.push(row);continue;}
   const prev=result[i];
   if(row.codigo_proveedor.length>prev.codigo_proveedor.length)prev.codigo_proveedor=row.codigo_proveedor;
   if(row.descripcion.length>prev.descripcion.length)prev.descripcion=row.descripcion;
   if(prev.cantidad==null&&row.cantidad!=null){
    prev.cantidad=row.cantidad;
    prev.unidad=row.unidad;
    prev.advertencia_ocr='Cantidad recuperada con otra lectura OCR. Comprobá el dato contra el remito.';
   } else if(prev.cantidad!=null&&row.cantidad!=null&&prev.cantidad!==row.cantidad){
    prev.cantidad=null;
    prev.advertencia_ocr='Lecturas OCR contradictorias de la cantidad. Revisá el original.';
   }
  }
 }
 return result;
}
function ticketRows(lines){
 let out=[];for(let i=0;i<lines.length-1;i++){
  let m=line(lines[i]).match(/^(\d+(?:[.,]\d+)?)\s*[x×]\s*([\d.,]+)\s*\((\d{1,2}(?:[.,]\d+)?)\)/i);if(!m)continue;
  const next=line(lines[i+1]),am=(next.match(/(-?[\d.,]+)$/)||[])[1];if(!am||/^(TOTAL|EFECTIVO|TARJ|IVA|CAE|VTO)/i.test(next))continue;
  let desc=next.slice(0,next.length-am.length).trim(),q=numberValue(m[1]),p=numberValue(m[2]),sum=numberValue(am);
  if(!desc||q==null||p==null||sum==null)continue;
  let r=aRow('',desc,q,'',p,0,numberValue(m[3]),sum);
  if(Math.abs(q*p-sum)>Math.max(.1,sum*.01))r.advertencia_ocr='Cantidad × precio no coincide con importe. Revisar.';
  out.push(r);i++;
 }return out;
}
const match=(t,rs)=>{for(const r of rs){const m=t.match(r);if(m)return m[1]||'';}return ''};
const amountTail=l=>{const x=line(l).match(/(-?\d[\d.,]*)\s*$/);return x?numberValue(x[1]):null};
function byLabel(lines,rx){for(let i=lines.length-1;i>=0;i--){const t=line(lines[i]),m=t.match(rx);if(!m)continue;const x=t.slice(m.index+m[0].length).match(/(?:USD|ARS|US\$)?\s*\$?\s*(-?\d[\d.,]*)/i);if(x)return numberValue(x[1]);}return null}
function supplier(lines){
 const i=lines.findIndex(x=>/RAZ[OÓ]N\s+SOCIAL\s*:/i.test(x));
 if(i>=0){let v=lines.slice(i,i+3).join(' ').replace(/^.*?RAZ[OÓ]N\s+SOCIAL\s*:\s*/i,'');
   v=v.split(/\s+(?:PUNTO\s+DE\s+VENTA|COMP\.?\s*NRO|FECHA\s+DE\s+EMISI[OÓ]N|DOMICILIO|CUIT\s*:)/i)[0].trim();
   v=v.replace(/\bS\.?\s*R\.?\s*L\.?\b\.?/gi,'S.R.L.').replace(/\bS\.?\s*A\.?\b\.?/gi,'S.A.');
   const next=lines[i+1]||'';if(/^S\.?A\.?\b/i.test(next)&&!/S\.?A\.?$/i.test(v))v+=' S.A.';
   return line(v);
 }
 const top=lines.slice(0,14).find(x=>/(S\.?A\.?|S\.?R\.?L\.?)\b/i.test(x)&&!/CUIT|INGRESOS|DOMICILIO|COOPERATIVA|CONSUMIDOR|ESTUDIO CONTABLE/i.test(x));
 if(top)return line(top).split(/\s+(?:V[AÁ]LIDO\s+COMO|UNO\s+COMO|RECONO\.?|N[°*]|PUNTO\s+DE\s+VENTA)/i)[0];
 const options=lines.slice(0,12).filter(x=>/^[\p{L}][\p{L} .&-]{3,70}$/u.test(x)&&!/^(FECHA|CUIT|IVA|ORIGINAL|REMITO|FACTURA|TICKET|TIQUE|COD|PUNTO|CONDICION|INGRESOS|INICIO|RAZON)/i.test(x));
 return options.sort((a,b)=>b.length-a.length)[0]||'';
}
function docType(t){const a=norm(t);if(/\bREMITO\b/.test(a))return 'Remito';if(/\b(?:TIQUE|TICKET)\s+FACTURA\b|\bTICKET\b/.test(a))return 'Ticket';if(/\bFACTURA\b/.test(a))return 'Factura';if(/NOTA DE CREDITO/.test(a))return 'Nota de crédito';if(/NOTA DE DEBITO/.test(a))return 'Nota de débito';return 'No determinado'}
function docLetter(t,type){if(type==='Remito')return '';let a=norm(t);let m=a.match(/(?:TIQUE|TICKET)\s+FACTURA\s*["']?\s*([ABCE])/);if(m)return m[1];m=a.match(/(?:^|\n)\s*([ABCE])\s*(?:\|\s*)?(?:COD\.?\s*\d+\s*)?FACTURA\b/);if(m)return m[1];const c=a.match(/\bCOD\.?\s*(01|06|11|19)\b/);return c?({'01':'A','06':'B','11':'C','19':'E'})[c[1]]:''}
function docNumber(t){
 let m=t.match(/(?:PUNTO\s+DE\s+VENTA|PTO\.?\s*VENTA)\s*:?\s*(\d{1,5})\s+(?:COMP\.?\s*NRO\.?|CPBTE\.?\s*NRO\.?)\s*:?\s*(\d{4,12})/i);
 if(!m)m=t.match(/P\.?V\.?\s*NRO\.?\s*:?\s*(\d{1,5})\s+NRO\.?\s*T\.?\s*:?\s*(\d{4,12})/i);
 if(m)return m[1].padStart(4,'0')+'-'+m[2].padStart(8,'0');
 m=t.match(/\bN[°º]\s*(\d{4,5})-(\d{5,12})/i)||t.match(/\b(\d{4,5})-(\d{5,12})/i);
 return m?m[1]+'-'+m[2]:'';
}
export function interpretarComprobante(text,name='',zones={}){
 const source=String(text||'').replace(/\r/g,''),head=String(zones.headerText||''),table=String(zones.tableText||''),summary=String(zones.summaryText||'');
 const mainLines=source.split('\n').map(line).filter(Boolean),headerLines=head.split('\n').map(line).filter(Boolean),tableLines=table.split('\n').map(line).filter(Boolean),sumLines=summary.split('\n').map(line).filter(Boolean);
 const all=source+'\n'+head+'\n'+table+'\n'+summary,lines=[...mainLines,...headerLines,...tableLines,...sumLines],topLines=[...headerLines,...mainLines];
 const tipo=docType(all),letra=docLetter(all,tipo),numero=docNumber(all),fecha=match(all,[/\bFECHA\s+DE\s+EMISI[OÓ]N\s*:?\s*(\d{2}[/-]\d{2}[/-]\d{4})/i,/\bFECHA\s*:\s*(\d{2}[/-]\d{2}[/-]\d{4})/i]);
 function cleanIssuerName(raw){
  const name=line(raw);
  const legal=name.match(/^(.+?(?:\bS\.?\s*R\.?\s*L\.?|\bS\.?\s*A\.?|\bLTDA\.?))(?=\s|$)/i);
  return legal?legal[1].trim():name;
 }
 const issuerLines=String(zones.supplierText||'').split('\n').map(line).filter(Boolean);
 const issuerName=issuerLines.length?cleanIssuerName(supplier(issuerLines)):'';
 // Priorizar emisor desde su zona fisica, sin mezclarlo con el cliente.
 let proveedor=Object.prototype.hasOwnProperty.call(zones,'supplierText')?(issuerName&&issuerName.length>=7?issuerName:''):supplier(topLines);
 if(/^(?:S\.?R\.?L\.?|S\.?A\.?|LTDA\.?|SRL)$/i.test(proveedor.trim())){
   const comercial=topLines.find(x=>/\b(?:LA CHACRA AGROINSUMOS|AGROINSUMOS LA CHACRA)\b/i.test(x)&&!/RAZ[OÓ]N SOCIAL|CUIT|DOMICILIO/i.test(x));
   proveedor=comercial?line(comercial).replace(/\s+(?:A\s+FACTURA|FACTURA|PUNTO\s+DE\s+VENTA).*$/i,'').trim():'';
 }
 let cuits=[...new Set([...all.matchAll(/\bCUIT\s*(?:NRO\.?\s*)?:?\s*(\d[\d\s-]{9,16}\d)/gi)].map(x=>x[1].replace(/\D/g,'')).filter(x=>x.length===11))];
 let cuitInferido=false;if(cuits.length===1){
  let m=all.match(/INGRESOS\s+BRUTOS\s*:?\s*(\d[\d\s-]{9,16}\d)/i),v=m?m[1].replace(/\D/g,''):'';
  if(v.length===11&&v!==cuits[0]){cuits=[v,cuits[0]];cuitInferido=true;}
 }
 const cae=match(all,[/\bCAE\s*(?:N[°º*]\s*)?:?\s*(\d{10,18})/i]);
 const cai=match(all,[/\bC\.?A\.?[I1l]\.?\s*(?:N[°º*]\s*)?:?\s*(\d{10,18})/i]);
 const fecha_vto_cae=match(all,[/VTO\.?\s+DE\s+CAE\s*:\s*(\d{2}\/\d{2}\/\d{4})/i,/VTO\.?\s+CAE\s*:\s*(\d{2}\/\d{2}\/\d{4})/i]);
 const moneda=tipo==='Remito'?'':(/\bUSD\b|US\$|U\$S|DOLAR/i.test(all)?'USD':(/\$|\bARS\b|PESOS/i.test(all)?'ARS':''));
 const arLines=mainLines;
 let articulos=tipo==='Remito'?mergeRemitoRows([mainLines,tableLines]):tipo==='Ticket'?ticketRows(arLines):invoiceRows(arLines);
 const other=tipo==='Ticket'?ticketRows(tableLines):tipo==='Factura'?invoiceRows(tableLines):[];
 if(other.length>articulos.length)articulos=other;
 const subtotal_bruto=byLabel(lines,/^SUBTOTAL\s*:?/i);
 let neto=byLabel(lines,/IMPORTE\s+NETO\s+GRAVADO\s*:?/i),neto_estimado=false;
 const total=byLabel(lines,/(?:IMPORTE\s+TOTAL|^TOTAL)\s*:?/i),iva_contenido=byLabel(lines,/IVA\s+CONTENIDO\s*:?/i);
 let iva_por_alicuota={};for(const l of lines){const m=l.match(/\bIVA\s*(\d{1,2}(?:[.,]\d+)?)\s*%\s*:?/i);if(!m)continue;const x=l.slice(m.index+m[0].length).match(/(?:USD|ARS)?\s*\$?\s*(-?\d[\d.,]*)/i);if(x)iva_por_alicuota[m[1].replace(',','.')]=numberValue(x[1]);}
 if(tipo==='Factura'){const calc={};for(const a of articulos){if(a.iva_porcentaje!=null&&a.importe!=null){const k=String(a.iva_porcentaje);calc[k]=(calc[k]||0)+a.importe*a.iva_porcentaje/100;}}
  for(const [k,v] of Object.entries(calc))if(iva_por_alicuota[k]===undefined)iva_por_alicuota[k]=Math.round(v*100)/100;
 }
 const iva=Object.values(iva_por_alicuota).reduce((a,b)=>a+b,0)||null;
 if(neto==null&&tipo==='Factura'&&iva!=null&&iva_contenido==null&&articulos.length&&articulos.every(a=>a.importe!=null)){neto=Math.round(articulos.reduce((a,b)=>a+b.importe,0)*100)/100;neto_estimado=true;}
 const percepcion_iibb=byLabel(lines,/PERCEPCI[OÓ]N\s+(?:IIBB|LIBB|1IBB)(?:\s+[A-ZÁÉÍÓÚÑ0-9]+)*/i);
 const percepcion_iva=byLabel(lines,/PERCEPCI[OÓ]N\s+IVA(?:\s+[A-ZÁÉÍÓÚÑ0-9]+)*/i);
 const otros_tributos=byLabel(lines,/IMPORTE\s+OTROS\s+TRIBUTOS\s*:?/i);
 const referencia_comprobante=match(all,[/\bREF\.?\s*:\s*(?:FACTURA\s*[ABCE]?\s*)?(\d{4,5}-\d{5,12})/i,/\bFACTURA\s+[ABCE]\s+(\d{4,5}-\d{5,12})/i]);
 const orden_compra=match(all,[/ORDEN\s+DE\s+COMPRA\s*(?:N[°º])?\s*:?\s*([A-Z0-9-]+)/i]);
 let condicion_venta=match(all,[/CONDICI[OÓ]N\s+DE\s+VENTA\s*:\s*([^\n]+)/i]);if(condicion_venta)condicion_venta=condicion_venta.split(/\s+FECHA\s+DE\s+VTO/i)[0].trim();
 if(!condicion_venta&&tipo==='Ticket')condicion_venta=match(all,[/\b(EFECTIVO|TARJ\.?\s*CREDITO|TARJETA\s+DE\s+CREDITO|TARJETA\s+DE\s+DEBITO|TRANSFERENCIA)\b/i]);
 const advertencias=[];
 if(proveedor===''&&tipo!=='No determinado')advertencias.push('Proveedor: no se identificó la razón social con seguridad.');
 if(tipo==='Ticket'&&articulos.length&&total!=null&&articulos.every(a=>a.importe!=null)){
  const suma=Math.round(articulos.reduce((a,b)=>a+b.importe,0)*100)/100;
  if(Math.abs(suma-total)>.06)advertencias.push('La suma de artículos ('+suma.toFixed(2)+') no coincide con el total ('+total.toFixed(2)+'). Revisar también pagos y vuelto.');
 }
 if(tipo==='Factura'&&neto!=null&&iva!=null&&total==null)advertencias.push('Total no leído. No se completa automáticamente porque podrían faltar tributos o decimales.');
 if(!numero)advertencias.push('Número de comprobante no reconocido.');if(!fecha)advertencias.push('Fecha no reconocida.');if(!proveedor)advertencias.push('Proveedor no identificado.');
 if(!articulos.length)advertencias.push('No se identificaron los renglones. Corregir manualmente y revisar el documento.');
 if(tipo==='Remito'&&articulos.some(a=>a.cantidad==null))advertencias.push('Uno o más artículos tienen cantidades ilegibles. Completalas antes de revisar el remito.');
 if(neto_estimado)advertencias.push('Neto calculado a partir de artículos y no leído directamente. Revisar.');
 if(cuitInferido)advertencias.push('CUIT del proveedor propuesto desde Ingresos Brutos: verificar con el original.');
 if(tipo==='Remito')advertencias.push('Remito: los precios e importes se mantienen vacíos.');
 if(!moneda&&tipo!=='Remito')advertencias.push('Moneda no identificada.');
 return {tipo,letra,numero,fecha,fecha_vto_cae,proveedor,moneda,cuit_proveedor:cuits[0]||'',cuit_comprador:cuits[1]||'',identificacion_proveedor:'',identificacion_comprador:'',condicion_venta,cae,cai,neto,neto_estimado,iva,iva_por_alicuota,iva_contenido,percepcion_iibb,percepcion_iva,otros_tributos,total,subtotal_bruto,descuento_documento:null,referencia_operacion:'',referencia_comprobante,orden_compra,articulos,advertencias,observaciones:'',texto_extraido:source,metodo:'',paginas:1,nombre_archivo:name,revisado_local:false};
}
