import { difficultyLevel } from "./difficulty.ts";
import { Game, type LevelResult } from "./game.ts";
import { Hangar } from "./hangar.ts";
import { LEVELS } from "./levels.ts";
import { Menu, type ResultAction } from "./menu.ts";
import { Connection, type CloseReason } from "./net/connection.ts";
import { invitedTo, OnlineMenu } from "./net/online-menu.ts";
import { RECONNECT_GRACE, type ClientMessage, type MatchResult, type RoomInfo, type ServerMessage } from "./net/protocol.ts";
import { Leaderboard, score } from "./scores.ts";
import { effectsVolume, lastRoomSetup, setEffectsVolume, setLastRoomSetup, setShipLook, shipLook } from "./settings.ts";

const game = new Game(document.querySelector<HTMLElement>("#game")!);
const leaderboard = new Leaderboard();
const menu = new Menu(LEVELS, leaderboard, effectsVolume());
const online = new OnlineMenu(LEVELS);
const hangar = new Hangar();

function play(level: number): void {
	menu.hideResult();
	document.body.classList.add("playing");
	game.start(level);
}

/** From a level played alone, to the screen for picking the next one */
function backToLevels(level: number): void {
	game.stop();
	document.body.classList.remove("playing");
	menu.showSinglePlayer(level);
}

function pause(): void {
	/* online with nobody else but bots, the level stands still for you, as it does alone */
	const alone = (room?.players.every(({ id, bot }) => id == me || bot) ?? false);
	game.pause(alone);
	if (game.online) { send({ type: "pause", paused: true }); }
	document.body.classList.remove("playing"); /* show the cursor for the buttons */
	menu.showPause();
}

function resume(): void {
	menu.hidePause();
	document.body.classList.add("playing");
	if (game.online) { send({ type: "pause", paused: false }); }
	game.resume();
}

hangar.onChange = look => {
	setShipLook(look);
	send({ type: "look", look });
};
online.onShip = () => {
	online.hide();
	hangar.open(shipLook(), () => { if (room) { showRoom(room); } });
};

menu.onStart = play;
menu.onResume = resume;
menu.onLeave = () => (game.online ? leaveRoom() : backToLevels(game.level ?? 0));
menu.onVolume = volume => {
	setEffectsVolume(volume);
	game.setEffectsVolume(volume);
};
menu.onVolumeSet = () => game.playTestSound();

game.onOutcome = (result: LevelResult) => {
	document.body.classList.remove("playing"); /* show the cursor for the buttons */
	if (result.match) {
		showMatchResult(result.match);
		return;
	}

	const { level, outcome, podsLeft, podsTotal, destroyed, shields, difficulty } = result;
	const name = LEVELS[level].name;
	const points = score({ won: outcome == "won", podsLeft, destroyed, shields, difficulty });
	/* co-op runs have boards of their own */
	const board = (result.online ? `${name} · co-op` : name);
	const details = { score: points, level: board, entry: leaderboard.add(board, points.total, difficulty) };

	const next = level + 1;
	const last = (next < LEVELS.length ? "" : " That was the last level.");
	const [title, text] = {
		"won": [`Level ${level + 1} complete`, `Pods saved: ${podsLeft} of ${podsTotal}.${last}`],
		"pods-lost": ["All pods lost", `Level ${level + 1}: ${name}`],
		"match-over": ["", ""], /* shown above */
	}[outcome];

	if (result.online) {
		const host = room?.host == me;
		const actions: ResultAction[] = (host
			? [
				...(outcome == "won"
					? [{ label: (next < LEVELS.length ? "Next level" : "Play again"), action: () => send({ type: "start", level: next % LEVELS.length }) }]
					: [{ label: "Retry", action: () => send({ type: "start", level }) }]),
				{ label: "Lobby", action: () => send({ type: "lobby" }) },
			]
			: [{ label: "Leave", action: () => leaveRoom() }]);
		menu.showResult(title, host ? text : `${text} The host picks what's next.`, actions, details);
		return;
	}

	const toMenu: ResultAction = { label: "Menu", action: () => backToLevels(level) };
	const proceed: ResultAction = (outcome == "won"
		? (next < LEVELS.length ? { label: "Next level", action: () => play(next) } : { label: "Play again", action: () => play(0) })
		: { label: "Retry", action: () => play(level) });
	menu.showResult(title, text, [proceed, toMenu], details);
};

/** Deathmatch over: who won, and for the host what's next */
function showMatchResult({ reason, standings }: MatchResult): void {
	const winners = standings.filter(({ frags }) => frags == standings[0].frags);
	const title = (winners.length > 1 ? "Draw" : winners[0].id == me ? "You win" : `${winners[0].name} wins`);
	const text = (reason == "frags" ? "Frag limit reached." : "Time is up.");
	if (room?.host == me) {
		menu.showStandings(title, text, [
			{ label: "Rematch", action: () => send({ type: "start" }) },
			{ label: "Lobby", action: () => send({ type: "lobby" }) },
		], standings, me);
	} else {
		menu.showStandings(title, `${text} The host picks what's next.`, [{ label: "Leave", action: () => leaveRoom() }], standings, me);
	}
}

/* Online play */

/** Where this tab keeps its resume token: a reload goes back into the room; another tab is another pilot */
const RESUME_KEY = "netwars.resume";

let connection: Connection | null = null;
/** This player's id in the room, and the room as last heard of */
let me: number | null = null;
let room: RoomInfo | null = null;
/** Takes this player's place in the room back on a new connection; null when not in a room */
let token: string | null = null;
/** When the connection to the room dropped (ms); null while connected */
let lostAt: number | null = null;
/** A resume was sent: the server answers with a welcome, or an error when the place is gone */
let resuming = false;

const reconnecting = document.getElementById("reconnecting")!;
document.getElementById("reconnecting-leave")!.onclick = () => leaveRoom();

const send = (message: ClientMessage) => connection?.send(message);

menu.onMultiplayer = () => online.showJoin(leaderboard.lastName);
online.onBack = () => {
	forgetRoom(); /* not in a room, but maybe connected */
	online.hide();
	menu.showTitle();
};
online.onCreate = name => {
	/* what the host picked last time, unless its level is no more */
	const last = lastRoomSetup();
	const setup = (last && LEVELS[last.level] ? last : null);
	const create: ClientMessage = { type: "create", name, level: setup?.level ?? menu.selectedLevel, difficulty: setup?.difficulty ?? difficultyLevel(), look: shipLook() };
	void connectThen(name, create, ...(setup ? [{ type: "setup", ...setup } as const] : []));
};
online.onJoin = (code, name) => connectThen(name, { type: "join", code, name, look: shipLook() });
online.onSetup = setup => {
	send({ type: "setup", ...setup });
	setLastRoomSetup(setup);
};
online.onStart = () => send({ type: "start" });
online.onLeave = () => leaveRoom();
online.onAddBot = () => send({ type: "addBot" });
online.onRemoveBot = id => send({ type: "removeBot", id });

/** Connect (unless connected) and send the first messages */
async function connectThen(name: string, ...messages: ClientMessage[]): Promise<void> {
	game.unlockAudio(); /* a click: sound may start now, ready for the level the host starts later */
	leaderboard.remember(name);
	online.setBusy(true);
	if (!connection) {
		try {
			attach(await Connection.open());
		} catch {
			online.showError("Cannot reach the game server. Is it running?");
			return;
		}
	}
	for (const message of messages) { connection!.send(message); }
}

function attach(opened: Connection): void {
	connection = opened;
	opened.onMessage = receive;
	opened.onClose = lost;
}

function remember(next: string | null): void {
	token = next;
	try {
		if (next) { sessionStorage.setItem(RESUME_KEY, next); } else { sessionStorage.removeItem(RESUME_KEY); }
	} catch { /* no storage: a reload starts afresh */ }
}

function savedToken(): string | null {
	try {
		return sessionStorage.getItem(RESUME_KEY);
	} catch {
		return null;
	}
}

/** The connection ended: in a room, try to get back in; the level (if any) goes on meanwhile */
function lost(reason: CloseReason): void {
	connection = null;
	resuming = false;
	if (reason == "replaced") {
		disconnected("You are in this room in another tab now.");
		return;
	}
	if (!token) {
		disconnected("Lost the connection to the game server.");
		return;
	}
	lostAt ??= performance.now();
	showReconnecting("Connection lost. Reconnecting…");
	void reconnect();
}

/** Tries for RECONNECT_GRACE, the time the server keeps this player's place: at once, then less and less often */
async function reconnect(): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		if (attempt) { await new Promise(done => setTimeout(done, Math.min(5000, 250 * 2 ** attempt))); }
		if (!token || connection) { return; } /* left the room, or back in already */
		if (performance.now() - lostAt! > RECONNECT_GRACE * 1000) {
			disconnected("Lost the connection to the game server.");
			return;
		}

		let opened: Connection;
		try {
			opened = await Connection.open();
		} catch {
			continue;
		}
		if (!token || connection) {
			opened.close();
			return;
		}
		attach(opened);
		resuming = true;
		opened.send({ type: "resume", token });
		return;
	}
}

function showReconnecting(text: string): void {
	reconnecting.querySelector("span")!.textContent = text;
	reconnecting.hidden = false;
}

function receive(message: ServerMessage): void {
	switch (message.type) {
		case "welcome":
			me = message.you;
			remember(message.token);
			lostAt = null;
			resuming = false;
			reconnecting.hidden = true;
			showRoom(message.room);
		break;

		case "room": showRoom(message.room); break;

		case "error":
			if (resuming) {
				disconnected(message.message);
			} else {
				online.showError(message.message);
			}
		break;

		case "start":
			if (game.onlineRun == message.run) { break; } /* back after a dropped connection: the level went on */
			menu.hideAll();
			online.hide();
			hangar.hide();
			document.body.classList.add("playing");
			game.startOnline(send, message, me!);
		break;

		case "snapshot": game.receive(message); break;
		case "outcome": game.endOnline(message); break;
	}
}

/** The lobby, unless a level is being played or its result is showing */
function showRoom(info: RoomInfo): void {
	room = info;
	game.pilots = info.players;
	if (hangar.visible || info.state == "playing" || (info.state == "over" && game.online)) { return; }

	if (game.online) { game.stop(); } /* back from a level */
	document.body.classList.remove("playing");
	menu.hideAll();
	online.showLobby(info, me!);
}

function leaveRoom(): void {
	send({ type: "leave" });
	toMultiplayer();
}

/** Out of the room for good (no way back), or never got back in */
function disconnected(why: string): void {
	toMultiplayer();
	online.showError(why);
}

/** Out of any room, to the screen for creating or joining one */
function toMultiplayer(): void {
	forgetRoom();
	hangar.hide();
	game.stop();
	document.body.classList.remove("playing");
	menu.hideAll();
	online.showJoin(leaderboard.lastName);
}

function forgetRoom(): void {
	connection?.close();
	connection = null;
	me = null;
	room = null;
	remember(null);
	lostAt = null;
	resuming = false;
	reconnecting.hidden = true;
}

window.addEventListener("keydown", e => {
	if (e.key == "Escape") {
		if (hangar.visible) {
			hangar.close();
		} else if (menu.modalVisible) { /* settings or help */
			menu.closeModal();
		} else if (game.paused) {
			resume();
		} else if (game.playing) {
			pause();
		} else if (game.level !== null && !game.online) { /* level over: leave the result panel */
			backToLevels(game.level);
		} else if (menu.singlePlayerVisible) {
			menu.showTitle();
		} else {
			online.back();
		}
	}

	if (e.key == "Enter" && menu.singlePlayerVisible && !(document.activeElement instanceof HTMLButtonElement)) { menu.start(); }
});

menu.showTitle();

const saved = savedToken();
const invite = invitedTo();
if (saved) {
	/* reloaded while in a room: back into it */
	token = saved;
	lostAt = performance.now();
	menu.hideAll();
	showReconnecting("Getting back into your room…");
	void reconnect();
} else if (invite) {
	/* opened from an invite link: ready to join */
	menu.hideAll();
	online.showJoin(leaderboard.lastName, invite);
}
