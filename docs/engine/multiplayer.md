# Multiplayer

**Hot seat** is the round itself (rules-turn.md): several humans take their slots in one browser,
and `HOTSEATTURN` hands over. Each sees its own map.

**Network play** is `apps/relay` and `apps/web/src/net.ts`. A room holds seats. The moving player's
browser runs the round up to the next human and sends the whole game on. Others wait. The relay
never reads the game, so the rules run only in browsers.

Start the relay with `PORT=8787 npm start -w apps/relay`, then each player joins the same room with
a seat equal to their civilization's slot, the host with its game already loaded.

The original's simultaneous-moves mode (the `NM_` messages), its turn timer and its host migration
are not ported. Its protocol (0x00460379, 0x0045094d, 0x004d4b20) is a client-server exchange over
TCP/IP or IPX, which a browser cannot join, so the two games cannot play each other.
