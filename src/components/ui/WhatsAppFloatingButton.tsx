'use client'

import { usePathname } from 'next/navigation'
import { trackEvent } from '@/lib/tracking'
import { companyWhatsAppLink } from '@/lib/whatsapp'

const WHATSAPP_URL = companyWhatsAppLink('Hola, necesito información sobre sus servicios')

export default function WhatsAppFloatingButton() {
  // El globo es para quien visita el sitio. En el sistema interno (admin y panel del
  // trabajador) tapa botones y no le sirve a nadie; el panel del cliente sí lo conserva.
  const pathname = usePathname() || ''
  if (pathname.startsWith('/admin') || pathname.startsWith('/trabajos')) return null

  const handleClick = () => {
    trackEvent('Contact', { method: 'whatsapp', location: 'floating_widget' })
  }

  return (
    <>
      <style>{`
        @keyframes wa-ping {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes wa-ping-slow {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.9); opacity: 0; }
        }
        @keyframes wa-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        .wa-ring-1 {
          animation: wa-ping 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .wa-ring-2 {
          animation: wa-ping-slow 2.4s cubic-bezier(0.4, 0, 0.6, 1) 0.6s infinite;
        }
        .wa-btn {
          animation: wa-breathe 3s ease-in-out infinite;
        }
        .wa-btn:hover {
          animation: none;
          transform: scale(1.12);
        }
      `}</style>

      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        aria-label="Abrir chat de WhatsApp"
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center"
      >
        {/* Anillos de pulso */}
        <span
          className="wa-ring-1 absolute inline-flex h-14 w-14 rounded-full bg-[#25D366]"
        />
        <span
          className="wa-ring-2 absolute inline-flex h-14 w-14 rounded-full bg-[#25D366]"
        />

        {/* Botón principal */}
        <span
          className="wa-btn relative flex items-center justify-center w-14 h-14 rounded-full bg-[#25D366] shadow-lg transition-transform duration-200"
        >
          {/* Ícono oficial de WhatsApp */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 32 32"
            width="30"
            height="30"
            fill="white"
            aria-hidden="true"
          >
            <path d="M16.003 2.667C8.64 2.667 2.667 8.64 2.667 16c0 2.347.61 4.624 1.77 6.627L2.667 29.333l6.88-1.733A13.28 13.28 0 0 0 16.003 29.333C23.363 29.333 29.333 23.363 29.333 16S23.363 2.667 16.003 2.667zm0 24c-2.104 0-4.166-.57-5.962-1.647l-.427-.255-4.083 1.03 1.072-3.963-.278-.44A10.62 10.62 0 0 1 5.333 16c0-5.882 4.788-10.667 10.67-10.667S26.667 10.118 26.667 16 21.882 26.667 16.003 26.667zm5.86-7.977c-.32-.16-1.892-.933-2.185-1.04-.293-.107-.506-.16-.72.16-.213.32-.826 1.04-.933 1.253-.107.213-.213.24-.506.08-.293-.16-1.24-.457-2.36-1.453a8.87 8.87 0 0 1-1.632-2.027c-.16-.32 0-.48.133-.64.12-.12.293-.32.44-.48.147-.16.2-.267.293-.453.107-.213.053-.4-.027-.56-.08-.16-.72-1.733-.987-2.373-.267-.64-.533-.533-.72-.533-.187-.013-.4-.013-.614-.013a1.18 1.18 0 0 0-.853.4c-.293.32-1.12 1.093-1.12 2.667s1.147 3.093 1.307 3.307c.16.213 2.253 3.44 5.463 4.827.763.333 1.36.533 1.823.68.763.24 1.46.213 2.013.133.614-.093 1.893-.773 2.16-1.52.267-.747.267-1.387.187-1.52-.08-.133-.293-.213-.614-.373z" />
          </svg>
        </span>
      </a>
    </>
  )
}
