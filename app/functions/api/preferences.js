import { requireAuth, createServiceClient } from '../_shared/supabase.js'

export async function onRequestPost({ request, env }) {
  const { user, error, status } = await requireAuth(request, env)
  if (!user) return Response.json({ error }, { status })

  const body = await request.json()
  const cuisineWeights      = body.cuisine_weights      || {}
  const flavorWeights       = body.flavor_weights       || {}
  const methodWeights       = body.method_weights       || {}
  const ingredients         = body.ingredients          || []
  const dietaryRestrictions = body.dietary_restrictions || []
  const dishRatings         = body.dish_ratings         || []

  const service = createServiceClient(env)

  const { error: upsertError } = await service.from('user_preferences').upsert(
    {
      user_id:               user.id,
      cuisine_weights:       cuisineWeights,
      flavor_weights:        flavorWeights,
      method_weights:        methodWeights,
      initial_ingredients:   ingredients,
      dietary_restrictions:  dietaryRestrictions,
      vector_stale:          true,
      updated_at:            new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  if (upsertError) {
    console.error('Preferences upsert error:', upsertError)
    return Response.json({ error: 'Failed to save preferences' }, { status: 500 })
  }

  if (dishRatings.length > 0) {
    const today = new Date().toISOString().split('T')[0]
    const rows = dishRatings.map(({ dish_id, score }) => {
      const direction = score >= 6 ? 1 : -1
      const strength  = Math.abs(score - 5.5) / 4.5
      return { user_id: user.id, dish_id, rating: direction, strength, menu_date: today }
    })
    const { error: ratingError } = await service
      .from('ratings')
      .upsert(rows, { onConflict: 'user_id,dish_id,menu_date' })
    if (ratingError) {
      console.error('Onboarding ratings upsert error:', ratingError)
      // Non-fatal
    }
  }

  return Response.json({ ok: true })
}
