import { requireAuth, createServiceClient } from '../_shared/supabase.js'

export async function onRequest({ request, env }) {
  const { user, error, status } = await requireAuth(request, env)
  if (!user) return Response.json({ error }, { status })

  if (request.method === 'GET') {
    const service = createServiceClient(env)
    const { data, error: dbError } = await service
      .from('ratings')
      .select('id, rating, menu_date, dishes(source_name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (dbError) {
      console.error('Ratings fetch error:', dbError)
      return Response.json({ error: 'Failed to fetch ratings' }, { status: 500 })
    }
    return Response.json(data || [])
  }

  if (request.method === 'DELETE') {
    const url      = new URL(request.url)
    const ratingId = parseInt(url.searchParams.get('rating_id') || '', 10)

    if (!ratingId || isNaN(ratingId)) {
      return Response.json({ error: 'rating_id required' }, { status: 400 })
    }

    // Validate ownership before deleting
    const service = createServiceClient(env)
    const { data: existing } = await service
      .from('ratings')
      .select('user_id')
      .eq('id', ratingId)
      .single()

    if (!existing) {
      return Response.json({ error: 'Rating not found' }, { status: 404 })
    }
    if (existing.user_id !== user.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: delError } = await service
      .from('ratings')
      .delete()
      .eq('id', ratingId)

    if (delError) {
      console.error('Rating delete error:', delError)
      return Response.json({ error: 'Failed to delete rating' }, { status: 500 })
    }
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}
