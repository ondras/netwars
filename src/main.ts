import { Game, type LevelResult } from "./game.ts";
import { LEVELS } from "./levels.ts";
import { Menu, type ResultAction } from "./menu.ts";
import { Leaderboard, score } from "./scores.ts";
import { effectsVolume, setEffectsVolume } from "./settings.ts";

const game = new Game(document.querySelector<HTMLElement>("#game")!);
const leaderboard = new Leaderboard();
const menu = new Menu(LEVELS, leaderboard, effectsVolume());

function play(level: number): void {
	menu.hideResult();
	document.body.classList.add("playing");
	game.start(level);
}

function backToMenu(level: number): void {
	game.stop();
	document.body.classList.remove("playing");
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
menu.onLeave = () => backToMenu(game.level ?? 0);
menu.onVolume = volume => {
	setEffectsVolume(volume);
	game.setEffectsVolume(volume);
};
menu.onVolumeSet = () => game.playTestSound();

game.onOutcome = ({ level, outcome, podsLeft, podsTotal, destroyed, shields, difficulty }: LevelResult) => {
	document.body.classList.remove("playing"); /* show the cursor for the buttons */
	const toMenu: ResultAction = { label: "Menu", action: () => backToMenu(level) };
	const retry: ResultAction = { label: "Retry", action: () => play(level) };

	const name = LEVELS[level].name;
	const points = score({ won: outcome == "won", podsLeft, destroyed, shields, difficulty });
	const details = { score: points, level: name, entry: leaderboard.add(name, points.total, difficulty) };

	switch (outcome) {
		case "won": {
			const next = level + 1;
			const proceed: ResultAction = (next < LEVELS.length
				? { label: "Next level", action: () => play(next) }
				: { label: "Play again", action: () => play(0) });
			const last = (next < LEVELS.length ? "" : " That was the last level.");
			menu.showResult(`Level ${level + 1} complete`, `Pods saved: ${podsLeft} of ${podsTotal}.${last}`, [proceed, toMenu], details);
		} break;

		case "ship-destroyed":
			menu.showResult("Ship destroyed", `Level ${level + 1}: ${name}`, [retry, toMenu], details);
		break;

		case "pods-lost":
			menu.showResult("All pods lost", `Level ${level + 1}: ${name}`, [retry, toMenu], details);
		break;
	}
};

window.addEventListener("keydown", e => {
	if (e.key == "Escape") {
		if (menu.modalVisible) { /* settings or help */
			menu.closeModal();
		} else if (game.paused) {
			resume();
		} else if (game.playing) {
			pause();
		} else if (game.level !== null) { /* level over: leave the result panel */
			backToMenu(game.level);
		}
	}

	if (e.key == "Enter" && menu.visible && !(document.activeElement instanceof HTMLButtonElement)) { menu.start(); }
});

menu.show(0);
