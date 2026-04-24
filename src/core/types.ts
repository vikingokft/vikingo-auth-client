export interface AuthedUser {
  sub: string
  email: string
  name: string
  picture?: string
  hd: string
}

export interface TokenResponse {
  token_type: 'Bearer'
  access_token: string
  expires_in: number
  user: AuthedUser
}

export interface SyncResponse {
  status: 'active' | 'suspended' | 'deleted'
}

export interface Session {
  sub: string
  email: string
  name: string
  picture?: string
  hd: string
  exp: number
  iat: number
  lastSyncedAt?: number
}
