import { Metadata } from 'next'
import Navbar from '@/components/landing/Navbar'
import Footer from '@/components/landing/Footer'

export const metadata: Metadata = {
  title: 'Política de Privacidad',
  description: 'Política de privacidad y protección de datos personales de Yo me Encargo. Conoce cómo protegemos tu información.',
  alternates: {
    canonical: 'https://yomeencargo.cl/politica-de-privacidad',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="pt-32 pb-12">
          <div className="container mx-auto px-4">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 text-center">
              Política de Privacidad
            </h1>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-4 pb-12 max-w-4xl">
        <div className="bg-white rounded-xl shadow-lg p-8 md:p-12">
          <div className="prose prose-lg max-w-none">
            
            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Introducción</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                En <strong>Yo me Encargo</strong>, valoramos y respetamos su privacidad. Esta Política de Privacidad 
                describe cómo recopilamos, usamos, almacenamos y protegemos su información personal cuando utiliza 
                nuestros servicios de transporte y mudanzas.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Al utilizar nuestros servicios, usted acepta las prácticas descritas en esta política. Si no está 
                de acuerdo con estas prácticas, le recomendamos no utilizar nuestros servicios.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Información que Recopilamos</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Recopilamos diferentes tipos de información para proporcionar y mejorar nuestros servicios:
              </p>
              
              <h3 className="text-xl font-bold text-gray-900 mb-3 mt-6">2.1 Información Personal</h3>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Nombre completo</li>
                <li>Número de teléfono</li>
                <li>Dirección de correo electrónico</li>
                <li>RUT (opcional, para facturación)</li>
                <li>Direcciones de origen y destino del servicio</li>
              </ul>

              <h3 className="text-xl font-bold text-gray-900 mb-3 mt-6">2.2 Información del Servicio</h3>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Detalles de la cotización y servicio contratado</li>
                <li>Tipo y cantidad de objetos a transportar</li>
                <li>Fechas y horarios de servicio</li>
                <li>Comentarios o instrucciones especiales</li>
              </ul>

              <h3 className="text-xl font-bold text-gray-900 mb-3 mt-6">2.3 Información Técnica</h3>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Dirección IP</li>
                <li>Tipo de navegador y dispositivo</li>
                <li>Páginas visitadas en nuestro sitio web</li>
                <li>Fecha y hora de las visitas</li>
                <li>Cookies y tecnologías similares</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Cómo Usamos su Información</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Utilizamos la información recopilada para los siguientes propósitos:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li><strong>Prestación del servicio:</strong> Coordinar y ejecutar los servicios de mudanza o transporte contratados</li>
                <li><strong>Comunicación:</strong> Contactarlo para confirmar detalles, enviar actualizaciones y responder consultas</li>
                <li><strong>Facturación:</strong> Procesar pagos y emitir facturas o boletas</li>
                <li><strong>Mejora del servicio:</strong> Analizar y mejorar nuestros servicios y experiencia del usuario</li>
                <li><strong>Marketing:</strong> Enviar información promocional sobre nuestros servicios (solo con su consentimiento)</li>
                <li><strong>Cumplimiento legal:</strong> Cumplir con obligaciones legales y regulatorias</li>
                <li><strong>Seguridad:</strong> Proteger contra fraudes y actividades no autorizadas</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Cómo Compartimos su Información</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                No vendemos su información personal a terceros. Podemos compartir su información en las siguientes circunstancias:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li><strong>Proveedores de servicio:</strong> Compartimos información con proveedores que nos ayudan a operar 
                nuestro negocio (procesamiento de pagos, plataformas tecnológicas, etc.)</li>
                <li><strong>Personal operativo:</strong> Nuestros conductores y personal de carga reciben la información 
                necesaria para completar el servicio</li>
                <li><strong>Obligaciones legales:</strong> Cuando sea requerido por ley o por autoridades competentes</li>
                <li><strong>Protección de derechos:</strong> Para proteger nuestros derechos legales, propiedad o seguridad</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Almacenamiento y Seguridad de Datos</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Tomamos medidas razonables para proteger su información personal:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Encriptación de datos sensibles en tránsito y almacenamiento</li>
                <li>Acceso restringido a información personal solo a personal autorizado</li>
                <li>Revisión regular de nuestras prácticas de seguridad</li>
                <li>Almacenamiento en servidores seguros</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>Retención de datos:</strong> Conservamos su información personal mientras sea necesario para 
                proporcionar nuestros servicios y cumplir con obligaciones legales. Generalmente:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li>Datos de servicio: 5 años (por razones contables y legales)</li>
                <li>Datos de marketing: hasta que retire su consentimiento</li>
                <li>Cookies y datos técnicos: según configuración de su navegador</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Cookies y Tecnologías de Seguimiento</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Utilizamos cookies y tecnologías similares para mejorar su experiencia en nuestro sitio web:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li><strong>Cookies esenciales:</strong> Necesarias para el funcionamiento básico del sitio</li>
                <li><strong>Cookies de rendimiento:</strong> Nos ayudan a entender cómo los usuarios interactúan con el sitio</li>
                <li><strong>Cookies de funcionalidad:</strong> Guardan sus preferencias y configuraciones</li>
                <li><strong>Cookies de marketing:</strong> Utilizadas para mostrar publicidad relevante</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                Puede gestionar las cookies a través de la configuración de su navegador. Sin embargo, desactivar algunas 
                cookies puede afectar la funcionalidad del sitio.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Sus Derechos</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                De acuerdo con la Ley N° 19.628 sobre Protección de la Vida Privada de Chile, usted tiene los siguientes derechos:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2 mb-4">
                <li><strong>Acceso:</strong> Solicitar una copia de la información personal que tenemos sobre usted</li>
                <li><strong>Rectificación:</strong> Solicitar la corrección de información inexacta o incompleta</li>
                <li><strong>Eliminación:</strong> Solicitar la eliminación de su información personal (sujeto a obligaciones legales)</li>
                <li><strong>Oposición:</strong> Oponerse al procesamiento de sus datos para ciertos fines</li>
                <li><strong>Portabilidad:</strong> Solicitar la transferencia de sus datos a otro proveedor</li>
                <li><strong>Retirar consentimiento:</strong> Retirar su consentimiento para el procesamiento de datos en cualquier momento</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                Para ejercer estos derechos, contáctenos a través de{' '}
                <a href="mailto:contacto@yomeencargo.cl" className="text-brand-blue hover:underline">
                  contacto@yomeencargo.cl
                </a>
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Privacidad de Menores</h2>
              <p className="text-gray-700 leading-relaxed">
                Nuestros servicios están dirigidos a personas mayores de 18 años. No recopilamos intencionalmente 
                información personal de menores de edad. Si descubrimos que hemos recopilado información de un menor, 
                eliminaremos dicha información de inmediato.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Enlaces a Sitios de Terceros</h2>
              <p className="text-gray-700 leading-relaxed">
                Nuestro sitio web puede contener enlaces a sitios de terceros (como redes sociales o procesadores de pago). 
                No somos responsables de las prácticas de privacidad de estos sitios externos. Le recomendamos revisar 
                sus políticas de privacidad antes de proporcionarles información.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Cambios a esta Política</h2>
              <p className="text-gray-700 leading-relaxed">
                Nos reservamos el derecho de actualizar esta Política de Privacidad periódicamente para reflejar cambios 
                en nuestras prácticas o en la legislación aplicable. Las modificaciones serán publicadas en esta página 
                con la fecha de última actualización. Le recomendamos revisar esta política regularmente.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Contacto</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Si tiene preguntas, inquietudes o solicitudes relacionadas con esta Política de Privacidad o el 
                manejo de sus datos personales, puede contactarnos:
              </p>
              <ul className="list-none text-gray-700 space-y-2">
                <li><strong>Email:</strong> contacto@yomeencargo.cl</li>
                <li><strong>Teléfono:</strong> +56 9 5233 4799</li>
                <li><strong>WhatsApp:</strong> +56 9 5233 4799</li>
                <li><strong>Horario de atención:</strong> Lunes a Domingo, 9:00 - 19:00 hrs</li>
              </ul>
            </section>

            <div className="mt-12 p-6 bg-green-50 rounded-lg border-l-4 border-brand-green">
              <p className="text-gray-700">
                <strong>Compromiso con su privacidad:</strong> En Yo me Encargo nos comprometemos a proteger su 
                información personal y a ser transparentes sobre cómo la utilizamos. Su confianza es fundamental 
                para nosotros.
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
