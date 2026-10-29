// Only durable campaign fields travel in browser backups or portable files.
export const SAVE_FIELDS = ["side", "difficulty", "mission", "xp", "level", "points", "upgrades", "career", "finished"];
export const campaignData = (save) => Object.fromEntries(SAVE_FIELDS.map(key => [key, save[key]]));
export const campaignFile = (save) => ({ format: "warfare1944.campaign", version: 1, campaign: campaignData(save) });
