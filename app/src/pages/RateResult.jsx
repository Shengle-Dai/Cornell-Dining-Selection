import { useSearchParams } from 'react-router-dom'

export default function RateResult() {
  const [params] = useSearchParams()
  const status = params.get('status')   // 'liked' | 'disliked' | 'error'
  const dish   = params.get('dish') || 'this dish'
  const msg    = params.get('msg')

  const isError   = status === 'error'
  const isLiked   = status === 'liked'
  const isDisliked = status === 'disliked'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5 bg-white">
      <div className="max-w-sm w-full text-center">
        <div className="text-cornell-red mb-6">
          {isError ? (
            <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {isError && (
          <>
            <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">
              {msg || 'Something went wrong'}
            </h1>
            <p className="text-gray-500">This rating link may be invalid or expired.</p>
          </>
        )}
        {isLiked && (
          <>
            <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">Liked!</h1>
            <p className="text-gray-500">
              Glad you liked <strong>{dish}</strong>! We'll recommend more like it.
            </p>
          </>
        )}
        {isDisliked && (
          <>
            <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">Noted!</h1>
            <p className="text-gray-500">
              Got it — we'll show less of <strong>{dish}</strong> in the future.
            </p>
          </>
        )}
        {!status && (
          <>
            <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">Invalid Link</h1>
            <p className="text-gray-500">This rating link is invalid.</p>
          </>
        )}

        <div className="mt-8 font-serif text-xs italic text-gray-400">No spam, just food.</div>
      </div>
    </div>
  )
}
