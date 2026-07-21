#!/bin/sh
# Exit immediately if a command exits with a non-zero status
set -e

echo "Deploying database migrations..."
npx prisma migrate deploy

echo "Fetching the latest frontend release from: $WEB_FRONTEND_BUILD"

rm -rf dist/public
mkdir dist/public
curl -sL "$WEB_FRONTEND_BUILD" -o web-release.zip
unzip -q web-release.zip -d dist/public
rm web-release.zip

echo "Starting the application..."

exec "$@"