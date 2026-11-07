import { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/landing/Navbar'
import Footer from '@/components/landing/Footer'
import LegalText from '@/components/LegalText'
import { getLegalContent } from '@/lib/legalDocuments'

export const metadata: Metadata = {
  title: 'Términos y Condiciones',
  description: 'Términos y condiciones de uso de los servicios de transporte y mudanzas de Yo me Encargo. Conoce nuestras políticas.',
  alternates: {
    canonical: 'https://yomeencargo.cl/terminos-y-condiciones',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default async function TermsPage() {
  // Texto editado en Configuración → Políticas y términos; sin edición, el original de abajo.
  const custom = await getLegalContent('terminos-y-condiciones')
  return (
    <>
      <Navbar />
      
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="pt-32 pb-12">
          <div className="container mx-auto px-4">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 text-center">
              Términos y Condiciones
            </h1>
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
            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Aceptación de los Términos</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Al contratar los servicios de transporte, mudanza o flete ofrecidos por <strong>Yo me Encargo</strong>, 
                usted acepta quedar legalmente vinculado por estos Términos y Condiciones. Si no está de acuerdo con 
                alguna parte de estos términos, le recomendamos no utilizar nuestros servicios.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Nos reservamos el derecho de modificar estos términos en cualquier momento. Las modificaciones entrarán 
                en vigor inmediatamente después de su publicación en nuestro sitio web.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Descripción de los Servicios</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Yo me Encargo ofrece servicios de transporte de carga, mudanzas residenciales, mudanzas de oficinas 
                y traslados a nivel nacional. Nuestros servicios incluyen:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Transporte de mercancías y objetos personales</li>
                <li>Carga y descarga de productos</li>
                <li>Servicios adicionales como embalaje, desarme y armado de muebles (opcionales)</li>
                <li>Cobertura en la Región Metropolitana y traslados a regiones</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                Los servicios específicos contratados quedarán detallados en la cotización y confirmación del servicio.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Cotización y Pago</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Las cotizaciones proporcionadas a través de nuestro sistema online son estimaciones basadas en la 
                información proporcionada por el cliente. El precio final puede variar si:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>El volumen o peso de la carga difiere significativamente de lo declarado</li>
                <li>Existen condiciones no informadas (accesos difíciles, pisos adicionales, etc.)</li>
                <li>Se requieren servicios adicionales no contemplados inicialmente</li>
                <li>Las direcciones de origen o destino son modificadas</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mb-4">
                El cliente será notificado de cualquier ajuste en el precio antes de la ejecución del servicio.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>Formas de pago:</strong> Aceptamos transferencia bancaria, efectivo y tarjetas de crédito/débito. 
                El pago debe realizarse según lo acordado en la confirmación del servicio.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Responsabilidades del Cliente</h2>
              <p className="text-gray-700 leading-relaxed mb-4">El cliente se compromete a:</p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Proporcionar información precisa y completa sobre la carga a transportar</li>
                <li>Informar sobre cualquier objeto frágil, valioso o de características especiales</li>
                <li>Embalar adecuadamente los objetos si no contrata el servicio de embalaje</li>
                <li>Estar presente o designar un representante en origen y destino</li>
                <li>Garantizar el acceso adecuado para la carga y descarga</li>
                <li>Informar sobre restricciones de horario, estacionamiento o acceso</li>
                <li>No incluir artículos prohibidos (materiales peligrosos, ilegales o perecederos sin refrigeración)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Responsabilidades de Yo me Encargo</h2>
              <p className="text-gray-700 leading-relaxed mb-4">Nos comprometemos a:</p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Realizar el servicio en la fecha y horario acordados</li>
                <li>Manejar la carga con el debido cuidado y profesionalismo</li>
                <li>Contar con personal capacitado y vehículos en buen estado</li>
                <li>Responder por los daños según nuestras Políticas de Garantía</li>
                <li>Notificar cualquier inconveniente o retraso de manera oportuna</li>
              </ul>
            </section>

            <section className="mb-8">
              {/* Hasta el 30-sep-2026 esto decía «seguro de hasta $500.000» y «reclamo en 48 horas».
                  Tomás mandó las condiciones reales (30% del valor neto, 2 UF de deducible, 5 días),
                  que ahora viven en /politicas-de-garantia: acá se resumen y se enlazan, para que
                  las dos páginas no vuelvan a decir cosas distintas. */}
              <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Garantía y Responsabilidad por Daños</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                La garantía de Yo Me Encargo por daños en los artículos trasladados aplica únicamente cuando el
                servicio contratado incluye embalaje realizado por nuestro equipo. Yo Me Encargo se responsabiliza
                por los daños o deterioros que sufran los bienes trasladados por su culpa, hasta un máximo del 30%
                del valor neto de la mudanza, con un deducible de 2 UF. Cualquier daño debe ser informado por
                escrito, vía correo electrónico, dentro de los 5 días posteriores al servicio.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Las condiciones completas están en nuestras{' '}
                <Link href="/politicas-de-garantia" className="font-semibold text-primary-600 hover:underline">
                  Políticas de Garantía
                </Link>
                .
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Cancelaciones y Reprogramaciones</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>Por parte del cliente:</strong>
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Cancelación con más de 48 horas de anticipación: sin cargo</li>
                <li>Cancelación entre 24-48 horas: 30% del valor del servicio</li>
                <li>Cancelación con menos de 24 horas: 50% del valor del servicio</li>
                <li>No presentarse el día acordado: 100% del valor del servicio</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>Por parte de Yo me Encargo:</strong>
              </p>
              <p className="text-gray-700 leading-relaxed">
                Si debemos cancelar o reprogramar por causas de fuerza mayor, se notificará al cliente con la mayor 
                anticipación posible y se ofrecerá reprogramación sin costo o reembolso completo.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Artículos Prohibidos</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                No transportamos ni nos responsabilizamos por:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Sustancias ilegales, drogas o narcóticos</li>
                <li>Materiales inflamables, explosivos o peligrosos</li>
                <li>Armas de fuego sin permisos correspondientes</li>
                <li>Animales vivos (salvo coordinación previa especial)</li>
                <li>Dinero en efectivo, joyas o documentos de valor no declarados</li>
                <li>Alimentos perecederos sin las condiciones apropiadas</li>
                <li>Materiales biológicos o médicos sin autorización</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Privacidad y Datos Personales</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Respetamos su privacidad y protegemos sus datos personales de acuerdo con la legislación chilena vigente. 
                La información recopilada será utilizada únicamente para la prestación del servicio y comunicaciones 
                relacionadas.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Para más información, consulte nuestra{' '}
                <Link href="/politica-de-privacidad" className="text-brand-blue hover:underline">
                  Política de Privacidad
                </Link>.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Resolución de Conflictos</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Cualquier disputa relacionada con nuestros servicios será resuelta inicialmente mediante comunicación 
                directa entre las partes. Si no se llega a un acuerdo, las partes se someterán a la jurisdicción de 
                los tribunales de Santiago, Chile.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Contacto</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Para consultas, reclamos o información adicional sobre estos términos y condiciones, puede contactarnos:
              </p>
              <ul className="list-none text-gray-700 space-y-2">
                <li><strong>Email:</strong> contacto@yomeencargo.cl</li>
                <li><strong>Teléfono:</strong> +56 9 5233 4799</li>
                <li><strong>WhatsApp:</strong> +56 9 5233 4799</li>
                <li><strong>Horario:</strong> Lunes a Domingo, 9:00 - 19:00 hrs</li>
              </ul>
            </section>
              </div>
            )}

            <div className="mt-12 p-6 bg-blue-50 rounded-lg border-l-4 border-brand-blue">
              <p className="text-gray-700">
                <strong>Nota importante:</strong> Al utilizar nuestros servicios, usted confirma haber leído, 
                entendido y aceptado estos Términos y Condiciones en su totalidad.
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
