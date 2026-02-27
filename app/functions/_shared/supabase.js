import { createClient } from '@supabase/supabase-js'

export function createAnonClient(env, authHeader = null) {
  const opts = { auth: { autoRefreshToken: false, persistSession: false } }
  if (authHeader) {
    opts.global = { headers: { Authorization: authHeader } }
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts)
}

export function createServiceClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Extracts and verifies the Bearer JWT from the request.
 * Returns { user, error, status } where user is non-null on success.
 */
export async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Missing auth token', status: 401 }
  }
  const supabase = createAnonClient(env, authHeader)
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return { user: null, error: 'Invalid or expired token', status: 401 }
  }
  return { user, error: null, status: 200 }
}

/**
 * Verifies the JWT is valid AND the user's email matches ADMIN_EMAIL.
 */
export async function requireAdmin(request, env) {
  const { user, error, status } = await requireAuth(request, env)
  if (!user) return { user: null, error, status }
  if (user.email !== env.ADMIN_EMAIL) {
    return { user: null, error: 'Forbidden', status: 403 }
  }
  return { user, error: null, status: 200 }
}
