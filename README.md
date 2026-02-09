
# Cloudflare One‑Click (Queues, auto‑provisioned)

This repo deploys **one Worker** that both **produces** logs (HTTP `fetch`) and **consumes** them (Queues `queue`). 

## Notes
- Batches flush by **count (100)**, **bytes (~256KB)**, or **time (60s)** done by Cloudflare runtime
