'use client'

import { Truck, Home, Briefcase, Package, Building2, RefreshCw } from 'lucide-react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { companyWhatsAppLink } from '@/lib/whatsapp'

export default function Services() {
  const services = [
    {
      icon: Truck,
      title: 'Fletes en Santiago',
      description: 'Traslado de carga y objetos dentro de la Región Metropolitana',
      features: [
        'Servicio el mismo día',
        'Carga y descarga incluida',
        'Vehículos de diferentes tamaños',
      ],
      color: 'from-brand-blue to-brand-blue',
      delay: 0.1,
    },
    {
      icon: Home,
      title: 'Mudanzas de Hogar',
      description: 'Mudanzas completas de casas y departamentos',
      features: [
        'Embalaje disponible',
        'Protección de muebles',
        'Personal capacitado',
      ],
      color: 'from-brand-blue to-brand-cyan',
      delay: 0.2,
    },
    {
      icon: Briefcase,
      title: 'Mudanzas de Oficina',
      description: 'Traslado de equipamiento y mobiliario empresarial',
      features: [
        'Coordinación logística',
        'Horarios flexibles',
        'Minimal downtime',
      ],
      color: 'from-brand-green to-brand-green-dark',
      delay: 0.3,
    },
    {
      icon: Package,
      title: 'Traslado a Regiones',
      description: 'Envíos y mudanzas a todo Chile',
      features: [
        'Cobertura nacional',
        'Tracking del envío',
        'Entrega coordinada',
      ],
      color: 'from-indigo-500 to-indigo-600',
      delay: 0.4,
    },
    {
      icon: Building2,
      title: 'Servicios Corporativos',
      description: 'Soluciones logísticas para empresas',
      features: [
        'Contratos mensuales',
        'Facturación centralizada',
        'Atención prioritaria',
      ],
      color: 'from-purple-500 to-purple-600',
      delay: 0.5,
    },
    {
      icon: RefreshCw,
      title: 'Servicios Recurrentes',
      description: 'Transporte programado y regular',
      features: [
        'Agenda personalizada',
        'Precios preferenciales',
        'Servicio garantizado',
      ],
      color: 'from-pink-500 to-pink-600',
      delay: 0.6,
    },
  ]

  return (
    <section id="servicios" className="py-20 md:py-28 bg-gradient-to-br from-gray-50 to-brand-blue-light">
      <div className="container mx-auto px-4">
        {/* Encabezado */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
            Nuestros Servicios
          </h2>
          <p className="text-lg md:text-xl text-gray-600 max-w-3xl mx-auto">
            Soluciones de transporte y logística adaptadas a tus necesidades
          </p>
        </motion.div>

        {/* Grid de Servicios */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: service.delay }}
              className="group bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden border border-gray-100"
            >
              {/* Header con gradiente */}
              <div className={`bg-gradient-to-r ${service.color} p-6 text-white`}>
                <service.icon size={48} className="mb-4" />
                <h3 className="text-2xl font-bold mb-2">{service.title}</h3>
                <p className="text-white/90 text-sm">{service.description}</p>
              </div>

              {/* Contenido */}
              <div className="p-6">
                <ul className="space-y-3 mb-6">
                  {service.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start">
                      <svg
                        className="w-5 h-5 text-brand-green mr-2 mt-0.5 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/cotizador"
                  className="block w-full text-center px-6 py-3 bg-gray-100 text-brand-blue rounded-lg hover:bg-brand-blue hover:text-white transition-all duration-300 font-semibold group-hover:shadow-md"
                >
                  Cotizar este Servicio
                </Link>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA adicional */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.7 }}
          className="mt-16 text-center"
        >
          <div className="bg-gradient-to-r from-brand-blue to-brand-cyan rounded-2xl p-8 md:p-12 text-white shadow-2xl">
            <h3 className="text-2xl md:text-3xl font-bold mb-4">
              ¿No encuentras lo que buscas?
            </h3>
            <p className="text-lg mb-6 text-white/90">
              Contáctanos y encontraremos la solución perfecta para tu necesidad
            </p>
            <a
              href={companyWhatsAppLink('Hola, necesito información sobre un servicio especial')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-8 py-4 bg-white text-brand-blue rounded-lg hover:bg-gray-100 transition-all duration-300 font-bold shadow-lg hover:shadow-xl transform hover:-translate-y-1"
            >
              Consultar por WhatsApp
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
