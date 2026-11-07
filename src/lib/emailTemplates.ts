/**
 * Plantillas de TODOS los correos del sistema. Hasta el 04-10-2026 vivían en el workflow
 * de n8n «mail web» (`psmygb0sPt0OQddx`); esto es ese código traído tal cual —mismos
 * asuntos, mismos textos, mismo HTML— para enviar directo con Resend sin n8n en el medio.
 *
 * Tres familias, igual que las tres ramas del Switch de n8n:
 *   - cotización (`quote_email_requested`, `quote_email_adjusted`): antes salía por Gmail.
 *   - aviso de pago aprobado al dueño (`payment_approved`): antes salía por Gmail.
 *   - el resto (sistema de correos): ya salía por Resend, desde n8n.
 *
 * Un evento desconocido LANZA a propósito: el emisor lo registra como fallo y nunca lo da
 * por enviado. Agregar un correo nuevo = agregar un caso acá.
 *
 * Los textos no llevan tildes porque así estaban en n8n; no se corrigieron en la mudanza
 * para que el cambio de transporte no cambie además lo que lee el cliente.
 */

import { siteBaseUrl, toHiddenFileUrl } from '@/lib/fileLinks'

/* eslint-disable no-var, prefer-const */

export interface RenderedEmail {
  to: string
  subject: string
  html: string
  text?: string
}

/** El remitente que usaba n8n. Dominio verificado en la cuenta de Resend de Yo me Encargo. */
export const DEFAULT_FROM = 'Yo me Encargo <contacto@yomeencargo.cl>'

const TEL = '+56 9 5439 0267'
const esc = (s: any) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const clp = (n: any) => { let v = Math.round(Number(n)); if (!v || isNaN(v)) v = 0; return '$' + v.toLocaleString('es-CL') }

const VERDE = '#8CC63F';
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const fechaLarga = (f: any) => {
  if (!f || String(f).indexOf('-') === -1) return f || '';
  const p = String(f).split('-');
  return parseInt(p[2], 10) + ' de ' + (MESES[parseInt(p[1], 10) - 1] || '') + ' de ' + p[0];
};
const hhmm = (h: any) => (h ? String(h).slice(0, 5) : '');

const fila = (label: any, val: any) => val
  ? '<tr><td style="padding:10px 0;border-bottom:1px solid #EEF0F2;color:#6B7280;font-size:14px;">' + label + '</td><td style="padding:10px 0;border-bottom:1px solid #EEF0F2;color:#111827;font-size:14px;font-weight:600;text-align:right;">' + esc(val) + '</td></tr>'
  : '';

const tabla = (titulo: any, rows: any) => rows
  ? '<tr><td style="padding:26px 32px 0;"><p style="margin:0 0 6px;color:#111827;font-size:15px;font-weight:700;">' + esc(titulo) + '</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows + '</table></td></tr>'
  : '';

const detalle = (r: any) => tabla('Detalle de tu mudanza',
  fila('Fecha', fechaLarga(r.fecha)) + fila('Hora', hhmm(r.hora)) + fila('Origen', r.origen) + fila('Destino', r.destino));

const boton = (url: any, texto: any) => url
  ? '<tr><td style="padding:22px 32px 0;text-align:center;"><table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr><td style="border-radius:12px;background:' + VERDE + ';"><a href="' + url + '" target="_blank" style="display:inline-block;padding:15px 30px;color:#0E1A05;font-size:17px;font-weight:700;text-decoration:none;border-radius:12px;">' + texto + '</a></td></tr></table></td></tr>'
  : '';

const destacado = (etiqueta: any, monto: any) => monto
  ? '<tr><td style="padding:20px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2FBE9;border:2px solid ' + VERDE + ';border-radius:16px;"><tr><td style="padding:20px;text-align:center;"><span style="color:#3F6212;font-size:13px;font-weight:700;">' + esc(etiqueta) + '</span><br><span style="color:#111827;font-size:32px;font-weight:800;">' + clp(monto) + '</span></td></tr></table></td></tr>'
  : '';

const aviso = (texto: any) => texto
  ? '<tr><td style="padding:18px 32px 0;"><p style="margin:0;color:#9A3412;font-size:13px;background:#FFF7ED;border:1px solid #FFEDD5;border-radius:10px;padding:10px 14px;">' + esc(texto) + '</p></td></tr>'
  : '';

const parrafo = (t: any) => '<tr><td style="padding:10px 32px 0;"><p style="margin:0;color:#374151;font-size:15px;line-height:1.55;">' + esc(t) + '</p></td></tr>';

const lista = (titulo: any, puntos: any) => (puntos && puntos.length)
  ? '<tr><td style="padding:24px 32px 0;"><p style="margin:0 0 8px;color:#111827;font-size:15px;font-weight:700;">' + esc(titulo) + '</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="color:#374151;font-size:14px;line-height:1.5;">' + puntos.map((x: any) => '<tr><td style="padding:4px 0;">' + esc(x) + '</td></tr>').join('') + '</table></td></tr>'
  : '';

const pdfLink = (url: any) => url
  ? '<tr><td style="padding:18px 32px 0;"><a href="' + url + (url.indexOf('?') > -1 ? '&' : '?') + 'download=cotizacion-yomeencargo.pdf" target="_blank" style="color:#2563EB;font-size:14px;text-decoration:underline;">Descargar mi cotizacion en PDF</a></td></tr>'
  : '';

const shell = (titulo: any, cuerpo: any) => [
  '<!DOCTYPE html>',
  '<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(titulo) + '</title></head>',
  '<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;">',
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;"><tr><td align="center">',
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(17,24,39,0.06);">',
  '<tr><td style="padding:24px 32px 18px;text-align:center;border-bottom:3px solid ' + VERDE + ';"><img src="https://yomeencargo.cl/logo.png" alt="Yo me Encargo" height="40" style="height:40px;display:inline-block;"></td></tr>',
  '<tr><td style="padding:30px 32px 6px;"><h1 style="margin:0;color:#111827;font-size:23px;line-height:1.25;">' + esc(titulo) + '</h1></td></tr>',
  cuerpo,
  '<tr><td style="padding:26px 32px 30px;text-align:center;background:#111827;"><p style="margin:0;color:#ffffff;font-size:15px;font-weight:700;">Yo me Encargo</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">Mudanzas y fletes con precio fijo</p><p style="margin:10px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">Dudas? Llamanos: ' + TEL + '</p><p style="margin:4px 0 0;"><a href="https://yomeencargo.cl" style="color:' + VERDE + ';font-size:13px;text-decoration:none;">yomeencargo.cl</a></p><p style="margin:6px 0 0;"><a href="https://yomeencargo.cl/politicas-de-garantia" style="color:rgba(255,255,255,0.7);font-size:12px;text-decoration:underline;">Pol&iacute;ticas de garant&iacute;a</a></p></td></tr>',
  '</table></td></tr></table></body></html>'
].join('');


/** Rama «sistema»: los correos automáticos y el link de ingreso. */
function renderSystem(d: any): RenderedEmail {
  const ev = d.event;
  const c = d.cliente || {};
  const r = d.reserva || {};
  const q = d.cotizacion || {};
  const p = d.pago || {};
  const primer = esc(c.nombre || 'Cliente').split(' ')[0];
  const fecha = fechaLarga(r.fecha || q.fecha);
  const cotizador = d.cotizador_url || 'https://yomeencargo.cl';
  let subject = '';
  let cuerpo = '';
  let to = c.email;

  if (ev === 'booking_confirmed') {
    // El #05 lo reciben tambien las reservas MANUALES desde sep-2026, y esas pueden
    // entrar sin pago, con abono parcial o pagadas. `pago.pagado` trae lo cobrado de
    // verdad; si no viene (payload anterior), se asume lo de siempre: al #05 solo se
    // llegaba con un pago aprobado. Ningun cliente puede leer "Recibimos tu pago" sin
    // haber pagado.
    const pagado = (p.pagado === undefined || p.pagado === null) ? null : (Number(p.pagado) || 0);
    const saldo = Number(p.saldo_pendiente) || 0;
    const sinPago = pagado === 0;
    // "el 50%" se conserva cuando de verdad lo es (el caso web); si no, el monto real.
    const abonoTxt = (pagado === null || (p.tipo === 'Abono 50%' && Math.abs(pagado - saldo) <= 1)) ? 'el 50%' : clp(pagado);
    subject = primer + ', tu mudanza del ' + fecha + ' esta confirmada';
    cuerpo = parrafo(sinPago
        ? 'Tu mudanza quedo agendada y tu cupo esta reservado. Coordinamos los ultimos detalles por WhatsApp unos dias antes.'
        : 'Recibimos tu pago y tu cupo quedo asegurado. Coordinamos los ultimos detalles por WhatsApp unos dias antes.')
      + destacado('Total de tu servicio', r.precio_total)
      + (saldo ? aviso(sinPago
          ? 'Queda pendiente el pago de ' + clp(saldo) + '.'
          : 'Abonaste ' + abonoTxt + '. El saldo de ' + clp(saldo) + ' se paga al finalizar el traslado.') : '')
      + detalle(r)
      + lista('Que preparar', ['Embala lo fragil y rotula las cajas.', 'Reserva el estacionamiento mas cercano a la puerta.', 'Si hay ascensor, avisa a conserjeria el dia anterior.', 'Ten a mano lo que necesites ese mismo dia.']);

  } else if (ev === 'payment_due') {
    const step = String(d.step || '2h');
    subject = step === '72h' ? primer + ', ultimo aviso por tu mudanza del ' + fecha
            : step === '24h' ? primer + ', tu mudanza del ' + fecha + ' sigue sin confirmar'
            : primer + ', tu cupo del ' + fecha + ' todavia no esta asegurado';
    cuerpo = parrafo('Tu cotizacion sigue vigente y el precio esta fijo. Solo falta el abono para que la fecha quede reservada a tu nombre.')
      + destacado('Abona para reservar tu cupo', p.monto)
      + boton(p.flow_payment_url, 'Abonar y asegurar mi cupo &rarr;')
      + '<tr><td style="padding:12px 32px 0;text-align:center;"><p style="margin:0;color:#6B7280;font-size:12px;">Pago seguro procesado por Flow / Webpay.</p></td></tr>'
      + aviso(step === '72h' ? 'Si no recibimos el abono, liberamos el cupo para otra mudanza y esta reserva se cierra.' : 'Tu fecha y horario se confirman solo con el abono. Reservar ahora evita que otra mudanza tome tu cupo.')
      + detalle(r);

  } else if (ev === 'payment_rejected') {
    subject = primer + ', tu pago no se proceso';
    cuerpo = parrafo('No se te cobro nada. Suele ser un rechazo del banco o un limite de la tarjeta, y se resuelve reintentando o usando otro medio de pago.')
      + destacado('Monto del abono', p.monto)
      + boton(p.flow_payment_url, 'Reintentar el pago &rarr;')
      + detalle(r);

  } else if (ev === 'quote_recovery') {
    subject = primer + ', todavia necesitas mudarte?';
    cuerpo = parrafo('Quedo agendada una mudanza tuya para el ' + fecha + ' que nunca alcanzamos a concretar. Esa fecha ya paso, asi que la damos por cerrada: no tienes nada pendiente con nosotros.')
      + parrafo('Si todavia lo necesitas, cotizar de nuevo toma un par de minutos y el precio queda fijo, sin sorpresas.')
      + boton(cotizador, 'Cotizar mi mudanza &rarr;')
      + '<tr><td style="padding:18px 32px 0;"><p style="margin:0;color:#6B7280;font-size:13px;line-height:1.5;">Te escribimos una sola vez por esto. Si prefieres que no te contactemos mas, respondenos este correo.</p></td></tr>';

  } else if (ev === 'quote_auto') {
    subject = primer + ', tu cotizacion de mudanza esta lista (' + clp(q.precio_total) + ')';
    cuerpo = parrafo('Tu precio esta calculado y queda fijo: no cambia el dia de la mudanza. Puedes asegurar la fecha abonando la mitad ahora y pagar el resto al terminar el traslado.')
      + destacado('Total estimado de tu servicio', q.precio_total)
      + boton(cotizador, 'Reservar mi fecha &rarr;')
      + tabla('Detalle de tu cotizacion', fila('Fecha', fechaLarga(q.fecha)) + fila('Hora', hhmm(q.hora)) + fila('Origen', q.origen) + fila('Destino', q.destino) + fila('Vehiculo', q.vehiculo))
      + pdfLink(d.pdf_url);

  } else if (ev === 'quote_reminder') {
    subject = primer + ', tu cotizacion sigue vigente';
    cuerpo = parrafo('Te escribimos por la cotizacion que pediste ayer. El precio sigue firme y la fecha todavia esta disponible.')
      + destacado('Tu precio', q.precio_total)
      + boton(cotizador, 'Reservar mi fecha &rarr;')
      + aviso('Las fechas se ocupan por orden de reserva. La tuya se confirma con el abono.')
      + pdfLink(d.pdf_url);

  } else if (ev === 'quote_social_proof') {
    subject = primer + ', asi trabajamos en Yo me Encargo';
    cuerpo = parrafo('Antes de decidir, vale que sepas como trabajamos. Estas son las cosas que mas nos preguntan.')
      + lista('Lo que incluye tu mudanza', ['Precio fijo: el valor cotizado es el que pagas, sin cargos sorpresa al final.', 'Carga protegida durante todo el traslado.', 'Equipo propio: no subcontratamos el camion ni a la gente.', 'Coordinacion por WhatsApp desde que reservas hasta que terminamos.'])
      + destacado('Tu cotizacion', q.precio_total)
      + boton(cotizador, 'Reservar mi mudanza &rarr;');

  } else if (ev === 'quote_last_call') {
    subject = primer + ', ultima oportunidad para tu mudanza';
    cuerpo = parrafo('Paso una semana desde tu cotizacion y no queremos dejarla vencer sin avisarte.')
      + (q.es_flexible
          ? parrafo('Marcaste que tienes flexibilidad de fecha, y eso juega a tu favor: moviendo el dia a uno de menor demanda el precio baja.')
          : parrafo('Si tienes flexibilidad con la fecha, avisanos: moviendo el dia a uno de menor demanda podemos mejorarte el precio.'))
      + destacado('Tu cotizacion', q.precio_total)
      + boton(cotizador, 'Ver mi cotizacion &rarr;')
      + '<tr><td style="padding:18px 32px 0;"><p style="margin:0;color:#6B7280;font-size:13px;line-height:1.5;">Este es el ultimo correo que te enviamos por esta cotizacion.</p></td></tr>';

  } else if (ev === 'service_reminder_d3') {
    subject = primer + ', tu mudanza es en 3 dias';
    cuerpo = parrafo('Faltan tres dias. Este es el momento de dejar todo listo para que el dia de la mudanza sea rapido.')
      + lista('Checklist', ['Embala lo fragil con papel o burbuja y rotula cada caja por ambiente.', 'Vacia cajones y desconecta electrodomesticos con anticipacion.', 'Reserva el estacionamiento mas cercano a la puerta, en origen y destino.', 'Si hay ascensor, avisa a conserjeria: muchos edificios piden reservarlo.', 'Separa documentos, joyas y medicamentos para llevarlos contigo.'])
      + detalle(r);

  } else if (ev === 'service_reminder_d1') {
    subject = primer + ', tu mudanza es manana' + (hhmm(r.hora) ? ' a las ' + hhmm(r.hora) : '');
    const v = d.vehiculo || {};
    const filasV = fila('Camion', v.nombre) + fila('Color', v.color) + fila('Chofer', v.chofer) + fila('Telefono del chofer', v.telefono_chofer);
    cuerpo = parrafo('Ya esta todo listo. Manana llegamos a la hora acordada; si necesitas cambiar algo, escribenos hoy por WhatsApp.')
      + detalle(r)
      + tabla('Quien va a llegar', filasV)
      + aviso('Ten la carga embalada y lista antes de la hora. El equipo cuenta con ese tiempo para el resto del dia.');

  } else if (ev === 'review_request') {
    subject = primer + ', como nos fue?';
    // `dias` > 1 = el correo sale con atraso (la tarea no corrio ese dia): no se dice «ayer».
    cuerpo = parrafo((Number(d.dias) > 1 ? 'Hace unos dias hicimos tu mudanza.' : 'Ayer hicimos tu mudanza.') + ' Nos ayuda mucho saber que tal estuvo, y a quien esta buscando mudarse le sirve leer una opinion real.')
      + parrafo('Son dos minutos y hace mucha diferencia para nosotros.')
      + boton(d.review_url, 'Dejar mi resena &rarr;')
      // Código de referido (Tomás, 19-10-2026): solo si el programa está activo y el cliente tiene código.
      + (d.referido && d.referido.code
        ? '<tr><td style="padding:22px 32px 0;"><div style="border:1px dashed #8CC63F;border-radius:12px;padding:16px 18px;background:#F7FCF1;">'
          + '<p style="margin:0 0 6px;color:#111827;font-size:15px;font-weight:700;">Recomiendanos</p>'
          + '<p style="margin:0 0 10px;color:#374151;font-size:14px;line-height:1.5;">Si conoces a alguien que se va a mudar, pasale tu codigo: tiene ' + esc(d.referido.descuento) + ' de descuento en su primera mudanza reservando en ' + esc(String(d.referido.url).replace(/^https?:\/\//, '')) + '.</p>'
          + '<p style="margin:0;font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;color:#2C5282;">' + esc(d.referido.code) + '</p>'
          + '</div></td></tr>'
        : '')
      + '<tr><td style="padding:18px 32px 0;"><p style="margin:0;color:#6B7280;font-size:13px;line-height:1.5;">Si algo no salio como esperabas, respondenos este correo y lo vemos.</p></td></tr>';

  } else if (ev === 'reactivation') {
    subject = primer + ', necesitas mudarte de nuevo?';
    cuerpo = parrafo('Paso un mes desde tu mudanza. Si tienes algo pendiente por trasladar, o conoces a alguien que se este mudando, cotizar toma dos minutos y el precio queda fijo.')
      + boton(cotizador, 'Cotizar una mudanza &rarr;')
      + '<tr><td style="padding:18px 32px 0;"><p style="margin:0;color:#6B7280;font-size:13px;line-height:1.5;">Si prefieres que no te escribamos mas, respondenos este correo.</p></td></tr>';

  } else if (ev === 'internal_digest') {
    const sinC = d.leads_sin_contactar || [];
    const pag = d.pagos_recibidos || [];
    const fal = d.pagos_fallidos || [];
    const man = d.mudanzas_manana || [];
    to = d.to || c.email;
    subject = 'Resumen del dia ' + (d.fecha || '') + ' - ' + sinC.length + ' sin contactar, ' + man.length + ' manana';
    const total = pag.reduce((s: number, x: any) => s + (Number(x.monto) || 0), 0);
    cuerpo = destacado('Cobrado en las ultimas 24 h', total)
      + lista('Mudanzas de manana (' + man.length + ')', man.length ? man.map((m: any) => hhmm(m.hora) + ' - ' + (m.cliente || '') + ' - ' + (m.origen || '') + ' a ' + (m.destino || '')) : ['Ninguna agendada.'])
      + lista('Leads sin contactar hace mas de 24 h (' + sinC.length + ')', sinC.length ? sinC.slice(0, 25).map((l: any) => (l.nombre || '') + ' - ' + (l.email || '') + ' - ' + clp(l.monto)) : ['Ninguno pendiente.'])
      + lista('Pagos recibidos (' + pag.length + ')', pag.length ? pag.map((x: any) => (x.cliente || '') + ' - ' + clp(x.monto)) : ['Ninguno.'])
      + lista('Pagos fallidos (' + fal.length + ')', fal.length ? fal.map((x: any) => (x.cliente || '') + ' - ' + (x.email || '')) : ['Ninguno.'])
      + (sinC.length > 25 ? parrafo('Se muestran los 25 mas antiguos de ' + sinC.length + '. El resto esta en el panel.') : '');

  } else if (ev === 'customer_login_link') {
    // Link de acceso al Panel del Cliente (/mi-cuenta). Lo pide la persona desde la web:
    // vence y sirve una sola vez (lo controla el sitio, no este correo).
    const a = d.acceso || {};
    subject = 'Tu link para entrar a tu cuenta de Yo me Encargo';
    cuerpo = parrafo('Hola ' + primer + '. Con este boton entras a tu cuenta: ahi ves tus cotizaciones y reservas, y puedes pagar o cambiar la fecha.')
      + boton(a.url, 'Entrar a mi cuenta &rarr;')
      + aviso('El link vence en ' + (Number(a.vence_minutos) || 15) + ' minutos y sirve una sola vez. Si no lo pediste, ignora este correo.');

  } else {
    throw new Error('Evento no soportado por el nodo de plantillas: ' + JSON.stringify(ev));
  }


  if (!to) throw new Error('El payload de ' + ev + ' no trae destinatario')
  return { to, subject, html: shell(subject, cuerpo) }
}

/** Rama «cotización»: la que pide el cliente en la web y la ajustada desde el panel. */
function renderQuote(d: any): RenderedEmail {
  const meses = MESES
  var c = d.cliente || {};
  var q = d.cotizacion || {};
  var pago = d.pago || {};
  var nombre = esc(c.nombre || 'Cliente');
  var primer = nombre.split(' ')[0];
  var flow = pago.flow_payment_url || '#';
  var flow100 = pago.flow_payment_url_100 || '';
  var comentario = q.comentario_ajuste || '';
  var pdf = d.pdf_url || '';
  var fecha = q.fecha || '';
  if (q.fecha && String(q.fecha).indexOf('-') > -1) {
    var p = String(q.fecha).split('-');
    fecha = parseInt(p[2],10) + ' de ' + (meses[parseInt(p[1],10)-1] || '') + ' de ' + p[0];
  }
  var rows: string[] = [];
  var addRow = function(label: string, val: any){ if(val){ rows.push('<tr><td style="padding:10px 0;border-bottom:1px solid #EEF0F2;color:#6B7280;font-size:14px;">' + label + '</td><td style="padding:10px 0;border-bottom:1px solid #EEF0F2;color:#111827;font-size:14px;font-weight:600;text-align:right;">' + esc(val) + '</td></tr>'); } };
  addRow('Fecha', fecha);
  addRow('Hora', q.hora);
  addRow('Origen', q.origen);
  addRow('Destino', q.destino);
  if (q.distancia_km) addRow('Distancia', q.distancia_km + ' km');
  if (q.volumen_m3) addRow('Volumen', q.volumen_m3 + ' m3');
  addRow('Vehiculo', q.vehiculo);
  var detalle = rows.join('');
  var pdfBlock = '';
  if (pdf) {
    var pdfDl = pdf + (pdf.indexOf('?') > -1 ? '&' : '?') + 'download=cotizacion-yomeencargo.pdf';
    pdfBlock = '<tr><td style="padding:18px 32px 0;"><a href="' + pdfDl + '" target="_blank" style="color:#2563EB;font-size:14px;text-decoration:underline;">Descargar mi cotizacion en PDF</a></td></tr>';
  }
  var comentarioBlock = '';
  if (comentario) {
    comentarioBlock = '<tr><td style="padding:18px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;"><tr><td style="padding:14px 16px;"><p style="margin:0 0 4px;color:#1E3A8A;font-size:13px;font-weight:700;">Ajuste de tu cotizacion</p><p style="margin:0;color:#1E40AF;font-size:14px;line-height:1.5;">' + esc(comentario) + '</p></td></tr></table></td></tr>';
  }
  var cta100Block = '';
  if (flow100) {
    cta100Block = '<tr><td style="padding:14px 32px 0;text-align:center;"><p style="margin:0 0 8px;color:#374151;font-size:13px;">Prefieres pagar todo ahora? Obtienes 5% de descuento.</p><table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr><td style="border-radius:10px;border:2px solid #111827;"><a href="' + flow100 + '" target="_blank" style="display:inline-block;padding:12px 26px;color:#111827;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">Pagar 100% con descuento ({{TOTAL100}})</a></td></tr></table></td></tr>';
  }
  var parts = [
'<!DOCTYPE html>',
'<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu cotizacion</title></head>',
'<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;">',
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;"><tr><td align="center">',
'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(17,24,39,0.06);">',
'<tr><td style="padding:24px 32px 18px;text-align:center;border-bottom:3px solid #8CC63F;"><img src="https://yomeencargo.cl/logo.png" alt="Yo me Encargo" height="40" style="height:40px;display:inline-block;"></td></tr>',
'<tr><td style="padding:30px 32px 6px;"><h1 style="margin:0;color:#111827;font-size:23px;line-height:1.25;">Hola {{PRIMER}}, tu mudanza ya esta cotizada</h1><p style="margin:10px 0 0;color:#374151;font-size:15px;line-height:1.55;">Tu precio esta confirmado. Asegura tu fecha abonando solo la mitad ahora; el resto lo pagas al finalizar el traslado.</p></td></tr>',
'{{COMENTARIO}}',
'<tr><td style="padding:20px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border:1px solid #EEF0F2;border-radius:14px;"><tr><td style="padding:18px 20px;"><span style="color:#6B7280;font-size:13px;">Total estimado de tu servicio</span><br><span style="color:#111827;font-size:30px;font-weight:800;">{{TOTAL}}</span></td></tr></table></td></tr>',
'<tr><td style="padding:18px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2FBE9;border:2px solid #8CC63F;border-radius:16px;"><tr><td style="padding:22px 22px 24px;text-align:center;"><span style="display:inline-block;background:#8CC63F;color:#0E1A05;font-size:11px;font-weight:700;letter-spacing:0.04em;padding:5px 12px;border-radius:999px;text-transform:uppercase;">Opcion mas elegida</span><p style="margin:14px 0 2px;color:#111827;font-size:17px;font-weight:700;">Reserva con el 50%</p><p style="margin:0 0 14px;color:#3F6212;font-size:34px;font-weight:800;">{{ABONO}}</p><table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr><td style="border-radius:12px;background:#8CC63F;"><a href="{{FLOW}}" target="_blank" style="display:inline-block;padding:15px 30px;color:#0E1A05;font-size:17px;font-weight:700;text-decoration:none;border-radius:12px;">Abonar 50% y asegurar mi cupo &rarr;</a></td></tr></table><p style="margin:14px 0 0;color:#6B7280;font-size:12px;">Pago seguro procesado por Flow / Webpay. Confirmacion inmediata por correo.</p></td></tr></table></td></tr>',
'{{CTA100}}',
'<tr><td style="padding:14px 32px 0;"><p style="margin:0;color:#9A3412;font-size:13px;background:#FFF7ED;border:1px solid #FFEDD5;border-radius:10px;padding:10px 14px;">Tu fecha y horario se confirman solo al realizar el abono. Reservar ahora evita que tu cupo sea tomado por otra mudanza.</p></td></tr>',
'<tr><td style="padding:26px 32px 0;"><p style="margin:0 0 6px;color:#111827;font-size:15px;font-weight:700;">Detalle de tu cotizacion</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{{DETALLE}}</table></td></tr>',
'<tr><td style="padding:24px 32px 0;"><p style="margin:0 0 8px;color:#111827;font-size:15px;font-weight:700;">Que pasa despues de pagar?</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="color:#374151;font-size:14px;line-height:1.5;"><tr><td style="padding:3px 0;">1. Confirmamos tu reserva y tu cupo queda asegurado.</td></tr><tr><td style="padding:3px 0;">2. Recibes el comprobante por correo.</td></tr><tr><td style="padding:3px 0;">3. Coordinamos los detalles por WhatsApp.</td></tr><tr><td style="padding:3px 0;">4. Realizamos tu mudanza en la fecha agendada.</td></tr></table></td></tr>',
'{{PDFBLOCK}}',
'<tr><td style="padding:22px 32px 4px;"><p style="margin:0;color:#6B7280;font-size:13px;line-height:1.5;border-top:1px solid #EEF0F2;padding-top:16px;">Compra protegida &middot; Precio fijo sin sorpresas &middot; Carga protegida durante el traslado.</p></td></tr>',
'<tr><td style="padding:22px 32px 30px;text-align:center;background:#111827;"><p style="margin:0;color:#ffffff;font-size:15px;font-weight:700;">Yo me Encargo</p><p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">Mudanzas y fletes con precio fijo</p><p style="margin:10px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">Dudas? Llamanos: +56 9 5439 0267</p><p style="margin:4px 0 0;"><a href="https://yomeencargo.cl" style="color:#8CC63F;font-size:13px;text-decoration:none;">yomeencargo.cl</a></p><p style="margin:6px 0 0;"><a href="https://yomeencargo.cl/politicas-de-garantia" style="color:rgba(255,255,255,0.7);font-size:12px;text-decoration:underline;">Pol&iacute;ticas de garant&iacute;a</a></p></td></tr>',
'</table></td></tr></table></body></html>'
  ];
  var html = parts.join('');
  html = html.split('{{PRIMER}}').join(primer)
    .split('{{TOTAL100}}').join(clp(q.precio_100_con_descuento))
    .split('{{TOTAL}}').join(clp(q.precio_total))
    .split('{{ABONO}}').join(clp(q.precio_50))
    .split('{{FLOW}}').join(flow)
    .split('{{COMENTARIO}}').join(comentarioBlock)
    .split('{{CTA100}}').join(cta100Block)
    .split('{{DETALLE}}').join(detalle)
    .split('{{PDFBLOCK}}').join(pdfBlock);
  var subject = primer + ', tu cotizacion Yo me Encargo esta lista (' + clp(q.precio_total) + ')';
  if (!c.email) throw new Error('El payload de la cotizacion no trae destinatario')
  return { to: c.email, subject, html }
}

/** Aviso al dueño de un pago aprobado en Flow. */
function renderPaymentApproved(d: any): RenderedEmail {
  const to = d.to;
  const cliente = d.cliente || 'Cliente';
  const monto = clp(d.monto);
  const tipo = d.tipo_pago || '';
  const quote = d.quote_id || '';
  const fecha = d.fecha || '';
  const subject = 'Nuevo pago aprobado — ' + cliente + ' (' + tipo + ')';
  const lines = [
    'Se aprobó un pago en Flow.',
    '',
    'Cliente: ' + cliente,
    'Monto pagado: ' + monto + ' CLP',
    'Tipo de pago: ' + tipo,
    'N° de cotización: ' + quote,
    'Fecha: ' + fecha,
    '',
    'Revisa el panel de reservas para coordinar la mudanza.'
  ];
  const text = lines.join('\n');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;">'
    + lines.map((l) => l === '' ? '<br>' : esc(l)).join('<br>') + '</div>';
  if (!to) throw new Error('El aviso de pago no trae destinatario')
  return { to, subject, html, text }
}

/**
 * Aviso a Yo me encargo: un cliente pidió retirar sus créditos. Nació en el código (no
 * viene de n8n): sale solo por Resend.
 */
function renderCreditWithdrawal(d: any): RenderedEmail {
  const c = d.cliente || {}
  const b = d.banco || {}
  const to = d.to
  if (!to) throw new Error('El aviso de retiro no trae destinatario')
  const nombre = c.nombre || c.email || 'Cliente'
  const subject = 'Retiro de creditos: ' + nombre + ' quiere retirar ' + clp(d.monto)
  const lines = [
    nombre + ' pidio retirar sus creditos Yo me Encargo.',
    '',
    'Monto a transferir: ' + clp(d.monto) + ' (1 credito = $1)',
    '',
    'Titular: ' + (b.titular || ''),
    'RUT: ' + (b.rut || ''),
    'Banco: ' + (b.banco || ''),
    'Tipo de cuenta: ' + (b.tipo || ''),
    'Numero de cuenta: ' + (b.numero || ''),
    'Correo para el comprobante: ' + (b.email || c.email || ''),
    '',
    'Cliente: ' + [c.codigo, c.email, c.telefono].filter(Boolean).join(' - '),
    '',
    'Despues de transferir, marca el retiro como transferido en el panel: Marketing > Cupones y referidos.',
  ]
  const text = lines.join('\n')
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;">' +
    lines.map((l) => (l === '' ? '<br>' : esc(l))).join('<br>') +
    '</div>'
  return { to, subject, html, text }
}

/** Aviso interno al equipo: asunto y renglones ya armados por quien lo emite. */
function renderTeamNotice(d: any): RenderedEmail {
  const to = d.to
  if (!to) throw new Error('El aviso al equipo no trae destinatario')
  const lines: string[] = Array.isArray(d.lines) ? d.lines.map((l: any) => String(l ?? '')) : []
  const subject = String(d.subject || 'Aviso del panel')
  const text = lines.join('\n')
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;">' +
    lines.map((l) => (l === '' ? '<br>' : esc(l))).join('<br>') +
    '</div>'
  return { to, subject, html, text }
}

/** Al cliente que refirió: le llegaron créditos porque su referido pagó. */
function renderReferralReward(d: any): RenderedEmail {
  const c = d.cliente || {}
  const to = c.email
  if (!to) throw new Error('El aviso de creditos no trae destinatario')
  const primer = String(c.nombre || 'Hola').trim().split(/\s+/)[0]
  const subject = primer + ', ganaste ' + clp(d.monto) + ' en creditos Yo me Encargo'
  const cuerpo =
    parrafo((d.referido ? d.referido : 'Alguien') + ' reservo con tu codigo y ya sumamos tus creditos.') +
    destacado('Creditos ganados', d.monto) +
    parrafo('1 credito = $1. Puedes verlos y pedir el retiro desde tu cuenta, en Beneficios.') +
    boton(d.url, 'Ver mis creditos')
  return { to, subject, html: shell(subject, cuerpo) }
}

/** Payload del emisor (el mismo que recibía el webhook de n8n) → correo listo para enviar. */
export function renderEmail(rawPayload: Record<string, any>): RenderedEmail {
  // El PDF se enlaza por el dominio del sitio, no por el del almacenamiento.
  const payload = rawPayload?.pdf_url ? { ...rawPayload, pdf_url: toHiddenFileUrl(rawPayload.pdf_url, siteBaseUrl()) } : rawPayload
  const ev = payload?.event
  if (ev === 'quote_email_requested' || ev === 'quote_email_adjusted') return renderQuote(payload)
  if (ev === 'payment_approved') return renderPaymentApproved(payload)
  if (ev === 'credit_withdrawal_request') return renderCreditWithdrawal(payload)
  if (ev === 'team_notice') return renderTeamNotice(payload)
  if (ev === 'referral_reward') return renderReferralReward(payload)
  return renderSystem(payload)
}
