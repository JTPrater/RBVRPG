(function (RBV) {
const roomImages = {
  grand_staircase_bd: {
    images: [
      "grand stair1.png",
      "grand stair2.png",
      "grand stair3.png",
      "grand stair4.png",
      "grand stair5.png",
      "grand stair6.png",
      "grand stair7.png",
      "grand stair8.png",
      "grand stair9.png",
      "grand stair10.png",
    ],
    currentIndex: 0,
  },
  childrens_playroom_bd: {
    images: [
      "Childrens Playroom.png",
      "Childrens Playroom2.png",
      "Childrens Playroom3.png",
    ],
    currentIndex: 0,
  },
  gymnasium_bd: {
    images: [
      "1st gym1.png",
      "1st gym2.png",
      "1st gym3.png",
      "1st gym4.png",
      "1st gym5.png",
    ],
    currentIndex: 0,
  },
  port_officers_promenade_bd: {
    images: [
      "Port Officer's Promenade.png",
      "Port Officer's Promenade2.png",
      "Port Officer's Promenade3.png",
    ],
    currentIndex: 0,
  },
  starboard_officers_promenade_bd: {
    images: [
      "Starboard Officer's Promenade.png",
      "Starboard Officer's Promenade2.png",
      "Starboard Officer's Promenade3.png",
    ],
    currentIndex: 0,
  },
  port_bridge_wing_bd: {
    images: [
      "Port Bridge Wing.png",
      "Port Bridge Wing2.png",
      "Port Bridge Wing3.png",
      "Port Bridge Wing4.png",
      "Port Bridge Wing5.png",
    ],
    currentIndex: 0,
  },
  starboard_bridge_wing_bd: {
    images: [
      "Starboard Bridge Wing.png",
      "Starboard Bridge Wing2.png",
      "Starboard Bridge Wing3.png",
      "Starboard Bridge Wing4.png",
      "Starboard Bridge Wing5.png",
    ],
    currentIndex: 0,
  },
  bridge_bd: {
    images: [
      "Bridge.png",
      "Bridge2.png",
      "Bridge3.png",
      "Bridge4.png",
      "Bridge5.png",
      "Bridge6.png",
    ],
    currentIndex: 0,
  },
  first_class_lounge_a: {
    images: [
      "First Class Lounge1.png",
      "First Class Lounge2.png",
      "First Class Lounge3.png",
      "First Class Lounge4.png",
      "First Class Lounge5.png",
      "First Class Lounge6.png",
      "First Class Lounge7.png",
      "First Class Lounge8.png",
      "First Class Lounge9.png",
      "First Class Lounge10.png",
      "First Class Lounge11.png",
      "First Class Lounge12.png",
      "First Class Lounge13.png",
    ],
    currentIndex: 0,
  },
  corridor_a: {
    images: ["Corridor.png", "Corridor2.png", "Corridor3.png", "Corridor4.png"],
    currentIndex: 0,
  },
  corridor: {
    images: [
      "a corridor1.png",
      "a corridor2.png",
      "a corridor3.png",
      "a corridor4.png",
    ],
    currentIndex: 0,
  },
  grand_staircase_a: {
    images: [
      "gsc A1.png",
      "gsc A2.png",
      "gsc A3.png",
      "gsc A4.png",
      "gsc A5.png",
      "gsc A6.png",
      "gsc A7.png",
      "gsc A8.png",
      "gsc A9.png",
    ],
    currentIndex: 0,
  },
  aft_grand_staircase_a: {
    images: [
      "Aft Grand Staircase.png",
      "Aft Grand Staircase2.png",
      "Aft Grand Staircase3.png",
      "Aft Grand Staircase4.png",
    ],
    currentIndex: 0,
  },
  first_class_smoking_room_a: {
    images: [
      "First Class Smoking.png",
      "First Class Smoking2.png",
      "First Class Smoking3.png",
      "First Class Smoking4.png",
      "First Class Smoking5.png",
      "First Class Smoking6.png",
      "First Class Smoking7.png",
      "First Class Smoking8.png",
      "First Class Smoking9.png",
      "First Class Smoking10.png",
      "First Class Smoking11.png",
    ],
    currentIndex: 0,
  },
};
roomImages.verandah_palm_court_a = {
  images: [
    "Palm Court.png",
    "Palm Court2.png",
    "Palm Court3.png",
    "Palm Court4.png",
    "Palm Court5.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_reception_d = {
  images: [
    "First Class Reception1.png",
    "First Class Reception2.png",
    "First Class Reception3.png",
    "First Class Reception4.png",
    "First Class Reception5.png",
    "First Class Reception6.png",
    "First Class Reception7.png",
    "First Class Reception8.png",
    "First Class Reception9.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_dining_room_d = {
  images: [
    "First Class Dining1.png",
    "First Class Dining2.png",
    "First Class Dining3.png",
    "First Class Dining4.png",
    "First Class Dining5.png",
    "First Class Dining6.png",
    "First Class Dining7.png",
    "First Class Dining8.png",
    "First Class Dining9.png",
    "First Class Dining10.png",
    "First Class Dining11.png",
    "First Class Dining12.png",
    "First Class Dining13.png",
    "First Class Dining14.png",
    "First Class Dining15.png",
    "First Class Dining16.png",
    "First Class Dining17.png",
    "First Class Dining18.png",
    "First Class Dining19.png",
    "First Class Dining20.png",
    "First Class Dining21.png",
    "First Class Dining22.png",
    "First Class Dining23.png",
  ],
  currentIndex: 0,
};

// Add Southampton room images
roomImages.berth_44_walkaway = {
  images: ["berth 44 walkaway.jpg"],
  currentIndex: 0,
};

roomImages.dockside_cafe = {
  images: ["dockside cafe.jpg"],
  currentIndex: 0,
};

roomImages.berth_44_forward = {
  images: ["berth44 forward1.jpg"],
  currentIndex: 0,
};

roomImages.first_class_gangway = {
  images: ["firstclassgangway.jpg"],
  currentIndex: 0,
};

roomImages.crew_gangway = {
  images: ["crew gangway.jpg"],
  currentIndex: 0,
};

roomImages.third_class_gangway = {
  images: ["3rd class gangway.jpg"],
  currentIndex: 0,
};

roomImages.berth_44_aft = {
  images: ["berth 44 aft docks1.jpg"],
  currentIndex: 0,
};

roomImages.covered_walkway = {
  images: ["berth 44 walkaway.jpg"],
  currentIndex: 0,
};

roomImages.boarding_tower = {
  images: ["1st class tower1.jpg", "1st class tower2.jpg"],
  currentIndex: 0,
};

roomImages.first_class_starboard_enclosed_promenade_a = {
  images: [
    "1st starb A enclosed prom1.png",
    "1st starb A enclosed prom2.png",
    "1st starb A enclosed prom3.png",
    "1st starb A enclosed prom4.png",
    "1st starb A enclosed prom5.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_port_enclosed_promenade_a = {
  images: [
    "1st port A enclosed prom1.png",
    "1st port A enclosed prom2.png",
    "1st port A enclosed prom3.png",
    "1st port A enclosed prom4.png",
    "1st port A enclosed prom5.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_port_promenade_a = {
  images: [
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
  ],
  currentIndex: 0,
};

roomImages.first_class_starboard_promenade_a = {
  images: [
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
  ],
  currentIndex: 0,
};

roomImages.first_a_corridor = {
  images: ["1st A corridor1.png", "1st A corridor2.png", "1st A corridor3.png"],
  currentIndex: 0,
};

roomImages.first_class_forward_overlooking_promenade_a = {
  images: [
    "1st A overlook prom1.png",
    "1st A overlook prom2.png",
    "1st A overlook prom3.png",
    "1st A overlook prom4.png",
    "1st A overlook prom5.png",
    "1st A overlook prom6.png",
  ],
  currentIndex: 0,
};

roomImages.second_class_staircase_a = {
  images: [
    "2nd class staircase1.png",
    "2nd class staircase2.png",
    "2nd class staircase3.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_b_forward_overlooking_promenade = {
  images: [
    "1C B overlook prom1.png",
    "1C B overlook prom2.png",
    "1C B overlook prom3.png",
    "1C B overlook prom4.png",
    "1C B overlook prom5.png",
    "1C B overlook prom6.png",
  ],
  currentIndex: 0,
};

roomImages.wheelhouse_bd = {
  images: [
    "wheelhouse1.png",
    "wheelhouse2.png",
    "wheelhouse3.png",
    "wheelhouse4.png",
    "wheelhouse5.png",
  ],
  currentIndex: 0,
};

roomImages.starboard_engineers_promenade_bd = {
  images: [
    "starb engineers prom1.png",
    "starb engineers prom2.png",
    "starb engineers prom3.jpg",
    "starb engineers prom4.jpg",
    "starb engineers prom5.jpg",
  ],
  currentIndex: 0,
};

roomImages.port_engineers_promenade_bd = {
  images: [
    "port engineers prom1.png",
    "port engineers prom2.png",
    "port engineers prom3.png",
  ],
  currentIndex: 0,
};

roomImages.starboard_2nd_class_promenade_bd = {
  images: [
    "starb 2nd class prom1.png",
    "starb 2nd class prom2.png",
    "starb 2nd class prom3.png",
    "starb 2nd class prom4.png",
  ],
  currentIndex: 0,
};

roomImages.port_2nd_class_promenade_bd = {
  images: [
    "port 2nd class prom1.png",
    "port 2nd class prom2.png",
    "port 2nd class prom3.png",
    "port 2nd class prom4.png",
  ],
  currentIndex: 0,
};

// Boat Deck - First Class Port Promenade (bd) defaults and sunset variant
roomImages.port_promenade_bd = {
  images: [
    "BD first port prom1.png",
    "BD first port prom2.png",
    "BD first port prom3.png",
    "BD first port prom4.png",
    "BD first port prom5.png",
    "BD first port prom6.png",
    "BD first port prom7.png",
  ],
  currentIndex: 0,
};

// Boat Deck - First Class Starboard Promenade replacement set
roomImages.starboard_promenade_bd = {
  images: [
    "BD first starb prom1.png",
    "BD first starb prom2.png",
    "BD first starb prom3.png",
    "BD first starb prom4.png",
    "BD first starb prom5.png",
    "BD first starb prom6.png",
  ],
  currentIndex: 0,
};

roomImages["2nd_class_staircase_bd"] = {
  images: [
    "2nd class staircasebd1.png",
    "2nd class staircasebd2.png",
    "2nd class staircasebd3.png",
    "2nd class staircasebd4.png",
  ],
  currentIndex: 0,
};

roomImages.forecastle_b = {
  images: [
    "forecastle1.png",
    "forecastle2.png",
    "forecastle3.png",
    "forecastle4.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_port_b_enclosed_promenade = {
  images: [
    "1st B port enclosed prom1.png",
    "1st B port enclosed prom2.png",
    "1st B port enclosed prom3.png",
    "1st B port enclosed prom4.png",
    "1st B port enclosed prom5.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_starboard_b_enclosed_promenade = {
  images: [
    "1st B starb enclosed prom1.png",
    "1st B starb enclosed prom2.png",
    "1st B starb enclosed prom3.png",
    "1st B starb enclosed prom4.png",
    "1st B starb enclosed prom5.png",
  ],
  currentIndex: 0,
};

roomImages.poop_deck = {
  images: [
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
  ],
  currentIndex: 0,
};

roomImages.grand_staircase_b = {
  images: [
    "B deck gd1.png",
    "B deck gd2.png",
    "B deck gd3.png",
    "B deck gd4.png",
    "B deck gd5.png",
    "B deck gd6.png",
    "B deck gd7.png",
    "B deck gd8.png",
    "B deck gd9.png",
  ],
  currentIndex: 0,
};

roomImages.third_class_smoke_room_b = {
  images: [
    "3rd class SR1.png",
    "3rd class SR2.png",
    "3rd class SR3.png",
    "3rd class SR4.png",
    "3rd class SR5.png",
    "3rd class SR6.png",
  ],
  currentIndex: 0,
};

roomImages.second_class_smoke_room_b = {
  images: [
    "2nd smoke1.png",
    "2nd smoke2.png",
    "2nd smoke3.png",
    "2nd smoke4.png",
    "2nd smoke5.png",
  ],
  currentIndex: 0,
};

roomImages.second_class_starboard_promenade_b = {
  images: [
    "2nd class b starb prom1.png",
    "2nd class b starb prom2.png",
    "2nd class b starb prom3.png",
    "2nd class b starb prom4.png",
    "2nd class b starb prom5.png",
    "2nd class b starb prom6.png",
    "2nd class b starb prom7.png",
  ],
  currentIndex: 0,
};

roomImages.second_class_port_promenade_b = {
  images: [
    "2nd class b prom1.png",
    "2nd class b prom2.png",
    "2nd class b prom3.png",
    "2nd class b prom4.png",
    "2nd class b prom5.png",
    "2nd class b prom6.png",
    "2nd class b prom7.png",
  ],
  currentIndex: 0,
};

roomImages.b_deck_aft_staircase = {
  images: [
    "b aft staircase1.png",
    "b aft staircase2.png",
    "b aft staircase3.png",
    "b aft staircase4.png",
  ],
  currentIndex: 0,
};

roomImages.restaurant_reception_room = {
  images: [
    "reception room1.png",
    "reception room2.png",
    "reception room3.png",
    "reception room4.png",
    "reception room5.png",
  ],
  currentIndex: 0,
};

roomImages.a_la_carte_restaurant = {
  images: [
    "carte1.png",
    "carte2.png",
    "carte3.png",
    "carte4.jpg",
    "carte5.png",
    "carte6.png",
    "carte7.png",
    "carte8.png",
    "carte9.png",
    "carte10.png",
    "carte11.png",
    "carte12.png",
    "carte13.png",
    "carte14.png",
  ],
  currentIndex: 0,
};

roomImages.cabin_a3 = {
  images: ["Cabin A3.jpg", "Cabin A3 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a4 = {
  images: ["Cabin A4.jpg", "Cabin A4 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a5 = {
  images: ["Cabin A5.jpg", "Cabin A5 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a6 = {
  images: ["Cabin A6.jpg", "Cabin A6 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a7 = {
  images: ["Cabin A7.jpg", "Cabin A7 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a8 = {
  images: ["Cabin A8.jpg", "Cabin A8 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a9 = {
  images: ["Cabin A9.jpg", "Cabin A9 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a10 = {
  images: ["Cabin A10.jpg", "Cabin A10 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a11 = {
  images: ["Cabin A11.jpg", "Cabin A11 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a12 = {
  images: ["Cabin A12.jpg", "Cabin A12 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a14 = {
  images: ["Cabin A14.jpg", "Cabin A14 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a15 = {
  images: ["Cabin A15.jpg", "Cabin A15 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a16 = {
  images: ["Cabin A16.jpg", "Cabin A16 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a17 = {
  images: ["Cabin A17.jpg", "Cabin A17 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a18 = {
  images: ["Cabin A18.jpg", "Cabin A18 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a19 = {
  images: ["Cabin A19.jpg", "Cabin A19 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a20 = {
  images: ["Cabin A20.jpg", "Cabin A20 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a21 = {
  images: ["Cabin A21.jpg", "Cabin A21 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a22 = {
  images: ["Cabin A22.jpg", "Cabin A22 2.jpg"],
  currentIndex: 0,
};

roomImages.cabin_a23 = {
  images: ["Cabin A23.jpg", "Cabin A23 2.jpg"],
  currentIndex: 0,
};

  RBV.data = RBV.data || {};
  RBV.data.roomImages = roomImages;
  window.roomImages = roomImages;
})(window.RBV);
