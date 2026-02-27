import { hmacVerify } from '../_shared/hmac.js'
import { createServiceClient } from '../_shared/supabase.js'

export async function onRequestGet({ request, env }) {
  const url    = new URL(request.url)
  const email  = (url.searchParams.get('email')   || '').trim().toLowerCase()
  const token  = url.searchParams.get('token')    || ''
  const menuId = url.searchParams.get('menu_id')  || ''
  const date   = url.searchParams.get('date')     || ''
  const rating = url.searchParams.get('rating')   || ''

  if (!email || !token || !menuId || !date || !['up', 'down'].includes(rating)) {
    return redirect('/rate?status=error&msg=Invalid+rating+link')
  }

  const valid = await hmacVerify(env.HMAC_SECRET, email, token)
  if (!valid) {
    return redirect('/rate?status=error&msg=Invalid+or+tampered+token')
  }

  const service = createServiceClient(env)

  const { data: profiles } = await service
    .from('profiles')
    .select('id')
    .eq('email', email)
    .limit(1)

  if (!profiles || profiles.length === 0) {
    return redirect('/rate?status=error&msg=No+account+found+for+this+email')
  }
  const userId = profiles[0].id

  const { data: menuEntry } = await service
    .from('daily_menus')
    .select('dish_id, dishes(source_name)')
    .eq('id', menuId)
    .limit(1)

  if (!menuEntry || menuEntry.length === 0) {
    return redirect('/rate?status=error&msg=Dish+not+found')
  }

  const dishId   = menuEntry[0].dish_id
  const dishName = menuEntry[0].dishes?.source_name || 'this dish'
  const ratingVal = rating === 'up' ? 1 : -1

  const { error: ratingError } = await service.from('ratings').upsert(
    { user_id: userId, dish_id: dishId, rating: ratingVal, menu_date: date },
    { onConflict: 'user_id,dish_id,menu_date' },
  )

  if (ratingError) {
    console.error('Rating upsert error:', ratingError)
    return redirect('/rate?status=error&msg=Failed+to+save+rating')
  }

  await service.from('user_preferences').upsert(
    { user_id: userId, vector_stale: true, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )

  const status = rating === 'up' ? 'liked' : 'disliked'
  return redirect(`/rate?status=${status}&dish=${encodeURIComponent(dishName)}`)
}

function redirect(location) {
  return Response.redirect(location, 302)
}
