// The player's character for this tab. A tab keeps it in sessionStorage, which a
// new tab or a bookmark starts without (the session cookie is all it has), so it
// is fetched from the server before the game's scripts read it. Synchronous on
// purpose: everything after this reads the character as the page loads.
// "playerId" is which of the characters logged in on this browser the tab plays
// (several may be, a tab each): the tab names it whenever it connects. A tab
// that has a character but no id (opened before ids were kept) asks too, and
// takes the one the server will give it.
(function () {
  try {
    if (sessionStorage.getItem("character") && sessionStorage.getItem("playerId")) return;
    const req = new XMLHttpRequest();
    req.open("GET", "/api/me", false);
    req.send();
    if (req.status === 200) {
      const answer = JSON.parse(req.responseText);
      if (answer && answer.character) {
        sessionStorage.setItem("character", JSON.stringify(answer.character));
        if (answer.playerId) sessionStorage.setItem("playerId", answer.playerId);
      }
    } else if (req.status === 401) {
      window.location.href = "/";
    }
  } catch (e) {
    // the game shows what it can without it
  }
})();
