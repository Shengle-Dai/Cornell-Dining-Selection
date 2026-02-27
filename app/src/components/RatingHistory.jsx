/**
 * Table of a user's dish ratings with a delete button per row.
 *
 * ratings  – { id: number, dishes: { source_name: string }, menu_date: string, rating: 1|-1 }[]
 * onDelete – (ratingId: number) => void
 */
export default function RatingHistory({ ratings, onDelete }) {
  if (!ratings || ratings.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No ratings yet. Rate dishes from your daily emails!
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 pr-4 text-gray-500 font-medium">Dish</th>
            <th className="text-left py-2 pr-4 text-gray-500 font-medium">Date</th>
            <th className="text-left py-2 pr-4 text-gray-500 font-medium">Rating</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {ratings.map(r => (
            <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 pr-4 text-gray-800">{r.dishes?.source_name || '—'}</td>
              <td className="py-2 pr-4 text-gray-500">{r.menu_date}</td>
              <td className="py-2 pr-4 text-lg">{r.rating === 1 ? '👍' : '👎'}</td>
              <td className="py-2">
                <button
                  onClick={() => onDelete(r.id)}
                  className="text-xs text-gray-400 hover:text-red-600 transition-colors"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
