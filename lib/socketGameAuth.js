/**
 * Session-backed identity for game socket events (do not trust client character/email).
 */
function createSocketGameAuth(User) {
  async function attachSessionUser(socket) {
    // The character this connection plays, settled as it connected (server.js
    // io.use: the one its tab named, of those logged in on its browser)
    const sessionUserId = socket.playerId;
    if (!sessionUserId) {
      return null;
    }

    const user = await User.findById(sessionUserId).select("email character");
    if (!user) {
      return null;
    }

    socket.userEmail = user.email;
    socket.character = user.character || null;
    socket.sessionUserId = user._id;
    return user;
  }

  async function requireSessionUser(socket) {
    if (socket.sessionUserId && socket.userEmail && socket.character) {
      return { ok: true, user: { email: socket.userEmail, character: socket.character } };
    }

    const user = await attachSessionUser(socket);
    if (!user) {
      return { ok: false, error: "Authentication required" };
    }

    return { ok: true, user };
  }

  return {
    attachSessionUser,
    requireSessionUser,
  };
}

module.exports = { createSocketGameAuth };
