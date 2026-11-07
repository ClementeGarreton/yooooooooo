import { NextResponse } from 'next/server'
import { getMarketingConfig, referralsLive } from '@/lib/coupons'
import { getAdminCredits } from '@/lib/referralCredits'

export const dynamic = 'force-dynamic'

/** Referidos con sus dos pasos y retiros de créditos, para Marketing. */
export async function GET() {
  try {
    const { available, config } = await getMarketingConfig()
    return NextResponse.json(await getAdminCredits(config, available && referralsLive(config)))
  } catch (error) {
    console.error('[admin/credits] Error:', error)
    return NextResponse.json({ error: 'No se pudieron cargar los créditos' }, { status: 500 })
  }
}
