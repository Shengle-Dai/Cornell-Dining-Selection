import { requireAuth, createServiceClient } from '../_shared/supabase.js'

export async function onRequestPatch({ request, env }) {
  const { user, error, status } = await requireAuth(request, env)
  if (!user) return Response.json({ error }, { status })

  const body = await request.json()
  const service = createServiceClient(env)

  // Update profiles.subscribed if provided
  if (typeof body.subscribed === 'boolean') {
    const { error: profileError } = await service
      .from('profiles')
      .update({ subscribed: body.subscribed, updated_at: new Date().toISOString() })
      .eq('id', user.id)
    if (profileError) {
      console.error('Profile update error:', profileError)
      return Response.json({ error: 'Failed to update subscription' }, { status: 500 })
    }
  }

  // Update user_preferences fields if any weight/restriction field was sent
  const prefFields = ['cuisine_weights', 'flavor_weights', 'method_weights', 'dietary_restrictions']
  const prefUpdate = {}
  for (const field of prefFields) {
    if (body[field] !== undefined) prefUpdate[field] = body[field]
  }

  if (Object.keys(prefUpdate).length > 0) {
    prefUpdate.vector_stale = true
    prefUpdate.updated_at   = new Date().toISOString()

    const { error: prefError } = await service
      .from('user_preferences')
      .upsert({ user_id: user.id, ...prefUpdate }, { onConflict: 'user_id' })

    if (prefError) {
      console.error('Preferences update error:', prefError)
      return Response.json({ error: 'Failed to update preferences' }, { status: 500 })
    }
  }

  return Response.json({ ok: true })
}
