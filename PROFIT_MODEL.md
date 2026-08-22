# Profit model

All monetary values are stored as integer micro-USD. Floating-point money is not used in request accounting.

For a request with prompt tokens $T_i$ and maximum completion tokens $T_o$:

$$
C = \left\lceil\frac{T_i P_{ui}}{10^6}\right\rceil + \left\lceil\frac{T_o P_{uo}}{10^6}\right\rceil
$$

$$
R = \left\lceil\frac{T_i P_{si}}{10^6}\right\rceil + \left\lceil\frac{T_o P_{so}}{10^6}\right\rceil
$$

where $P_u$ is upstream price and $P_s$ is network sale price, both in micro-USD per million tokens. XGuard then computes the configured network fee $F$ and per-request variable infrastructure cost $I$:

$$
C_{total}=C+\left\lceil R\frac{F}{100}\right\rceil+I
$$

`XGUARD_NETWORK_FEE_PERCENT` and `XGUARD_VARIABLE_INFRA_MICRO_USD_PER_REQUEST` must both be present. An unknown network or infrastructure cost blocks the route; it is never assumed to be zero.

The pre-execution guard requires:

$$
R-C_{total} \geq \text{MIN\_MARGIN\_USD}
$$

and

$$
\frac{R-C_{total}}{R}\times100 \geq \text{MIN\_MARGIN\_PERCENT}
$$

It also blocks new upstream work when settled revenue minus recorded cost reaches `-MAX_DAILY_LOSS_USD`.

## Accounting truth

- `QUOTED`: conservative request estimate; not earned.
- `PENDING`: successful inference measured, but network settlement is not evidenced.
- `SETTLED`: an independently identified network settlement exists.
- `WITHDRAWABLE`: the network confirms funds can be withdrawn.
- `WITHDRAWN`: the network confirms withdrawal execution.
- `RECEIVED_BY_OWNER`: owner receipt is evidenced.

Daily net profit is:

$$
\text{settled revenue} - \text{recorded real cost}
$$

Pending, quoted, or merely withdrawable revenue does not count as settled revenue. Upstream, network, and variable-infrastructure costs are separate D1 rows. Provider-reported usage creates a `USAGE_REPORTED` upstream cost; the network and infrastructure rows use their explicitly configured contractual rates. If upstream usage is absent, the conservative maximum estimate is recorded as `ESTIMATED`, never silently treated as exact.

## Optimization

Health checks run hourly. Every six hours the optimizer ranks routes by configured token cost, fresh health, 24-hour success rate, and latency. It can promote a primary route, preserve healthy failover routes, or pause an unsafe route. It cannot change DGrid's external listing price because DGrid has not published a provider price-management API.

The `$350/day` value is a target only. Target status is `ACHIEVED` only when the day's settled revenue minus real recorded cost is at least `$350`.
