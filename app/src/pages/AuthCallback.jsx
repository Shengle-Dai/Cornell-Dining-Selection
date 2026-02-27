import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState(null)

  useEffect(() => {
    async function handleCallback() {
      const hash = window.location.hash.substring(1)
      const params = new URLSearchParams(hash)
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      const errDesc = params.get('error_description') || params.get('error')

      if (errDesc) {
        setError(errDesc)
        return
      }

      if (!accessToken) {
        setError('No access token received.')
        return
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || '',
      })

      if (sessionError) {
        setError(sessionError.message)
        return
      }

      // Check if user already has preferences
      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('user_id')
        .limit(1)

      if (prefs && prefs.length > 0) {
        navigate('/dashboard')
      } else {
        navigate('/onboarding')
      }
    }

    handleCallback()
  }, [navigate])

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-5">
        <div className="max-w-sm w-full text-center">
          <div className="text-cornell-red mb-6">
            <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">Sign-in Failed</h1>
          <p className="text-gray-500">{error}</p>
          <a href="/" className="mt-6 inline-block text-sm text-cornell-red hover:underline">
            Try again
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5">
      <div className="max-w-sm w-full text-center">
        <div className="text-cornell-red mb-6">
          <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="font-serif text-2xl font-semibold text-cornell-red mb-4">Signing in…</h1>
        <p className="text-gray-500">Please wait while we complete your sign-in.</p>
      </div>
    </div>
  )
}
