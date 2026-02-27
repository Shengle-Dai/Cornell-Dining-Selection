import { createClient } from '@supabase/supabase-js'

// These are public values (anon key is safe to expose in browser bundles).
// The same values are in wrangler.toml for Pages Functions.
export const supabase = createClient(
  'https://huunbjkfqcnqqgferttj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1dW5iamtmcWNucXFnZmVydHRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwODI5MTYsImV4cCI6MjA4NzY1ODkxNn0.OCHDLKdgZZPY-N-OjOIuwxEai6xpIdB9R0pBy53VrzI',
)
