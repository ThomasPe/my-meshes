# ADR-0004: A local MCP server so an AI agent can work the library

- Status: **accepted** 2026-11-05
- Date: 2026-11-05
- Related: ADR-0003 (AI assistance, binding principles), META-7a (hints and model pages),
  IMP-1a (imports fill metadata), `spec/04-quality.md` (no network without the user).

## Context

ADR-0003 brought AI into the app as suggestions the user confirms one at a time. That is
the right shape for a click, and the wrong one for "please go through my 2,000 projects
and fill in what you can". Doing that well needs an agent that can plan, read, look things
up and write in a loop, with a conversation to steer it. Such agents exist on the user's
machine already (Claude Desktop, Claude Code, others), and they speak the Model Context
Protocol (MCP). Meshkeep does not need to run a model to let one work the library: it
needs to be an MCP server.

The user's words for the goal: let the AI enrich models with metadata as autonomously as
possible, add models (for example from the Downloads folder) and look up sources.

## Decision

Meshkeep exposes its engine as an MCP server, inside the running app.

1. **Transport.** The app listens on `127.0.0.1:<port>` (default 7340) and answers
   JSON-RPC over HTTP (the Streamable HTTP transport, POST only, JSON responses, no SSE,
   no session ids). The same executable started as `meshkeep --mcp [url] [token]` is a
   stdio bridge that forwards lines to that endpoint, for clients that only launch
   commands (Claude Desktop). One process owns the engine, the index and the watchers;
   the window sees every change an agent makes through the same events the commands
   emit.
2. **Access.** Off by default. Every request carries a bearer token the app mints when
   the server is first enabled (shown, copyable and replaceable in Settings). Requests
   with a browser `Origin` that is not this machine are refused, so no web page can
   reach the port. The token lives in `settings.json`, like the AI endpoint; it is not a
   secret from the user, it is a secret from everything else on the machine.
3. **Two switches.** "Run the MCP server" exposes reading tools only: roots, search
   (with a `missing` filter for the fields an agent should fill), project details with
   hints, readme text, model pages (behind the existing "Load model pages" setting),
   creator suggestions, inbox, duplicates, collections, and listing the import folders.
   "Allow writes" adds the writing tools: metadata (single and batch), imports,
   promoting inbox files, rename, move, favorites, collections, moving files between
   projects and removing folders left empty. No tool deletes a file behind these two
   switches; deleting has its own switch (amendment below).
4. **Import folders.** The only paths outside the libraries an agent may list or import
   from are the folders the user names in Settings (Downloads with one click). Paths are
   canonicalised before the check, so `..` and links cannot leave them.
5. **Engine owns the protocol.** `crates/engine/src/mcp.rs` turns a JSON-RPC value into a
   result and a list of changes; the shell adds the socket, the token check and the
   events. Every tool is tested without a socket; the socket is tested once.
6. **What leaves the machine** is the client's business, not the server's, and the
   Settings card says so in plain words: the tools return project metadata, file names,
   readme text, the listed import folders and (with the setting on) what model pages say;
   where the connected client sends that depends on the client. The privacy policy carries
   the same paragraph. Meshkeep still makes no network request of its own for this.

## Consequences

- ADR-0003's "suggestions, never silent writes" does not hold for an agent with writes
  allowed: that is the point of the switch, and why it is separate and off by default.
  The agent writes through the same paths the UI uses (`update_metadata` with the sidecar
  stamp, the import pipeline, rename, move), so conflicts and validation behave the same.
- A client with a kept-alive connection outlives "stop" until it gives up on it (the
  server library closes only on the request's own `Connection: close`); the bridge sends
  that header, a stopped server refuses new connections at once.
- The port is fixed per settings, so two users on one machine would collide; acceptable
  for a desktop app, the status line shows the bind error.
- MCP evolves; the server states protocol version 2025-06-18 and ignores what it does
  not implement (resources, sampling, elicitation). A client that needs SSE streaming
  gets 405 on GET and keeps working over POST.
- The feature is not Store-relevant beyond the privacy text: no new capability, no new
  outbound connection.

## Amendment 2026-11-07: deleting, behind a third switch (#57)

An agent that finds duplicates and reorganises a library could not finish the job: the
last step, removing a duplicate or a project, always fell back to the user. So:

- **A third switch "Allow deleting (to the trash)"**, off by default, only available while
  "Allow writes" is on, and turned off with it. It adds `delete_file`, `delete_project`,
  `resolve_duplicates` (keep one project, trash the members it fully covers, what the
  Duplicates view's "keep" does) and `remove_shared_files` (thin a collection out: trash
  the files that also exist in other projects). Everything goes through the trash deleter
  (IMP-5), nothing is removed permanently, `project.yaml` and the library root are refused.
- **Behind "Allow writes"** two tools that involve no deletion: `move_files` (take files
  out of a project into an existing or new project folder) and `remove_empty_folders`
  (folders with nothing at all in them, deepest first; a single remaining file keeps a
  folder, so do the root, the inbox and the app's folders).
- **Common rules:** every one of these takes `dry_run` and returns the paths it would
  touch; the index, collections and favorites follow in the same call; the usual change
  events reach the window. `find_duplicates` now lists each member's shared files with
  the projects that also hold them, so an agent can decide between the two resolutions.
