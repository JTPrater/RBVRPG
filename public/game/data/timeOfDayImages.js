// Night and sunrise/sunset versions of the Britannic's exterior location pictures, made from the day pictures
// (scripts/night_edit; written by make_tod_manifest.py). Sunrise and sunset share one set ("twilight"). A version has
// the day picture's name with a .webp extension, in its own folder beside images/animations/locations/britannic.
(function (RBV) {
  const FOLDERS = { night: "britannic (night)", twilight: "britannic (twilight)" };
  const NAMES = [
    "Port Officer's Promenade.png",
    "Port Officer's Promenade2.png",
    "Port Officer's Promenade3.png",
    "Starboard Officer's Promenade.png",
    "Starboard Officer's Promenade2.png",
    "Starboard Officer's Promenade3.png",
    "Port Bridge Wing.png",
    "Port Bridge Wing2.png",
    "Port Bridge Wing3.png",
    "Port Bridge Wing4.png",
    "Port Bridge Wing5.png",
    "Starboard Bridge Wing.png",
    "Starboard Bridge Wing2.png",
    "Starboard Bridge Wing3.png",
    "Starboard Bridge Wing4.png",
    "Starboard Bridge Wing5.png",
    "Bridge.png",
    "Bridge2.png",
    "Bridge3.png",
    "Bridge4.png",
    "Bridge5.png",
    "Bridge6.png",
    "1st starb A enclosed prom1.png",
    "1st starb A enclosed prom2.png",
    "1st starb A enclosed prom3.png",
    "1st starb A enclosed prom4.png",
    "1st starb A enclosed prom5.png",
    "1st port A enclosed prom1.png",
    "1st port A enclosed prom2.png",
    "1st port A enclosed prom3.png",
    "1st port A enclosed prom4.png",
    "1st port A enclosed prom5.png",
    "1st A port prom1.png",
    "1st A port prom2.png",
    "1st A port prom3.png",
    "1st A port prom4.png",
    "1st A port prom5.png",
    "1st A port prom6.png",
    "1st A port prom7.png",
    "1st A port prom8.png",
    "1st A port prom9.png",
    "1st A port prom10.png",
    "1st A starb prom1.png",
    "1st A starb prom2.png",
    "1st A starb prom3.png",
    "1st A starb prom4.png",
    "1st A starb prom5.png",
    "1st A starb prom6.png",
    "1st A starb prom7.png",
    "1st A starb prom8.png",
    "1st A starb prom9.png",
    "1st A starb prom10.png",
    "1st A overlook prom1.png",
    "1st A overlook prom2.png",
    "1st A overlook prom3.png",
    "1st A overlook prom4.png",
    "1st A overlook prom5.png",
    "1st A overlook prom6.png",
    "1C B overlook prom1.png",
    "1C B overlook prom2.png",
    "1C B overlook prom3.png",
    "1C B overlook prom4.png",
    "1C B overlook prom5.png",
    "1C B overlook prom6.png",
    "starb engineers prom1.png",
    "starb engineers prom2.png",
    "port engineers prom1.png",
    "port engineers prom2.png",
    "port engineers prom3.png",
    "starb 2nd class prom1.png",
    "starb 2nd class prom2.png",
    "starb 2nd class prom3.png",
    "starb 2nd class prom4.png",
    "port 2nd class prom1.png",
    "port 2nd class prom2.png",
    "port 2nd class prom3.png",
    "port 2nd class prom4.png",
    "BD first port prom1.png",
    "BD first port prom2.png",
    "BD first port prom3.png",
    "BD first port prom4.png",
    "BD first port prom5.png",
    "BD first port prom6.png",
    "BD first port prom7.png",
    "BD first starb prom1.png",
    "BD first starb prom2.png",
    "BD first starb prom3.png",
    "BD first starb prom4.png",
    "BD first starb prom5.png",
    "BD first starb prom6.png",
    "forecastle1.png",
    "forecastle2.png",
    "forecastle3.png",
    "forecastle4.png",
    "1st B port enclosed prom1.png",
    "1st B port enclosed prom2.png",
    "1st B port enclosed prom3.png",
    "1st B port enclosed prom4.png",
    "1st B port enclosed prom5.png",
    "1st B starb enclosed prom1.png",
    "1st B starb enclosed prom2.png",
    "1st B starb enclosed prom3.png",
    "1st B starb enclosed prom4.png",
    "1st B starb enclosed prom5.png",
    "poop1.png",
    "poop2.png",
    "poop3.png",
    "poop4.png",
    "poop5.png",
    "poop6.png",
    "poop7.png",
    "poop8.png",
    "poop9.png",
    "poop10.png",
    "poop11.png",
    "poop12.png",
    "poop13.png",
    "poop14.png",
    "poop15.png",
    "2nd class b starb prom1.png",
    "2nd class b starb prom2.png",
    "2nd class b starb prom3.png",
    "2nd class b starb prom4.png",
    "2nd class b starb prom5.png",
    "2nd class b starb prom6.png",
    "2nd class b starb prom7.png",
    "2nd class b prom1.png",
    "2nd class b prom2.png",
    "2nd class b prom3.png",
    "2nd class b prom4.png",
    "2nd class b prom5.png",
    "2nd class b prom6.png",
    "2nd class b prom7.png",
  ];
  const have = new Set(NAMES);

  // The set for the sun's altitude in degrees: night below -5 (from nautical twilight on, as the sky's ms-4, ms-5 and
  // night palettes), sunrise/sunset up to 9 (the low sun of ms-3 to ms-1), day above
  function forSunAltitude(alt) {
    if (alt < -5) return "night";
    if (alt < 9) return "twilight";
    return "day";
  }

  // The same from the sky's hourly palette name, for before the celestial layer knows the sun
  function forPalette(name) {
    if (!name || name === "day") return "day";
    if (name === "night" || name === "ms-5" || name === "ms-4") return "night";
    return name.startsWith("ms") ? "twilight" : "day";
  }

  // A Britannic location picture's path in a time of day's set; the day picture's where the set has no version
  function path(imageName, tod) {
    if (tod && tod !== "day" && FOLDERS[tod] && have.has(imageName)) {
      const webp = imageName.replace(/\.(png|jpe?g)$/i, ".webp");
      return `/images/animations/locations/${FOLDERS[tod]}/${webp}`;
    }
    return `/images/animations/locations/britannic/${imageName}`;
  }

  RBV.data = RBV.data || {};
  RBV.data.timeOfDayImages = { FOLDERS, NAMES, forSunAltitude, forPalette, path };
})(window.RBV);
