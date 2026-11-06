import { supabase } from './supabase'

/**
 * Edge Functions return { success: false, error: 'CODE' } with a non-2xx status.
 * supabase-js wraps that in a FunctionsHttpError whose `context` is the fetch
 * Response, so read the JSON body to recover our stable error code.
 */
async function readErrorCode(error) {
  const response = error?.context

  if (response && typeof response.json === 'function') {
    try {
      const body = await response.json()
      if (body?.error) return String(body.error)
    } catch {
      // Body was empty or not JSON: fall through to the generic message.
    }
  }

  return error?.message || 'SERVER_ERROR'
}

async function invokeAuthFunction(name, payload) {
  const { data, error } = await supabase.functions.invoke(name, { body: payload })

  if (error) {
    throw new Error(await readErrorCode(error))
  }

  if (!data?.success) {
    throw new Error(data?.error || 'SERVER_ERROR')
  }

  return data
}

export function registerPhone({ phone, password, fullName }) {
  return invokeAuthFunction('registerPhone', { phone, password, fullName })
}

export function loginPhone({ phone, password }) {
  return invokeAuthFunction('loginPhone', { phone, password })
}

/** Applies the tokens returned by registerPhone/loginPhone. */
export async function establishSession(data) {
  if (!data?.access_token || !data?.refresh_token) return false

  const { error } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })

  if (error) throw error
  return true
}
