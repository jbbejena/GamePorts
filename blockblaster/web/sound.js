// Block Blaster's sound effects: recorded files from the original, played through Web Audio. Other modules call
// play(name) with a short name from SOUNDS below. The effects switch (setEffects) silences them at once.
// Music is three loops (menus, a level, a Very Hard level). setScene(name) asks for one: it crossfades in over the one
// before, each loop's last seconds fade into its own start so it never stops, setDuck makes it quieter under panels,
// and the music switch (setMusic) stops it at once and keeps any from starting while it is off.
// Every call that gets past the rate limits is written to `played` as [name, ms, muted], even with the sound off, so a
// check can read what the page tried to play without listening. A loop being asked for is written as
// [music_<name>, ms, false].
// Each entry: `files` (one is picked each time, never the one before), `together` (play every file at once), `big`
// (files for play(name, {big: true}), e.g. a larger cube), `volume`, `gap` (shortest wait in ms between two plays of
// the name) and `voices` (most copies of the name sounding at once).
const SOUNDS = {
  tap: { files: ["pig2_trimmed"], volume: 0.8, gap: 40, voices: 3 },
  hop: { files: ["pig3_trimmed"], volume: 0.6, gap: 40, voices: 3 },
  slot: { files: ["first_settle2_trimmed"], volume: 0.7, gap: 60, voices: 3 },
  pop: { files: ["pop2"], volume: 0.7, gap: 60, voices: 2 },
  vanish: { files: ["disapper_trimmed"], volume: 0.7, gap: 80, voices: 3 },
  // 46 shots a second would pile up, so these are thinned to a patter
  shot: { files: ["shoot_whoosh_04_trimmed"], volume: 0.3, gap: 90, voices: 3 },
  hit: { files: ["shoot_hit", "hit_05"], volume: 0.35, gap: 70, voices: 3 },
  metal: { files: ["metal_hit"], volume: 0.5, gap: 70, voices: 3 },
  break: {
    files: ["grid_breaking_1", "grid_breaking_2"],
    big: ["grid_breaking_6", "grid_breaking_7"],
    volume: 0.5,
    gap: 60,
    voices: 4,
  },
  clear: { files: ["final_break02", "stagebreak3"], together: true, volume: 0.8, gap: 500, voices: 1 },
  win: { files: ["game_success", "endgame_win"], together: true, volume: 0.6, gap: 1000, voices: 1 },
  fail: { files: ["game_over"], volume: 0.7, gap: 1000, voices: 1 },
  retry: { files: ["try_again"], volume: 0.7, gap: 500, voices: 1 },
  click: { files: ["click"], volume: 0.5, gap: 80, voices: 2 },
  button: { files: ["button_tap_pop", "tap_cartoon_pop_mouth_002"], volume: 0.8, gap: 60, voices: 2 },
  count: { files: ["coin_counting"], volume: 0.5, gap: 70, voices: 3 },
  coins: { files: ["coins_collect_several_at_once_001"], volume: 0.7, gap: 500, voices: 1 },
  appear: { files: ["booster_appear"], volume: 0.7, gap: 500, voices: 1 },
  unlock: { files: ["unlock"], volume: 0.8, gap: 500, voices: 1 },
  purchase: { files: ["purchase"], volume: 0.8, gap: 500, voices: 1 },
  tray: { files: ["raise_03_trimmed"], volume: 0.8, gap: 200, voices: 1 },
  revive: { files: ["sparkle1"], volume: 0.7, gap: 500, voices: 1 },
  reveal: { files: ["pop_sparkle"], volume: 0.6, gap: 100, voices: 2 },
  shuffle: { files: ["whoosh2_gem"], volume: 0.7, gap: 300, voices: 1 },
  bomb: { files: ["bomb"], volume: 0.9, gap: 300, voices: 1 },
  volley: { files: ["booster_shooting"], volume: 0.8, gap: 500, voices: 1 },
  select: { files: ["selection"], volume: 0.7, gap: 100, voices: 1 },
  pick: { files: ["pop_sparkle"], volume: 0.7, gap: 100, voices: 1 },
  lock_open: { files: ["opening_metal_slide2"], volume: 0.8, gap: 120, voices: 2 },
  gate_pull: { files: ["pull_01", "pull_02"], volume: 0.35, gap: 90, voices: 2 },
  gate_open: { files: ["pulley_01_trimmed"], volume: 0.7, gap: 200, voices: 2 },
  snake_pull: { files: ["ivy_whoosh_close"], volume: 0.35, gap: 120, voices: 2 },
  snake_gone: { files: ["ivy_whoosh_open"], volume: 0.6, gap: 200, voices: 2 },
  dragon_pull: { files: ["ivy_whoosh_close"], volume: 0.35, gap: 120, voices: 2 },
  dragon_gone: { files: ["ivy_whoosh_open"], volume: 0.6, gap: 200, voices: 2 },
  egg_change: { files: ["egg_break_change_trimmed"], volume: 0.55, gap: 70, voices: 3 },
  egg_break: { files: ["egg_full_break_trimmed"], volume: 0.7, gap: 60, voices: 3 },
  pipe_out: { files: ["tap_cartoon_pop_mouth_009_trimmed"], volume: 0.7, gap: 70, voices: 3 },
  ice_hit: { files: ["ice_break_14765_trimmed", "ice_break_14765_trimmed_trimmed"], volume: 0.35, gap: 120, voices: 2 },
  ice_shatter: { files: ["ice_shatter_trimmed", "ice_shatter_3"], volume: 0.8, gap: 150, voices: 2 },
  hammer_swing: { files: ["sport_baseball_bat_foam_swipe_001"], volume: 0.6, gap: 80, voices: 3 },
  hammer_hit: { files: ["industrial_impacts_hammer_wood_fixed_beam_002_trimmed_trimmed"], volume: 0.7, gap: 80, voices: 3 },
  wood_hit: { files: ["wood_stage1"], volume: 0.6, gap: 80, voices: 2 },
  wood_break: { files: ["wood_stage2"], volume: 0.8, gap: 150, voices: 2 },
  door_hit: { files: ["pm_fssf_door_mid_3", "pm_fssf_door_mid_7"], volume: 0.35, gap: 90, voices: 3 },
  door_open: { files: ["opening_metal_slide2", "door_close"], volume: 0.8, gap: 200, voices: 2 },
  biscuit_hit: { files: ["biscuit_hit_no_click"], volume: 0.45, gap: 70, voices: 3 },
  biscuit_break: { files: ["berry_explode_2"], volume: 0.7, gap: 120, voices: 2 },
  // The rocket's sounds as its prefab pairs them: the rear (start) part's hit, the front (end) part's hit, the merge,
  // the lift-off and the boost (Split Object Feature's AudioFx lists; hits at most once every 0.04 s)
  rocket_rear_hit: { files: ["rocket_hit_fire"], volume: 0.4, gap: 40, voices: 3 },
  rocket_front_hit: { files: ["rocket_hit"], volume: 0.4, gap: 40, voices: 3 },
  rocket_merge: { files: ["rocket_merge"], volume: 0.8, gap: 200, voices: 2 },
  rocket_lift_off: { files: ["rocket_lift_off_trimmed"], volume: 0.9, gap: 200, voices: 2 },
  rocket_boost: { files: ["rocket_boost"], volume: 0.5, gap: 200, voices: 2 },
  // The U.F.O.'s sounds as its prefabs pair them: a cat settling into its cup, the dome opening and closing, the launch
  ufo_seat: {
    files: ["zapsplat_vehicles_car_seatbelt_safety_belt_click_lock_into_place_003_83839_trimmed"],
    volume: 0.8,
    gap: 60,
    voices: 3,
  },
  ufo_open: { files: ["pm_fssf_door_mid_3"], volume: 0.3, gap: 40, voices: 2 },
  ufo_close: { files: ["pm_fssf_door_mid_7"], volume: 0.3, gap: 40, voices: 2 },
  ufo_launch: {
    files: ["zapsplat_science_fiction_spacecraft_fighter_zoom_by_ultra_fast_004_84010"],
    volume: 0.7,
    gap: 200,
    voices: 2,
  },
  // The pumpkin's sounds as its prefab pairs them: a hit, a crack as it wears down, its death, and the next one emerging
  pumpkin_hit: { files: ["pumpkin_hit_trimmed"], volume: 0.5, gap: 70, voices: 3 },
  pumpkin_crack: { files: ["pumpkin_break1_trimmed", "pumpkin_break3_trimmed"], volume: 0.6, gap: 120, voices: 2 },
  pumpkin_death: { files: ["pumpkin_death_trimmed"], volume: 0.8, gap: 150, voices: 2 },
  pumpkin_emerge: {
    files: ["pumpkin_emerge_start_trimmed", "pumpkin_emerge_trimmed"],
    together: true,
    volume: 0.6,
    gap: 150,
    voices: 2,
  },
  // The jelly beans' sounds as their prefabs pair them: the box rings a hit, each bean popping rattles
  bean_thock: { files: ["bean_hit_thock"], volume: 0.5, gap: 70, voices: 3 },
  bean_pop: { files: ["beans6"], volume: 0.4, gap: 50, voices: 4 },
  // The chain's sounds as its prefab pairs them: the length changing as a member moves up, and the break
  shackles_stretch: { files: ["shackles_shrink_grow_2"], volume: 0.8, gap: 50, voices: 2 },
  shackles_break: { files: ["shackles_break_trimmed"], volume: 0.7, gap: 50, voices: 2 },
  // The curtain's sounds as its prefabs pair them: a cube landing in it, a block pulled up (its two pulls together),
  // and the health stack's chain moving on to the next block
  curtain_hit: { files: ["curtain_hit"], volume: 0.5, gap: 70, voices: 3 },
  curtain_pull: { files: ["curtain_pull_1", "curtain_pull_2"], together: true, volume: 0.7, gap: 150, voices: 2 },
  curtain_chain: { files: ["curtain_chain_2"], volume: 0.6, gap: 150, voices: 2 },
  // The bull totem's sounds as its prefab names them: becoming active, and breaking
  totem_appears: { files: ["totem_appears_trimmed"], volume: 0.7, gap: 150, voices: 2 },
  totem_destroy: { files: ["totem_destroy_trimmed"], volume: 0.8, gap: 150, voices: 2 },
  // The music toy: each note breaks with one of the original's eight note clips (MusicToyNoteMappingSo gives each color
  // its note) and the whole toy falling in on itself rings its collapse
  note_1: { files: ["x_1_trimmed"], volume: 0.7, gap: 40, voices: 3 },
  note_2: { files: ["x_2_trimmed"], volume: 0.7, gap: 40, voices: 3 },
  note_3: { files: ["x_3_trimmed"], volume: 0.7, gap: 40, voices: 3 },
  note_4: { files: ["x_4_trimmed"], volume: 0.7, gap: 40, voices: 3 },
  note_5: { files: ["x_5_trimmed"], volume: 0.7, gap: 40, voices: 3 },
  note_6: { files: ["x_6_trimmed"], volume: 0.7, gap: 40, voices: 3 },
  note_7: { files: ["x_7_trimmed"], volume: 0.7, gap: 40, voices: 3 },
  note_8: { files: ["x_8_trimmed"], volume: 0.7, gap: 40, voices: 3 },
  toy_collapse: { files: ["music_toy_collapse"], volume: 0.8, gap: 150, voices: 2 },
  // The crossbow: its base and its bow rising at the level's start (the two appear clips together), and an arrow's
  // whoosh as it fires (one of the two clips)
  crossbow_appear: {
    files: ["crossbow_appear_base", "crossbow_appear_crossbow"],
    together: true,
    volume: 0.6,
    gap: 300,
    voices: 1,
  },
  crossbow_fire: { files: ["arrow_whoosh_1_trimmed", "arrow_whoosh_3_trimmed"], volume: 0.7, gap: 60, voices: 3 },
  // The scissors gate closing a step, as its prefab pairs it
  gate_close: { files: ["accordion_close_trimmed"], volume: 0.7, gap: 100, voices: 2 },
  // The cage of a Cat Cell opening (the sliding metal of the keys' locks)
  cage_open: { files: ["opening_metal_slide2"], volume: 0.8, gap: 120, voices: 2 },
  // The slot cage's sounds as its prefabs pair them: a cube landing in it, and the hatch breaking away
  cage_hit: { files: ["zapsplat_household_vacuum_cleaner_set_trimmed"], volume: 0.4, gap: 70, voices: 3 },
  cage_destroy: { files: ["metal_hit", "unicorn_exit_trimmed"], together: true, volume: 0.7, gap: 150, voices: 2 },
  // The Pigroshka's sounds as its prefabs pair them: a hit, a layer opening (the two clips together) and the next doll
  // settling after it hops out
  doll_hit: { files: ["matryoshka_open2_trimmed_hit"], volume: 0.5, gap: 70, voices: 3 },
  doll_open: { files: ["matryoshka_open1_trimmed", "pop2"], together: true, volume: 0.7, gap: 150, voices: 2 },
  doll_emerge: { files: ["first_settle2_trimmed"], volume: 0.6, gap: 150, voices: 2 },
  // The Astro Pig's sounds as its prefabs pair them: the helmet closing, the nose opening, the cat settling into the
  // cockpit, the wind-up and the lift-off
  helmet_close: { files: ["pm_fssf_door_mid_7"], volume: 0.4, gap: 60, voices: 2 },
  ship_open: { files: ["rocket_opening1"], volume: 0.5, gap: 100, voices: 2 },
  ship_place: {
    files: ["zapsplat_vehicles_car_seatbelt_safety_belt_click_lock_into_place_003_83839_trimmed"],
    volume: 0.8,
    gap: 100,
    voices: 2,
  },
  ship_wind: { files: ["rocket_launch_windup_1"], volume: 0.6, gap: 200, voices: 2 },
  ship_launch: { files: ["rocket_launch1"], volume: 0.7, gap: 200, voices: 2 },
  // Conveyor Wall (ConveyorDoorFxModel's players): a pig passes, a pig is thrown off, the block lowers and rises,
  // the wall breaks
  wall_pass: { files: ["pass_1_trimmed"], volume: 0.7, gap: 80, voices: 2 },
  wall_reject: { files: ["hit_05"], volume: 0.8, gap: 80, voices: 2 },
  wall_down: { files: ["raise_03_trimmed"], volume: 0.4, gap: 120, voices: 2 },
  wall_up: { files: ["raise_05_trimmed"], volume: 0.4, gap: 120, voices: 2 },
  wall_open: { files: ["disapper_trimmed"], volume: 0.8, gap: 150, voices: 2 },
  // The Pixel Mixer's sounds from the clips ASSETS.md lists for it: a cube sucked in, a hose block sent away, the machine
  // going
  mixer_hit: { files: ["zapsplat_household_vacuum_cleaner_set_trimmed"], volume: 0.4, gap: 70, voices: 3 },
  mixer_release: {
    files: ["zapsplat_cartoon_bird_poop_hit_surface_splat_squelch_008_74097_trimmed"],
    volume: 0.5,
    gap: 60,
    voices: 3,
  },
  mixer_done: { files: ["disapper_trimmed"], volume: 0.8, gap: 150, voices: 2 },
  unicorn_ready: { files: ["unicorn_button_ready"], volume: 0.8, gap: 500, voices: 1 },
  unicorn_exit: { files: ["unicorn_exit_trimmed"], volume: 0.8, gap: 500, voices: 1 },
};
const EFFECTS_VOLUME = 0.8;
// The loops, the music's volume, the share of it left under a panel, and the seconds a loop takes to fade into the next
// song or into its own start
const SONGS = { menu: "music/menu.ogg", level: "music/level.ogg", hard: "music/hard.ogg" };
const MUSIC_VOLUME = 0.3;
const MUSIC_DUCKED = 0.4;
const CROSSFADE = 2;
const DUCK_FADE = 0.4;
// Switching the music off ramps it down over this many seconds, which is at once to the ear but with no click
const OFF_FADE = 0.05;
// The record keeps this many of the latest entries
const PLAYED_LIMIT = 400;

// [name, ms since the page opened, muted]
export const played = [];

const audio = {
  ctx: null,
  out: null,
  effects: true,
  music: true,
  musicOut: null,
  // The loop wanted now, the one playing ({name, voices, timer}), the decoded loops and the loops being fetched
  scene: null,
  track: null,
  songs: new Map(),
  loading: new Map(),
  ducked: false,
  buffers: new Map(),
  last: new Map(),
  lastFile: new Map(),
  voices: new Map(),
};

function filesOf(entry) {
  return [...entry.files, ...(entry.big || [])];
}

async function loadFile(file) {
  try {
    const response = await fetch(`sounds/${file}.ogg`);
    if (!response.ok) {
      throw new Error(`The sound file answered ${response.status}`);
    }
    audio.buffers.set(file, await audio.ctx.decodeAudioData(await response.arrayBuffer()));
  } catch (e) {
    console.warn(`Block Blaster: couldn't load the ${file} sound`, e);
  }
}

// Browsers only allow sound after the player touches the page, so the sound starts then
function unlock() {
  if (!audio.ctx) {
    try {
      audio.ctx = new AudioContext();
    } catch (e) {
      console.warn("Block Blaster: couldn't start the sound", e);
      return;
    }
    audio.out = audio.ctx.createGain();
    audio.out.gain.value = audio.effects ? EFFECTS_VOLUME : 0;
    audio.out.connect(audio.ctx.destination);
    audio.musicOut = audio.ctx.createGain();
    audio.musicOut.gain.value = musicLevel();
    audio.musicOut.connect(audio.ctx.destination);
    const files = new Set(Object.values(SOUNDS).flatMap(filesOf));
    files.forEach(loadFile);
  }
  update();
  if (audio.scene && audio.music && !audio.track) {
    startSong(audio.scene);
  }
}

// The sound pauses while the page is hidden
async function update() {
  const { ctx } = audio;
  if (!ctx || ctx.state === "closed") {
    return;
  }
  try {
    await (document.hidden ? ctx.suspend() : ctx.resume());
  } catch (e) {
    console.warn("Block Blaster: couldn't start or pause the sound", e);
  }
}

export function initSound() {
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pagehide", close);
}

export function setEffects(on) {
  audio.effects = on;
  if (audio.out) {
    const now = audio.ctx.currentTime;
    audio.out.gain.cancelScheduledValues(now);
    audio.out.gain.setValueAtTime(on ? EFFECTS_VOLUME : 0, now);
  }
}

// The music switch: off stops the loop at once and keeps any from starting, on starts the one wanted
export function setMusic(on) {
  audio.music = on;
  if (on) {
    requestSong();
    fadeMusic(DUCK_FADE);
  } else {
    endTrack(OFF_FADE);
    fadeMusic(OFF_FADE);
  }
}

export function effectsOn() {
  return audio.effects;
}

export function musicOn() {
  return audio.music;
}

function pick(files, name) {
  if (files.length === 1) {
    return files[0];
  }
  const before = audio.lastFile.get(name);
  const others = files.filter((file) => file !== before);
  const file = others[Math.floor(Math.random() * others.length)];
  audio.lastFile.set(name, file);
  return file;
}

function start(file, name, volume) {
  const buffer = audio.buffers.get(file);
  if (!buffer || !audio.ctx || audio.ctx.state !== "running") {
    return;
  }
  const source = audio.ctx.createBufferSource();
  source.buffer = buffer;
  const gain = audio.ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(audio.out);
  audio.voices.set(name, (audio.voices.get(name) || 0) + 1);
  source.addEventListener("ended", () => audio.voices.set(name, audio.voices.get(name) - 1));
  source.start();
}

// Play a sound by its short name. `options.big` picks the larger variant where the sound has one; `options.volume`
// scales it. Plays closer together than the sound's gap, or past its voice limit, are dropped and never recorded
export function play(name, options = {}) {
  const entry = SOUNDS[name];
  if (!entry) {
    throw new Error(`Block Blaster has no sound called ${name}`);
  }
  const now = performance.now();
  if (now - (audio.last.get(name) ?? -Infinity) < entry.gap || (audio.voices.get(name) || 0) >= entry.voices) {
    return;
  }
  audio.last.set(name, now);
  played.push([name, Math.round(now), !audio.effects]);
  if (played.length > PLAYED_LIMIT) {
    played.shift();
  }
  if (!audio.effects) {
    return;
  }
  const volume = entry.volume * (options.volume ?? 1);
  const files = options.big && entry.big ? entry.big : entry.files;
  if (entry.together) {
    files.forEach((file) => start(file, name, volume));
  } else {
    start(pick(files, name), name, volume);
  }
}

// ---------- Music ----------

function musicLevel() {
  if (!audio.music) {
    return 0;
  }
  return MUSIC_VOLUME * (audio.ducked ? MUSIC_DUCKED : 1);
}

function fadeMusic(seconds) {
  if (!audio.musicOut) {
    return;
  }
  const now = audio.ctx.currentTime;
  const gain = audio.musicOut.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(musicLevel(), now + seconds);
}

// Ask for the loop of a screen ("menu", "level" or "hard"). Asking for the one already wanted changes nothing
export function setScene(name) {
  if (!SONGS[name]) {
    throw new Error(`Block Blaster has no music called ${name}`);
  }
  if (audio.scene === name) {
    return;
  }
  audio.scene = name;
  requestSong();
}

// Start the wanted loop when the music is on: written to the record at once, played as soon as the page may make sound
function requestSong() {
  const name = audio.scene;
  if (!name || !audio.music || audio.track?.name === name) {
    return;
  }
  played.push([`music_${name}`, Math.round(performance.now()), false]);
  if (played.length > PLAYED_LIMIT) {
    played.shift();
  }
  if (audio.ctx) {
    startSong(name);
  }
}

// What a check reads: the loop wanted, the loop playing, whether panels have it quiet, the switch, and its volume now
export function musicState() {
  return {
    on: audio.music,
    scene: audio.scene,
    playing: audio.track ? audio.track.name : null,
    ducked: audio.ducked,
    volume: audio.musicOut ? Number(audio.musicOut.gain.value.toFixed(3)) : null,
    context: audio.ctx ? audio.ctx.state : null,
  };
}

// Panels make the music quieter while they stand
export function setDuck(on) {
  if (audio.ducked === on) {
    return;
  }
  audio.ducked = on;
  fadeMusic(DUCK_FADE);
}

function loadSong(name) {
  if (!audio.loading.has(name)) {
    const loading = fetch(SONGS[name])
      .then((response) => {
        if (!response.ok) {
          throw new Error(`The music file answered ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((data) => audio.ctx.decodeAudioData(data));
    // A failed download is tried again next time
    loading.catch(() => audio.loading.delete(name));
    audio.loading.set(name, loading);
  }
  return audio.loading.get(name);
}

// The new loop loads first, so the old one keeps playing until the two can crossfade
async function startSong(name) {
  try {
    if (!audio.songs.has(name)) {
      audio.songs.set(name, await loadSong(name));
    }
  } catch (e) {
    console.warn("Block Blaster: couldn't load the music", e);
    return;
  }
  // The screen or the switch may have changed while it loaded
  if (audio.scene !== name || !audio.music || !audio.ctx || audio.track?.name === name) {
    return;
  }
  endTrack(CROSSFADE);
  const track = { name, voices: [], timer: null };
  audio.track = track;
  playCopy(track, audio.ctx.currentTime);
}

// One copy of the loop, fading in while the copy before it fades out. The next copy is booked just before it starts
function playCopy(track, when) {
  const song = audio.songs.get(track.name);
  const source = audio.ctx.createBufferSource();
  source.buffer = song;
  const gain = audio.ctx.createGain();
  const end = when + song.duration;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(1, when + CROSSFADE);
  gain.gain.setValueAtTime(1, end - CROSSFADE);
  gain.gain.linearRampToValueAtTime(0, end);
  source.connect(gain).connect(audio.musicOut);
  source.start(when);
  source.stop(end);
  const voice = { source, gain };
  track.voices.push(voice);
  source.addEventListener("ended", () => {
    track.voices = track.voices.filter((other) => other !== voice);
  });
  const next = end - CROSSFADE;
  track.timer = setTimeout(
    () => {
      if (audio.track === track && audio.ctx) {
        playCopy(track, Math.max(next, audio.ctx.currentTime));
      }
    },
    Math.max(0, (next - audio.ctx.currentTime - 1) * 1000),
  );
}

// The playing loop fades out over `seconds` and no more copies are booked
function endTrack(seconds) {
  const track = audio.track;
  audio.track = null;
  if (!track || !audio.ctx) {
    return;
  }
  clearTimeout(track.timer);
  const now = audio.ctx.currentTime;
  for (const { source, gain } of track.voices) {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + seconds);
    source.stop(now + seconds + 0.05);
  }
}

// The page is going: the music stops, and the sound is given back
function close() {
  endTrack(0);
  const { ctx } = audio;
  if (ctx && ctx.state !== "closed") {
    ctx.close().catch((e) => console.warn("Block Blaster: couldn't close the sound", e));
  }
  audio.ctx = null;
  audio.out = null;
  audio.musicOut = null;
}
