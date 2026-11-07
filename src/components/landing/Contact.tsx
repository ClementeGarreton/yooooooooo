'use client'

import { Mail, Phone, Clock, MessageCircle, ArrowRight, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { trackEvent } from '@/lib/tracking'
import { companyWhatsAppLink } from '@/lib/whatsapp'

function WhatsAppIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width="32"
      height="32"
      fill="white"
      aria-hidden="true"
    >
      <path d="M16.003 2.667C8.64 2.667 2.667 8.64 2.667 16c0 2.347.61 4.624 1.77 6.627L2.667 29.333l6.88-1.733A13.28 13.28 0 0 0 16.003 29.333C23.363 29.333 29.333 23.363 29.333 16S23.363 2.667 16.003 2.667zm0 24c-2.104 0-4.166-.57-5.962-1.647l-.427-.255-4.083 1.03 1.072-3.963-.278-.44A10.62 10.62 0 0 1 5.333 16c0-5.882 4.788-10.667 10.67-10.667S26.667 10.118 26.667 16 21.882 26.667 16.003 26.667zm5.86-7.977c-.32-.16-1.892-.933-2.185-1.04-.293-.107-.506-.16-.72.16-.213.32-.826 1.04-.933 1.253-.107.213-.213.24-.506.08-.293-.16-1.24-.457-2.36-1.453a8.87 8.87 0 0 1-1.632-2.027c-.16-.32 0-.48.133-.64.12-.12.293-.32.44-.48.147-.16.2-.267.293-.453.107-.213.053-.4-.027-.56-.08-.16-.72-1.733-.987-2.373-.267-.64-.533-.533-.72-.533-.187-.013-.4-.013-.614-.013a1.18 1.18 0 0 0-.853.4c-.293.32-1.12 1.093-1.12 2.667s1.147 3.093 1.307 3.307c.16.213 2.253 3.44 5.463 4.827.763.333 1.36.533 1.823.68.763.24 1.46.213 2.013.133.614-.093 1.893-.773 2.16-1.52.267-.747.267-1.387.187-1.52-.08-.133-.293-.213-.614-.373z" />
    </svg>
  )
}

export default function Contact() {
  const contactItems = [
    {
      icon: MessageCircle,
      customIcon: <WhatsAppIcon />,
      title: 'WhatsApp',
      value: '+56 9 5233 4799',
      description: 'Respuesta inmediata',
      href: companyWhatsAppLink(),
      gradient: 'from-green-500 to-emerald-600',
      bgGradient: 'from-green-50 to-emerald-50',
      iconBg: 'bg-gradient-to-br from-green-400 to-emerald-500',
      hoverTextColor: 'group-hover:text-green-600',
    },
    {
      icon: Phone,
      title: 'Teléfono',
      value: '+56 9 5233 4799',
      description: 'Lunes a Domingo',
      href: 'tel:+56952334799',
      gradient: 'from-blue-500 to-cyan-600',
      bgGradient: 'from-blue-50 to-cyan-50',
      iconBg: 'bg-gradient-to-br from-blue-400 to-cyan-500',
      hoverTextColor: 'group-hover:text-blue-600',
    },
    {
      icon: Mail,
      title: 'Email',
      value: 'contacto@yomeencargo.cl',
      description: 'Respuesta en 24hrs',
      href: 'mailto:contacto@yomeencargo.cl',
      gradient: 'from-cyan-500 to-blue-600',
      bgGradient: 'from-cyan-50 to-blue-50',
      iconBg: 'bg-gradient-to-br from-cyan-400 to-blue-500',
      hoverTextColor: 'group-hover:text-cyan-600',
    },
  ]

  return (
    <section className="relative py-20 md:py-32 overflow-hidden">
      {/* Fondo decorativo */}
      <div className="absolute inset-0 bg-gradient-to-br from-brand-blue-light via-white to-cyan-50"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(111,168,220,0.1),transparent_50%)]"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(140,198,63,0.08),transparent_50%)]"></div>

      <div className="container mx-auto px-4 relative z-10">
        {/* Encabezado */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16 md:mb-20"
        >
          <motion.div
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-brand-blue to-brand-cyan rounded-2xl mb-6 shadow-lg"
          >
            <MessageCircle className="text-white" size={32} />
          </motion.div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6">
            Contáctanos
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            Estamos listos para ayudarte con tu mudanza o traslado
          </p>
        </motion.div>

        <div className="max-w-6xl mx-auto">
          {/* Grid de Contacto */}
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            {contactItems.map((item, index) => {
              const Icon = item.icon
              const iconElement = item.customIcon ?? <Icon className="text-white" size={32} />
              return (
                <motion.a
                  key={item.title}
                  href={item.href}
                  target={item.href.startsWith('http') ? '_blank' : undefined}
                  rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  onClick={() => trackEvent('Contact', { method: item.title.toLowerCase(), location: 'contact_section' })}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  whileHover={{ y: -8, scale: 1.02 }}
                  className="group relative bg-white p-8 rounded-3xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden"
                >
                  {/* Efecto de fondo al hover */}
                  <div className={`absolute inset-0 bg-gradient-to-br ${item.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>

                  {/* Decoración de esquina */}
                  <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${item.gradient} opacity-5 rounded-bl-full transform translate-x-8 -translate-y-8 group-hover:opacity-10 transition-opacity duration-300`}></div>

                  <div className="relative z-10">
                    {/* Icono */}
                    <div className={`${item.iconBg} w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                      {iconElement}
                    </div>

                    {/* Contenido */}
                    <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-gray-800 transition-colors">
                      {item.title}
                    </h3>
                    <p className={`text-lg font-semibold text-brand-blue mb-2 ${item.hoverTextColor} transition-colors`}>
                      {item.value}
                    </p>
                    <p className="text-sm text-gray-600">
                      {item.description}
                    </p>

                    {/* Flecha */}
                    <div className="mt-6 flex items-center text-brand-blue group-hover:translate-x-2 transition-transform duration-300">
                      <span className="text-sm font-semibold mr-2">Contactar</span>
                      <ArrowRight size={18} />
                    </div>
                  </div>
                </motion.a>
              )
            })}
          </div>

          {/* Información adicional y CTA */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Horario */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="bg-white p-8 rounded-3xl shadow-lg hover:shadow-xl transition-shadow duration-300"
            >
              <div className="flex items-start space-x-4">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-400 to-pink-500 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
                  <Clock className="text-white" size={32} />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900 mb-3">Horario de Atención</h3>
                  <div className="space-y-2">
                    <p className="text-lg font-semibold text-gray-800">Lunes a Domingo</p>
                    <p className="text-2xl font-bold text-brand-blue">9:00 - 18:00 hrs</p>
                    <p className="text-sm text-gray-600 mt-3 flex items-center">
                      <Sparkles size={14} className="mr-2 text-brand-green" />
                      Respondemos emails y WhatsApp
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* CTA Cotización Rápida */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="relative bg-gradient-to-br from-brand-blue via-brand-cyan to-cyan-500 p-8 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 overflow-hidden group"
            >
              {/* Efectos decorativos de fondo */}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.2),transparent_50%)]"></div>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(255,255,255,0.1),transparent_50%)]"></div>

              <div className="relative z-10 text-white">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center mr-4">
                    <Sparkles className="text-white" size={24} />
                  </div>
                  <h3 className="text-2xl font-bold">¿Necesitas una cotización rápida?</h3>
                </div>
                <p className="text-white/90 mb-6 text-lg leading-relaxed">
                  Usa nuestro cotizador online y obtén tu presupuesto al instante, sin esperas ni complicaciones.
                </p>
                <a
                  href="/cotizador"
                  className="inline-flex items-center justify-center w-full px-6 py-4 bg-white text-brand-blue rounded-xl hover:bg-gray-50 transition-all duration-300 font-bold text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-1 group-hover:scale-105"
                >
                  <span>Ir al Cotizador</span>
                  <ArrowRight size={20} className="ml-2 group-hover:translate-x-1 transition-transform" />
                </a>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}
