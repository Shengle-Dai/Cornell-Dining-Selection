import { requireAdmin, createServiceClient } from '../../_shared/supabase.js'

export async function onRequestGet({ request, env }) {
  const { user, error, status } = await requireAdmin(request, env)
  if (!user) return Response.json({ error }, { status })

  const service = createServiceClient(env)

  const now            = new Date()
  const thirtyDaysAgo  = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString()

  const [
    totalUsersRes,
    totalSubsRes,
    recentProfilesRes,
    recentRatingsRes,
    likedRatingsRes,
    dislikedRatingsRes,
    lastMenuRes,
  ] = await Promise.all([
    service.from('profiles').select('*', { count: 'exact', head: true }),
    service.from('profiles').select('*', { count: 'exact', head: true }).eq('subscribed', true),
    service.from('profiles').select('created_at').gte('created_at', thirtyDaysAgo),
    service.from('ratings').select('created_at, rating').gte('created_at', fourteenDaysAgo),
    service.from('ratings').select('dish_id, dishes(source_name)').eq('rating', 1),
    service.from('ratings').select('dish_id, dishes(source_name)').eq('rating', -1),
    service.from('daily_menus').select('menu_date, eatery').order('menu_date', { ascending: false }).limit(200),
  ])

  // --- Signups by day ---
  const signupMap = {}
  recentProfilesRes.data?.forEach(p => {
    const day = p.created_at.split('T')[0]
    signupMap[day] = (signupMap[day] || 0) + 1
  })
  // Fill in zeros for missing days
  const signupsByDay = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000)
    const dateStr = d.toISOString().split('T')[0]
    signupsByDay.push({ date: dateStr.slice(5), count: signupMap[dateStr] || 0 })
  }

  // --- Ratings by day ---
  const ratingMap = {}
  recentRatingsRes.data?.forEach(r => {
    const day = r.created_at.split('T')[0]
    if (!ratingMap[day]) ratingMap[day] = { liked: 0, disliked: 0 }
    if (r.rating === 1)  ratingMap[day].liked++
    else                 ratingMap[day].disliked++
  })
  const ratingsByDay = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000)
    const dateStr = d.toISOString().split('T')[0]
    ratingsByDay.push({
      date: dateStr.slice(5),
      liked:    ratingMap[dateStr]?.liked    || 0,
      disliked: ratingMap[dateStr]?.disliked || 0,
    })
  }

  // --- Top liked / disliked ---
  function topDishes(rows) {
    const counts = {}
    const names  = {}
    rows?.forEach(r => {
      counts[r.dish_id] = (counts[r.dish_id] || 0) + 1
      names[r.dish_id]  = r.dishes?.source_name || 'Unknown'
    })
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([dish_id, count]) => ({ dish_id: parseInt(dish_id, 10), name: names[dish_id], count }))
  }

  // --- Last menu date + eatery count ---
  const lastMenuDate = lastMenuRes.data?.[0]?.menu_date ?? null
  const lastMenuEateryCount = lastMenuDate
    ? new Set(
        lastMenuRes.data
          ?.filter(m => m.menu_date === lastMenuDate)
          .map(m => m.eatery)
      ).size
    : 0

  return Response.json({
    total_users:              totalUsersRes.count ?? 0,
    total_subscribers:        totalSubsRes.count  ?? 0,
    signups_by_day:           signupsByDay,
    ratings_by_day:           ratingsByDay,
    top_liked:                topDishes(likedRatingsRes.data),
    top_disliked:             topDishes(dislikedRatingsRes.data),
    last_menu_date:           lastMenuDate,
    last_menu_eatery_count:   lastMenuEateryCount,
  })
}
