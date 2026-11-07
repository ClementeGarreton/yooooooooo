import type { Metadata } from 'next'

// El panel es privado: ni la portada de ingreso ni las cuentas deben aparecer en Google.
export const metadata: Metadata = {
  // El layout raíz ya agrega « | Yo me Encargo» con su template.
  title: 'Mi cuenta',
  robots: { index: false, follow: false },
}

export default function MiCuentaLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50">{children}</div>
}
