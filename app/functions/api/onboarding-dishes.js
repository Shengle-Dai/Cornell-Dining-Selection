import { createAnonClient, requireAuth } from '../_shared/supabase.js'

export async function onRequestGet({ request, env }) {
  const { user, error, status } = await requireAuth(request, env)
  if (!user) return Response.json({ error }, { status })

  const supabase = createAnonClient(env, request.headers.get('Authorization'))
  const { data, error: dbError } = await supabase
    .from('dishes')
    .select('id, source_name, cuisine_type')
    .eq('is_onboarding_dish', true)

  if (dbError) {
    console.error('Onboarding dishes fetch error:', dbError)
    return Response.json({ error: 'Failed to fetch onboarding dishes' }, { status: 500 })
  }

  return Response.json(data || [])
}
