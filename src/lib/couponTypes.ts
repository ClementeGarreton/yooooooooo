// Tipos de cupones y referidos, SIN dependencias de servidor (los usan la tarjeta de
// cotización del panel y la configuración del admin). Lo que toca la base vive en coupons.ts.

export type CouponKind = 'porcentaje' | 'monto'
export type CouponOrigin = 'manual' | 'referido' | 'premio'

export interface MarketingConfig {
  referralEnabled: boolean
  referredKind: CouponKind | null
  referredValue: number | null
  rewardKind: CouponKind | null
  rewardValue: number | null
  rewardValidDays: number
  /** Tope en pesos del descuento del referido. null = sin tope. */
  referredCap: number | null
  /** true = el código solo sirve a quien nunca ha sido cliente. */
  onlyNew: boolean
  /**
   * Pesos pagados por el referido que valen 1 crédito para el dueño del código (1 crédito =
   * $1). null = se usa el premio anterior (`rewardKind` / `rewardValue`).
   */
  pesosPerToken: number | null
}

export interface AdminCoupon {
  id: string
  code: string
  origin: CouponOrigin
  kind: CouponKind | null
  value: number | null
  minAmount: number
  /** Tope del descuento en pesos. null = sin tope. */
  maxDiscount: number | null
  /** false = falta correr add_coupon_max_discount.sql. */
  maxDiscountAvailable: boolean
  maxUses: number | null
  validFrom: string | null
  validUntil: string | null
  active: boolean
  description: string | null
  ownerLabel: string | null
  /** Usos que cuentan: su reserva se pagó y sigue al precio con descuento. */
  uses: number
  createdAt: string
}

/** Lo que ve el cliente al aplicar un cupón a una cotización. */
export interface CouponQuote {
  code: string
  label: string
  discount: number
  finalPrice: number
  abono50: number
  full95: number
}

/** «15%» o «$20.000». */
export function couponValueLabel(kind: CouponKind | null, value: number | null): string {
  if (!kind || !value) return 'Sin definir'
  return kind === 'porcentaje' ? `${value}%` : `$${value.toLocaleString('es-CL')}`
}
