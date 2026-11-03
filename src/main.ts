import { difficultyLevel } from "./difficulty.ts";
import { Game, type LevelResult } from "./game.ts";
import { LEVELS } from "./levels.ts";
import { Menu, type ResultAction } from "./menu.ts";
import { Connection } from "./net/connection.ts";
import { invitedTo, OnlineMenu } from "./net/online-menu.ts";
import type { ClientMessage, RoomInfo, ServerMessage } from "./net/protocol.ts";
import { Leaderboard, score } from "./scores.ts";
import { effectsVolume, setEffectsVolume } from "./settings.ts";

const game = new Game(document.querySelector<HTMLElement>("#game")!);
const leaderboard = new Leaderboard();
const menu = new Menu(LEVELS, leaderboard, effectsVolume());
const online = new OnlineMenu(LEVELS);

function play(level: number): void {
	menu.hideResult();
	document.body.classList.add("playing");
	game.start(level);
}

function backToMenu(level: number): void {
	game.stop();
	document.body.classList.remove("playing");
	online.hide();
	menu.show(level);
}

function pause(): void {
	game.pause();
	document.body.classList.remove("playing"); /* show the cursor for the buttons */
	menu.showPause();
}

function resume(): void {
	menu.hidePause();
	document.body.classList.add("playing");
	game.resume();
}

menu.onStart = play;
menu.onResume = resume;
menu.onLeave = () => (game.online ? leaveRoom() : backToMenu(game.level ?? 0));
menu.onVolume = volume => {
	setEffectsVolume(volume);
	game.setEffectsVolume(volume);
};
menu.onVolumeSet = () => game.playTestSound();

game.onOutcome = (result: LevelResult) => {
	document.body.classList.remove("playing"); /* show the cursor for the buttons */
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
		"ship-destroyed": [(result.online ? "All ships destroyed" : "Ship destroyed"), `Level ${level + 1}: ${name}`],
		"pods-lost": ["All pods lost", `Level ${level + 1}: ${name}`],
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

	const toMenu: ResultAction = { label: "Menu", action: () => backToMenu(level) };
	const proceed: ResultAction = (outcome == "won"
		? (next < LEVELS.length ? { label: "Next level", action: () => play(next) } : { label: "Play again", action: () => play(0) })
		: { label: "Retry", action: () => play(level) });
	menu.showResult(title, text, [proceed, toMenu], details);
};

/* Online play */

let connection: Connection | null = null;
/** This player's id in the room, and the room as last heard of */
let me: number | null = null;
let room: RoomInfo | null = null;

const send = (message: ClientMessage) => connection?.send(message);

menu.onOnline = () => online.showJoin(leaderboard.lastName);
online.onBack = () => backToMenu(menu.selectedLevel);
online.onCreate = name => connectThen(name, { type: "create", name, level: menu.selectedLevel, difficulty: difficultyLevel() });
online.onJoin = (code, name) => connectThen(name, { type: "join", code, name });
online.onSetup = (level, difficulty) => send({ type: "setup", level, difficulty });
online.onStart = () => send({ type: "start" });
online.onLeave = () => leaveRoom();

/** Connect (unless connected) and send the first message */
async function connectThen(name: string, message: ClientMessage): Promise<void> {
	game.unlockAudio(); /* a click: sound may start now, ready for the level the host starts later */
	leaderboard.remember(name);
	online.setBusy(true);
	if (!connection) {
		try {
			connection = await Connection.open();
		} catch {
			online.showError("Cannot reach the game server. Is it running?");
			return;
		}
		connection.onMessage = receive;
		connection.onClose = () => disconnected("Lost the connection to the game server.");
	}
	connection.send(message);
}

function receive(message: ServerMessage): void {
	switch (message.type) {
		case "welcome":
			me = message.you;
			showRoom(message.room);
		break;

		case "room": showRoom(message.room); break;
		case "error": online.showError(message.message); break;

		case "start":
			menu.hideAll();
			online.hide();
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
	if (info.state == "playing" || (info.state == "over" && game.online)) { return; }

	if (game.online) { game.stop(); } /* back from a level */
	document.body.classList.remove("playing");
	menu.hideAll();
	online.showLobby(info, me!);
}

function leaveRoom(): void {
	send({ type: "leave" });
	connection?.close();
	connection = null;
	me = null;
	room = null;
	backToMenu(menu.selectedLevel);
}

function disconnected(why: string): void {
	connection = null;
	me = null;
	room = null;
	game.stop();
	document.body.classList.remove("playing");
	menu.hideAll();
	online.showJoin(leaderboard.lastName);
	online.showError(why);
}

window.addEventListener("keydown", e => {
	if (e.key == "Escape") {
		if (menu.modalVisible) { /* settings or help */
			menu.closeModal();
		} else if (game.paused) {
			resume();
		} else if (game.playing) {
			pause();
		} else if (game.level !== null && !game.online) { /* level over: leave the result panel */
			backToMenu(game.level);
		}
	}

	if (e.key == "Enter" && menu.visible && !(document.activeElement instanceof HTMLButtonElement)) { menu.start(); }
});

menu.show(0);

/* opened from an invite link: ready to join */
const invite = invitedTo();
if (invite) {
	menu.hideAll();
	online.showJoin(leaderboard.lastName, invite);
}
