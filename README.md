# My Postmaster

My Postmaster is a desktop API client I built for Linux. It lets you build, send and test API requests, keep them organised in collections, switch between environments, automate checks with scripts, and get help from Claude AI, all from one fast, keyboard-friendly window.

Everything runs locally. Your collections, environments and history stay on your machine.

---

## What you can do with it

### Send requests over every common protocol
- **HTTP / REST**: every method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS and more), query and path parameters, headers, and bodies as JSON, XML, HTML, text, form-data (with file uploads), URL-encoded or binary files.
- **GraphQL**: query and variables editors, plus a schema explorer that loads the schema through introspection and builds queries for you.
- **WebSocket**, **Socket.IO** (v3/v4), **Server-Sent Events** and **MQTT** (3.1.1 / 5): connect, send messages, listen to events and topics, and watch a live message log.
- **gRPC**: unary and streaming calls, using server reflection or your own `.proto` files.

### Read responses comfortably
- Pretty, raw and live HTML preview views with syntax highlighting and search.
- Response headers, cookies, timing and the exact request that was sent.
- Status, time and size at a glance. Save a response to a file, copy it, or keep it as an example.
- **Visualizer**: turn a response into a table or chart with a small template.

### Stay organised
- **Collections and folders** with drag and drop, rename, duplicate, copy/paste and keyboard navigation.
- **Examples** saved on requests.
- **History** of everything you send, grouped by day.
- Tabs you can reorder, duplicate and reopen after closing.

### Variables and environments
- **Environments** (dev, staging, production…), **collection variables** and **globals**.
- `{{variables}}` are coloured as you type: teal when defined, red when missing. Hover one to see its value.
- Autocomplete for variables in every field, and built-in dynamic values such as `{{$guid}}`, `{{$timestamp}}` and `{{$isoTimestamp}}`.
- Secret variables are masked.

### Authentication
No Auth, inherit from parent, Bearer Token, Basic, API Key, JWT Bearer, Digest, OAuth 1.0, OAuth 2.0 (with token fetching), Hawk and AWS Signature v4. Set auth once on a collection or folder and let requests inherit it.

### Scripts and tests
- **Pre-request** and **post-response** scripts in JavaScript, with a familiar `pm.*` scripting API.
- Write tests with `pm.test(...)` and `pm.expect(...)` (Chai), validate JSON schemas, set variables, send extra requests and chain requests together.
- Ready-made snippets for the most common checks.
- A **console** that shows every request, response and `console.log` line.

### Run and load-test
- **Collection runner**: run a whole collection or folder, choose the order, repeat it for many iterations, and feed it a CSV or JSON data file.
- **Performance testing**: simulate many virtual users and watch response times and error rates.

### Mock servers
Start a local mock server from a collection's saved examples. It's useful for front-end work before the real API exists.

### Code generation
Turn any request into ready-to-run code: cURL, HTTPie, wget, PowerShell, JavaScript (Fetch), Node.js (Axios), Python (Requests, http.client), Go, Java (OkHttp, HttpClient), C#, PHP, Ruby, Swift, Kotlin, Rust and Dart.

### Claude AI assistant
Ask Claude to explain a response, debug a failing request, write tests, or build a request or an entire collection from a plain-English description. It uses your own Claude account that is signed in on your computer, so there are no extra keys to manage.

### Networking options
Proxy support (system or custom, with bypass list), custom CA certificates, client certificates (CRT/KEY or PFX), configurable timeouts and redirects, a cookie jar with a cookie manager, and per-request overrides for all of these.

### Comfortable to use
- Light, dark or follow-system theme.
- Stacked or side-by-side request/response layout.
- Adjustable interface and editor font sizes.
- Command palette (`Ctrl+K`) to find any request or action.
- Multiple windows.
- Find in page.
- Full keyboard shortcuts (`Ctrl+/` shows them all).

---

## Importing your existing work

You don't have to start from scratch. My Postmaster can import:

| Source | What comes in |
|---|---|
| **Postman** | Collections (v2.0 / v2.1), environments, globals and full data dumps |
| **Postman** and **EchoAPI** installed on this computer | One-click import straight from the app: pick the collections you want; ones you already imported are greyed out |
| **Insomnia** | v4 exports, including environments |
| **OpenAPI 3 / Swagger 2** | JSON or YAML, from a file or a link |
| **HAR** files | Recorded browser traffic |
| **cURL** | Paste a command into the URL bar or the import box |
| **My Postmaster backups** | Your full workspace |

One-click import only reads the other app's local data on this computer, only when you click it, and never changes it.

You can import from a file, a link, pasted text, or by dropping files onto the window. Collections and environments export as JSON files that other API tools can read.

---

## Installing

### Supported systems
- **Ubuntu 18.04 or newer** (18.04, 20.04, 22.04 and 24.04 are tested on every change), or an Ubuntu-based system such as Linux Mint, Pop!_OS or Zorin OS.
- 64-bit Intel or AMD processor (amd64).

### From a .deb package (Ubuntu / Debian)
```bash
sudo apt install ./my-postmaster_<version>_amd64.deb
```
`apt` also installs the few system libraries the app needs.
Then launch **My Postmaster** from your applications menu, or run `my-postmaster` in a terminal.

### Running from source
You need Node.js 18 or newer.
```bash
git clone https://github.com/<your-username>/my-postmaster.git
cd my-postmaster
npm install
npm start
```

### Building the .deb yourself
```bash
npm install
npm run deb
```
This creates `my-postmaster_<version>_amd64.deb` in the project folder.

### Running the tests
```bash
npm test
```
This starts the app against local test servers for every protocol and checks the results.

To check the `.deb` itself on every supported Ubuntu version, build it and run the tests inside clean Docker containers:
```bash
npm run deb
npm run test:docker            # Ubuntu 18.04, 20.04, 22.04 and 24.04
test/docker_test.sh 22.04      # or a single version
```
Each run installs the package with `apt` in a fresh `ubuntu:<version>` container, checks the menu entry, starts the app, runs the full test suite as a normal user against the installed app, and then removes the package. The same checks run automatically on GitHub for every push and pull request.

---

## Turning on the AI assistant
The assistant uses the Claude command-line tool that is signed in on your computer:

1. Install it: `curl -fsSL https://claude.ai/install.sh | bash`
2. Sign in once by running `claude` in a terminal.
3. Open My Postmaster. The status bar shows **Claude connected**.

You can pick the model in **Settings → Claude AI**.

---

## Where your data lives
Everything is stored locally in `~/.config/My Postmaster/`. To move to another machine, use **Settings → Data → Export all data** and import the backup there.

---

## Handy shortcuts

| Action | Shortcut |
|---|---|
| Send request | `Ctrl+Enter` |
| Send and download | `Ctrl+Alt+Enter` |
| New tab | `Ctrl+T` |
| Close tab / reopen closed tab | `Ctrl+W` / `Ctrl+Shift+T` |
| Save / Save as | `Ctrl+S` / `Ctrl+Shift+S` |
| Search everything | `Ctrl+K` |
| Import | `Ctrl+O` |
| Focus URL bar | `Ctrl+L` |
| Beautify body | `Ctrl+B` |
| Toggle sidebar | `Ctrl+\` |
| Toggle layout | `Ctrl+Alt+V` |
| Console | `Ctrl+Alt+C` |
| Settings | `Ctrl+,` |
| All shortcuts | `Ctrl+/` |

---

## License
ISC
