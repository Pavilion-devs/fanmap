// Landing-page photography, hotlinked from Unsplash (free under the Unsplash licence).
const u = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1800&q=80`;

export const PHOTOS = {
  van: { src: u("1695220539847-31f3a2453bdd"), alt: "A camper van parked above the sea at dusk" },
  stageDoor: { src: u("1454321717968-d243ade71663"), alt: "A stage door sign reading Band and crew only" },
  guitarist: { src: u("1565035010268-a3816f98589a"), alt: "A guitarist backlit on stage, a fan's raised hands in front" },
  desk: { src: u("1631188769213-1f385e8544fa"), alt: "A sound engineer at the mixing desk facing the stage" },
  club: { src: u("1669459846550-c60006acdec6"), alt: "A packed club in front of a lit stage" },
  barStage: { src: u("1759338449452-c69d98ea7177"), alt: "A musician playing in a dim, crowded bar" },
  bar: { src: u("1760931657888-3a1305fe68c4"), alt: "A bar with shelves of bottles and beer taps" },
  jukebox: { src: u("1761935884120-1ee93ed5cf78"), alt: "A jukebox glowing in a dark bar" },
  crowd: { src: u("1459749411175-04bf5292ceea"), alt: "A crowd with hands up under warm stage light" },
  theatre: { src: u("1488036106564-87ecb155bb15"), alt: "A theatre crowd under a row of stage lights" },
} as const;

export type Photo = (typeof PHOTOS)[keyof typeof PHOTOS];
