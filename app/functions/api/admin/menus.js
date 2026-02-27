import { requireAdmin, createServiceClient } from '../../_shared/supabase.js'

export async function onRequestGet({ request, env }) {
  const { user, error, status } = await requireAdmin(request, env)
  if (!user) return Response.json({ error }, { status })

  const url  = new URL(request.url)
  const date = url.searchParams.get('date') || ''

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: 'date parameter required (YYYY-MM-DD)' }, { status: 400 })
  }

  const service = createServiceClient(env)
  const { data, error: dbError } = await service
    .from('daily_menus')
    .select('id, eatery, bucket, dishes(source_name)')
    .eq('menu_date', date)
    .order('eatery')

  if (dbError) {
    console.error('Menu fetch error:', dbError)
    return Response.json({ error: 'Failed to fetch menus' }, { status: 500 })
  }

  return Response.json(data || [])
}
