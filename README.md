# Neon Riders

A multiplayer Tron-style light bike game built with TypeScript, HTML5 Canvas, and WebSockets.

## Features

- **Neon Aesthetic**: Dark background with glowing grid lines and neon-colored bikes/trails
- **Multiplayer**: Real-time WebSocket-based multiplayer with room creation and joining
- **Lobby System**: Create/join rooms by code, see connected players, host starts with countdown
- **Shared Logic**: Movement and collision logic lives in `src/shared/` for server-authoritative gameplay
- **Responsive**: Works on desktop and mobile screens

## Tech Stack

- **Client**: TypeScript, HTML5 Canvas, Vite (bundler)
- **Server**: Node.js, WebSocket (`ws` library)
- **Shared**: Common types, bike physics, collision detection
- **Tooling**: ESLint, Prettier, TypeScript

## Project Structure

```
src/
  client/          # Browser client code
    ui/            # Lobby UI components and styles
    canvas.ts      # Canvas setup and resize handling
    renderer.ts    # Grid, bike, and trail rendering
    gameLoop.ts    # requestAnimationFrame loop with delta-time
    input.ts       # Keyboard input handling (Arrow keys + WASD)
    network.ts     # WebSocket client
    main.ts        # Client entry point
  server/          # Node.js server
    index.ts       # HTTP + WebSocket server
    gameRoom.ts    # Game room management and tick loop
    wsHandler.ts   # WebSocket connection routing
  shared/          # Shared between client and server
    types.ts       # Core types (BikeState, ArenaConfig, etc.)
    protocol.ts    # WebSocket message types
    bike.ts        # Bike creation, movement, turning
    collision.ts   # Wall and trail collision detection
public/            # Static assets
```

## Setup

```bash
# Install dependencies
npm install

# Start development (client + server concurrently)
npm run dev

# Or run them separately:
npm run dev:client   # Vite dev server on port 3000
npm run dev:server   # Game server on port 8080
```

## Scripts

| Script          | Description                              |
|-----------------|------------------------------------------|
| `npm run dev`   | Start client and server in dev mode      |
| `npm run build` | TypeScript check + Vite production build |
| `npm run lint`  | Run ESLint                               |
| `npm run start` | Start production server                  |

## How to Play

1. Open the game in your browser
2. Enter a rider name and choose a neon color
3. Create a room or join an existing one with a room code
4. Once all players are in, the host starts the game
5. Use **Arrow Keys** or **WASD** to turn your light bike
6. Avoid walls, your own trail, and other players' trails
7. Last rider standing wins!

## Docker

```bash
docker build -t neon-riders .
docker run -p 8080:8080 neon-riders
```

Then open http://localhost:8080 in your browser.
