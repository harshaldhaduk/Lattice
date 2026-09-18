# Lattice 0.5.0 test relay

Use this only when testing across separate computers. Different VS Code windows on one computer can use the extension's default local relay.

1. Install Node.js 22 or newer on the computer that will host the relay.
2. Extract this ZIP and run `node start-relay.cjs` in the extracted folder. Keep that terminal running. No npm install is needed.
3. Connect both computers to the same private LAN or private VPN. Find the relay computer's reachable IPv4 address. If prompted by the host firewall, permit Node on the private network.
4. On **both** machines, set VS Code's `lattice.relayUrl` and `lattice.advertiseUrl` to `ws://HOST-IP:4329`, replacing HOST-IP with that address.
5. Start a new Lattice session on the host, copy its invitation and join from the other machine. Both participants need access to the project's GitHub repository. Each person who runs an agent needs their own signed-in Codex or Claude CLI.

The relay stores encrypted session data in `data/` and reuses `data/storage.key` on restart. Keep that folder private and backed up. Do not delete or regenerate the key if you need session history.

This launcher uses invitation-based access over a private network. For a public internet relay, use the source deployment guide with TLS and GitHub authentication. Do not port-forward this test relay to the public internet.
