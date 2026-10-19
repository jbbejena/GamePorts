// The highest-level table: a button on the level path opens a panel with this server's top players by the highest level
// they have reached, and the player's own row under them when they are not among the top. The bot builds the rows
// (common/table.py); outside a server it answers with its own words, which the panel shows instead.
import { cut, makeFace } from "./whoshere.js";

// Names are cut at this many characters, with an ellipsis as the last one
const NAME_MOST = 14;
const ART = "art/ui/";
const LOADING = "Loading";
const FAILED = "The table couldn't be read. Try again in a moment.";

const panel = { actions: null, open: false, token: 0 };

function $(id) {
  return document.getElementById(id);
}

function numberText(n) {
  return n.toLocaleString("en-US");
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// The first place wears the gold medal; the others show their number
function rankNode(rank) {
  if (rank === 1) {
    const medal = make("span", "table-rank medal");
    const picture = make("img", "");
    picture.src = `${ART}Icon_Medal_Gold.png`;
    picture.alt = "1";
    medal.append(picture);
    return medal;
  }
  return make("span", "table-rank", String(rank));
}

function levelNode(entry) {
  const node = make("span", "table-level");
  if (entry.cleared) {
    const cup = make("img", "table-cup");
    cup.src = `${ART}Icon_Trophy.png`;
    cup.alt = "";
    node.append(cup, make("span", "", "Cleared"));
  } else {
    node.textContent = `Level ${numberText(entry.level)}`;
  }
  return node;
}

function makeRow(entry) {
  const row = make("li", "table-row");
  row.dataset.rank = String(entry.rank);
  row.toggleAttribute("data-you", entry.you);
  const name = make("span", "table-name", cut(entry.name, NAME_MOST));
  name.title = entry.name;
  if (entry.you) {
    row.setAttribute("aria-current", "true");
    name.title = `${entry.name} (you)`;
  }
  row.append(rankNode(entry.rank), makeFace({ name: entry.name, avatar: entry.avatar }, "table-face"), name, levelNode(entry));
  return row;
}

// The top rows in the list, and the player's own row under it when it is not among them, with a gap mark between
function drawRows(answer) {
  $("table-list").replaceChildren(...answer.rows.map(makeRow));
  const own = answer.you ? [makeRow(answer.you)] : [];
  if (answer.you && answer.you.rank > answer.rows.length + 1) {
    own.unshift(make("li", "table-gap", "…"));
  }
  $("table-own").replaceChildren(...own);
}

function note(text) {
  $("table-note").textContent = text;
}

// Open the panel and ask the bot for the rows. A second press while it waits asks again
export async function openTable() {
  if (!panel.open) {
    panel.open = true;
    $("table").hidden = false;
    $("table-close").focus({ preventScroll: true });
  }
  panel.token += 1;
  const token = panel.token;
  $("table-list").replaceChildren();
  $("table-own").replaceChildren();
  note(LOADING);
  let answer;
  try {
    answer = await panel.actions.table();
  } catch (e) {
    console.warn("Block Blaster: couldn't read the highest-level table", e);
    answer = { error: FAILED };
  }
  if (!panel.open || token !== panel.token) {
    return;
  }
  if (answer.error) {
    note(answer.error);
    return;
  }
  note("");
  drawRows(answer);
}

export function closeTable() {
  if (!panel.open) {
    return;
  }
  panel.open = false;
  panel.token += 1;
  $("table").hidden = true;
}

// True while the table stands
export function tableOpen() {
  return panel.open;
}

// `actions.table()` asks the bot for the rows
export function initTable(actions) {
  panel.actions = actions;
  $("table-open").addEventListener("click", openTable);
  $("table-close").addEventListener("click", closeTable);
  $("table").addEventListener("click", (event) => event.target === $("table") && closeTable());
  document.addEventListener("keydown", (event) => event.key === "Escape" && closeTable());
}
