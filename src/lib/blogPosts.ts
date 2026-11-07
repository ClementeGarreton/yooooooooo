/**
 * Artículos del blog (/blog). Viven en el código, no en la base: son pocos y cambian poco.
 *
 * Regla para escribir acá: ningún precio, plazo ni cifra que no esté ya publicado en la web
 * (FAQ, servicios, cotizador). El precio lo da el cotizador; el blog explica y lleva a él.
 *
 * En los párrafos y listas, `[texto](/ruta)` se dibuja como enlace interno.
 */

export type BlogBlock = { h2: string } | { p: string } | { ul: string[] } | { ol: string[] }

export interface BlogPost {
  slug: string
  title: string
  /** Para Google y la tarjeta del listado: hasta ~155 caracteres. */
  description: string
  /** AAAA-MM-DD */
  date: string
  blocks: BlogBlock[]
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'como-cotizar-un-flete',
    title: 'Cómo cotizar un flete en Santiago: qué datos tener a mano',
    description:
      'Qué necesitas para cotizar un flete o transporte de carga en Santiago, de qué depende el precio y cómo obtener un precio fijo online en minutos.',
    date: '2026-10-27',
    blocks: [
      {
        p: 'Cotizar un flete es rápido si tienes claros unos pocos datos antes de empezar. Con ellos, el precio que recibes es el que pagas, sin ajustes el día del traslado.',
      },
      { h2: '¿De qué depende el precio de un flete?' },
      {
        p: 'El precio se calcula según tres cosas: el volumen de lo que trasladas, la distancia entre el origen y el destino, y los accesos de cada dirección (pisos, ascensor, escaleras o distancia hasta el camión).',
      },
      { h2: 'Los datos que conviene tener listos' },
      {
        ol: [
          'Dirección de origen y de destino, con comuna.',
          'Qué vas a trasladar: muebles, electrodomésticos, cajas, mercadería o equipos. Mientras más preciso, más exacto el precio.',
          'Piso y si hay ascensor en cada dirección.',
          'El día y la hora en que lo necesitas.',
          'Si quieres servicios extra: embalaje, desembalaje, armado o desarmado de muebles.',
        ],
      },
      { h2: 'Cotiza online y recibe un precio fijo' },
      {
        p: 'En el [cotizador online](/cotizador?start=online) eliges tus artículos, ingresas las direcciones y la fecha, y recibes un precio fijo en unos 3 minutos. Ahí mismo puedes reservar.',
      },
      {
        p: 'En los fletes dentro de Santiago la carga y la descarga van incluidas, y tenemos vehículos de distintos tamaños según lo que necesites trasladar.',
      },
      { h2: '¿Con cuánta anticipación conviene cotizar?' },
      {
        p: 'Lo ideal es agendar con 48 horas de anticipación. Si es urgente, según disponibilidad podemos coordinar el traslado para el mismo día.',
      },
      { h2: '¿Y si no sé bien cuánto volumen tengo?' },
      {
        p: 'Si son muchas cosas o no sabes cuánto espacio ocupan, puedes pedir una [cotización a domicilio](/domicilio): te visitamos, revisamos todo y te entregamos una cotización completa.',
      },
    ],
  },
  {
    slug: 'como-preparar-tu-mudanza',
    title: 'Cómo preparar tu mudanza: lista paso a paso',
    description:
      'Una lista práctica para preparar tu mudanza: qué hacer las semanas antes, cómo embalar, qué hacer el día del traslado y qué puedes dejar en nuestras manos.',
    date: '2026-10-27',
    blocks: [
      {
        p: 'Una mudanza ordenada empieza antes del día del traslado. Esta lista te ayuda a llegar con todo listo y a decidir qué haces tú y qué nos encargas a nosotros.',
      },
      { h2: 'Antes: decide qué se va y qué no' },
      {
        ul: [
          'Recorre cada pieza y separa lo que no vas a llevar: regalar, vender o reciclar antes de la mudanza reduce el volumen y el precio.',
          'Haz una lista de los muebles grandes y los electrodomésticos. Te sirve para cotizar y para revisar que todo llegue.',
          'Mide los muebles grandes y las puertas o ascensores del nuevo lugar.',
        ],
      },
      { h2: 'Cotiza y reserva con tiempo' },
      {
        p: 'Con tu lista a mano, el [cotizador online](/cotizador?start=online) te da un precio fijo en minutos. Lo ideal es agendar con al menos 48 horas de anticipación.',
      },
      { h2: 'Embalaje: hazlo tú o encárgalo' },
      {
        p: 'Puedes embalar por tu cuenta o pedirnos que lo hagamos. Llevamos cajas, film y mantas, y podemos embalar todo o solo lo frágil; tú eliges al cotizar.',
      },
      {
        ul: [
          'Usa cajas firmes y no las sobrecargues: mejor varias medianas que una muy pesada.',
          'Marca cada caja con la pieza de destino y si es frágil.',
          'Deja aparte una caja con lo que vas a necesitar la primera noche: documentos, cargadores, remedios, artículos de aseo.',
        ],
      },
      { h2: 'Muebles y electrodomésticos' },
      {
        p: 'Si hay que desarmar camas, closets o mesas, puedes sumar armado y desarmado al cotizar. También el desarmado de refrigerador, si el tuyo lo necesita para pasar por puertas o ascensores.',
      },
      { h2: 'El día de la mudanza' },
      {
        ol: [
          'Ten las llaves y los permisos del edificio listos (uso de ascensor o estacionamiento, si los piden).',
          'Revisa que no quede nada en cajones, closets ni bodega.',
          'Al llegar, indica dónde va cada mueble y cada caja.',
        ],
      },
      {
        p: 'Nosotros cargamos, trasladamos y entregamos, y tus cosas van protegidas durante todo el trayecto.',
      },
    ],
  },
  {
    slug: 'mudanza-de-oficina',
    title: 'Mudanza de oficina: cómo organizarla sin detener tu empresa',
    description:
      'Cómo planificar una mudanza de oficina: inventario, horarios, equipos y facturación para empresas. Lo que conviene definir antes de cotizar el traslado.',
    date: '2026-10-27',
    blocks: [
      {
        p: 'Trasladar una oficina no es igual que una mudanza de casa: hay equipos, archivos y personas que necesitan volver a trabajar cuanto antes. La clave es planificar.',
      },
      { h2: 'Define un responsable y una fecha' },
      {
        p: 'Nombra a una persona a cargo de la mudanza dentro de la empresa. Ella define la fecha, coordina con el edificio de origen y de destino, y es el contacto para el equipo de traslado.',
      },
      { h2: 'Haz el inventario por área' },
      {
        ul: [
          'Escritorios, sillas, estanterías y muebles de archivo.',
          'Equipos: computadores, pantallas, impresoras y servidores.',
          'Archivos y documentos, en cajas marcadas por área.',
          'Lo que no se va a trasladar: mejor darlo de baja antes.',
        ],
      },
      { h2: 'Elige un horario que no corte la operación' },
      {
        p: 'Con horarios flexibles, el traslado puede hacerse en el momento que menos afecte a la empresa. La coordinación logística del día la hacemos nosotros.',
      },
      { h2: 'Armado, desarmado y embalaje' },
      {
        p: 'Al cotizar puedes sumar el desarmado y armado de muebles y el embalaje. Así cada estación de trabajo llega lista para usar.',
      },
      { h2: 'Facturación para empresas' },
      {
        p: 'Si tu empresa nos contrata seguido, tenemos contratos mensuales y facturación centralizada. Conoce todos los servicios en [nuestros servicios](/nuestros-servicios) o [escríbenos](/contactanos).',
      },
      { h2: 'Cotiza tu traslado' },
      {
        p: 'Para una oficina pequeña, el [cotizador online](/cotizador?start=online) te da el precio en minutos. Si es una oficina grande o tiene equipos especiales, una [cotización a domicilio](/domicilio) permite revisar todo antes.',
      },
    ],
  },
  {
    slug: 'flete-a-regiones',
    title: 'Flete o mudanza de Santiago a regiones: cómo planificarlo',
    description:
      'Qué tener en cuenta para un flete o mudanza de Santiago a regiones: fechas, embalaje, recepción en destino y cómo cotizar el traslado.',
    date: '2026-10-27',
    blocks: [
      {
        p: 'Hacemos fletes y mudanzas desde Santiago a todo Chile. Un traslado largo pide un poco más de planificación que uno dentro de la ciudad.',
      },
      { h2: 'Fecha de entrega comprometida' },
      {
        p: 'Los fletes interprovinciales tienen una fecha de entrega comprometida. Al reservar sabes cuándo llega tu carga, para coordinar a quien la recibe.',
      },
      { h2: 'Embala pensando en el trayecto' },
      {
        ul: [
          'En un viaje largo la carga se mueve más: protege lo frágil y llena los espacios vacíos de las cajas.',
          'Si prefieres, embalamos nosotros con cajas, film y mantas.',
          'Marca las cajas con tu nombre y la ciudad de destino.',
        ],
      },
      { h2: 'Coordina la recepción' },
      {
        p: 'Define quién recibe en destino y avísanos su nombre y teléfono. La entrega se coordina con esa persona.',
      },
      { h2: 'Tu carga va cubierta' },
      {
        p: 'Cada traslado va cubierto: protegemos y aseguramos tus cosas durante todo el trayecto.',
      },
      { h2: 'Cómo cotizar un traslado a regiones' },
      {
        p: 'Ingresa la dirección de origen en Santiago y la de destino en el [cotizador online](/cotizador?start=online). El precio considera el volumen, la distancia y los accesos. Si tienes dudas, [escríbenos](/contactanos).',
      },
    ],
  },
  {
    slug: 'cotizacion-online-o-a-domicilio',
    title: '¿Cotización online o a domicilio? Cuál conviene para tu mudanza',
    description:
      'Diferencias entre cotizar tu mudanza online y pedir una visita a domicilio: cuándo conviene cada una, cuánto demoran y qué pasa con el costo de la visita.',
    date: '2026-10-27',
    blocks: [
      {
        p: 'En Yo me Encargo puedes cotizar tu mudanza de dos maneras. Las dos terminan en un precio fijo; cambia quién hace el inventario.',
      },
      { h2: 'Cotización online' },
      {
        ul: [
          'Tú eliges los artículos, las direcciones y la fecha.',
          'Recibes el precio al instante, en unos 3 minutos.',
          'Puedes reservar en el mismo momento.',
        ],
      },
      {
        p: 'Conviene cuando sabes bien qué vas a trasladar: un flete, una mudanza de departamento o unos pocos muebles. Empieza en el [cotizador online](/cotizador?start=online).',
      },
      { h2: 'Cotización a domicilio' },
      {
        ul: [
          'Vamos a tu casa u oficina, revisamos todo y te entregamos una cotización completa y personalizada.',
          'Tiene un precio fijo y por ahora es solo en la Región Metropolitana.',
          'Si después contratas la mudanza, lo que pagaste por la visita se descuenta del total del flete.',
        ],
      },
      {
        p: 'Conviene cuando son muchas cosas, cuando no sabes cuánto volumen tienes o cuando hay muebles o equipos especiales. Agenda la visita en [cotización a domicilio](/domicilio).',
      },
      { h2: '¿Cuál elegir?' },
      {
        p: 'Si puedes hacer la lista de tus cosas en unos minutos, cotiza online. Si la lista te parece difícil o prefieres que alguien lo vea, pide la visita. Y si te quedan dudas, [revisa cómo preparar tu mudanza](/blog/como-preparar-tu-mudanza).',
      },
    ],
  },
]

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug)
}
