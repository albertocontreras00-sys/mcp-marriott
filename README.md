# @striderlabs/mcp-marriott

MCP server for Marriott Hotels — let AI agents search hotels, manage reservations, check in, and interact with the Marriott Bonvoy loyalty program via browser automation.

Built by [Strider Labs](https://striderlabs.ai).

## Overview

This MCP server enables AI agents (Claude, etc.) to:

- Search Marriott properties worldwide
- Browse room types and rates
- Complete hotel bookings
- Manage existing reservations (view, modify, cancel)
- Mobile check-in
- Track Marriott Bonvoy points and tier status
- Redeem Bonvoy points for award stays
- View past stay history

## Tools

| Tool | Description |
|------|-------------|
| `status` | Check login status and Bonvoy session info |
| `login` | Log in to Marriott Bonvoy (auto or manual) |
| `logout` | Clear saved session and cookies |
| `search_hotels` | Search hotels by destination, dates, guests |
| `get_hotel_details` | Get amenities, policies, check-in times |
| `get_room_options` | View available room types and rates |
| `select_room` | Choose a room before checkout |
| `add_extras` | Add parking, breakfast, late checkout, etc. |
| `checkout` | Complete booking (requires explicit confirmation) |
| `get_reservation` | Retrieve existing reservations |
| `modify_reservation` | Change dates or room type |
| `cancel_reservation` | Cancel a booking |
| `check_in` | Mobile check-in with room preferences |
| `get_bonvoy_status` | Points balance, tier, nights to upgrade |
| `redeem_points` | Book award stays with Bonvoy points |
| `get_stay_history` | View past stays and points earned |

## Setup

### 1. Install

```bash
npm install -g @striderlabs/mcp-marriott
```

Or run directly with npx:

```bash
npx @striderlabs/mcp-marriott
```

### 2. Install Playwright browsers

```bash
npx playwright install chromium
```

### 3. Configure credentials (optional)

Set environment variables for automatic login:

```bash
export MARRIOTT_EMAIL="your@email.com"
export MARRIOTT_PASSWORD="yourpassword"
```

Without these, the `login` tool returns a URL for manual browser login.

### 4. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "marriott": {
      "command": "npx",
      "args": ["@striderlabs/mcp-marriott"],
      "env": {
        "MARRIOTT_EMAIL": "your@email.com",
        "MARRIOTT_PASSWORD": "yourpassword"
      }
    }
  }
}
```

### 5. Configure Cursor / other MCP clients

```json
{
  "mcp": {
    "servers": {
      "marriott": {
        "command": "npx",
        "args": ["@striderlabs/mcp-marriott"],
        "env": {
          "MARRIOTT_EMAIL": "your@email.com",
          "MARRIOTT_PASSWORD": "yourpassword"
        }
      }
    }
  }
}
```

## Remote Vercel deployment

The production deployment uses Streamable HTTP:

- Production URL: `https://marriott-mcp.vercel.app`
- MCP endpoint: `https://marriott-mcp.vercel.app/api/mcp`
- Authentication: `Authorization: Bearer <MCP_AUTH_TOKEN>`
- Session storage: private Vercel Blob (`BLOB_READ_WRITE_TOKEN`)
- Browser: `playwright-core` with `@sparticuz/chromium`

Set these environment variables in Vercel. Do not commit their values:

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_AUTH_TOKEN` | Yes | Bearer token required by `/api/mcp` |
| `BLOB_READ_WRITE_TOKEN` | Yes | Automatically provided by the private Blob store |
| `MARRIOTT_EMAIL` | Recommended | Enables automatic Marriott login |
| `MARRIOTT_PASSWORD` | Recommended | Enables automatic Marriott login |
| `MARRIOTT_SESSION_STATE_PATH` | No | Defaults to `marriott/storage-state.json` |
| `MARRIOTT_SESSION_INFO_PATH` | No | Defaults to `marriott/session.json` |
| `PLAYWRIGHT_EXECUTABLE_PATH` | No | Local browser override; Vercel uses Sparticuz Chromium |

The server persists the complete Playwright storage state, not just cookies. If Marriott requires MFA, CAPTCHA, device verification, or another interactive step, `login` reports that requirement and `status` remains unauthenticated until a verifiable member session exists.

### Connect it to ChatGPT

In ChatGPT web, enable Developer Mode if your plan/workspace requires it, then create a custom MCP app from Settings → Apps (workspace admins may need to enable custom apps first). Use:

- Endpoint URL: `https://marriott-mcp.vercel.app/api/mcp`
- Authentication: bearer/API key header
- Header name: `Authorization`
- Header value: `Bearer <the value stored in MCP_AUTH_TOKEN>`

Scan the tools, create the draft app, then select it from the tools menu in a new chat. The server exposes all 16 tools listed below. Keep confirmation enabled for booking, modification, cancellation, and points redemption actions.

OpenAI's current custom-app flow is documented in [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).

## Usage Examples

### Search hotels

```
Search for Marriott hotels in Tokyo from July 10-15 for 2 adults
```

### Book a room

```
Find me a room at the W Hotel Times Square for next weekend, then book the cheapest option
```

### Check Bonvoy status

```
How many Bonvoy points do I have and what's my current tier?
```

### Redeem points

```
Use my Bonvoy points to book a standard room at the Marriott Marquis in NYC for March 20-22
```

### Manage a reservation

```
Show me my upcoming reservations and cancel the one in Chicago
```

## Session Management

Local stdio runs save cookies and storage state to `~/.striderlabs/marriott/`. The Vercel deployment saves them in the private Blob store so they persist across serverless invocations. To log out:

```
Use the logout tool
```

Or delete the directory:

```bash
rm -rf ~/.striderlabs/marriott/
```

## Safety & Confirmations

**Destructive actions require explicit confirmation:**

- `checkout` — requires `confirm: true`
- `modify_reservation` — requires `confirm: true`
- `cancel_reservation` — requires `confirm: true`
- `redeem_points` — requires `confirm: true`

Without `confirm: true`, these tools return a **preview** of what would happen, giving users a chance to review before committing.

## Development

```bash
git clone https://github.com/markswendsen-code/mcp-marriott
cd mcp-marriott
npm install
npm run build
node dist/index.js
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MARRIOTT_EMAIL` | Marriott Bonvoy account email |
| `MARRIOTT_PASSWORD` | Marriott Bonvoy account password |
| `MCP_AUTH_TOKEN` | Bearer token for the remote MCP endpoint |
| `BLOB_READ_WRITE_TOKEN` | Private Vercel Blob session storage token |

## License

MIT — [Strider Labs](https://striderlabs.ai)
