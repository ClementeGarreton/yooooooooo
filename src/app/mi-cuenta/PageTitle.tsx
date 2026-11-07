/** Título de cada página del panel, con el mismo ancho y aire en todas. */
export default function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold text-slate-900 lg:text-4xl">{title}</h1>
      {subtitle && <p className="mt-2 text-slate-500 lg:text-lg">{subtitle}</p>}
    </div>
  )
}
