// Loyalty ("Menues Rewards"): points and tiers tied to the customer's phone number.
// Points are earned on paid orders, a tier multiplies them, and points can be spent on a reward at checkout.
// Everything is configurable in Admin → Loyalty.

export const DEFAULT_LOYALTY = {
  enabled: true,
  earnPerRupee: 0.1, // 1 point for every ₹10 spent
  welcomeBonus: 50, // given once, when a phone number is first registered
  tiers: [
    { name: 'Silver', minPoints: 0, multiplier: 1 },
    { name: 'Gold', minPoints: 500, multiplier: 1.25 },
    { name: 'Platinum', minPoints: 1500, multiplier: 1.5 },
  ],
  rewards: [
    { id: 'R1', name: '₹50 off your bill', points: 100, value: 50 },
    { id: 'R2', name: '₹150 off your bill', points: 250, value: 150 },
    { id: 'R3', name: '₹400 off your bill', points: 600, value: 400 },
  ],
}

// Customers created before loyalty existed (or by tests) get empty balances.
export function account(c) {
  if (c.points == null) c.points = 0
  if (c.lifetimePoints == null) c.lifetimePoints = 0
  if (c.visits == null) c.visits = 0
  if (c.totalSpend == null) c.totalSpend = 0
  return c
}

export function sortedTiers(settings) {
  return [...(settings.loyalty?.tiers || DEFAULT_LOYALTY.tiers)].sort((a, b) => a.minPoints - b.minPoints)
}

export function tierOf(settings, customer) {
  const tiers = sortedTiers(settings)
  let tier = tiers[0]
  for (const t of tiers) if ((customer.lifetimePoints || 0) >= t.minPoints) tier = t
  return tier
}

export function nextTierOf(settings, customer) {
  return sortedTiers(settings).find((t) => t.minPoints > (customer.lifetimePoints || 0)) || null
}

export function pointsForSpend(settings, customer, amount) {
  const l = settings.loyalty
  if (!l?.enabled) return 0
  return Math.floor(amount * l.earnPerRupee * tierOf(settings, customer).multiplier)
}

export function addPoints(state, customer, points, kind, now, extra = {}) {
  account(customer)
  customer.points += points
  if (points > 0) customer.lifetimePoints += points // tiers follow everything ever earned, spending points never demotes
  state.loyaltyLog.unshift({ id: 'LP' + String(++state.counters.loyalty).padStart(5, '0'), at: now, customerId: customer.id, points, kind, balance: customer.points, ...extra })
  if (state.loyaltyLog.length > 500) state.loyaltyLog.length = 500
}

// Everything a customer is allowed to see about their own account.
export function publicAccount(state, customer) {
  account(customer)
  const tier = tierOf(state.settings, customer)
  const next = nextTierOf(state.settings, customer)
  const l = state.settings.loyalty || DEFAULT_LOYALTY
  return {
    enabled: !!l.enabled,
    name: customer.name || '',
    points: customer.points,
    tier: tier.name,
    multiplier: tier.multiplier,
    visits: customer.visits,
    nextTier: next ? { name: next.name, pointsToGo: next.minPoints - customer.lifetimePoints } : null,
    rewards: l.rewards.map((r) => ({ ...r, affordable: customer.points >= r.points })),
    recent: state.loyaltyLog.filter((e) => e.customerId === customer.id).slice(0, 6).map(({ at, points, kind, note }) => ({ at, points, kind, note })),
  }
}
