# Permissionless keeper

This optional process records target-pool observations and attempts `executeStrategy()` only after an `eth_call`
simulation succeeds. It has no special contract role: any address can perform the same calls, and keeper downtime does
not transfer funds or alter configuration.

1. Copy `.env.example` to `.env` and set `RPC_URL` plus the deployed `HOOK_ADDRESS`.
2. Run `npm install`.
3. Leave `EXECUTE=false` for dry-run monitoring.
4. For execution, use a low-value key holding gas only, set `KEEPER_PRIVATE_KEY`, then set `EXECUTE=true`.

The process refuses a wrong chain or an address without bytecode, never logs the private key, simulates before sending,
waits for two confirmations, and is idempotent because a successful execution consumes the current strategy liability.
Do not reuse the token creator or treasury key.
