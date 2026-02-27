import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthGuard from '../components/AuthGuard'
import WeightChips from '../components/WeightChips'
import RatingHistory from '../components/RatingHistory'
import { supabase } from '../lib/supabase'

const CUISINES = ['chinese', 'japanese', 'korean', 'indian', 'mexican', 'italian', 'american', 'mediterranean', 'thai', 'vietnamese']
const FLAVORS  = ['savory', 'sweet', 'spicy', 'sour', 'umami', 'mild', 'smoky', 'tangy', 'rich', 'fresh']
const METHODS  = ['fried', 'grilled', 'baked', 'steamed', 'stir-fried', 'roasted', 'braised', 'raw', 'sauteed', 'smoked']

const DIETARY = [
  { value: 'vegetarian',   label: 'Vegetarian' },
  { value: 'vegan',        label: 'Vegan' },
  { value: 'gluten-free',  label: 'Gluten-free' },
  { value: 'dairy-free',   label: 'Dairy-free' },
  { value: 'halal',        label: 'Halal' },
  { value: 'no-nuts',      label: 'Nut Allergy' },
  { value: 'no-shellfish', label: 'Shellfish Allergy' },
]

export default function Dashboard() {
  return <AuthGuard><DashboardInner /></AuthGuard>
}

function DashboardInner() {
  const navigate = useNavigate()

  const [profile,    setProfile]    = useState(null)
  const [prefs,      setPrefs]      = useState(null)
  const [ratings,    setRatings]    = useState([])
  const [loading,    setLoading]    = useState(true)

  // Editable preference state
  const [subscribed,      setSubscribed]      = useState(true)
  const [cuisineWeights,  setCuisineWeights]  = useState({})
  const [flavorWeights,   setFlavorWeights]   = useState({})
  const [methodWeights,   setMethodWeights]   = useState({})
  const [dietary,         setDietary]         = useState([])

  const [saving,   setSaving]   = useState(false)
  const [saveMsg,  setSaveMsg]  = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token
  }

  async function loadData() {
    setLoading(true)
    const token = await getToken()
    if (!token) { navigate('/'); return }

    const [profileRes, prefsRes, ratingsRes] = await Promise.all([
      supabase.from('profiles').select('subscribed').single(),
      supabase.from('user_preferences').select('cuisine_weights, flavor_weights, method_weights, dietary_restrictions').single(),
      fetch('/api/ratings', { headers: { Authorization: `Bearer ${token}` } }),
    ])

    if (profileRes.data) {
      setProfile(profileRes.data)
      setSubscribed(profileRes.data.subscribed)
    }
    if (prefsRes.data) {
      setPrefs(prefsRes.data)
      setCuisineWeights(prefsRes.data.cuisine_weights || {})
      setFlavorWeights(prefsRes.data.flavor_weights || {})
      setMethodWeights(prefsRes.data.method_weights || {})
      setDietary(prefsRes.data.dietary_restrictions || [])
    }
    if (ratingsRes.ok) {
      const data = await ratingsRes.json()
      setRatings(data || [])
    }

    setLoading(false)
  }

  async function savePrefs() {
    setSaving(true)
    setSaveMsg(null)
    const token = await getToken()
    if (!token) return

    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          subscribed,
          cuisine_weights: cuisineWeights,
          flavor_weights:  flavorWeights,
          method_weights:  methodWeights,
          dietary_restrictions: dietary,
        }),
      })
      setSaveMsg(res.ok ? 'Saved!' : 'Failed to save.')
    } catch {
      setSaveMsg('Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRating(ratingId) {
    const token = await getToken()
    if (!token) return
    const res = await fetch(`/api/ratings?rating_id=${ratingId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      setRatings(prev => prev.filter(r => r.id !== ratingId))
    }
  }

  function toggleDietary(val) {
    setDietary(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    )
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

  return (
    <div className="min-h-screen bg-white py-10 px-5">
      <div className="max-w-lg mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="font-serif text-2xl font-semibold text-cornell-red">Your Dashboard</h1>
          <button
            onClick={signOut}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Subscription toggle */}
        <section className="mb-8 p-5 border border-gray-200 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Subscription</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">
                {subscribed ? '✅ Subscribed' : '⏸️ Paused'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {subscribed ? 'You receive daily dining picks.' : 'Daily emails are paused.'}
              </p>
            </div>
            <button
              onClick={() => setSubscribed(s => !s)}
              className={`px-4 py-2 text-sm font-semibold rounded border transition-all ${
                subscribed
                  ? 'border-gray-300 text-gray-600 hover:border-red-400 hover:text-red-600'
                  : 'border-cornell-red text-cornell-red hover:bg-cornell-red hover:text-white'
              }`}
            >
              {subscribed ? 'Pause' : 'Resume'}
            </button>
          </div>
        </section>

        {/* Taste preferences */}
        <section className="mb-8 p-5 border border-gray-200 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Taste Preferences</h2>

          <WeightChips label="Cuisines" options={CUISINES} value={cuisineWeights} onChange={setCuisineWeights} />
          <WeightChips label="Flavors"  options={FLAVORS}  value={flavorWeights}  onChange={setFlavorWeights} />
          <WeightChips label="Cooking styles" options={METHODS} value={methodWeights} onChange={setMethodWeights} />

          <div className="mt-2">
            <h3 className="text-sm font-semibold text-cornell-red mb-2">Dietary restrictions</h3>
            <div className="flex flex-wrap gap-2">
              {DIETARY.map(d => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDietary(d.value)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                    dietary.includes(d.value)
                      ? 'bg-cornell-red text-white border-cornell-red'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-cornell-red'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-4">
            <button
              onClick={savePrefs}
              disabled={saving}
              className="px-5 py-2.5 bg-cornell-red text-white text-sm font-semibold uppercase tracking-wide rounded hover:bg-red-800 transition-all disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            {saveMsg && (
              <span className={`text-sm ${saveMsg === 'Saved!' ? 'text-green-600' : 'text-red-600'}`}>
                {saveMsg}
              </span>
            )}
          </div>
        </section>

        {/* Rating history */}
        <section className="mb-8 p-5 border border-gray-200 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Rating History</h2>
          <RatingHistory ratings={ratings} onDelete={deleteRating} />
        </section>
      </div>
    </div>
  )
}
