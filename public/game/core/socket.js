(function (RBV) {
  RBV.socket = io({ withCredentials: true });

  RBV.socket.on("auth-error", (data) => {
    console.error("🔒 Authentication required for game action:", data?.message);
    alert("Your session expired. Please log in again.");
    window.location.href = "/";
  });

  window.socket = RBV.socket;
})(window.RBV);
