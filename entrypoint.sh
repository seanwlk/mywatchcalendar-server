#!/bin/sh
# Exit immediately if a command exits with a non-zero status
set -e

echo "Deploying database migrations..."
npx prisma migrate deploy

echo "Fetching the latest frontend release..."

rm -rf public
mkdir public
curl -sL "https://github.com/seanwlk/mywatchcalendar-app/releases/latest/download/web-release.zip" -o web-release.zip
unzip -q web-release.zip -d public
rm web-release.zip

echo "Starting the application..."

exec "$@"