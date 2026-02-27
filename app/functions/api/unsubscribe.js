import { hmacVerify } from '../_shared/hmac.js'
import { createServiceClient } from '../_shared/supabase.js'

export async function onRequestGet({ request, env }) {
  const url   = new URL(request.url)
  const email = (url.searchParams.get('email') || '').trim().toLowerCase()
  const token = url.searchParams.get('token')  || ''

  if (!email || !token) {
    return Response.redirect('/unsubscribe?status=error&msg=Invalid+link', 302)
  }

  const valid = await hmacVerify(env.HMAC_SECRET, email, token)
  if (!valid) {
    return Response.redirect('/unsubscribe?status=error&msg=Invalid+or+tampered+token', 302)
  }

  const service = createServiceClient(env)
  const { error } = await service
    .from('profiles')
    .update({ subscribed: false, updated_at: new Date().toISOString() })
    .eq('email', email)

  if (error) {
    console.error('Unsubscribe error:', error)
    return Response.redirect('/unsubscribe?status=error&msg=Server+error', 302)
  }

  return Response.redirect('/unsubscribe?status=success', 302)
}
