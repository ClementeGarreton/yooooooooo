'use client'

import { useEffect, useState } from 'react'
import { getPricingConfig, type PricingConfig } from '@/lib/pricingService'

/**
 * Porcentajes de recargo de sábado, domingo y feriado, para que el calendario muestre lo
 * mismo que después cobra `calculateQuote`.
 *
 * Arranca en `null` y no en los valores por defecto (20/50/100 %): mostrar un «+100%» en
 * los feriados mientras llega la configuración real asustaría por nada. Sin datos, el
 * calendario simplemente no marca recargos.
 */
export function useTimeSurcharges(): PricingConfig['timeSurcharges'] | null {
  const [surcharges, setSurcharges] = useState<PricingConfig['timeSurcharges'] | null>(null)

  useEffect(() => {
    let vigente = true
    getPricingConfig()
      .then((config) => {
        if (vigente) setSurcharges(config.timeSurcharges ?? null)
      })
      .catch(() => {
        /* getPricingConfig ya devuelve los valores por defecto ante un fallo. */
      })
    return () => {
      vigente = false
    }
  }, [])

  return surcharges
}
