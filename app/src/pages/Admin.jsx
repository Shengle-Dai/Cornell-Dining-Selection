import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import AuthGuard from '../components/AuthGuard'
import StatCard from '../components/StatCard'
import { supabase } from '../lib/supabase'

export default function Admin() {
  return <AuthGuard><AdminInner /></AuthGuard>
}

function AdminInner() {
  const navigate = useNavigate()
  const [stats,    setStats]    = useState(null)
  const [menus,    setMenus]    = useState(null)
  const [menuDate, setMenuDate] = useState(new Date().toISOString().split('T')[0])
  const [loading,  setLoading]  = useState(true)
  const [denied,   setDenied]   = useState(false)

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token
  }

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    const token = await getToken()
    if (!token) { navigate('/'); return }
    const res = await fetch('/api/admin/stats', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 403) { setDenied(true); setLoading(false); return }
    const data = await res.json()
    setStats(data)
    setLoading(false)
  }

  async function loadMenus() {
    const token = await getToken()
    if (!token) return
    const res = await fetch(`/api/admin/menus?date=${menuDate}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setMenus(await res.json())
  }

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    )
  }

  if (denied) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-5">
        <div className="max-w-sm text-center">
          <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">Access Denied</h1>
          <p className="text-gray-500">This page is for admins only.</p>
          <a href="/" className="mt-6 inline-block text-sm text-cornell-red hover:underline">Go home</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-5">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="font-serif text-2xl font-semibold text-cornell-red">Admin Dashboard</h1>
          <button
            onClick={signOut}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Subscribers"       value={stats?.total_subscribers} />
          <StatCard label="Total Users"        value={stats?.total_users} />
          <StatCard label="Last Menu Date"     value={stats?.last_menu_date} />
          <StatCard label="Eateries Scraped"   value={stats?.last_menu_eatery_count} />
        </div>

        {/* Signups chart */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Signups — Last 30 Days</h2>
          {stats?.signups_by_day?.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={stats.signups_by_day}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#B31B1B" strokeWidth={2} dot={false} name="Signups" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400">No signup data in this period.</p>
          )}
        </div>

        {/* Ratings chart */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Daily Ratings — Last 14 Days</h2>
          {stats?.ratings_by_day?.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.ratings_by_day}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="liked"    fill="#B31B1B" name="👍 Liked"    radius={[3, 3, 0, 0]} />
                <Bar dataKey="disliked" fill="#d1d5db" name="👎 Disliked" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400">No rating data in this period.</p>
          )}
        </div>

        {/* Top liked / disliked */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Top Liked Dishes</h2>
            {stats?.top_liked?.length > 0 ? (
              <ol className="space-y-2">
                {stats.top_liked.map((d, i) => (
                  <li key={d.dish_id} className="flex justify-between text-sm">
                    <span className="text-gray-700"><span className="text-gray-400 mr-2">{i + 1}.</span>{d.name}</span>
                    <span className="text-gray-500">{d.count} 👍</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-gray-400">No data yet.</p>}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Top Disliked Dishes</h2>
            {stats?.top_disliked?.length > 0 ? (
              <ol className="space-y-2">
                {stats.top_disliked.map((d, i) => (
                  <li key={d.dish_id} className="flex justify-between text-sm">
                    <span className="text-gray-700"><span className="text-gray-400 mr-2">{i + 1}.</span>{d.name}</span>
                    <span className="text-gray-500">{d.count} 👎</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-gray-400">No data yet.</p>}
          </div>
        </div>

        {/* Menu browser */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Menu Browser</h2>
          <div className="flex gap-3 mb-4">
            <input
              type="date"
              value={menuDate}
              onChange={e => setMenuDate(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
            <button
              onClick={loadMenus}
              className="px-4 py-1.5 bg-cornell-red text-white text-sm font-semibold rounded hover:bg-red-800 transition-all"
            >
              Load
            </button>
          </div>

          {menus === null && <p className="text-sm text-gray-400">Select a date to view the menu.</p>}
          {menus !== null && menus.length === 0 && (
            <p className="text-sm text-gray-400">No menu data for {menuDate}.</p>
          )}
          {menus !== null && menus.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 pr-4 text-gray-500 font-medium">Eatery</th>
                    <th className="text-left py-2 pr-4 text-gray-500 font-medium">Bucket</th>
                    <th className="text-left py-2 text-gray-500 font-medium">Dish</th>
                  </tr>
                </thead>
                <tbody>
                  {menus.map(m => (
                    <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 pr-4 text-gray-700">{m.eatery}</td>
                      <td className="py-2 pr-4 text-gray-500">{m.bucket}</td>
                      <td className="py-2 text-gray-800">{m.dishes?.source_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
