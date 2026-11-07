import { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/landing/Navbar'
import Footer from '@/components/landing/Footer'
import LegalText from '@/components/LegalText'
import { getLegalContent } from '@/lib/legalDocuments'

// «Servicios, Términos y Garantías» de Yo Me Encargo.
//
// Secciones 1 a 4: el documento de Tomás (recibido el 30-sep-2026) COMPLETO y LITERAL,
// en su orden y con sus títulos. No se reescribe ni se resume: si cambia, se reemplaza
// el texto acá. Las secciones 5 y 6 (cancelaciones y conflictos) vienen de los Términos
// y Condiciones, que el documento no cubre.
// Esta ruta es la que va enlazada en el pie del sitio, en el resumen del cotizador y en
// el pie de todos los correos.

export const metadata: Metadata = {
  title: 'Servicios, Términos y Garantías',
  description:
    'Servicios de mudanza de Yo me Encargo, servicios adicionales, forma de pago, inclusiones y exclusiones, garantía y responsabilidad por daños.',
  alternates: {
    canonical: 'https://yomeencargo.cl/politicas-de-garantia',
  },
  robots: {
    index: true,
    follow: true,
  },
}

const h2 = 'text-2xl font-bold text-gray-900 mb-4'
const h3 = 'text-xl font-semibold text-gray-800 mb-3 mt-6'
const p = 'text-gray-700 leading-relaxed mb-4'
const ul = 'list-disc pl-6 text-gray-700 space-y-2 mb-4'
const label = 'text-gray-900 font-semibold mb-2'

export default async function WarrantyPage() {
  // Texto editado en Configuración → Políticas y términos; sin edición, el original de abajo.
  const custom = await getLegalContent('politicas-de-garantia')
  return (
    <>
      <Navbar />

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="pt-32 pb-12">
          <div className="container mx-auto px-4">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 text-center">
              Servicios, Términos y Garantías
            </h1>
            <div className="mt-4 text-center text-gray-600 space-y-1">
              <p className="font-semibold text-gray-800">YO ME ENCARGO SpA · Mudanzas · Embalajes</p>
              <p>RUT: 77.437.426-4 · Vitacura, Santiago, Chile</p>
              <p>Lunes a viernes: +56 9 5233 4799</p>
              <p>Fines de semana / reclamos y sugerencias: +56 9 5439 0267</p>
              <p>www.yomeencargo.cl</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-4 pb-12 max-w-4xl">
          <div className="bg-white rounded-xl shadow-lg p-8 md:p-12">
            <div className="prose prose-lg max-w-none">
              {custom ? (
                <LegalText content={custom} />
              ) : (
                <div data-legal-original>
              <section className="mb-10">
                <h2 className={h2}>1. Nuestros Servicios de Mudanzas</h2>

                <h3 className={h3}>1.1 Servicio Básico</h3>
                <p className={label}>Incluye:</p>
                <ul className={ul}>
                  <li>Traslado y embalaje de muebles, cuadros, línea blanca y colchones.</li>
                  <li>Desembalaje de muebles y armado de camas.</li>
                  <li>Distribución de las cajas embaladas por el cliente en los puntos designados.</li>
                </ul>
                <p className={label}>No incluye:</p>
                <ul className={ul}>
                  <li>
                    Materiales como cajas y papel de embalar para artículos como loza, adornos, libros y juguetes
                    (deben ser provistos y embalados por el cliente).
                  </li>
                </ul>
                <p className={p}>
                  <strong>Nota:</strong> el embalaje de muebles se realiza un día antes o según la programación
                  acordada con su ejecutivo.
                </p>

                <h3 className={h3}>1.2 Servicio Completo</h3>
                <p className={label}>Incluye:</p>
                <ul className={ul}>
                  <li>Traslado y embalaje de todos los enseres del hogar, con materiales adecuados.</li>
                  <li>Desembalaje de todos los muebles y armado de camas.</li>
                  <li>Distribución de las cajas en los puntos designados.</li>
                </ul>
                <p className={label}>No incluye:</p>
                <ul className={ul}>
                  <li>
                    Servicios adicionales indicados en la sección 2 de este documento; deben consultarse y cotizarse
                    con su ejecutivo.
                  </li>
                </ul>
                <p className={p}>
                  <strong>Nota:</strong> el embalaje de muebles se realiza un día antes o según la programación
                  acordada con su ejecutivo.
                </p>

                <div className="p-5 bg-blue-50 rounded-lg border-l-4 border-brand-blue">
                  <p className={label}>Importante sobre la garantía:</p>
                  <p className="text-gray-700 leading-relaxed">
                    La garantía de Yo Me Encargo por daños en los artículos trasladados aplica únicamente cuando el
                    servicio contratado incluye embalaje realizado por nuestro equipo. Si el cliente contrata el
                    traslado sin este servicio, Yo Me Encargo no otorga garantía sobre los bienes embalados por el
                    propio cliente o por terceros.
                  </p>
                </div>
              </section>

              <section className="mb-10">
                <h2 className={h2}>2. Servicios Adicionales</h2>
                <p className={p}>
                  Todos los servicios adicionales no están incluidos en los servicios base; deben ser cotizados
                  explícitamente por los ejecutivos.
                </p>

                <h3 className={h3}>2.1 Traslado de vehículo</h3>
                <ul className={ul}>
                  <li>
                    Servicio disponible dentro de todo Chile, exclusivo para clientes que hayan contratado servicios de
                    mudanza.
                  </li>
                </ul>

                <h3 className={h3}>2.2 Inventario</h3>
                <ul className={ul}>
                  <li>Lista detallada y rotulada de todos los bultos y cajas a trasladar, incluyendo su descripción.</li>
                </ul>

                <h3 className={h3}>2.3 Servicio en altura</h3>
                <ul className={ul}>
                  <li>
                    Traslado de bultos en espacios elevados y de difícil acceso, generalmente en edificios altos,
                    utilizando máquinas, materiales y personal especializado.
                  </li>
                </ul>

                <h3 className={h3}>2.4 Desinstalaciones o instalaciones especiales</h3>
                <ul className={ul}>
                  <li>
                    Desmontaje y montaje de muebles, equipos o dispositivos que requieren habilidades técnicas
                    específicas, como electrodomésticos y otros muebles.
                  </li>
                  <li>
                    Personal especializado para desinstalarlos y volver a instalarlos en el nuevo destino, utilizando
                    máquinas, materiales y personal especializado.
                  </li>
                </ul>

                <h3 className={h3}>2.5 Trabajo por escaleras</h3>
                <ul className={ul}>
                  <li>
                    Servicio de traslado por escaleras cuando los bultos superan las dimensiones para acceder al lugar,
                    ya sea por falta de ascensor u otros espacios estrechos.
                  </li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className={h2}>3. Notas Importantes</h2>

                <h3 className={h3}>Valores</h3>
                <p className={p}>Los valores cotizados no incluyen IVA.</p>

                <h3 className={h3}>Forma de Pago</h3>
                <p className={p}>
                  El pago debe estar acreditado en la cuenta de Yo Me Encargo SpA previo al inicio del servicio, salvo
                  acuerdos especiales de crédito.
                </p>
                <p className={p}>Se aceptan los siguientes métodos de pago:</p>
                <p className={label}>Transferencia bancaria:</p>
                <ul className={ul}>
                  <li>Banco: Banco de Chile</li>
                  <li>Tipo de cuenta: Cuenta Corriente</li>
                  <li>Número de cuenta: 00-171-17432-01</li>
                  <li>RUT: 77.437.426-4</li>
                  <li>Nombre: Yo Me Encargo SpA</li>
                  <li>Correo electrónico: pagosyomeencargo@gmail.com</li>
                </ul>
                <p className="text-gray-700 leading-relaxed">Contacto lunes a viernes: +56 9 5233 4799</p>
                <p className={p}>Contacto fines de semana, reclamos o sugerencias: +56 9 5439 0267</p>

                <h3 className={h3}>Salvoconducto</h3>
                <p className={p}>
                  Documento requerido por la ley chilena para el traslado de bienes y efectos personales. Debe ser
                  obtenido por el dueño de los bienes en una Notaría de su comuna al menos dos días hábiles previos al
                  inicio de la mudanza. Sin este documento, Yo Me Encargo se reserva el derecho a no realizar el
                  servicio y a aplicar los cargos correspondientes por cancelación. Consulte los detalles con su
                  ejecutivo.
                </p>

                <h3 className={h3}>Permiso de Estacionamiento</h3>
                <p className={p}>
                  Requerido en algunas zonas de las principales ciudades. Para obtenerlo se debe presentar el
                  Salvoconducto y, preferentemente, tramitarlo al menos una semana antes de la fecha de la mudanza.
                </p>

                <div className="p-5 bg-blue-50 rounded-lg border-l-4 border-brand-blue mb-4">
                  <p className={label}>Importante sobre la información de los artículos a trasladar:</p>
                  <p className="text-gray-700 leading-relaxed">
                    Es responsabilidad del cliente declarar la totalidad de los muebles, artículos y bultos a trasladar
                    al momento de solicitar la cotización. La omisión de artículos no declarados podrá generar costos
                    adicionales, asociados al tiempo excedido respecto del tiempo originalmente contemplado para la
                    ejecución del trabajo cotizado.
                  </p>
                </div>

                <h3 className={h3}>Inclusiones</h3>
                <ul className={ul}>
                  <li>Jabas y cajones para bienes delicados, salvo los expresamente indicados en la sección de exclusiones.</li>
                  <li>Embalaje y protección de bienes en la residencia.</li>
                  <li>Carga del camión en residencia, sellado y traslado a destino.</li>
                  <li>Descarga en destino.</li>
                  <li>Desembalaje parcial.</li>
                  <li>Armado y desarmado de muebles simples.</li>
                  <li>Ubicación de ítems en superficie plana.</li>
                  <li>
                    Retiro del material sobrante el mismo día de la entrega. Cualquier solicitud de retiro en fecha
                    posterior tendrá un recargo adicional.
                  </li>
                </ul>

                <h3 className={h3}>Exclusiones</h3>
                <ul className={ul}>
                  <li>
                    Vehículo de enlace, en caso de no poder estacionar cerca de la residencia o en caso de acceso por
                    subterráneos.
                  </li>
                  <li>
                    Acarreos a pie de más de 30 metros, en caso de no poder estacionar cerca de la residencia con el
                    camión principal ni con vehículo de enlace.
                  </li>
                  <li>El no aviso previo de acarreo por escaleras a pisos superiores podrá generar cobros adicionales.</li>
                  <li>
                    Manipulación de bienes pesados y sobredimensionados, como cajas fuertes y pianos, salvo que estén
                    expresamente incluidos en el presupuesto.
                  </li>
                  <li>
                    Servicios de electricista, carpintero, gasfíter, aseo o cualquier otra especialidad técnica
                    requerida.
                  </li>
                  <li>
                    Numeración de bultos y elaboración de inventario, salvo que estén expresamente incluidos en el
                    presupuesto.
                  </li>
                  <li>Recogidas o entregas adicionales.</li>
                  <li>Permisos de estacionamiento en caso de ser requeridos por la municipalidad.</li>
                  <li>Todo lo que no esté explícitamente incluido en la propuesta.</li>
                </ul>
              </section>

              <section className="mb-10">
                <h2 className={h2}>4. Consideraciones Generales</h2>
                <p className={p}>
                  Esta propuesta dará origen a un contrato mercantil en el momento en que sea aceptada, y estará sujeta
                  a la ley chilena para todos sus efectos.
                </p>

                <h3 className={h3}>Traslado de joyas y artículos de alto valor</h3>
                <p className={p}>
                  Es de exclusiva responsabilidad del cliente el traslado de artículos de alto valor, tales como joyas,
                  relojes, perfumes, artículos electrónicos, dinero, obras de arte, objetos personales invaluables y
                  otros. Yo Me Encargo no se hará responsable por la pérdida, daño o extravío de estos artículos durante
                  la mudanza. Todo objeto valorizado en más de 25 UF que el cliente necesite trasladar debe ser
                  declarado por correo electrónico a nuestra empresa con anticipación, con el fin de tomar los
                  resguardos necesarios para su traslado.
                </p>

                <h3 className={h3}>Responsabilidad por daños</h3>
                <p className={p}>
                  Yo Me Encargo se responsabiliza por los daños o deterioros que sufran los bienes trasladados por su
                  culpa, hasta un máximo del 30% del valor neto de la mudanza. El cliente será responsable de cualquier
                  diferencia de precio que supere dicho monto, y en caso de solicitar compensación o restauración deberá
                  pagar previamente un deducible de 2 UF. Yo Me Encargo no se hace responsable en ningún caso por daños
                  o pérdidas de objetos o cajas embaladas por el cliente o por un tercero, así como tampoco por daños
                  causados por caso fortuito, fuerza mayor o mal estado previo de los bienes a trasladar. Cualquier daño
                  debe ser informado por escrito, vía correo electrónico, dentro de los 5 días posteriores al servicio.
                </p>
              </section>

              <section className="mb-10">
                <h2 className={h2}>5. Cancelaciones y devoluciones</h2>
                <h3 className={h3}>Si cancela el cliente</h3>
                <ul className={ul}>
                  <li>Con más de 48 horas de anticipación: sin cargo</li>
                  <li>Entre 24 y 48 horas antes: 30% del valor del servicio</li>
                  <li>Con menos de 24 horas: 50% del valor del servicio</li>
                  <li>Si no se presenta el día acordado: 100% del valor del servicio</li>
                </ul>
                <h3 className={h3}>Si cancelamos nosotros</h3>
                <p className={p}>
                  Si debemos cancelar o reprogramar por causas de fuerza mayor, se notificará al cliente con la
                  mayor anticipación posible y se ofrecerá <strong>reprogramación sin costo o reembolso
                  completo</strong>.
                </p>
              </section>

              <section className="mb-8">
                <h2 className={h2}>6. Resolución de conflictos</h2>
                <p className="text-gray-700 leading-relaxed">
                  Cualquier disputa relacionada con nuestros servicios será resuelta inicialmente mediante
                  comunicación directa entre las partes. Si no se llega a un acuerdo, las partes se someterán a
                  la jurisdicción de los tribunales de Santiago, Chile.
                </p>
              </section>
                </div>
              )}

              <div className="mt-12 p-6 bg-gray-50 rounded-lg border-l-4 border-gray-300">
                <p className="text-gray-700">
                  Ver también nuestros{' '}
                  <Link href="/terminos-y-condiciones" className="font-semibold text-primary-600 hover:underline">
                    Términos y Condiciones
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </>
  )
}
