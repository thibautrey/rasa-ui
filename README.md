# Pleiades Rasa UI

An MIT-licensed, self-hosted control plane for Rasa Open Source. It is an
independent application and does not require a Rasa Studio or Rasa Pro license.

## Features

- YAML and visual NLU authoring with immutable revisions and restore
- durable training queue, model archive history, promotion and rollback
- authenticated test console with intent and confidence inspection
- conversation transcripts, quality review and 30-day analytics
- admin, editor and viewer roles with HTTP-only sessions
- configurable storefront widget with origin allowlists and rate limiting
- sanitized runtime status without exposing the Rasa API token

Rasa still owns model execution and training. This application stores editable
project sources in PostgreSQL because the Rasa HTTP API does not expose CRUD
operations for project YAML files.

`endpoints.yml` and `credentials.yml` are retained as export references. Rasa
does not apply them through `/model/train`; deploying those files requires
control of the Rasa runtime and a restart.

## Local development

1. Copy `.env.example` to `.env` and replace every placeholder.
2. Start Rasa Open Source with its REST channel and HTTP API enabled.
3. Run `docker compose up --build`.
4. Open `http://localhost:3000` and sign in with `ADMIN_EMAIL` and
   `ADMIN_PASSWORD`.

For development outside Docker, start PostgreSQL separately, point
`DATABASE_URL` at it, then run:

```sh
npm install
npm run prisma:migrate
npm run dev
```

## Security

`RASA_API_TOKEN`, `AUTH_SECRET`, database credentials and model-download tokens
remain server-side. The public widget calls the application gateway, never Rasa
directly. Every widget requires an explicit HTTP(S) origin allowlist.

Use different random values of at least 32 characters for `AUTH_SECRET` and
`MODEL_DOWNLOAD_TOKEN`. Rotate the bootstrap administrator password after the
first login.

For long training requests behind Cloudflare, keep the public Rasa hostname in
`RASA_BASE_URL` and map it directly to the Traefik origin with
`RASA_ORIGIN_HOST` and `RASA_ORIGIN_IP`. Docker then preserves the correct Host
header without sending training traffic through Cloudflare.

## Deployment

The production Dockerfile runs Prisma migrations and creates the bootstrap
administrator before starting the standalone Next.js server. The included
Docker Compose stack is suitable for Coolify; all required values are listed in
`.env.example`.
