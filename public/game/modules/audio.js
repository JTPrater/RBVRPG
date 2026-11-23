(function (RBV) {
  const openMapSound = new Audio("/sounds/open_map.mp3");
  openMapSound.preload = "auto";

  const openDoorSound = new Audio("/sounds/open_door.mp3");
  const closeDoorSound = new Audio("/sounds/close_door.mp3");
  openDoorSound.preload = "auto";
  closeDoorSound.preload = "auto";

  const eatSound = new Audio("/sounds/eat.mp3");
  const drinkSound = new Audio("/sounds/drink.mp3");
  eatSound.preload = "auto";
  drinkSound.preload = "auto";

  const telegraphSound = new Audio("/sounds/telegraph.mp3");
  telegraphSound.preload = "auto";

  const interiorSound = new Audio("/sounds/ship_interior.mp3");
  interiorSound.loop = true;
  interiorSound.volume = 0.5;

  const exteriorSound = new Audio("/sounds/ship_exterior.mp3");
  exteriorSound.loop = true;
  exteriorSound.volume = 0.5;

  let sfxVolume = 1;
  const allSfx = [
    openMapSound,
    openDoorSound,
    closeDoorSound,
    eatSound,
    drinkSound,
    telegraphSound,
  ];

  function setSfxVolume(value) {
    sfxVolume = value / 100;
    allSfx.forEach((s) => {
      s.volume = sfxVolume;
    });
    interiorSound.volume = 0.5 * sfxVolume;
    exteriorSound.volume = 0.5 * sfxVolume;
  }

  function playConsumptionSound(item) {
    let soundToPlay = null;

    if (item?.topCategory === "food") {
      soundToPlay = eatSound;
    } else if (
      item?.topCategory === "soft_beverages" ||
      item?.topCategory === "alcoholic_beverages"
    ) {
      soundToPlay = drinkSound;
    } else if ((item?.hungry ?? 0) > 0) {
      soundToPlay = eatSound;
    } else if ((item?.thirsty ?? 0) > 0) {
      soundToPlay = drinkSound;
    }

    if (!soundToPlay) return;

    soundToPlay.currentTime = 0;
    soundToPlay.play().catch(() => {});
  }

  RBV.audio = {
    openMapSound,
    openDoorSound,
    closeDoorSound,
    eatSound,
    drinkSound,
    telegraphSound,
    interiorSound,
    exteriorSound,
    setSfxVolume,
    playConsumptionSound,
  };

  window.setSfxVolume = setSfxVolume;
  window.playConsumptionSound = playConsumptionSound;
  window.openMapSound = openMapSound;
  window.openDoorSound = openDoorSound;
  window.closeDoorSound = closeDoorSound;
  window.interiorSound = interiorSound;
  window.exteriorSound = exteriorSound;

})(window.RBV);
