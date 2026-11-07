// Limpieza de texto antes de dibujarlo en un PDF.
//
// POR QUÉ EXISTE
// jsPDF con las fuentes estándar (Helvetica) usa WinAnsi, que cubre más o menos Latin-1.
// Cualquier carácter por encima de eso NO tiene glifo: no sale en blanco, sale como los
// bytes UTF-8 interpretados como Latin-1. Un emoji de portapapeles se convierte en
// "Ø=ÜË" y un guión largo en un símbolo cortado.
//
// No es hipotético: medido el 3-sep-2026 contra la base de producción, el 9% de las notas
// de reservas y el 10% de las de cotizaciones traen alguno. Vienen de copiar y pegar de
// WhatsApp —emojis de encabezado, guiones largos, comillas tipográficas— y salían como
// basura en un documento que ve el cliente y el chofer.
//
// La solución no es embeber una fuente con emojis (pesa megas y no arregla el guión
// largo): es traducir lo que tiene equivalente y descartar lo que no se puede dibujar.
// Un carácter de menos se lee bien; "Ø=ÜË" no.

/** Caracteres frecuentes que SÍ tienen un equivalente razonable en la fuente. */
const EQUIVALENTES: Array<[RegExp, string]> = [
  [/[‐-―−➖]/g, '-'], // guiones largos y medios, menos matemático, el "heavy minus"
  [/[‘’‚‛]/g, "'"], // comillas simples tipográficas
  [/[“”„‟]/g, '"'], // comillas dobles tipográficas
  [/…/g, '...'],
  [/[•●▪]/g, '-'], // viñetas. OJO: el · (U+00B7) NO va acá — la fuente sí lo dibuja,
  //                    y es el separador del encabezado ("RES-000146 · Emision").
  [/[✓✔]/g, '[OK]'],
  [/[✗✘✖]/g, 'X'],
  [/[→⇒]/g, '->'],
  [/≤/g, '<='],
  [/≥/g, '>='],
  [/™/g, '(TM)'],
  [/ /g, ' '], // espacio duro
]

/** Lo que la fuente del PDF puede dibujar: espacio a ÿ (WinAnsi ~ Latin-1). */
const DIBUJABLE = /[^ -ÿ\n\r\t]/g

/**
 * Deja el texto en lo que la fuente del PDF puede dibujar.
 *
 * 1) Traduce lo que tiene equivalente (guiones, comillas, flechas).
 * 2) Descarta lo que no (emojis, símbolos raros, selectores de variación).
 * 3) Limpia los espacios que quedaron colgando donde había un emoji.
 *
 * Los saltos de línea se conservan intactos: son parte del contenido.
 */
export function sanitizeForPdf(input: unknown): string {
  if (input === null || input === undefined) return ''
  let texto = String(input)

  for (const [patron, reemplazo] of EQUIVALENTES) {
    texto = texto.replace(patron, reemplazo)
  }

  if (!DIBUJABLE.test(texto)) {
    DIBUJABLE.lastIndex = 0
    return texto
  }
  DIBUJABLE.lastIndex = 0

  // Se limpia LÍNEA POR LÍNEA comparando con la original, para distinguir dos cosas que
  // se ven iguales en el resultado: un espacio que ya estaba (indentación que el que
  // escribió la nota puso a propósito, y varias notas traen tablas alineadas a mano) y un
  // espacio que quedó colgando porque al lado había un emoji.
  return texto
    .split('\n')
    .map((linea) => {
      const limpia = linea.replace(DIBUJABLE, '')
      if (limpia === linea) return linea
      // Si la línea NO empezaba con espacio y ahora sí, ese espacio lo dejó el emoji.
      const empezabaConEspacio = /^\s/.test(linea)
      let resultado = limpia.replace(/ {2,}/g, ' ').replace(/[ \t]+$/, '')
      if (!empezabaConEspacio) resultado = resultado.replace(/^[ \t]+/, '')
      return resultado
    })
    .join('\n')
}

/**
 * Aplica la limpieza a TODO lo que se dibuje en este documento, de una vez.
 *
 * Se envuelven `text` y `splitTextToSize` en vez de limpiar en cada llamada porque son
 * decenas de llamadas repartidas por tres generadores distintos: limpiar una por una
 * garantiza que alguna quede afuera y vuelva la basura por ahí. `splitTextToSize` también
 * se envuelve porque calcula el ancho para cortar los renglones, y tiene que medir el
 * texto que realmente se va a dibujar.
 */
export function applyPdfTextSanitizer(pdf: {
  text: (...args: any[]) => any
  splitTextToSize: (...args: any[]) => any
}): void {
  const textoOriginal = pdf.text.bind(pdf)
  const cortarOriginal = pdf.splitTextToSize.bind(pdf)

  pdf.text = (contenido: any, ...resto: any[]) => {
    const limpio = Array.isArray(contenido)
      ? contenido.map((l) => sanitizeForPdf(l))
      : sanitizeForPdf(contenido)
    return textoOriginal(limpio, ...resto)
  }

  pdf.splitTextToSize = (contenido: any, ...resto: any[]) =>
    cortarOriginal(sanitizeForPdf(contenido), ...resto)
}
