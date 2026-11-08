// Optional Supabase sync. When VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set, the demo
// state is mirrored to one row of `demo_state`, so a phone that scans a table QR code sees the
// same restaurant as the laptop. Without these variables the app runs fully in local demo mode.
//
// Only the public anon key is used here. Service-role keys live in Edge Functions only.

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key, { realtime: { params: { eventsPerSecond: 5 } } }) : null
export const syncEnabled = !!supabase

export async function pullRemote() {
  if (!supabase) return null
  const { data, error } = await supabase.from('demo_state').select('state').eq('id', 'main').maybeSingle()
  if (error) throw error
  return data?.state || null
}

export async function pushRemote(state) {
  if (!supabase) return
  const { error } = await supabase.from('demo_state').upsert({ id: 'main', state, updated_at: new Date().toISOString() })
  if (error) throw error
}

export function subscribeRemote(onState) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('demo_state_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'demo_state' }, (payload) => {
      if (payload.new?.state) onState(payload.new.state)
    })
    .subscribe()
  return () => supabase.removeChannel(channel)
}
