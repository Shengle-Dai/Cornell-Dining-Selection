import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthGuard from '../components/AuthGuard'
import WeightChips from '../components/WeightChips'
import DishSliders from '../components/DishSliders'
import { supabase } from '../lib/supabase'

const CUISINES = ['Chinese', 'Japanese', 'Korean', 'Indian', 'Mexican', 'Italian', 'American', 'Mediterranean', 'Thai', 'Vietnamese']
const FLAVORS  = ['savory', 'sweet', 'spicy', 'sour', 'umami', 'mild', 'smoky', 'tangy', 'rich', 'fresh']
const METHODS  = ['fried', 'grilled', 'baked', 'steamed', 'stir-fried', 'roasted', 'braised', 'raw', 'sauteed', 'smoked']

const INGREDIENT_GROUPS = [
  { label: 'Proteins',          items: ['chicken', 'beef', 'pork', 'tofu', 'shrimp', 'fish', 'eggs', 'lamb'] },
  { label: 'Grains & Starches', items: ['rice', 'noodles', 'pasta', 'bread', 'potato'] },
  { label: 'Produce',           items: ['vegetables', 'mushrooms', 'broccoli', 'spinach', 'corn', 'tomato'] },
  { label: 'Dairy & Other',     items: ['cheese', 'beans', 'lentils', 'onion', 'garlic'] },
]

const DIETARY = [
  { value: 'vegetarian',  label: 'Vegetarian' },
  { value: 'vegan',       label: 'Vegan' },
  { value: 'gluten-free', label: 'Gluten-free' },
  { value: 'dairy-free',  label: 'Dairy-free' },
  { value: 'halal',       label: 'Halal' },
  { value: 'no-nuts',     label: 'Nut Allergy' },
  { value: 'no-shellfish',label: 'Shellfish Allergy' },
]

export default function Onboarding() {
  return <AuthGuard><OnboardingInner /></AuthGuard>
}

function OnboardingInner() {
  const navigate = useNavigate()

  const [cuisineWeights, setCuisineWeights] = useState({})
  const [flavorWeights,  setFlavorWeights]  = useState({})
  const [methodWeights,  setMethodWeights]  = useState({})
  const [ingredients,    setIngredients]    = useState([])
  const [dietary,        setDietary]        = useState([])

  const [dishes,      setDishes]  = useState([])
  const [dishRatings, setDishRatings] = useState({})

  const [saving,  setSaving]  = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    async function loadDishes() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/onboarding-dishes', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setDishes(data || [])
      }
    }
    loadDishes()
  }, [])

  function toggleIngredient(item) {
    setIngredients(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    )
  }

  function toggleDietary(val) {
    setDietary(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }

    const dishRatingsList = Object.entries(dishRatings).map(([dish_id, score]) => ({
      dish_id: parseInt(dish_id, 10),
      score,
    }))
    // Include unrated dishes at the neutral midpoint
    dishes.forEach(d => {
      if (!dishRatings[d.id]) dishRatingsList.push({ dish_id: d.id, score: 5 })
    })

    try {
      const res = await fetch('/api/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          cuisine_weights: cuisineWeights,
          flavor_weights:  flavorWeights,
          method_weights:  methodWeights,
          ingredients,
          dietary_restrictions: dietary,
          dish_ratings: dishRatingsList,
        }),
      })
      if (res.ok) {
        setDone(true)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save. Please try again.')
      }
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-5">
        <div className="max-w-sm w-full text-center">
          <div className="text-cornell-red mb-6">
            <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">Preferences Saved!</h1>
          <p className="text-gray-500">Your daily picks will be personalized starting tomorrow.</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="mt-6 w-full py-3 border border-cornell-red text-cornell-red text-sm font-semibold uppercase tracking-wide rounded hover:bg-cornell-red hover:text-white transition-all"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white py-10 px-5">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="text-cornell-red mb-4">
            <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-2">You're Subscribed!</h1>
          <p className="text-gray-500">Tell us what you like so we can personalize your picks.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-2">
          <WeightChips
            label="Cuisines you enjoy"
            options={CUISINES.map(c => c.toLowerCase())}
            value={cuisineWeights}
            onChange={setCuisineWeights}
          />
          <WeightChips
            label="Flavors you enjoy"
            options={FLAVORS}
            value={flavorWeights}
            onChange={setFlavorWeights}
          />
          <WeightChips
            label="Cooking styles you prefer"
            options={METHODS}
            value={methodWeights}
            onChange={setMethodWeights}
          />

          {/* Ingredients */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-cornell-red mb-1">Ingredients you love</h3>
            <p className="text-xs text-gray-400 mb-2">Pick any ingredients you enjoy — this gives us the strongest signal for your taste.</p>
            {INGREDIENT_GROUPS.map(g => (
              <div key={g.label}>
                <p className="text-xs text-gray-500 font-semibold mt-3 mb-1.5">{g.label}</p>
                <div className="flex flex-wrap gap-2">
                  {g.items.map(item => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => toggleIngredient(item)}
                      className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                        ingredients.includes(item)
                          ? 'bg-cornell-red text-white border-cornell-red'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-cornell-red'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Dietary */}
          <div className="mb-4">
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

          {/* Dish sliders */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-cornell-red mb-1">
              Rate these dishes (1 = dislike, 10 = love)
            </h3>
            <p className="text-xs text-gray-400 mb-3">Slide to rate each dish — this gives us the best signal for your taste.</p>
            <DishSliders
              dishes={dishes}
              ratings={dishRatings}
              onChange={(dishId, score) => setDishRatings(prev => ({ ...prev, [dishId]: score }))}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-cornell-red text-white text-sm font-semibold uppercase tracking-wide rounded hover:bg-red-800 transition-all disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
        </form>

        <div className="text-center mt-4">
          <a href="/" className="text-xs italic text-gray-400 hover:underline">Skip for now</a>
        </div>
      </div>
    </div>
  )
}
