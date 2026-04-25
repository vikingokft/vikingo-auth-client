export interface AuthedUser {
  sub: string
  email: string
  name: string
  picture?: string
  hd: string
  guest?: boolean
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
  /**
   * True if the session belongs to a guest (external user invited via the auth server's
   * `/invite/redeem` flow), not a Workspace user. Guest sessions:
   *  - have `sub` of form `guest:<email>` (no Google sub)
   *  - have empty `hd`
   *  - are NOT synced against the Workspace Admin SDK
   *  - cannot be revoked once issued; only the underlying invite can be revoked before redemption
   * Apps may apply different authorization rules to guests (e.g. read-only views).
   */
  guest?: boolean
  invitedBy?: string
}
