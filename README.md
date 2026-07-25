# MyWatchCalendar Server

NestJS Backend for MyWatchCalendar App available [here](https://github.com/seanwlk/mywatchcalendar-app). The backend already exposes on the root directory the latest web compiled release so you technically do not need the app but it's still available.

## Instructions

To run this project, you must configure your environment variables. Create a `.env` file in the root directory of the project, you can use the `.env.example` as a template.

Here are the required environment variables and their reference values:

| Variable | Reference Value / Description |
| :--- | :--- |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/mywatchcalendar?schema=public` |
| `PORT` | `3000` (The internal port the Node app binds to. Must not be changed if using a docker environment, this is only for standalone/ dev use) |
| `JWT_ACCESS_SECRET` | Secret key for access tokens |
| `JWT_REFRESH_SECRET` | Secret key for refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `ALLOW_USER_REGISTRATION` | `true / false` (This variable blocks the registration for new users) |
| `TMDB_API_KEY` | Your TMDB API key (`API_KEY`) |
| `REDIS_HOST` | `redis-bull` (Must match the Docker service name if using Compose) |
| `REDIS_PORT` | `6379` |
| `BULLBOARD_USER` | Username for the BullMQ dashboard (e.g., `admin`) |
| `BULLBOARD_PASSWORD` | Password for the BullMQ dashboard |
| `WEB_FRONTEND_BUILD` | URL to the frontend build zip (e.g., `https://github.com/seanwlk/mywatchcalendar-app/releases/latest/download/web-release.zip`) |

### Admin account
By default the first user that registers on the application becomes administrator and can access the admin dashboard from the app settings.

### Sync jobs
Currently there are two jobs that sync the data for the series. One runs every month and does a full metadata sync of all series. The other one runs daily and only takes the followed series that have episodes scheduled to air, this way the data for running series is fresh.
(This setup might change in the future if i see that it cannot be trusted to have decent data)

## 🐳 Docker Deployment (Recommended)

The easiest way to deploy this application is using Docker. The provided Docker setup utilizes Node alpine and runs as a multi-container stack.

### The Stack
1. **`server`**: This is the actual backend of the app. It maps by default to port `8100`, you are free to change it as you like for one that fits better your reverse proxy environment.
2. **`postgres`**: PostgreSQL database configured with a named volume (`postgres-data:/var/lib/postgresql`), you can map it to different folder if needed.
3. **`redis-bull`**: Redis database for the BullMQ Queues that mounts a volume (`redis-data:/data`) to persist the data.

### Startup Behavior
When the server container starts, an entrypoint script automatically executes the following tasks before starting the Node application:
* Deploys database migrations using `npx prisma migrate deploy`.
* Downloads the latest frontend release zip from the URL provided in the `WEB_FRONTEND_BUILD` environment variable.
* Unzips the frontend build into the `dist/public` directory to be served statically.

### Running the App
To start the entire stack, ensure your `.env` file is created or add the variables manually to the docker-compose if you dont want another file around, then run:

```bash
docker compose up -d
```

## Local Deployement

If you want to run it without docker it's just a classic node app. Just `npm install` and then you have these scripts that 

* **Build the NestJS app**: `npm run build`
* **Start in development mode**: `npm run start:dev`
* **Start in production mode**: `npm run start:prod`

Then use something like PM2 to keep the service up.
