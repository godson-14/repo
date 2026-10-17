# MockServer-Quick

Generate a local mock REST API from a JSON file. It uses Node.js built-ins, so no third-party runtime dependencies are required.

## Requirements

- Node.js 20 or newer

## Run it

From this directory:

```bash
node src/cli.mjs --file=examples/schema.json --port=4000
```

The server listens on `127.0.0.1` only, making it local to your device. Open `http://127.0.0.1:4000/health` to check it.

## JSON format

The top level must be an object. Each property becomes a collection endpoint, and each value must be an array:

```json
{
  "users": [
    { "id": "u1", "name": "Ada", "email": "ada@example.test" }
  ]
}
```

Empty or null fields are filled with simple sample values when the server starts. This is a lightweight seed generator, not a full Faker replacement.

## Endpoints

For the example data, these endpoints are available:

| Method | Endpoint | Action |
|---|---|---|
| GET | `/users` | List users; supports `?limit=10&offset=0` |
| GET | `/users/u1` | Get one user |
| POST | `/users` | Create a user from a JSON body |
| PUT | `/users/u1` | Replace a user (ID is preserved) |
| PATCH | `/users/u1` | Update selected fields |
| DELETE | `/users/u1` | Delete a user |
| GET | `/health` | Health check |

The example also provides `/tasks` and `/tasks/:id` routes.

## Example request

```bash
curl http://127.0.0.1:4000/users
curl -X POST http://127.0.0.1:4000/users \
  -H "content-type: application/json" \
  -d '{"name":"Linus","email":"linus@example.test"}'
```

## Important notes

- Data changes live in memory and reset when the process restarts.
- This is for local development and frontend testing, not production data or public deployment.
- The server binds to localhost by default.
