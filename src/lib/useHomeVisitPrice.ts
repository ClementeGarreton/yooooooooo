'use client'

import { useEffect, useState } from 'react'
import { getPricingConfig } from '@/lib/pricingService'
import { DEFAULT_HOME_VISIT_PRICE, normalizeHomeVisitPrice } from '@/lib/homeVisitPricing'

/**
 * Precio configurado de la visita a domicilio, para las pantallas que lo muestran.
 *
 * Vive aparte de `homeVisitPricing.ts` porque ese módulo lo importa también la API, que
 * corre en el servidor y no puede arrastrar hooks de React.
 *
 * Arranca en el valor por defecto y lo reemplaza cuando llega la configuración: así la
 * primera pintura muestra un precio real en vez de un cero o un hueco, y si la lectura
 * falla la página sigue diciendo lo mismo que hoy. `getPricingConfig()` ya cachea cinco
 * minutos, así que varias pantallas montadas a la vez no repiten la consulta.
 */
export function useHomeVisitPrice(): number {
  const [price, setPrice] = useState(DEFAULT_HOME_VISIT_PRICE)

  useEffect(() => {
    let vigente = true
    getPricingConfig()
      .then((config) => {
        if (vigente) setPrice(normalizeHomeVisitPrice(config.additionalServices?.homeVisitPrice))
      })
      .catch(() => {
        /* getPricingConfig ya devuelve los valores por defecto ante un fallo. */
      })
    return () => {
      vigente = false
    }
  }, [])

  return price
}
