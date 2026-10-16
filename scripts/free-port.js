import net from 'node:net';

// A port nothing is listening on, from the operating system, for the scratch servers the tests start.
//
// The tests used to pick one at random from a range (5200-5599 for the browser specs, 3200-4899 for the node suites). A range cannot know what else
// is running on the developer's machine: 5432 is inside 5200-5599, and PostgreSQL listens there. server/index.js binds the wildcard address and
// PostgreSQL only 127.0.0.1 and ::1, so the scratch server started without an error and printed "running", but every request to 127.0.0.1:5432
// went to PostgreSQL, which closed the connection: "fetch failed ... other side closed", on a different spec in each run (about one start in four
// hundred, so about one full run in three), and no number of retries could help (Phase 8 found this: the log of the failed attempts named the port).
// The operating system keeps track of what is in use; asking it removes the guesswork.

/** @returns {Promise<number>} */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    // The wildcard address, like server/index.js, so that a port taken on any address is not offered.
    probe.listen(0, () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address());
      probe.close(() => resolve(port));
    });
  });
}
