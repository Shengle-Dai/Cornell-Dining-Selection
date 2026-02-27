/**
 * 1–10 rating sliders for onboarding dishes.
 *
 * dishes   – { id: number, source_name: string, cuisine_type: string }[]
 * ratings  – Record<number, number>  (dish_id → score 1-10)
 * onChange – (dishId: number, score: number) => void
 */
export default function DishSliders({ dishes, ratings = {}, onChange }) {
  if (!dishes || dishes.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No dishes available yet — your first email will use your cuisine &amp; flavor picks instead.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {dishes.map(d => {
        const score = ratings[d.id] ?? 5
        return (
          <div key={d.id} className="p-3 border border-gray-200 rounded-lg bg-gray-50">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-sm font-semibold text-gray-800">
                {d.source_name || 'Unknown dish'}
              </span>
              <span>
                <span className="text-sm font-bold text-cornell-red">{score}</span>
                <span className="text-xs text-gray-400"> /10</span>
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={score}
              onChange={e => onChange(d.id, parseInt(e.target.value, 10))}
              className="w-full accent-cornell-red"
            />
          </div>
        )
      })}
    </div>
  )
}
