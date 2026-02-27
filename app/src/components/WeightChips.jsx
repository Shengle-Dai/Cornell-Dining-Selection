/**
 * Toggleable chip group for cuisine / flavor / cooking-method preferences.
 *
 * value    – Record<string, number>  (key present with 1.0 = selected)
 * onChange – (next: Record<string, number>) => void
 */
export default function WeightChips({ label, options, value = {}, onChange }) {
  function toggle(opt) {
    const next = { ...value }
    if (next[opt]) {
      delete next[opt]
    } else {
      next[opt] = 1.0
    }
    onChange(next)
  }

  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-cornell-red mb-2">{label}</h3>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
              value[opt]
                ? 'bg-cornell-red text-white border-cornell-red'
                : 'bg-white text-gray-600 border-gray-300 hover:border-cornell-red'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}
