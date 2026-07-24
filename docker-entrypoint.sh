#!/bin/sh
set -eu

require_env() {
  variable_name="$1"
  if ! printenv "$variable_name" >/dev/null 2>&1 ||
    [ -z "$(printenv "$variable_name")" ]; then
    echo "Required environment variable $variable_name is not configured." >&2
    exit 1
  fi
}

for variable_name in \
  DATABASE_URL \
  AUTH_SECRET \
  ADMIN_EMAIL \
  ADMIN_PASSWORD \
  RASA_BASE_URL \
  RASA_API_TOKEN \
  LITELLM_BASE_URL \
  LITELLM_API_KEY \
  LITELLM_MODEL \
  NEXT_PUBLIC_APP_URL \
  INTERNAL_MODEL_SERVER_URL \
  MODEL_DOWNLOAD_TOKEN
do
  require_env "$variable_name"
done

if [ "${#AUTH_SECRET}" -lt 32 ]; then
  echo "AUTH_SECRET must contain at least 32 characters." >&2
  exit 1
fi

if [ "${#ADMIN_PASSWORD}" -lt 12 ]; then
  echo "ADMIN_PASSWORD must contain at least 12 characters." >&2
  exit 1
fi

if [ "${#MODEL_DOWNLOAD_TOKEN}" -lt 32 ]; then
  echo "MODEL_DOWNLOAD_TOKEN must contain at least 32 characters." >&2
  exit 1
fi

case "${RASA_TRAINING_TIMEOUT_MS:-1800000}" in
  *[!0-9]* | "")
    echo "RASA_TRAINING_TIMEOUT_MS must be a positive integer." >&2
    exit 1
    ;;
esac

if [ "${RASA_TRAINING_TIMEOUT_MS:-1800000}" -le 0 ]; then
  echo "RASA_TRAINING_TIMEOUT_MS must be a positive integer." >&2
  exit 1
fi

case "${TRAINING_WORKER_ENABLED:-true}" in
  true | false) ;;
  *)
    echo "TRAINING_WORKER_ENABLED must be true or false." >&2
    exit 1
    ;;
esac

node ./node_modules/prisma/build/index.js migrate deploy
node scripts/seed-admin.mjs
exec node server.js
