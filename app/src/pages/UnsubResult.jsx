import { useSearchParams } from 'react-router-dom'

export default function UnsubResult() {
  const [params] = useSearchParams()
  const status = params.get('status')  // 'success' | 'error'
  const msg    = params.get('msg')

  const isSuccess = status === 'success'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5 bg-white">
      <div className="max-w-sm w-full text-center">
        <div className="text-cornell-red mb-6">
          {isSuccess ? (
            <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>

        {isSuccess ? (
          <>
            <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">Unsubscribed</h1>
            <p className="text-gray-500">
              You've been removed from the daily dining picks. You can re-subscribe anytime by signing in again!
            </p>
          </>
        ) : (
          <>
            <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">
              {msg || 'Something went wrong'}
            </h1>
            <p className="text-gray-500">This unsubscribe link may be invalid or expired.</p>
          </>
        )}

        <div className="mt-8 font-serif text-xs italic text-gray-400">No spam, just food.</div>
      </div>
    </div>
  )
}
