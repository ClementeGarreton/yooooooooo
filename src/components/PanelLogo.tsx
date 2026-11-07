import Image from 'next/image'

/**
 * Logo de Yo me encargo para los paneles (admin, cliente y equipo). El logo tiene letras
 * negras y fondo transparente, así que sobre la barra azul va dentro de una placa blanca.
 */
export default function PanelLogo({ size = 44, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-white p-1 ${className}`}
      style={{ width: size, height: size }}
    >
      <Image src="/logo.png" alt="Yo me encargo" width={size - 8} height={size - 8} className="h-full w-full object-contain" />
    </span>
  )
}
