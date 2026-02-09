
# Cloudflare One‑Click (Queues, auto‑provisioned)

This repo deploys **one Worker** that both **produces** logs (HTTP `fetch`) and **consumes** them (Queues `queue`). 

## Notes
- Batches flush by **count (200)**, **bytes (~200KB)**, or **time (10s)**.
- Failures retry with exponential backoff + jitter and CF redelivery.
