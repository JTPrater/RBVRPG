/**
 * Session-backed identity for game socket events (do not trust client character/email).
 */
function createSocketGameAuth(User) {
  async function attachSessionUser(socket) {
    const sessionUserId = socket.request?.session?.userId;
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
