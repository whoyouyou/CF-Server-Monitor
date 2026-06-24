import { getApiBase } from './config'

const DEFAULT_ERROR_MESSAGES = {
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error'
}

const createHeaders = (includeAuth = true, includeTurnstile = true) => {
  const headers = {
    'Content-Type': 'application/json'
  }
  
  if (includeAuth) {
    const token = localStorage.getItem('jwt_token')
    if (token) {
      headers['Authorization'] = 'Bearer ' + token
    }
  }
  
  if (includeTurnstile) {
    const turnstileToken = localStorage.getItem('turnstile_token')
    if (turnstileToken) {
      headers['X-Turnstile-Token'] = turnstileToken
    }
    const turnstileVerified = localStorage.getItem('turnstile_verified')
    if (turnstileVerified) {
      headers['X-Turnstile-Verified'] = turnstileVerified
    }
  }
  
  return headers
}

const handleResponse = async (res, options = {}) => {
  const { autoRedirect = true } = options
  
  if (res.status === 401) {
    localStorage.removeItem('jwt_token')
    if (autoRedirect) {
      window.location.href = '/admin'
    }
    return { error: DEFAULT_ERROR_MESSAGES[401], status: 401 }
  }
  
  if (res.status === 403) {
    localStorage.removeItem('turnstile_token')
    localStorage.removeItem('turnstile_verified')
    if (autoRedirect) {
      window.location.reload()
    }
    return { error: DEFAULT_ERROR_MESSAGES[403], status: 403 }
  }
  
  if (!res.ok) {
    let errorMessage = DEFAULT_ERROR_MESSAGES[res.status] || 'Request failed'
    let errorCode = res.status
    let errorMessageKey = null
    try {
      const data = await res.json()
      if (data.message) {
        errorMessageKey = data.message
      }
      if (data.error) {
        errorMessage = data.error
      }
      if (data.code) {
        errorCode = data.code
        if (!data.error && typeof data.code === 'string') {
          errorMessage = data.code
        }
      }
    } catch (e) {
      // ignore
    }
    return { error: errorMessage, code: errorCode, status: res.status, message: errorMessageKey }
  }
  
  try {
    const data = await res.json()
    // Store turnstile_verified from body if present
    if (data && data.turnstile_verified) {
      localStorage.setItem('turnstile_verified', data.turnstile_verified)
      // Clear one-time turnstile token after successful verification
      localStorage.removeItem('turnstile_token')
    }
    return { data, status: res.status }
  } catch (e) {
    return { data: null, status: res.status }
  }
}

export const http = {
  async get(url, options = {}) {
    const { includeAuth = true, includeTurnstile = true, autoRedirect = true } = options
    const headers = createHeaders(includeAuth, includeTurnstile)

    const res = await fetch(`${getApiBase()}${url}`, {
      method: 'GET',
      headers,
      credentials: 'include'
    })

    return handleResponse(res, { autoRedirect })
  },

  async post(url, body = {}, options = {}) {
    const { includeAuth = true, includeTurnstile = true, autoRedirect = true } = options
    const headers = createHeaders(includeAuth, includeTurnstile)

    const res = await fetch(`${getApiBase()}${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include'
    })

    return handleResponse(res, { autoRedirect })
  },

  async put(url, body = {}, options = {}) {
    const { includeAuth = true, includeTurnstile = true, autoRedirect = true } = options
    const headers = createHeaders(includeAuth, includeTurnstile)

    const res = await fetch(`${getApiBase()}${url}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
      credentials: 'include'
    })

    return handleResponse(res, { autoRedirect })
  },

  async delete(url, options = {}) {
    const { includeAuth = true, includeTurnstile = true, autoRedirect = true } = options
    const headers = createHeaders(includeAuth, includeTurnstile)

    const res = await fetch(`${getApiBase()}${url}`, {
      method: 'DELETE',
      headers,
      credentials: 'include'
    })

    return handleResponse(res, { autoRedirect })
  }
}

export const isAdminLoggedIn = () => {
  return !!localStorage.getItem('jwt_token')
}

export default http